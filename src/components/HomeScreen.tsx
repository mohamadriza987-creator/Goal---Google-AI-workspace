import React, { useState, useRef, useEffect } from 'react';
import { Goal, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Send, Check, Edit2, Trash2, Plus, ArrowLeft, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Panda } from './Panda';
import { transcribeAudio, generateGoalFromTranscript, StructuredGoal } from '../services/geminiService';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface HomeScreenProps {
  user: any;
  dbUser: User | null;
  goals: Goal[];                             // passed from App — used by new home screen
  setCurrentScreen: (screen: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  addOptimisticGoal: (goal: Goal) => void;
  performSaveGoal: (goal: Goal) => Promise<void>;
}

import { useTranslation } from '../contexts/LanguageContext';
import { mapLanguageNameToCode } from '../lib/translations';

export function HomeScreen({ 
  user, 
  dbUser, 
  setCurrentScreen, 
  handleFirestoreError,
  addOptimisticGoal,
  performSaveGoal
}: HomeScreenProps) {
  const { t, setLanguage } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [processingState, setProcessingState] = useState<'idle' | 'transcribing' | 'generating'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);
  const [structuredGoal, setStructuredGoal] = useState<StructuredGoal | null>(null);
  const [manualTasks, setManualTasks] = useState<string[]>([]);
  const [newTaskInput, setNewTaskInput] = useState('');
  const [editingManualTaskIndex, setEditingManualTaskIndex] = useState<number | null>(null);
  const [editingManualTaskText, setEditingManualTaskText] = useState('');
  const [currentView, setCurrentView] = useState<'voice' | 'review'>('voice');
  const [isTyping, setIsTyping] = useState(false);
  const [typedGoal, setTypedGoal] = useState('');
  const [refinementCount, setRefinementCount] = useState(0);
  const [isAddingDetails, setIsAddingDetails] = useState(false);
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const REFINEMENT_LIMIT = 5;

  const {
    isRecording,
    startRecording,
    stopRecording,
    error: recorderError
  } = useAudioRecorder();

  // Auto-resize textareas on review screen
  useEffect(() => {
    const adjustHeights = () => {
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
      });
    };

    if (currentView === 'review') {
      // Use a small timeout to ensure DOM is ready and styles are applied
      const timeoutId = setTimeout(adjustHeights, 50);

      window.addEventListener('resize', adjustHeights);
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', adjustHeights);
      };
    }
  }, [currentView, structuredGoal, manualTasks, editingManualTaskIndex]);

  const processAudio = async (blob: Blob, isRefinement = false) => {
    setLoading(true);
    setProcessingState('transcribing');
    setProcessingError(null);

    if (!isRefinement) {
      setCurrentTranscript(null);
    }

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          resolve(base64String);
        };
      });
      reader.readAsDataURL(blob);
      const base64Audio = await base64Promise;

      const idToken = await user.getIdToken();

      // Step 1: Transcription
      const transcript = await transcribeAudio(base64Audio, blob.type, idToken);

      if (isRefinement) {
        const combinedTranscript = `${currentTranscript}\n\nAdditional details: ${transcript}`;
        setCurrentTranscript(combinedTranscript);
        await processTranscript(combinedTranscript, idToken, true);
      } else {
        setCurrentTranscript(transcript);
        await processTranscript(transcript, idToken);
      }
    } catch (err: any) {
      console.error('Processing error:', err);
      setProcessingError(err.message || t('error'));
    } finally {
      setLoading(false);
      setProcessingState('idle');
    }
  };

  const processTranscript = async (transcript: string, idToken?: string, isRefinement = false) => {
    setLoading(true);
    setProcessingState('generating');
    setProcessingError(null);

    try {
      const userContext = {
        age: dbUser?.age,
        locality: dbUser?.locality
      };

      const token = idToken || await user.getIdToken();
      const structured = await generateGoalFromTranscript(transcript, token, userContext);

      // Update app language based on detected language
      if (structured.language) {
        const langCode = mapLanguageNameToCode(structured.language);
        if (langCode !== 'en') {
          setLanguage(langCode);
        }
      }

      setStructuredGoal(structured);
      setCurrentView('review');
      if (isRefinement) {
        setRefinementCount(prev => prev + 1);
        setIsAddingDetails(false);
        setAdditionalDetails('');
      }
    } catch (err: any) {
      console.error('Processing error:', err);
      setProcessingError(err.message || t('error'));
    } finally {
      setLoading(false);
      setProcessingState('idle');
    }
  };

  const handleTypedGoalSubmit = async () => {
    if (!typedGoal.trim()) return;
    setCurrentTranscript(typedGoal.trim());
    const idToken = await user.getIdToken();
    await processTranscript(typedGoal.trim(), idToken);
    setTypedGoal('');
    setIsTyping(false);
  };

  const handleRegenerate = async () => {
    if (!currentTranscript) return;
    setIsEditingTranscript(false);
    const idToken = await user.getIdToken();
    await processTranscript(currentTranscript, idToken, true);
  };

  const handleAddDetailsSubmit = async () => {
    if (!additionalDetails.trim() || refinementCount >= REFINEMENT_LIMIT) return;
    const combinedTranscript = `${currentTranscript}\n\nAdditional details: ${additionalDetails.trim()}`;
    setCurrentTranscript(combinedTranscript);
    const idToken = await user.getIdToken();
    await processTranscript(combinedTranscript, idToken, true);
  };

  const handlePandaClick = async () => {
    if (isRecording) {
      const audioBlob = await stopRecording();
      if (audioBlob) {
        if (isAddingDetails) {
          processAudio(audioBlob, true);
        } else if (currentView === 'review') {
          processAudio(audioBlob, true);
        } else {
          processAudio(audioBlob);
        }
      }
    } else {
      setProcessingError(null);
      await startRecording();
    }
  };

  const retryGeneration = async () => {
    if (!currentTranscript) return;
    const idToken = await user.getIdToken();
    await processTranscript(currentTranscript, idToken);
  };

  const saveGoal = async () => {
    if (!user || !structuredGoal || isSaving) return;

    setIsSaving(true);
    const tempId = `temp-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const optimisticGoal: Goal = {
      id: tempId,
      ownerId: user.uid,
      title: structuredGoal.goalTitle,
      description: structuredGoal.goalDescription,
      category: structuredGoal.category,
      visibility: structuredGoal.privacy,
      progressPercent: 0,
      likesCount: 0,
      status: 'active',
      createdAt: createdAt,
      savingStatus: 'saving',
      sourceText: structuredGoal.transcript,
      normalizedMatchingText: structuredGoal.normalizedMatchingText,
      timeHorizon: structuredGoal.timeHorizon,
      tags: structuredGoal.tags,
      matchingMetadata: {
        age: dbUser?.age ?? null,
        locality: dbUser?.locality ?? null
      },
      draftData: {
        structuredGoal,
        manualTasks
      }
    };

    // Optimistically add to UI
    addOptimisticGoal(optimisticGoal);

    // Navigate immediately
    setCurrentScreen('goals');

    try {
      await performSaveGoal(optimisticGoal);

      // Clear draft since it's saved
      setStructuredGoal(null);
      setManualTasks([]);
      setCurrentView('voice');
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const discardDraft = () => {
    setStructuredGoal(null);
    setManualTasks([]);
    setCurrentView('voice');
    setRefinementCount(0);
    setIsAddingDetails(false);
    setAdditionalDetails('');
  };

  const toggleTaskSelection = (task: string) => {
    if (!structuredGoal) return;
    const isSelected = structuredGoal.suggestedTasks.includes(task);
    const newTasks = isSelected 
      ? structuredGoal.suggestedTasks.filter(t => t !== task)
      : [...structuredGoal.suggestedTasks, task];

    setStructuredGoal({
      ...structuredGoal,
      suggestedTasks: newTasks
    });
  };

  const addManualTask = () => {
    if (newTaskInput.trim()) {
      setManualTasks(prev => [...prev, newTaskInput.trim()]);
      setNewTaskInput('');
    }
  };

  const removeManualTask = (index: number) => {
    setManualTasks(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="h-full">
      <AnimatePresence mode="wait">
        {currentView === 'voice' ? (
          <motion.div
            key="voice"
            initial={{ opacity: 0, y: 20 }}
            animate={{ 
              opacity: 1, 
              y: 0,
              scale: isRecording ? 0.9 : 1,
            }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center h-[100dvh] p-6 overflow-hidden"
          >
            <div className="relative flex flex-col items-center w-full max-w-md">
              <Panda 
                isListening={isRecording} 
                onClick={handlePandaClick} 
                className="w-64 h-64"
              />

              <motion.div
                key={isRecording ? 'recording' : isTyping ? 'typing' : 'idle'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 text-center w-full"
              >
                {!isTyping ? (
                  <>
                    <p className="text-zinc-400 text-lg font-medium tracking-tight">
                      {isRecording ? t('recording') : t('tapToRecord')}
                    </p>
                    {!isRecording && (
                      <button 
                        onClick={() => setIsTyping(true)}
                        className="mt-4 flex items-center gap-2 mx-auto text-zinc-500 hover:text-white transition-colors text-sm font-medium"
                      >
                        <Edit2 size={16} />
                        {t('typeInstead')}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="w-full relative group">
                    <textarea
                      autoFocus
                      placeholder={t('typeYourGoal')}
                      value={typedGoal}
                      onChange={(e) => {
                        setTypedGoal(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleTypedGoalSubmit();
                        }
                      }}
                      className={cn(
                        "w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 pr-14 text-white placeholder-zinc-500 focus:outline-none focus:border-white/20 resize-none overflow-hidden min-h-[120px] transition-opacity",
                        loading && processingState === 'generating' && !isAddingDetails && currentView === 'voice' && "opacity-30"
                      )}
                    />
                    {loading && processingState === 'generating' && !isAddingDetails && currentView === 'voice' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-zinc-900/80 backdrop-blur-sm px-6 py-3 rounded-full border border-white/5 flex items-center gap-3">
                          <Loader2 size={18} className="animate-spin text-white" />
                          <span className="text-sm font-bold uppercase tracking-widest text-white">
                            {t('processing')}
                          </span>
                        </div>
                      </div>
                    )}
                    <button 
                      onClick={handleTypedGoalSubmit}
                      disabled={!typedGoal.trim() || loading}
                      className="absolute bottom-3 right-3 bg-white text-black p-3 rounded-xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50 active:scale-95 shadow-lg"
                    >
                      {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                  </div>
                )}
                {isRecording && (
                  <div className="flex gap-1 justify-center mt-4">
                    {[1, 2, 3, 4, 5].map(i => (
                      <motion.div
                        key={i}
                        animate={{ height: [4, 16, 4] }}
                        transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                        className="w-1 bg-white/40 rounded-full"
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            </div>

            {(loading || recorderError || processingError) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-12 flex flex-col items-center gap-4"
              >
                {loading && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-3 text-zinc-400 bg-zinc-900/50 px-6 py-3 rounded-2xl border border-white/5 backdrop-blur-xl">
                      <Loader2 size={18} className="animate-spin" />
                      <span className="text-sm font-medium">
                        {processingState === 'transcribing' ? 'Transcribing audio...' : 'Generating your goal...'}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest animate-pulse">
                        {processingState === 'transcribing' ? 'Step 1 of 2' : 'Step 2 of 2'}
                      </p>
                      <button 
                        onClick={() => {
                          setLoading(false);
                          setProcessingState('idle');
                          setProcessingError('Process cancelled by user');
                        }}
                        className="text-[10px] text-zinc-500 hover:text-white underline transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {(recorderError || processingError) && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="text-red-400 text-sm text-center bg-red-400/10 px-6 py-3 rounded-2xl border border-red-400/20 backdrop-blur-xl">
                      {recorderError || processingError}
                    </div>
                    {processingError && currentTranscript && (
                      <button 
                        onClick={retryGeneration}
                        className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white transition-colors"
                      >
                        Retry Generation
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        ) : (
          structuredGoal && (
            <motion.div
              key="review"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-4xl mx-auto p-6 pt-12 pb-32 flex flex-col lg:flex-row gap-12"
            >
              <div className="flex-1 space-y-8">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCurrentView('voice')} className="text-zinc-500 hover:text-white flex items-center gap-2">
                    <ArrowLeft size={20} /> {t('back')}
                  </button>
                  <button onClick={discardDraft} className="text-red-500/70 hover:text-red-500 text-sm font-medium">
                    {t('discard')}
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold block">{t('transcript')}</label>
                        <button 
                          onClick={() => {
                            if (isEditingTranscript) {
                              handleRegenerate();
                            } else {
                              setIsEditingTranscript(true);
                            }
                          }}
                          disabled={loading}
                          className="text-zinc-500 hover:text-white transition-colors p-1 flex items-center gap-2"
                        >
                          {isEditingTranscript ? (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-green-500">{t('done')}</span>
                          ) : (
                            <Edit2 size={12} />
                          )}
                        </button>
                        {loading && processingState === 'generating' && !isAddingDetails && (
                          <div className="flex items-center gap-2 text-zinc-500">
                            <Loader2 size={10} className="animate-spin" />
                            <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse">
                              {t('processing').split(' ')[0]}...
                            </span>
                          </div>
                        )}
                      </div>
                      {refinementCount > 0 && (
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                          {t('refinementLimitReached').split(' ')[0]}: {refinementCount}/{REFINEMENT_LIMIT}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <textarea
                        readOnly={!isEditingTranscript}
                        value={currentTranscript || ''}
                        onChange={(e) => {
                          setCurrentTranscript(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        className={cn(
                          "w-full bg-transparent border-none focus:ring-0 p-0 text-sm italic leading-relaxed resize-none overflow-hidden transition-colors",
                          isEditingTranscript ? "text-white" : "text-zinc-400",
                          loading && processingState === 'generating' && !isAddingDetails && "opacity-30"
                        )}
                      />
                      {loading && processingState === 'generating' && !isAddingDetails && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-zinc-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-white/5 flex items-center gap-3">
                            <Loader2 size={14} className="animate-spin text-white" />
                            <span className="text-xs font-bold uppercase tracking-widest text-white">
                              {t('processing')}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {!isAddingDetails && refinementCount < REFINEMENT_LIMIT && (
                      <div className="flex flex-wrap items-center gap-4 pt-2">
                        <button 
                          onClick={() => setIsAddingDetails(true)}
                          className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors flex items-center gap-2"
                        >
                          <Plus size={12} />
                          {t('addMoreDetails')}
                        </button>
                      </div>
                    )}

                    <AnimatePresence>
                      {isAddingDetails && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="pt-4 border-t border-white/5 space-y-4 overflow-hidden"
                        >
                          <div className="relative">
                            <textarea
                              autoFocus
                              placeholder={t('typeAdditionalDetails')}
                              value={additionalDetails}
                              onChange={(e) => {
                                setAdditionalDetails(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                              className={cn(
                                "w-full bg-zinc-950/50 border border-white/5 rounded-2xl pl-4 pr-12 py-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/10 resize-none overflow-hidden min-h-[60px] transition-opacity",
                                loading && processingState === 'generating' && isAddingDetails && "opacity-30"
                              )}
                            />
                            {loading && processingState === 'generating' && isAddingDetails && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-zinc-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-white/5 flex items-center gap-3">
                                  <Loader2 size={14} className="animate-spin text-white" />
                                  <span className="text-xs font-bold uppercase tracking-widest text-white">
                                    {t('processing')}
                                  </span>
                                </div>
                              </div>
                            )}
                            <div className="absolute right-2 bottom-2 flex items-center gap-2">
                              {additionalDetails.trim().length > 0 && (
                                <button 
                                  onClick={handleAddDetailsSubmit}
                                  disabled={loading}
                                  className="p-2 bg-white text-black rounded-full hover:bg-zinc-200 transition-colors disabled:opacity-50"
                                >
                                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <button 
                              onClick={() => {
                                setIsAddingDetails(false);
                                setAdditionalDetails('');
                              }}
                              className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white transition-colors"
                            >
                              {t('discard')}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-widest text-zinc-500 mb-2 block">{t('reviewGoal')}</label>
                      <textarea
                        value={structuredGoal.goalTitle}
                        onChange={(e) => {
                          setStructuredGoal({ ...structuredGoal, goalTitle: e.target.value });
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          target.style.height = 'auto';
                          target.style.height = target.scrollHeight + 'px';
                        }}
                        rows={1}
                        className="text-4xl font-bold bg-transparent border-none focus:ring-0 w-full p-0 tracking-tight resize-none overflow-hidden"
                      />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-zinc-500 mb-2 block">{t('goalDescription')}</label>
                    <textarea
                      value={structuredGoal.goalDescription}
                      onChange={(e) => {
                        setStructuredGoal({ ...structuredGoal, goalDescription: e.target.value });
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = target.scrollHeight + 'px';
                      }}
                      className="text-xl text-zinc-400 bg-transparent border-none focus:ring-0 w-full p-0 leading-relaxed resize-none overflow-hidden min-h-[6rem]"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="text-xs uppercase tracking-widest text-zinc-500 mb-4 block">{t('suggestedTasks')}</label>
                      <div className="space-y-3">
                        {structuredGoal.suggestedTasks.map((task, i) => (
                          <motion.div 
                            key={i} 
                            className={`flex items-start gap-4 p-4 rounded-2xl border transition-all bg-zinc-900/50 border-zinc-800 hover:border-zinc-700`}
                          >
                            <div 
                              onClick={() => toggleTaskSelection(task)}
                              className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors border-green-500 bg-green-500/10 mt-0.5`}
                            >
                              <Check size={14} className="text-green-500" />
                            </div>
                            <textarea
                              value={task}
                              onChange={(e) => {
                                const newTasks = [...structuredGoal.suggestedTasks];
                                newTasks[i] = e.target.value;
                                setStructuredGoal({ ...structuredGoal, suggestedTasks: newTasks });
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                              onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = target.scrollHeight + 'px';
                              }}
                              rows={1}
                              className="bg-transparent border-none focus:ring-0 w-full p-0 text-sm font-medium transition-all resize-none overflow-hidden"
                            />
                            <button 
                              onClick={() => {
                                const newTasks = structuredGoal.suggestedTasks.filter((_, idx) => idx !== i);
                                setStructuredGoal({ ...structuredGoal, suggestedTasks: newTasks });
                              }}
                              className="text-zinc-600 hover:text-red-400 mt-0.5"
                            >
                              <X size={14} />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-widest text-zinc-500 mb-4 block">{t('manualTasks') || 'Manual Tasks'}</label>
                      <div className="space-y-3">
                        {manualTasks.map((task, i) => (
                          <div key={i} className="flex items-start gap-4 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 group transition-all hover:border-zinc-700">
                            <div className="w-6 h-6 rounded-full border border-green-500 flex items-center justify-center flex-shrink-0 bg-green-500/10 mt-0.5">
                              <Check size={14} className="text-green-500" />
                            </div>
                            {editingManualTaskIndex === i ? (
                              <textarea
                                autoFocus
                                value={editingManualTaskText}
                                onChange={(e) => {
                                  setEditingManualTaskText(e.target.value);
                                  e.target.style.height = 'auto';
                                  e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                onInput={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  target.style.height = 'auto';
                                  target.style.height = target.scrollHeight + 'px';
                                }}
                                onBlur={() => {
                                  const newTasks = [...manualTasks];
                                  newTasks[i] = editingManualTaskText;
                                  setManualTasks(newTasks);
                                  setEditingManualTaskIndex(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    const newTasks = [...manualTasks];
                                    newTasks[i] = editingManualTaskText;
                                    setManualTasks(newTasks);
                                    setEditingManualTaskIndex(null);
                                  }
                                }}
                                rows={1}
                                className="flex-1 bg-transparent border-none focus:outline-none text-sm text-white resize-none overflow-hidden"
                              />
                            ) : (
                              <span 
                                onClick={() => {
                                  setEditingManualTaskIndex(i);
                                  setEditingManualTaskText(task);
                                }}
                                className="text-sm text-zinc-300 flex-1 cursor-text break-words"
                              >
                                {task}
                              </span>
                            )}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                              <button 
                                onClick={() => {
                                  setEditingManualTaskIndex(i);
                                  setEditingManualTaskText(task);
                                }}
                                className="p-1 text-zinc-500 hover:text-white transition-colors"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button 
                                onClick={() => removeManualTask(i)} 
                                className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}

                        <div className="flex items-start gap-2 mt-4">
                          <textarea
                            placeholder={t('addNote') + "..."}
                            value={newTaskInput}
                            onChange={(e) => {
                              setNewTaskInput(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onInput={(e) => {
                              const target = e.target as HTMLTextAreaElement;
                              target.style.height = 'auto';
                              target.style.height = target.scrollHeight + 'px';
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                addManualTask();
                              }
                            }}
                            rows={1}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 resize-none overflow-hidden"
                          />
                          <button 
                            onClick={addManualTask}
                            className="p-3 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors mt-0.5"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
                    <div className="space-y-4">
                      <label className="text-xs uppercase tracking-widest text-zinc-500 block">{t('category')} & {t('timeHorizon')}</label>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <select 
                          value={structuredGoal.category}
                          onChange={(e) => setStructuredGoal({ ...structuredGoal, category: e.target.value })}
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-600"
                        >
                          {['health', 'finance', 'learning', 'business', 'personal', 'social', 'other'].map(c => (
                            <option key={c} value={c}>{t(c) || c.charAt(0).toUpperCase() + c.slice(1)}</option>
                          ))}
                        </select>
                        <textarea 
                          value={structuredGoal.timeHorizon}
                          onChange={(e) => {
                            setStructuredGoal({ ...structuredGoal, timeHorizon: e.target.value });
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = target.scrollHeight + 'px';
                          }}
                          rows={1}
                          placeholder={t('timeHorizon')}
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-600 resize-none overflow-hidden"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-xs uppercase tracking-widest text-zinc-500 block">{t('privacy')}</label>
                      <div className="flex bg-zinc-900 border border-zinc-800 p-1 rounded-2xl">
                        {(['private', 'group', 'public'] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setStructuredGoal({ ...structuredGoal, privacy: v })}
                            className={cn(
                              "flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all",
                              structuredGoal.privacy === v ? "bg-white text-black" : "text-zinc-500 hover:text-white"
                            )}
                          >
                            {t(v)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs uppercase tracking-widest text-zinc-500 block">{t('tags')}</label>
                    <div className="flex flex-wrap gap-2">
                      {structuredGoal.tags.map((tag, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full text-xs text-zinc-400">
                          <span>#{tag}</span>
                          <button 
                            onClick={() => {
                              const newTags = structuredGoal.tags.filter((_, idx) => idx !== i);
                              setStructuredGoal({ ...structuredGoal, tags: newTags });
                            }}
                            className="hover:text-red-400"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <input 
                        placeholder={"+ " + t('tags')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim().replace('#', '');
                            if (val) {
                              setStructuredGoal({ ...structuredGoal, tags: [...structuredGoal.tags, val] });
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                        className="bg-transparent border-none focus:ring-0 text-xs text-zinc-500 w-24"
                      />
                    </div>
                  </div>

                  <button
                    onClick={saveGoal}
                    disabled={isSaving}
                    className="w-full py-4 bg-white text-black rounded-2xl font-bold hover:bg-zinc-200 transition-colors mt-12 flex items-center justify-center gap-2"
                  >
                    {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} />}
                    {isSaving ? t('saving') : t('saveGoal')}
                  </button>
                </div>
              </div>

              <div className="lg:w-80 flex flex-col items-center justify-center">
                <div className="relative group">
                  <Panda 
                    isListening={isRecording} 
                    onClick={handlePandaClick} 
                    className="w-48 h-48"
                  />
                </div>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}