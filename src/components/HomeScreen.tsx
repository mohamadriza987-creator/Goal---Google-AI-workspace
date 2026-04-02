import React, { useState, useRef, useEffect } from 'react';
import { Goal, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Send, Check, Edit2, Trash2, Plus, ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Panda } from './Panda';
import { structureGoal, StructuredGoal } from '../services/geminiService';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

interface HomeScreenProps {
  user: any;
  dbUser: User | null;
  setCurrentScreen: (screen: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
}

export function HomeScreen({ user, dbUser, setCurrentScreen, handleFirestoreError }: HomeScreenProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [structuredGoal, setStructuredGoal] = useState<StructuredGoal | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [manualTasks, setManualTasks] = useState<string[]>([]);
  const [newTaskInput, setNewTaskInput] = useState('');
  const [goalVisibility, setGoalVisibility] = useState<'private' | 'group' | 'public'>('private');
  const [publicFields, setPublicFields] = useState<string[]>(['title', 'description']);
  const [editingManualTaskIndex, setEditingManualTaskIndex] = useState<number | null>(null);
  const [editingManualTaskText, setEditingManualTaskText] = useState('');
  const [currentView, setCurrentView] = useState<'voice' | 'review'>('voice');

  const recognitionRef = useRef<any>(null);

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      if (transcript.trim()) {
        processGoal(transcript);
      }
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(prev => prev + final);
      setInterimTranscript(interim);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const processGoal = async (text: string) => {
    setLoading(true);
    try {
      const structured = await structureGoal(text);
      setStructuredGoal(structured);
      setSelectedTasks(structured.tasks);
      setCurrentView('review');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveGoal = async () => {
    if (!user || !structuredGoal) return;
    setLoading(true);
    try {
      const goalData = {
        ownerId: user.uid,
        title: structuredGoal.title,
        description: structuredGoal.description,
        category: structuredGoal.category,
        progressPercent: 0,
        visibility: goalVisibility,
        publicFields: goalVisibility === 'public' ? publicFields : [],
        createdAt: new Date().toISOString(),
      };

      const goalRef = await addDoc(collection(db, 'goals'), goalData);
      
      const batch = writeBatch(db);
      const allTasks = [...selectedTasks, ...manualTasks];
      
      allTasks.forEach((taskText, index) => {
        const taskRef = doc(collection(db, 'goals', goalRef.id, 'tasks'));
        batch.set(taskRef, {
          text: taskText,
          isDone: false,
          order: index,
          createdAt: new Date().toISOString(),
          source: selectedTasks.includes(taskText) ? 'ai' : 'manual'
        });
      });

      await batch.commit();
      
      // Reset state
      setStructuredGoal(null);
      setTranscript('');
      setSelectedTasks([]);
      setManualTasks([]);
      setCurrentView('voice');
      setCurrentScreen('goals');
    } catch (err) {
      handleFirestoreError(err, 'write', 'goals');
    } finally {
      setLoading(false);
    }
  };

  const toggleTaskSelection = (task: string) => {
    setSelectedTasks(prev => 
      prev.includes(task) ? prev.filter(t => t !== task) : [...prev, task]
    );
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
              scale: isListening ? 0.85 : 1,
            }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center h-screen p-6 overflow-hidden"
          >
            <Panda isListening={isListening} onClick={startListening} />
            
            <motion.div 
              className="mt-12 text-center max-w-lg"
              animate={{ y: isListening ? -20 : 0 }}
            >
              <p className="text-zinc-500 text-sm uppercase tracking-widest mb-4">
                {isListening ? "Tapping panda will stop recording" : "Tap the panda to speak"}
              </p>
              
              <AnimatePresence mode="wait">
                {!isListening ? (
                  <motion.h2 
                    key="prompt"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-2xl font-medium"
                  >
                    What's your goal?
                  </motion.h2>
                ) : (
                  <motion.div
                    key="transcript"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <div className="text-xl text-zinc-300 leading-relaxed min-h-[3rem]">
                      {transcript}
                      <span className="text-zinc-500">{interimTranscript}</span>
                      <motion.span
                        animate={{ opacity: [1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-1 h-6 bg-white ml-1 align-middle"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
            
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-8 flex items-center gap-2 text-zinc-400"
              >
                <Loader2 size={16} className="animate-spin" />
                <span>Structuring your goal...</span>
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
                <button onClick={() => setCurrentView('voice')} className="mb-4 text-zinc-500 hover:text-white flex items-center gap-2">
                  <ArrowLeft size={20} /> Back
                </button>
                
                <div className="space-y-8">
                  <div>
                    <label className="text-xs uppercase tracking-widest text-zinc-500 mb-2 block">Goal Title</label>
                    <input
                      value={structuredGoal.title}
                      onChange={(e) => setStructuredGoal({ ...structuredGoal, title: e.target.value })}
                      className="text-4xl font-bold bg-transparent border-none focus:ring-0 w-full p-0 tracking-tight"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-zinc-500 mb-2 block">Description</label>
                    <textarea
                      value={structuredGoal.description}
                      onChange={(e) => setStructuredGoal({ ...structuredGoal, description: e.target.value })}
                      className="text-xl text-zinc-400 bg-transparent border-none focus:ring-0 w-full p-0 leading-relaxed resize-none h-24"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="text-xs uppercase tracking-widest text-zinc-500 mb-4 block">Suggested Tasks</label>
                      <div className="space-y-3">
                        {structuredGoal.tasks.map((task, i) => (
                          <motion.div 
                            key={i} 
                            className={`flex items-center gap-4 p-4 rounded-2xl border transition-all bg-zinc-900/50 border-zinc-800 hover:border-zinc-700`}
                          >
                            <div 
                              onClick={() => toggleTaskSelection(task)}
                              className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
                                selectedTasks.includes(task) ? 'border-green-500 bg-green-500/10' : 'border-zinc-700'
                              }`}
                            >
                              <AnimatePresence>
                                {selectedTasks.includes(task) && (
                                  <motion.div
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0, opacity: 0 }}
                                  >
                                    <Check size={14} className="text-green-500" />
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            <input
                              value={task}
                              onChange={(e) => {
                                const newTasks = [...structuredGoal.tasks];
                                newTasks[i] = e.target.value;
                                setStructuredGoal({ ...structuredGoal, tasks: newTasks });
                                if (selectedTasks.includes(task)) {
                                  setSelectedTasks(prev => prev.map(t => t === task ? e.target.value : t));
                                }
                              }}
                              className={cn(
                                "bg-transparent border-none focus:ring-0 w-full p-0 text-sm font-medium transition-all",
                                !selectedTasks.includes(task) && "text-zinc-600 line-through opacity-50"
                              )}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs uppercase tracking-widest text-zinc-500 mb-4 block">My Tasks</label>
                      <div className="space-y-3">
                        {manualTasks.map((task, i) => (
                          <div key={i} className="flex items-center gap-4 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 group transition-all hover:border-zinc-700">
                            <div className="w-6 h-6 rounded-full border border-zinc-700 flex items-center justify-center flex-shrink-0 bg-white/10">
                              <Check size={14} className="text-white" />
                            </div>
                            {editingManualTaskIndex === i ? (
                              <input
                                autoFocus
                                value={editingManualTaskText}
                                onChange={(e) => setEditingManualTaskText(e.target.value)}
                                onBlur={() => {
                                  const newTasks = [...manualTasks];
                                  newTasks[i] = editingManualTaskText;
                                  setManualTasks(newTasks);
                                  setEditingManualTaskIndex(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const newTasks = [...manualTasks];
                                    newTasks[i] = editingManualTaskText;
                                    setManualTasks(newTasks);
                                    setEditingManualTaskIndex(null);
                                  }
                                }}
                                className="flex-1 bg-transparent border-none focus:outline-none text-sm text-white"
                              />
                            ) : (
                              <span 
                                onClick={() => {
                                  setEditingManualTaskIndex(i);
                                  setEditingManualTaskText(task);
                                }}
                                className="text-sm text-zinc-300 flex-1 cursor-text"
                              >
                                {task}
                              </span>
                            )}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                        
                        <div className="flex items-center gap-2 mt-4">
                          <input
                            placeholder="Add a task manually..."
                            value={newTaskInput}
                            onChange={(e) => setNewTaskInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addManualTask()}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-600"
                          />
                          <button 
                            onClick={addManualTask}
                            className="p-3 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 mt-12">
                    <label className="text-xs uppercase tracking-widest text-zinc-500 mb-4 block">Visibility & Privacy</label>
                    <div className="grid grid-cols-3 gap-4">
                      {(['private', 'group', 'public'] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setGoalVisibility(v)}
                          className={cn(
                            "py-4 rounded-2xl border text-sm font-bold capitalize transition-all",
                            goalVisibility === v ? "bg-white text-black border-white" : "bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    
                    {goalVisibility === 'public' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4"
                      >
                        <p className="text-xs text-zinc-500 uppercase tracking-widest">Public Fields</p>
                        <div className="flex flex-wrap gap-3">
                          {['title', 'description', 'tasks', 'progress'].map(field => (
                            <button
                              key={field}
                              onClick={() => setPublicFields(prev => 
                                prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
                              )}
                              className={cn(
                                "px-4 py-2 rounded-full text-xs font-medium border transition-all",
                                publicFields.includes(field) ? "bg-zinc-100 text-black border-zinc-100" : "bg-transparent border-zinc-800 text-zinc-500"
                              )}
                            >
                              {field}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </div>

                  <button
                    onClick={saveGoal}
                    disabled={loading}
                    className="w-full py-4 bg-white text-black rounded-2xl font-bold hover:bg-zinc-200 transition-colors mt-12"
                  >
                    {loading ? "Saving..." : "Save Goal"}
                  </button>
                </div>
              </div>

              <div className="lg:w-80 flex flex-col items-center justify-center">
                <div className="relative group">
                  <div className="scale-75">
                    <Panda isListening={isListening} onClick={startListening} />
                  </div>
                </div>
                
                {isListening && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 text-center"
                  >
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Listening...</p>
                    <p className="text-sm text-zinc-300 italic">"{transcript}{interimTranscript}"</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
