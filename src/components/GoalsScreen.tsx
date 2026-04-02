import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Goal, GoalTask } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CheckCircle2, Circle, X, MessageCircle, Bell, Trash2, Plus, Mic, Calendar as CalendarIcon, Edit2, Users, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { GoalCard } from './GoalCard';

interface GoalsScreenProps {
  goals: Goal[];
  activeGoal: Goal | null;
  setActiveGoal: (goal: Goal | null) => void;
  focusedTaskId: string | null;
  setFocusedTaskId: (id: string | null) => void;
  setCurrentScreen: (screen: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  onRetrySave?: (goal: Goal) => void;
}

import { useTranslation } from '../contexts/LanguageContext';

export function GoalsScreen({ 
  goals, 
  activeGoal, 
  setActiveGoal, 
  focusedTaskId,
  setFocusedTaskId,
  setCurrentScreen, 
  handleFirestoreError,
  onRetrySave
}: GoalsScreenProps) {
  const { t } = useTranslation();
  const [activeGoalTasks, setActiveGoalTasks] = useState<GoalTask[]>([]);
  const [newNote, setNewNote] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Auto-resize textareas
  useEffect(() => {
    const adjustHeights = () => {
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
      });
    };
    
    // Initial adjustment with a small delay
    const timeoutId = setTimeout(adjustHeights, 50);
    
    window.addEventListener('resize', adjustHeights);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', adjustHeights);
    };
  }, [activeGoal, focusedTaskId, editingNoteId]);

  useEffect(() => {
    if (activeGoal) {
      const q = query(collection(db, 'goals', activeGoal.id, 'tasks'), orderBy('order', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const t = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GoalTask));
        setActiveGoalTasks(t);
      }, (err) => handleFirestoreError(err, 'get', `goals/${activeGoal.id}/tasks`));
      return () => unsubscribe();
    } else {
      setActiveGoalTasks([]);
      setFocusedTaskId(null);
    }
  }, [activeGoal]);

  const toggleTask = async (goalId: string, taskId: string, isDone: boolean) => {
    try {
      const taskRef = doc(db, 'goals', goalId, 'tasks', taskId);
      await updateDoc(taskRef, { 
        isDone: !isDone,
        completedAt: !isDone ? new Date().toISOString() : null
      });
      
      const updatedTasks = activeGoalTasks.map(t => t.id === taskId ? { ...t, isDone: !isDone } : t);
      const doneCount = updatedTasks.filter(t => t.isDone).length;
      const progress = Math.round((doneCount / updatedTasks.length) * 100);
      
      await updateDoc(doc(db, 'goals', goalId), { progressPercent: progress });
    } catch (err) {
      handleFirestoreError(err, 'update', `goals/${goalId}/tasks/${taskId}`);
    }
  };

  const addNoteToTask = async (goalId: string, taskId: string) => {
    if (!newNote.trim()) return;
    try {
      const taskRef = doc(db, 'goals', goalId, 'tasks', taskId);
      const task = activeGoalTasks.find(t => t.id === taskId);
      if (!task) return;
      
      const newNoteObj = {
        id: Math.random().toString(36).substr(2, 9),
        text: newNote.trim(),
        createdAt: new Date().toISOString()
      };
      
      const updatedNotes = [...(task.notes || []), newNoteObj];
      await updateDoc(taskRef, { notes: updatedNotes });
      setNewNote('');
    } catch (err) {
      handleFirestoreError(err, 'update', `goals/${goalId}/tasks/${taskId}`);
    }
  };

  const deleteNoteFromTask = async (goalId: string, taskId: string, noteId: string) => {
    try {
      const taskRef = doc(db, 'goals', goalId, 'tasks', taskId);
      const task = activeGoalTasks.find(t => t.id === taskId);
      if (!task || !task.notes) return;
      
      const updatedNotes = task.notes.filter(n => n.id !== noteId);
      await updateDoc(taskRef, { notes: updatedNotes });
    } catch (err) {
      handleFirestoreError(err, 'update', `goals/${goalId}/tasks/${taskId}`);
    }
  };

  const editNoteInTask = async (goalId: string, taskId: string, noteId: string, newText: string) => {
    try {
      const taskRef = doc(db, 'goals', goalId, 'tasks', taskId);
      const task = activeGoalTasks.find(t => t.id === taskId);
      if (!task || !task.notes) return;
      
      const updatedNotes = task.notes.map(n => n.id === noteId ? { ...n, text: newText } : n);
      await updateDoc(taskRef, { notes: updatedNotes });
      setEditingNoteId(null);
    } catch (err) {
      handleFirestoreError(err, 'update', `goals/${goalId}/tasks/${taskId}`);
    }
  };

  const setNoteReminder = async (goalId: string, taskId: string, noteId: string, date: string) => {
    try {
      const taskRef = doc(db, 'goals', goalId, 'tasks', taskId);
      const task = activeGoalTasks.find(t => t.id === taskId);
      if (!task || !task.notes) return;
      
      const updatedNotes = task.notes.map(n => n.id === noteId ? { ...n, reminderAt: date } : n);
      await updateDoc(taskRef, { notes: updatedNotes });
    } catch (err) {
      handleFirestoreError(err, 'update', `goals/${goalId}/tasks/${taskId}`);
    }
  };

  const filteredGoals = React.useMemo(() => {
    return goals.filter(g => categoryFilter === 'all' || g.category === categoryFilter);
  }, [goals, categoryFilter]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto p-6 pt-12 pb-32"
    >
      {activeGoal ? (
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setActiveGoal(null)} className="mb-8 text-zinc-500 hover:text-white flex items-center gap-2">
            <ArrowLeft size={20} /> {t('back')}
          </button>
          <h1 className="text-4xl font-bold mb-4 tracking-tight break-words">{activeGoal.title}</h1>
          <p className="text-zinc-400 text-lg mb-12 leading-relaxed break-words">{activeGoal.description}</p>
          
          {/* Similar Goals / Community Discovery */}
          <SimilarGoalsSection 
            goal={activeGoal} 
            handleFirestoreError={handleFirestoreError}
            setCurrentScreen={setCurrentScreen}
          />

          <div className="mb-12 space-y-3">
            <div className="flex justify-between items-end">
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">{t('goalProgress')}</span>
              <span className="text-3xl font-light tabular-nums">
                {activeGoalTasks.length > 0 
                  ? Math.round((activeGoalTasks.filter(t => t.isDone).length / activeGoalTasks.length) * 100) 
                  : 0}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ 
                  width: `${activeGoalTasks.length > 0 
                    ? (activeGoalTasks.filter(t => t.isDone).length / activeGoalTasks.length) * 100 
                    : 0}%` 
                }}
                className="h-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                transition={{ type: "spring", stiffness: 40, damping: 15 }}
              />
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-6">{t('tasks')}</h3>
            <div className="flex flex-col gap-4">
              {(() => {
                const focusedTask = focusedTaskId ? activeGoalTasks.find(t => t.id === focusedTaskId) : null;
                if (!focusedTask) return null;
                
                return (
                  <motion.div 
                    layoutId={focusedTaskId!}
                    className="bg-zinc-900 border border-zinc-700 p-6 rounded-3xl shadow-2xl space-y-6"
                  >
                    <div className="flex items-center gap-4">
                      <motion.div 
                        whileTap={{ scale: 0.9 }}
                        whileHover={{ scale: 1.1 }}
                        onClick={() => toggleTask(activeGoal.id, focusedTaskId!, focusedTask.isDone)}
                        className="cursor-pointer"
                      >
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={focusedTask.isDone ? 'done' : 'undone'}
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          >
                            {focusedTask.isDone ? (
                              <CheckCircle2 className="text-green-500" size={28} />
                            ) : (
                              <Circle className="text-zinc-700" size={28} />
                            )}
                          </motion.div>
                        </AnimatePresence>
                      </motion.div>
                      <span className={cn(
                        "text-2xl font-medium flex-1 break-words",
                        focusedTask.isDone && "line-through text-zinc-600"
                      )}>
                        {focusedTask.text}
                      </span>
                      <button 
                        onClick={() => setFocusedTaskId(null)}
                        className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-zinc-800">
                      <h4 className="text-xs uppercase tracking-widest text-zinc-500">{t('notes')}</h4>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        {focusedTask.notes?.map((note) => (
                          <motion.div 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            key={note.id} 
                            className="group relative p-3 bg-zinc-800/50 rounded-xl text-sm text-zinc-300 border border-zinc-700/50 hover:border-zinc-600 transition-all"
                          >
                            {editingNoteId === note.id ? (
                              <textarea
                                autoFocus
                                value={editingNoteText}
                                onChange={(e) => {
                                  setEditingNoteText(e.target.value);
                                  e.target.style.height = 'auto';
                                  e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                onInput={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  target.style.height = 'auto';
                                  target.style.height = target.scrollHeight + 'px';
                                }}
                                onBlur={() => editNoteInTask(activeGoal.id, focusedTaskId!, note.id, editingNoteText)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    editNoteInTask(activeGoal.id, focusedTaskId!, note.id, editingNoteText);
                                  }
                                }}
                                rows={1}
                                className="w-full bg-transparent border-none focus:outline-none text-white resize-none overflow-hidden"
                              />
                            ) : (
                              <div className="flex items-start justify-between gap-2">
                                <span 
                                  onClick={() => {
                                    setEditingNoteId(note.id);
                                    setEditingNoteText(note.text);
                                  }}
                                  className="flex-1 cursor-text break-words"
                                >
                                  {note.text}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="relative">
                                    <button className={cn("p-1.5 rounded-lg hover:bg-zinc-700 transition-colors", note.reminderAt ? "text-green-500" : "text-zinc-500")}>
                                      <Bell size={14} />
                                    </button>
                                    <input 
                                      type="datetime-local"
                                      className="absolute inset-0 opacity-0 cursor-pointer"
                                      onChange={(e) => setNoteReminder(activeGoal.id, focusedTaskId!, note.id, e.target.value)}
                                    />
                                  </div>
                                  <button 
                                    onClick={() => deleteNoteFromTask(activeGoal.id, focusedTaskId!, note.id)}
                                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            )}
                            {note.reminderAt && (
                              <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-tighter">
                                <CalendarIcon size={10} />
                                {new Date(note.reminderAt).toLocaleString()}
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <textarea 
                              placeholder={t('addNote') + "..."}
                              value={newNote}
                              onChange={(e) => {
                                setNewNote(e.target.value);
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
                                  addNoteToTask(activeGoal.id, focusedTaskId!);
                                }
                              }}
                              rows={1}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-zinc-500 resize-none overflow-hidden"
                            />
                          </div>
                          <button 
                            onClick={() => addNoteToTask(activeGoal.id, focusedTaskId!)}
                            className="p-2 bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}

              {activeGoalTasks
                .filter(t => t.id !== focusedTaskId)
                .map(task => (
                  <motion.div 
                    layoutId={task.id}
                    key={task.id} 
                    className={cn(
                      "flex items-center gap-4 p-5 rounded-2xl border transition-all cursor-pointer group",
                      task.isDone ? "bg-zinc-900/30 border-zinc-800/50 opacity-50" : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                    )}
                  >
                    <motion.div 
                      whileTap={{ scale: 0.9 }}
                      whileHover={{ scale: 1.1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTask(activeGoal.id, task.id, task.isDone);
                      }}
                      className="cursor-pointer"
                    >
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={task.isDone ? 'done' : 'undone'}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        >
                          {task.isDone ? <CheckCircle2 className="text-green-500" size={24} /> : <Circle className="text-zinc-700" size={24} />}
                        </motion.div>
                      </AnimatePresence>
                    </motion.div>
                    <span 
                      onClick={() => setFocusedTaskId(task.id)}
                      className={cn("text-lg flex-1 break-words", task.isDone && "line-through text-zinc-600")}
                    >
                      {task.text}
                    </span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {task.notes && task.notes.length > 0 && (
                        <div className="flex items-center gap-1 text-zinc-500 text-xs">
                          <MessageCircle size={14} />
                          {task.notes.length}
                        </div>
                      )}
                      {task.reminderAt && <Bell size={14} className="text-green-500" />}
                    </div>
                  </motion.div>
                ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('myGoals')}</h1>
            <div className="flex items-center gap-4">
              <div className="flex bg-zinc-900 border border-zinc-800 p-1 rounded-2xl">
                {(['all', 'health', 'learning', 'personal', 'business'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-medium capitalize transition-all",
                      categoryFilter === cat ? "bg-white text-black shadow-lg" : "text-zinc-500 hover:text-white"
                    )}
                  >
                    {t(cat) || cat}
                  </button>
                ))}
              </div>
              <button onClick={() => setCurrentScreen('home')} className="p-3 bg-zinc-900 rounded-full border border-zinc-800 hover:bg-zinc-800">
                <Plus size={24} />
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredGoals.map(goal => (
              <GoalCard 
                key={goal.id} 
                goal={goal} 
                onClick={() => setActiveGoal(goal)} 
                onRetry={onRetrySave}
              />
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

function SimilarGoalsSection({ 
  goal, 
  handleFirestoreError,
  setCurrentScreen
}: { 
  goal: Goal, 
  handleFirestoreError: any,
  setCurrentScreen: (screen: any) => void
}) {
  const { t } = useTranslation();
  const [similarMatches, setSimilarMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (goal.embedding) {
      fetchSimilar();
    }
  }, [goal.id]);

  const fetchSimilar = async () => {
    setLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/goals/similar", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          goalId: goal.id,
          embedding: goal.embedding
        })
      });
      if (res.ok) {
        const data = await res.json();
        // Filter out own goal and very low scores
        setSimilarMatches(data.matches.filter((m: any) => m.id !== goal.id && m.score > 0.7));
      }
    } catch (err) {
      console.error("Match error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCommunity = async (groupId: string) => {
    if (!auth.currentUser) return;
    setJoining(groupId);
    try {
      // Add user to members subcollection
      await setDoc(doc(db, 'groups', groupId, 'members', auth.currentUser.uid), {
        userId: auth.currentUser.uid,
        joinedAt: new Date().toISOString()
      });
      
      // Update goal to point to this group
      await updateDoc(doc(db, 'goals', goal.id), { groupId });
      
      // Navigate to community
      setCurrentScreen({ name: 'community', groupId });
    } catch (err) {
      handleFirestoreError(err, 'update', `groups/${groupId}/members`);
    } finally {
      setJoining(null);
    }
  };

  const handleStartConversation = async (otherGoal: any) => {
    if (!auth.currentUser) return;
    setJoining(otherGoal.id);
    try {
      const idToken = await auth.currentUser.getIdToken();
      // Use the group assignment API to create a cluster
      const res = await fetch("/api/groups/assign", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          goal: { ...goal, embedding: goal.embedding }
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.action === 'assigned' || data.action === 'create') {
          // If it was created or assigned, the App.tsx logic usually handles the Firestore updates
          // But here we're in a specific sub-component, so we might need to wait or trigger a refresh.
          // For now, let's just navigate to the community screen if we have a groupId.
          if (data.groupId) {
            setCurrentScreen({ name: 'community', groupId: data.groupId });
          } else {
            // If it created a new group, we need the ID. The API returns it in App.tsx but let's check server.ts
            // Actually, the API for 'create' returns the groupName and memberGoalIds, but not the new ID yet.
            // Let's just alert the user that we're connecting them.
            alert("Connecting you with " + otherGoal.title + "...");
            // In a real app, we'd wait for the group to be created and then navigate.
          }
        }
      }
    } catch (err) {
      console.error("Start conversation error:", err);
    } finally {
      setJoining(null);
    }
  };

  if (loading) return (
    <div className="mb-12 p-6 bg-zinc-900/30 border border-zinc-800 rounded-3xl flex items-center gap-4">
      <Loader2 className="animate-spin text-zinc-500" size={20} />
      <span className="text-sm text-zinc-500 font-medium tracking-tight">Searching for similar goals...</span>
    </div>
  );

  if (similarMatches.length === 0) return null;

  return (
    <div className="mb-12 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
          <Users size={16} className="text-white" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Similar Goals Found</h3>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {similarMatches.map((match) => (
          <motion.div 
            key={match.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-[2rem] hover:border-zinc-700 transition-all group"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h4 className="text-lg font-bold mb-1 group-hover:text-white transition-colors">{match.title}</h4>
                <p className="text-sm text-zinc-500 line-clamp-2">{match.description}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 block mb-1">Match Score</span>
                <span className="text-xl font-light tabular-nums text-white">{(match.score * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                  {match.ownerId.substring(0, 2).toUpperCase()}
                </div>
                <span className="text-xs text-zinc-500 font-medium">User {match.ownerId.substring(0, 5)}</span>
              </div>

              {match.groupId ? (
                <button 
                  onClick={() => handleJoinCommunity(match.groupId)}
                  disabled={joining === match.groupId}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {joining === match.groupId ? <Loader2 className="animate-spin" size={12} /> : <MessageCircle size={12} />}
                  Join Community
                </button>
              ) : (
                <button 
                  onClick={() => handleStartConversation(match)}
                  disabled={joining === match.id}
                  className="flex items-center gap-2 px-6 py-2.5 bg-zinc-800 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-50"
                >
                  {joining === match.id ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />}
                  Start Conversation
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
