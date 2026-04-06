import React, { useState, useEffect } from 'react';
import { Goal, GoalTask, GoalRoomThread, GoalRoomReply, User, ThreadBadge } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeft, Lock, Edit2, Check, Plus, Send,
  HelpCircle, Loader2, X, BookOpen, Zap,
  MessageCircle, Users, ChevronRight,
  ThumbsUp, Heart, Hand, Star,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import {
  collection, query, orderBy, onSnapshot, limit,
  doc, updateDoc, addDoc, increment, serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { auth } from '../firebase';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)   return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400)return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

const BADGE_META: Record<ThreadBadge, { label: string; cls: string }> = {
  help:      { label: 'Help',      cls: 'badge badge-help'      },
  support:   { label: 'Support',   cls: 'badge badge-support'   },
  together:  { label: 'Together',  cls: 'badge badge-together'  },
  completed: { label: 'Completed', cls: 'badge badge-completed' },
  useful:    { label: 'Useful',    cls: 'badge badge-useful'    },
  blocked:   { label: 'Blocked',   cls: 'badge badge-blocked'   },
};

const ALL_BADGES: ThreadBadge[] = ['help','support','together','completed','useful','blocked'];

// ─────────────────────────────────────────────────────────────────────────────
// Progress Ring
// ─────────────────────────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 52, circ = 2 * Math.PI * r;
  const off = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="relative" style={{ width: 128, height: 128 }}>
      <svg width={128} height={128} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={64} cy={64} r={r} strokeWidth={9} fill="none" stroke="var(--c-border)" />
        <circle cx={64} cy={64} r={r} strokeWidth={9} fill="none"
          stroke="var(--c-gold)" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.25,.46,.45,.94)' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--c-gold)' }}>{pct}%</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────

function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }}
            onClick={onClose} />
          <motion.div key="sh"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
            className="fixed bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-6 max-h-[90dvh] overflow-y-auto"
            style={{ background: 'var(--c-surface)', borderRadius: '28px 28px 0 0', borderTop: '1px solid var(--c-border)' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--c-border-light)' }} />
            <h3 className="text-card-title mb-5">{title}</h3>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Card
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task, goalId, isNextStep, similarCount, onAskHelp, onAddNote }: {
  task: GoalTask; goalId: string; isNextStep: boolean; similarCount: number;
  onAskHelp: (t: GoalTask) => void; onAddNote: (t: GoalTask) => void;
}) {
  const [toggling, setToggling] = useState(false);

  const toggleDone = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await updateDoc(doc(db, 'goals', goalId, 'tasks', task.id), {
        isDone:      !task.isDone,
        completedAt: !task.isDone ? new Date().toISOString() : null,
      });
    } catch (e) { console.error(e); }
    finally { setToggling(false); }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: isNextStep ? 'rgba(201,168,76,.06)' : 'var(--c-surface)',
        border:     isNextStep ? '1px solid rgba(201,168,76,.25)' : '1px solid var(--c-border)',
      }}>
      {isNextStep && (
        <div className="px-4 pt-3 pb-0.5 flex items-center gap-1.5">
          <Zap size={11} style={{ color: 'var(--c-gold)' }} />
          <span style={{ color: 'var(--c-gold)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Today's next step
          </span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <button onClick={toggleDone} disabled={toggling}
            className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all"
            style={task.isDone
              ? { background: 'var(--c-success)', borderColor: 'var(--c-success)' }
              : { borderColor: 'var(--c-border-light)' }}>
            {toggling ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--c-text-3)' }} />
                      : task.isDone && <Check size={13} color="#fff" strokeWidth={3} />}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-body leading-snug"
               style={{ color: task.isDone ? 'var(--c-text-3)' : 'var(--c-text)', textDecoration: task.isDone ? 'line-through' : 'none' }}>
              {task.text}
            </p>
            {similarCount > 0 && !task.isDone && (
              <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>{similarCount} people share this task</p>
            )}
            {(task.notes?.length ?? 0) > 0 && (
              <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>{task.notes!.length} note{task.notes!.length > 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
        {!task.isDone && (
          <div className="flex items-center gap-2 mt-3 ml-9">
            <button onClick={() => onAddNote(task)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-meta transition-opacity hover:opacity-70"
              style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
              <BookOpen size={12} /> Add note
            </button>
            <button onClick={() => onAskHelp(task)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-meta transition-opacity hover:opacity-70"
              style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
              <HelpCircle size={12} /> Ask help
            </button>
            <button onClick={toggleDone}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-meta font-semibold transition-opacity hover:opacity-70"
              style={{ background: 'rgba(74,124,89,.15)', border: '1px solid rgba(74,124,89,.3)', color: 'var(--c-success)' }}>
              <Check size={12} /> Done
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan Tab
// ─────────────────────────────────────────────────────────────────────────────

function PlanTab({ goal, user }: { goal: Goal; user: FirebaseUser | null }) {
  const [tasks,       setTasks]       = useState<GoalTask[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [addingTask,  setAddingTask]  = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [saving,      setSaving]      = useState(false);

  // Sheets
  const [helpTask,     setHelpTask]     = useState<GoalTask | null>(null);
  const [helpType,     setHelpType]     = useState('');
  const [helpBlocking, setHelpBlocking] = useState('');
  const [helpSaving,   setHelpSaving]   = useState(false);
  const [noteTask,     setNoteTask]     = useState<GoalTask | null>(null);
  const [noteText,     setNoteText]     = useState('');
  const [noteSaving,   setNoteSaving]   = useState(false);

  const isTemp = goal.id.startsWith('temp-');

  useEffect(() => {
    if (isTemp) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'goals', goal.id, 'tasks'), orderBy('order', 'asc')),
      (snap) => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalTask)); setLoading(false); },
      (err)  => { console.error(err); setLoading(false); }
    );
  }, [goal.id]);

  const addTask = async () => {
    if (!newTaskText.trim() || saving || isTemp) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'goals', goal.id, 'tasks'), {
        text: newTaskText.trim(), isDone: false, order: tasks.length,
        source: 'manual', goalId: goal.id, createdAt: new Date().toISOString(),
      });
      setNewTaskText(''); setAddingTask(false);
    } catch(e) { console.error(e); } finally { setSaving(false); }
  };

  const submitHelp = async () => {
    if (!helpTask || helpSaving) return;
    setHelpSaving(true);
    try {
      // Write a real thread to Goal Room if the goal has a joined group
      if (goal.groupId && goal.groupJoined && auth.currentUser) {
        const uid  = auth.currentUser.uid;
        const name = auth.currentUser.displayName || 'Member';
        const now  = new Date().toISOString();
        const threadRef = await addDoc(collection(db, 'groups', goal.groupId, 'threads'), {
          goalId:          goal.id,
          badge:           'help',
          title:           helpTask.text,
          linkedTaskId:    helpTask.id,
          linkedTaskText:  helpTask.text,
          authorId:        uid,
          authorName:      name,
          previewText:     helpBlocking || `${helpType} needed`,
          replyCount:      0,
          usefulCount:     0,
          createdAt:       now,
          lastActivityAt:  now,
        });
        // Post first reply as context
        if (helpBlocking.trim()) {
          await addDoc(collection(db, 'groups', goal.groupId, 'threads', threadRef.id, 'replies'), {
            threadId:  threadRef.id, goalId: goal.id,
            authorId:  uid, authorName: name,
            text:      `Type of help needed: ${helpType}\n\nWhat's blocking me: ${helpBlocking}`,
            reactions: {}, createdAt: now,
          });
        }
      } else {
        // No group yet — just acknowledge
        await new Promise(r => setTimeout(r, 400));
        alert('Help request noted! Join a Goal Room to share it with others.');
      }
      setHelpTask(null); setHelpType(''); setHelpBlocking('');
    } catch(e) { console.error(e); }
    finally { setHelpSaving(false); }
  };

  const submitNote = async () => {
    if (!noteTask || !noteText.trim() || noteSaving) return;
    setNoteSaving(true);
    try {
      const existing = noteTask.notes ?? [];
      await updateDoc(doc(db, 'goals', goal.id, 'tasks', noteTask.id), {
        notes: [...existing, { id: Date.now().toString(), text: noteText.trim(), createdAt: new Date().toISOString() }],
      });
      setNoteTask(null); setNoteText('');
    } catch(e) { console.error(e); } finally { setNoteSaving(false); }
  };

  const todo = tasks.filter(t => !t.isDone);
  const done = tasks.filter(t =>  t.isDone);
  const simCount = goal.similarGoals?.length ?? 0;

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--c-gold)' }} /></div>;
  if (isTemp)  return <div className="px-5 py-10 text-center"><Loader2 size={20} className="animate-spin mx-auto mb-3" style={{ color: 'var(--c-gold)' }} /><p className="text-body" style={{ color: 'var(--c-text-2)' }}>Saving your goal…</p></div>;

  return (
    <div className="px-4 py-5 space-y-6" style={{ paddingBottom: 120 }}>
      {todo.length > 0 && (
        <section>
          <h3 className="text-meta uppercase tracking-widest mb-3" style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>To Do</h3>
          <div className="space-y-3">
            <AnimatePresence>
              {todo.map((t, i) => (
                <TaskCard key={t.id} task={t} goalId={goal.id} isNextStep={i === 0}
                  similarCount={i === 0 ? simCount : 0} onAskHelp={setHelpTask} onAddNote={setNoteTask} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {addingTask ? (
        <div className="flex gap-2">
          <input autoFocus value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setAddingTask(false); }}
            placeholder="Describe the task…" className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none"
            style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          <button onClick={addTask} disabled={saving}
            className="px-4 py-3 rounded-xl font-semibold disabled:opacity-40"
            style={{ background: 'var(--c-gold)', color: '#000' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button onClick={() => { setAddingTask(false); setNewTaskText(''); }}
            className="px-3 rounded-xl" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <button onClick={() => setAddingTask(true)}
          className="flex items-center gap-2 text-body w-full px-4 py-3 rounded-xl transition-opacity hover:opacity-70"
          style={{ border: '1px dashed var(--c-border)', color: 'var(--c-text-3)' }}>
          <Plus size={16} /> Add a task
        </button>
      )}

      {done.length > 0 && (
        <section>
          <h3 className="text-meta uppercase tracking-widest mb-3" style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Done · {done.length}</h3>
          <div className="space-y-2">
            <AnimatePresence>
              {done.map(t => (
                <TaskCard key={t.id} task={t} goalId={goal.id} isNextStep={false}
                  similarCount={0} onAskHelp={setHelpTask} onAddNote={setNoteTask} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {tasks.length === 0 && (
        <div className="text-center py-16">
          <p className="text-body mb-1" style={{ color: 'var(--c-text-2)' }}>No tasks yet.</p>
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Add your first step above.</p>
        </div>
      )}

      {/* Ask Help Sheet */}
      <BottomSheet open={!!helpTask} onClose={() => setHelpTask(null)} title="Ask for Help">
        {helpTask && (
          <div className="space-y-4">
            <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Task</p>
              <p className="text-body mt-0.5">{helpTask.text}</p>
            </div>
            <div>
              <label className="text-meta mb-2 block" style={{ color: 'var(--c-text-3)' }}>What kind of help?</label>
              <div className="flex flex-wrap gap-2">
                {['Advice', 'Accountability', 'Resource', 'Practice partner'].map(type => (
                  <button key={type} onClick={() => setHelpType(type)}
                    className="px-3 py-2 rounded-xl text-meta font-medium transition-all"
                    style={helpType === type
                      ? { background: 'var(--c-gold)', color: '#000' }
                      : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-meta mb-2 block" style={{ color: 'var(--c-text-3)' }}>What's blocking you?</label>
              <textarea value={helpBlocking} onChange={e => setHelpBlocking(e.target.value)}
                placeholder="Describe what's stopping you…" rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
            </div>
            <button onClick={submitHelp} disabled={helpSaving || !helpType}
              className="btn-gold w-full flex items-center justify-center gap-2 disabled:opacity-40">
              {helpSaving ? <Loader2 size={16} className="animate-spin" /> : <HelpCircle size={16} />}
              Post to Goal Room
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Add Note Sheet */}
      <BottomSheet open={!!noteTask} onClose={() => { setNoteTask(null); setNoteText(''); }} title="Add Note">
        {noteTask && (
          <div className="space-y-4">
            <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Task</p>
              <p className="text-body mt-0.5">{noteTask.text}</p>
            </div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Write your note…" rows={4} autoFocus
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
              style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
            <button onClick={submitNote} disabled={noteSaving || !noteText.trim()}
              className="btn-gold w-full flex items-center justify-center gap-2 disabled:opacity-40">
              {noteSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Save Note
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread Card
// ─────────────────────────────────────────────────────────────────────────────

function ThreadCard({ thread, onOpen }: { thread: GoalRoomThread; onOpen: () => void }) {
  const meta = BADGE_META[thread.badge];
  return (
    <motion.button onClick={onOpen} layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="w-full text-left p-4 rounded-2xl transition-all hover:opacity-80"
      style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={meta.cls}>{meta.label}</span>
        <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
          {timeAgo(thread.lastActivityAt)}
        </span>
      </div>
      <p className="text-card-title mb-1 leading-snug" style={{ fontSize: 15 }}>{thread.title}</p>
      {thread.linkedTaskText && (
        <p className="text-meta mb-2 flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
          <ChevronRight size={11} /> {thread.linkedTaskText}
        </p>
      )}
      <p className="text-meta line-clamp-2 mb-3" style={{ color: 'var(--c-text-2)' }}>
        {thread.previewText}
      </p>
      <div className="flex items-center gap-4">
        <span className="text-meta flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
          <MessageCircle size={12} /> {thread.replyCount}
        </span>
        <span className="text-meta flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
          <ThumbsUp size={12} /> {thread.usefulCount}
        </span>
        <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>
          {thread.authorName}
        </span>
      </div>
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread Detail
// ─────────────────────────────────────────────────────────────────────────────

function ThreadDetail({ thread, groupId, goalId, user, onBack }: {
  thread: GoalRoomThread; groupId: string; goalId: string;
  user: FirebaseUser | null; onBack: () => void;
}) {
  const [replies,     setReplies]   = useState<GoalRoomReply[]>([]);
  const [loading,     setLoading]   = useState(true);
  const [replyText,   setReplyText] = useState('');
  const [sending,     setSending]   = useState(false);
  const [savedNotes,  setSavedNotes]= useState<Set<string>>(new Set());

  const meta = BADGE_META[thread.badge];

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'groups', groupId, 'threads', thread.id, 'replies'), orderBy('createdAt', 'asc')),
      (snap) => { setReplies(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalRoomReply)); setLoading(false); },
      (err)  => { console.error(err); setLoading(false); }
    );
  }, [groupId, thread.id]);

  const sendReply = async () => {
    if (!replyText.trim() || sending || !user) return;
    setSending(true);
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'groups', groupId, 'threads', thread.id, 'replies'), {
        threadId: thread.id, goalId,
        authorId: user.uid, authorName: user.displayName || 'Member',
        text: replyText.trim(), reactions: {}, createdAt: now,
      });
      await updateDoc(doc(db, 'groups', groupId, 'threads', thread.id), {
        replyCount:     increment(1),
        lastActivityAt: now,
      });
      setReplyText('');
    } catch(e) { console.error(e); }
    finally { setSending(false); }
  };

  const reactToReply = async (replyId: string, reaction: string) => {
    try {
      await updateDoc(doc(db, 'groups', groupId, 'threads', thread.id, 'replies', replyId), {
        [`reactions.${reaction}`]: increment(1),
      });
      if (reaction === 'useful') {
        await updateDoc(doc(db, 'groups', groupId, 'threads', thread.id), {
          usefulCount: increment(1),
        });
      }
    } catch(e) { console.error(e); }
  };

  const saveReplyToNotes = async (reply: GoalRoomReply) => {
    if (!user || savedNotes.has(reply.id)) return;
    try {
      await addDoc(collection(db, 'goals', goalId, 'notes'), {
        goalId, ownerId: user.uid,
        text:           reply.text,
        source:         'saved_from_room',
        privacy:        'private',
        savedFromAuthorName: reply.authorName,
        savedFromReplyId:    reply.id,
        createdAt:      new Date().toISOString(),
      });
      setSavedNotes(prev => new Set([...prev, reply.id]));
    } catch(e) { console.error(e); }
  };

  const REACTIONS = [
    { key: 'useful',   icon: <ThumbsUp  size={13} />, label: 'Useful'       },
    { key: 'proud',    icon: <Star      size={13} />, label: 'Proud of you' },
    { key: 'me_too',   icon: <Heart     size={13} />, label: 'Me too'       },
    { key: 'can_help', icon: <Hand      size={13} />, label: 'I can help'   },
  ];

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100dvh - 280px)' }}>
      {/* Header */}
      <div className="px-4 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--c-border)' }}>
        <button onClick={onBack} className="transition-opacity hover:opacity-70" style={{ color: 'var(--c-text-2)' }}>
          <ArrowLeft size={20} />
        </button>
        <span className={meta.cls}>{meta.label}</span>
      </div>

      {/* Thread body */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid var(--c-border)' }}>
        <h2 className="text-card-title mb-2" style={{ fontSize: 18 }}>{thread.title}</h2>
        {thread.linkedTaskText && (
          <p className="text-meta mb-3 flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
            <ChevronRight size={11} /> {thread.linkedTaskText}
          </p>
        )}
        <p className="text-body leading-relaxed mb-2" style={{ color: 'var(--c-text-2)' }}>
          {thread.previewText}
        </p>
        <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
          {thread.authorName} · {timeAgo(thread.createdAt)}
        </p>
      </div>

      {/* Replies */}
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto" style={{ paddingBottom: 100 }}>
        {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--c-gold)' }} /></div>}

        {!loading && replies.length === 0 && (
          <p className="text-center text-meta py-8" style={{ color: 'var(--c-text-3)' }}>
            No replies yet. Be the first to respond.
          </p>
        )}

        {replies.map(reply => (
          <div key={reply.id} className="p-4 rounded-2xl" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-meta font-semibold" style={{ color: 'var(--c-text-2)' }}>{reply.authorName}</span>
              <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>{timeAgo(reply.createdAt)}</span>
            </div>
            <p className="text-body leading-relaxed mb-3">{reply.text}</p>

            {/* Reactions */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {REACTIONS.map(r => (
                <button key={r.key}
                  onClick={() => reactToReply(reply.id, r.key)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-meta transition-opacity hover:opacity-70"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                  {r.icon}
                  <span style={{ fontSize: 11 }}>{r.label}</span>
                  {(reply.reactions?.[r.key as keyof typeof reply.reactions] ?? 0) > 0 && (
                    <span style={{ color: 'var(--c-gold)', fontWeight: 700, fontSize: 11 }}>
                      {reply.reactions![r.key as keyof typeof reply.reactions]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Save to notes */}
            <button onClick={() => saveReplyToNotes(reply)}
              disabled={savedNotes.has(reply.id)}
              className="text-meta flex items-center gap-1.5 transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ color: savedNotes.has(reply.id) ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
              <BookOpen size={12} />
              {savedNotes.has(reply.id) ? 'Saved to notes' : 'Save to notes'}
            </button>
          </div>
        ))}
      </div>

      {/* Reply input */}
      <div className="sticky bottom-0 px-4 pb-6 pt-3"
           style={{ background: 'var(--c-bg)', borderTop: '1px solid var(--c-border)' }}>
        <div className="flex gap-2">
          <input value={replyText} onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendReply(); }}
            placeholder="Write a reply…"
            className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none"
            style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          <button onClick={sendReply} disabled={sending || !replyText.trim()}
            className="px-4 py-3 rounded-xl disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--c-gold)', color: '#000' }}>
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal Room Tab
// ─────────────────────────────────────────────────────────────────────────────

function GoalRoomTab({ goal, user }: { goal: Goal; user: FirebaseUser | null }) {
  const [threads,        setThreads]       = useState<GoalRoomThread[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [filter,         setFilter]        = useState<ThreadBadge | 'all'>('all');
  const [selectedThread, setSelectedThread]= useState<GoalRoomThread | null>(null);
  const [creating,       setCreating]      = useState(false);

  // Create thread form
  const [newBadge,    setNewBadge]    = useState<ThreadBadge>('help');
  const [newTitle,    setNewTitle]    = useState('');
  const [newBody,     setNewBody]     = useState('');
  const [newSaving,   setNewSaving]   = useState(false);

  // Join flow
  const [joining, setJoining] = useState(false);

  const { groupId, groupJoined, eligibleAt } = goal as any;

  useEffect(() => {
    if (!groupId || !groupJoined) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'groups', groupId, 'threads'), orderBy('lastActivityAt', 'desc'), limit(50)),
      (snap) => { setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalRoomThread)); setLoading(false); },
      (err)  => { console.error(err); setLoading(false); }
    );
  }, [groupId, groupJoined]);

  const joinRoom = async () => {
    if (!user || !groupId || joining) return;
    setJoining(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ goalId: goal.id, groupId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to join');
    } catch(e: any) {
      alert(e.message || 'Could not join. Try again.');
    } finally { setJoining(false); }
  };

  const createThread = async () => {
    if (!newTitle.trim() || newSaving || !user || !groupId) return;
    setNewSaving(true);
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'groups', groupId, 'threads'), {
        goalId: goal.id, badge: newBadge, title: newTitle.trim(),
        authorId: user.uid, authorName: user.displayName || 'Member',
        previewText: newBody.trim() || newTitle.trim(),
        replyCount: 0, usefulCount: 0, createdAt: now, lastActivityAt: now,
      });
      setCreating(false); setNewTitle(''); setNewBody(''); setNewBadge('help');
    } catch(e) { console.error(e); }
    finally { setNewSaving(false); }
  };

  const filtered = filter === 'all' ? threads : threads.filter(t => t.badge === filter);

  // ── No group at all
  if (!groupId) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
             style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
          <MessageCircle size={22} style={{ color: 'var(--c-gold)' }} />
        </div>
        <p className="text-card-title mb-2">Goal Room</p>
        <p className="text-meta mb-6" style={{ color: 'var(--c-text-3)' }}>
          Your goal is being matched to a room with people on a similar path.
          Check back soon.
        </p>
      </div>
    );
  }

  // ── Eligible but not joined
  if (groupId && !groupJoined) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
             style={{ background: 'rgba(201,168,76,.1)', border: '1px solid rgba(201,168,76,.3)' }}>
          <Users size={22} style={{ color: 'var(--c-gold)' }} />
        </div>
        <p className="text-card-title mb-2">You have a room waiting</p>
        <p className="text-meta mb-8" style={{ color: 'var(--c-text-3)' }}>
          People on a similar path are in this room. Join to collaborate, ask for help, and share progress.
        </p>
        <button onClick={joinRoom} disabled={joining}
          className="btn-gold flex items-center gap-2 disabled:opacity-50">
          {joining ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
          Join Goal Room
        </button>
      </div>
    );
  }

  // ── Thread detail
  if (selectedThread) {
    return (
      <ThreadDetail
        thread={selectedThread} groupId={groupId} goalId={goal.id}
        user={user} onBack={() => setSelectedThread(null)}
      />
    );
  }

  // ── Thread list
  return (
    <div className="flex flex-col" style={{ paddingBottom: 100 }}>
      {/* Filter pills */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ borderBottom: '1px solid var(--c-border)' }}>
        <button onClick={() => setFilter('all')}
          className="btn-pill flex-shrink-0 text-meta font-semibold transition-all"
          style={filter === 'all'
            ? { background: 'var(--c-gold)', color: '#000' }
            : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
          All
        </button>
        {ALL_BADGES.map(b => (
          <button key={b} onClick={() => setFilter(b)}
            className="flex-shrink-0 text-meta font-semibold transition-all"
            style={filter === b
              ? { ...{}, background: 'var(--c-gold)', color: '#000', borderRadius: 999, padding: '6px 14px' }
              : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', borderRadius: 999, padding: '6px 14px' }}>
            {BADGE_META[b].label}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-3 flex-1">
        {loading && <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--c-gold)' }} /></div>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-body mb-1" style={{ color: 'var(--c-text-2)' }}>No threads yet.</p>
            <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Start a conversation below.</p>
          </div>
        )}

        <AnimatePresence>
          {filtered.map(thread => (
            <ThreadCard key={thread.id} thread={thread} onOpen={() => setSelectedThread(thread)} />
          ))}
        </AnimatePresence>
      </div>

      {/* FAB — create thread */}
      <button onClick={() => setCreating(true)}
        className="fixed z-30 flex items-center gap-2 px-5 py-3.5 rounded-full font-semibold shadow-xl"
        style={{ bottom: 100, right: 20, background: 'var(--c-gold)', color: '#000', boxShadow: '0 4px 24px rgba(201,168,76,.35)' }}>
        <Plus size={18} /> New Thread
      </button>

      {/* Create Thread Sheet */}
      <BottomSheet open={creating} onClose={() => setCreating(false)} title="Start a Thread">
        <div className="space-y-4">
          <div>
            <label className="text-meta mb-2 block" style={{ color: 'var(--c-text-3)' }}>Thread type</label>
            <div className="flex flex-wrap gap-2">
              {ALL_BADGES.map(b => (
                <button key={b} onClick={() => setNewBadge(b)}
                  className={cn(newBadge === b ? BADGE_META[b].cls : '')}
                  style={newBadge !== b ? { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase' } : {}}>
                  {BADGE_META[b].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-meta mb-2 block" style={{ color: 'var(--c-text-3)' }}>Title</label>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="What do you want to discuss?" autoFocus
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>
          <div>
            <label className="text-meta mb-2 block" style={{ color: 'var(--c-text-3)' }}>Details (optional)</label>
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)}
              placeholder="Share more context…" rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
              style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>
          <button onClick={createThread} disabled={newSaving || !newTitle.trim()}
            className="btn-gold w-full flex items-center justify-center gap-2 disabled:opacity-40">
            {newSaving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Post Thread
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub Tab
// ─────────────────────────────────────────────────────────────────────────────

function StubTab({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
           style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
        {icon}
      </div>
      <p className="text-card-title mb-2">{title}</p>
      <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>{subtitle}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface GoalDetailScreenProps {
  user: FirebaseUser | null; dbUser: User | null;
  goalId: string; goals: Goal[];
  initialTab: 'plan' | 'goal-room' | 'people' | 'notes';
  setCurrentScreen: (s: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
}

type Tab = 'plan' | 'goal-room' | 'people' | 'notes';
const TABS: { key: Tab; label: string }[] = [
  { key: 'plan',      label: 'Plan'      },
  { key: 'goal-room', label: 'Goal Room' },
  { key: 'people',    label: 'People'    },
  { key: 'notes',     label: 'Notes'     },
];

export function GoalDetailScreen({ user, goalId, goals, initialTab, setCurrentScreen }: GoalDetailScreenProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const goal = goals.find(g => g.id === goalId);

  if (!goal) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4" style={{ color: 'var(--c-text-2)' }}>
        <p className="text-body">Goal not found.</p>
        <button className="btn-ghost" onClick={() => setCurrentScreen({ name: 'home' })}>Go Home</button>
      </div>
    );
  }

  const pct = goal.progressPercent ?? 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-14 pb-3">
        <button onClick={() => setCurrentScreen({ name: 'home' })}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: 'var(--c-text-2)' }}>
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-4" style={{ color: 'var(--c-text-3)' }}>
          <button className="transition-opacity hover:opacity-70"><Edit2 size={17} /></button>
          <button className="transition-opacity hover:opacity-70"><Lock  size={17} /></button>
        </div>
      </div>

      {/* Goal header */}
      <div className="px-5 pb-5 text-center">
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.3, lineHeight: 1.25 }} className="mb-1.5">
          {goal.title}
        </h1>
        <p className="text-meta mb-6 mx-auto max-w-xs" style={{ color: 'var(--c-text-2)' }}>
          {goal.description}
        </p>
        <div className="flex flex-col items-center">
          <ProgressRing pct={pct} />
          <p className="text-meta mt-2" style={{ color: 'var(--c-text-3)' }}>
            {pct}% Complete{goal.status === 'active' ? ' · Active' : ''}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar sticky top-0 z-10">
        {TABS.map(tab => (
          <button key={tab.key} className={cn('tab-item', activeTab === tab.key && 'active')}
            onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: .18 }}>

            {activeTab === 'plan' && <PlanTab goal={goal} user={user} />}

            {activeTab === 'goal-room' && <GoalRoomTab goal={goal} user={user} />}

            {activeTab === 'people' && (
              <StubTab icon={<Users size={22} style={{ color: 'var(--c-gold)' }} />}
                title="People" subtitle="People on a similar path. Coming in the next build." />
            )}

            {activeTab === 'notes' && (
              <StubTab icon={<BookOpen size={22} style={{ color: 'var(--c-gold)' }} />}
                title="Notes" subtitle="Your private and shared notes. Coming in the next build." />
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}