import React, { useState, useEffect } from 'react';
import { Goal, GoalTask, GoalRoomThread, GoalRoomReply, User, ThreadBadge } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeft, Lock, Edit2, Check, Plus, Send,
  HelpCircle, Loader2, X, BookOpen, Zap, Bell, Info, Trash2,
  MessageCircle, Users, ChevronRight,
  ThumbsUp, Heart, Hand, Star,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import {
  collection, query, orderBy, onSnapshot, limit,
  doc, updateDoc, addDoc, deleteDoc, increment, serverTimestamp,
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

function TaskCard({ task, goalId, isNextStep, onOpenDetail }: {
  task: GoalTask; goalId: string; isNextStep: boolean;
  onOpenDetail: (t: GoalTask) => void;
}) {
  const [toggling, setToggling] = useState(false);

  const toggleDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Done toggle */}
        <button onClick={toggleDone} disabled={toggling}
          className="flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all"
          style={task.isDone
            ? { background: 'var(--c-success)', borderColor: 'var(--c-success)' }
            : { borderColor: 'var(--c-border-light)' }}>
          {toggling
            ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--c-text-3)' }} />
            : task.isDone && <Check size={13} color="#fff" strokeWidth={3} />}
        </button>

        {/* Task text */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenDetail(task)}>
          <p className="text-body leading-snug"
             style={{ color: task.isDone ? 'var(--c-text-3)' : 'var(--c-text)', textDecoration: task.isDone ? 'line-through' : 'none' }}>
            {task.text}
          </p>
          {(task.notes?.length ?? 0) > 0 && (
            <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>
              {task.notes!.length} note{task.notes!.length > 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Bell */}
        <button onClick={(e) => { e.stopPropagation(); onOpenDetail(task); }}
          className="flex-shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: task.reminderAt ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
          <Bell size={15} fill={task.reminderAt ? 'currentColor' : 'none'} />
        </button>

        {/* Info */}
        <button onClick={() => onOpenDetail(task)}
          className="flex-shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: 'var(--c-text-3)' }}>
          <Info size={15} />
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Detail Sheet
// ─────────────────────────────────────────────────────────────────────────────

function TaskDetailSheet({ task, goalId, onClose }: {
  task: GoalTask | null; goalId: string; onClose: () => void;
}) {
  const [editing,     setEditing]     = useState(false);
  const [editText,    setEditText]    = useState('');
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [addingNote,  setAddingNote]  = useState(false);
  const [noteText,    setNoteText]    = useState('');
  const [noteSaving,  setNoteSaving]  = useState(false);

  useEffect(() => {
    if (task) { setEditText(task.text); setEditing(false); setAddingNote(false); setNoteText(''); }
  }, [task?.id]);

  const saveEdit = async () => {
    if (!task || !editText.trim() || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'goals', goalId, 'tasks', task.id), { text: editText.trim() });
      setEditing(false);
    } catch(e) { console.error(e); } finally { setSaving(false); }
  };

  const deleteTask = async () => {
    if (!task || deleting) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'goals', goalId, 'tasks', task.id));
      onClose();
    } catch(e) { console.error(e); setDeleting(false); }
  };

  const saveNote = async () => {
    if (!task || !noteText.trim() || noteSaving) return;
    setNoteSaving(true);
    try {
      const existing = task.notes ?? [];
      await updateDoc(doc(db, 'goals', goalId, 'tasks', task.id), {
        notes: [...existing, { id: Date.now().toString(), text: noteText.trim(), createdAt: new Date().toISOString() }],
      });
      setNoteText(''); setAddingNote(false);
    } catch(e) { console.error(e); } finally { setNoteSaving(false); }
  };

  return (
    <BottomSheet open={!!task} onClose={onClose} title="Task">
      {task && (
        <div className="space-y-5">
          {/* Task text / edit */}
          {editing ? (
            <div className="space-y-2">
              <textarea value={editText} onChange={e => setEditText(e.target.value)} autoFocus rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={saving || !editText.trim()}
                  className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                </button>
                <button onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-xl text-meta"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-body leading-snug"
               style={{ color: task.isDone ? 'var(--c-text-3)' : 'var(--c-text)', textDecoration: task.isDone ? 'line-through' : 'none' }}>
              {task.text}
            </p>
          )}

          {/* Reminder */}
          <div className="flex items-center justify-between py-3"
               style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--c-text-2)' }}>
              <Bell size={15} />
              <span className="text-body">Reminder</span>
            </div>
            <span className="text-meta"
                  style={{ color: task.reminderAt ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
              {task.reminderAt ? new Date(task.reminderAt).toLocaleDateString() : 'Not set'}
            </span>
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-meta uppercase tracking-widest"
                    style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Notes</span>
              {!addingNote && (
                <button onClick={() => setAddingNote(true)}
                  className="flex items-center gap-1 text-meta"
                  style={{ color: 'var(--c-gold)' }}>
                  <Plus size={14} /> Add
                </button>
              )}
            </div>

            {(task.notes?.length ?? 0) === 0 && !addingNote && (
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No notes yet.</p>
            )}
            {task.notes?.map(n => (
              <div key={n.id} className="px-4 py-3 rounded-xl"
                   style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                <p className="text-body">{n.text}</p>
                <p className="text-meta mt-1" style={{ color: 'var(--c-text-3)' }}>{timeAgo(n.createdAt)}</p>
              </div>
            ))}

            {addingNote && (
              <div className="space-y-2">
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} autoFocus rows={3}
                  placeholder="Write a note…"
                  className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
                <div className="flex gap-2">
                  <button onClick={saveNote} disabled={noteSaving || !noteText.trim()}
                    className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                    {noteSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save Note
                  </button>
                  <button onClick={() => { setAddingNote(false); setNoteText(''); }}
                    className="px-4 py-2 rounded-xl text-meta"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Edit + Delete */}
          {!editing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-body font-medium"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                <Edit2 size={15} /> Edit
              </button>
              <button onClick={deleteTask} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-body font-medium disabled:opacity-40"
                style={{ background: 'rgba(220,53,69,.08)', border: '1px solid rgba(220,53,69,.2)', color: '#e05260' }}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
              </button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
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
  const [detailTask,  setDetailTask]  = useState<GoalTask | null>(null);

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

  const todo = tasks.filter(t => !t.isDone);
  const done = tasks.filter(t =>  t.isDone);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--c-gold)' }} /></div>;
  if (isTemp)  return <div className="px-5 py-10 text-center"><Loader2 size={20} className="animate-spin mx-auto mb-3" style={{ color: 'var(--c-gold)' }} /><p className="text-body" style={{ color: 'var(--c-text-2)' }}>Saving your goal…</p></div>;

  return (
    <div className="px-4 py-5 space-y-6" style={{ paddingBottom: 120 }}>
      {todo.length > 0 && (
        <section>
          <h3 className="text-meta uppercase tracking-widest mb-3" style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>To Do</h3>
          <div className="space-y-2">
            <AnimatePresence>
              {todo.map((t, i) => (
                <TaskCard key={t.id} task={t} goalId={goal.id} isNextStep={i === 0}
                  onOpenDetail={setDetailTask} />
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
                  onOpenDetail={setDetailTask} />
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

      <TaskDetailSheet
        task={detailTask}
        goalId={goal.id}
        onClose={() => setDetailTask(null)}
      />
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

  const groupId = goal.groupId;

  useEffect(() => {
    if (!groupId) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'groups', groupId, 'threads'), orderBy('lastActivityAt', 'desc'), limit(50)),
      (snap) => { setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalRoomThread)); setLoading(false); },
      (err)  => { console.error(err); setLoading(false); }
    );
  }, [groupId]);

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

  // ── No room assigned yet
  if (!groupId) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
             style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
          <MessageCircle size={22} style={{ color: 'var(--c-gold)' }} />
        </div>
        <p className="text-card-title mb-2">Goal Room</p>
        <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
          No room assigned to this goal yet.
        </p>
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
// People Tab
// ─────────────────────────────────────────────────────────────────────────────

function PeopleTab({ goal }: { goal: Goal; user: FirebaseUser | null }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
           style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
        <Users size={22} style={{ color: 'var(--c-gold)' }} />
      </div>
      <p className="text-card-title mb-2">People</p>
      <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
        No members yet.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface GoalDetailScreenProps {
  user: FirebaseUser | null; dbUser: User | null;
  goalId: string; goals: Goal[];
  initialTab: 'plan' | 'goal-room' | 'people';
  setCurrentScreen: (s: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
}

type Tab = 'plan' | 'goal-room' | 'people';
const TABS: { key: Tab; label: string }[] = [
  { key: 'plan',      label: 'Plan'      },
  { key: 'goal-room', label: 'Goal Room' },
  { key: 'people',    label: 'People'    },
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
              <PeopleTab goal={goal} user={user} />
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}