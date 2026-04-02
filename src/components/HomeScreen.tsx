import React, { useState, useRef, useEffect } from 'react';
import { Goal, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Send, Check, Edit2, Trash2, Plus, ArrowLeft, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Panda } from './Panda';
import { structureGoalFromAudio, StructuredGoal } from '../services/geminiService';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface HomeScreenProps {
  user: any;
  dbUser: User | null;
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
  const [isSaving, setIsSaving] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [structuredGoal, setStructuredGoal] = useState<StructuredGoal | null>(null);
  const [manualTasks, setManualTasks] = useState<string[]>([]);
  const [newTaskInput, setNewTaskInput] = useState('');
  const [editingManualTaskIndex, setEditingManualTaskIndex] = useState<number | null>(null);
  const [editingManualTaskText, setEditingManualTaskText] = useState('');
  const [currentView, setCurrentView] = useState<'voice' | 'review'>('voice');

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

  const handlePandaClick = async () => {
    if (isRecording) {
      const audioBlob = await stopRecording();
      if (audioBlob) {
        processAudio(audioBlob);
      }
    } else {
      setProcessingError(null);
      await startRecording();
    }
  };

  const processAudio = async (blob: Blob) => {
    setLoading(true);
    setProcessingError(null);
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

      const userContext = {
        age: dbUser?.age,
        locality: dbUser?.locality
      };

      const structured = await structureGoalFromAudio(base64Audio, blob.type, userContext);
      
      // Update app language based on detected language
      if (structured.language) {
        const langCode = mapLanguageNameToCode(structured.language);
        if (langCode !== 'en') {
          setLanguage(langCode);
        }
      }

      setStructuredGoal(structured);
      setCurrentView('review');
    } catch (err: any) {
      console.error('Processing error:', err);
      setProcessingError(err.message || t('error'));
    } finally {
      setLoading(false);
    }
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
            <div className="relative flex flex-col items-center">
              <Panda isListening={isRecording} onClick={handlePandaClick} />
              
              <motion.div
                key={isRecording ? 'recording' : 'idle'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 text-center"
              >
                <p className="text-zinc-400 text-lg font-medium tracking-tight">
                  {isRecording ? t('recording') : t('tapToRecord')}
                </p>
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
                  <div className="flex items-center gap-3 text-zinc-400 bg-zinc-900/50 px-6 py-3 rounded-2xl border border-white/5 backdrop-blur-xl">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm font-medium">{t('processing')}</span>
                  </div>
                )}
                {(recorderError || processingError) && (
                  <div className="text-red-400 text-sm text-center bg-red-400/10 px-6 py-3 rounded-2xl border border-red-400/20 backdrop-blur-xl">
                    {recorderError || processingError}
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
                  <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold mb-3 block">{t('transcript')}</label>
                    <p className="text-sm text-zinc-400 italic leading-relaxed">"{structuredGoal.transcript}"</p>
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
                  <div className="scale-75">
                    <Panda isListening={isRecording} onClick={handlePandaClick} />
                  </div>
                </div>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
