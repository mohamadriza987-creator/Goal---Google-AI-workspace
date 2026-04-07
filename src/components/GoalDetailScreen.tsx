import React, { useState, useEffect, useRef } from 'react';
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
import { generateMicroSteps } from '../services/geminiService';
import { db } from '../firebase';
import {
  collection, query, orderBy, onSnapshot, limit,
  doc, updateDoc, addDoc, deleteDoc, increment, serverTimestamp,
  getDoc, getDocs, writeBatch,
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

/** Convert ISO string to value suitable for datetime-local input */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function TaskCard({ task, isNextStep, onOpenDetail, onToggleDone }: {
  task: GoalTask; isNextStep: boolean;
  onOpenDetail: (t: GoalTask) => void;
  onToggleDone: (task: GoalTask) => Promise<void>;
}) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    try { await onToggleDone(task); }
    catch (e) { console.error(e); }
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
        <button onClick={handleToggle} disabled={toggling}
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

function TaskDetailSheet({ task, goal, onClose, onDelete }: {
  task: GoalTask | null; goal: Goal; onClose: () => void;
  onDelete: (t: GoalTask) => void;
}) {
  const [editing,        setEditing]        = useState(false);
  const [editText,       setEditText]       = useState('');
  const [saving,         setSaving]         = useState(false);
  const [addingNote,     setAddingNote]     = useState(false);
  const [noteText,       setNoteText]       = useState('');
  const [noteSaving,     setNoteSaving]     = useState(false);
  const [showHelp,       setShowHelp]       = useState(false);
  const [helpType,       setHelpType]       = useState('');
  const [helpBlocking,   setHelpBlocking]   = useState('');
  const [helpSaving,     setHelpSaving]     = useState(false);
  const [helpDone,       setHelpDone]       = useState(false);
  const [generatingSteps, setGeneratingSteps] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderValue,   setReminderValue]   = useState('');
  const [reminderSaving,  setReminderSaving]  = useState(false);

  useEffect(() => {
    if (!task) return;
    setEditText(task.text); setEditing(false);
    setAddingNote(false); setNoteText('');
    setShowHelp(false); setHelpType(''); setHelpBlocking(''); setHelpDone(false);
    setGeneratingSteps(false);
    setEditingReminder(false);
    setReminderValue(task.reminderAt ? toDatetimeLocal(task.reminderAt) : '');

    // Auto-generate micro-steps if not already stored
    if (!task.microSteps?.length) {
      const run = async () => {
        const user = auth.currentUser;
        if (!user) return;
        setGeneratingSteps(true);
        try {
          const idToken = await user.getIdToken();
          const steps = await generateMicroSteps(task.text, idToken);
          if (steps.length > 0) {
            await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), { microSteps: steps });
          }
        } catch (e) {
          console.error('micro-steps generation failed', e);
        } finally {
          setGeneratingSteps(false);
        }
      };
      run();
    }
  }, [task?.id]);

  const saveEdit = async () => {
    if (!task || !editText.trim() || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), { text: editText.trim() });
      setEditing(false);
    } catch(e) { console.error(e); } finally { setSaving(false); }
  };

  const saveNote = async () => {
    if (!task || !noteText.trim() || noteSaving) return;
    setNoteSaving(true);
    try {
      const existing = task.notes ?? [];
      await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), {
        notes: [...existing, { id: Date.now().toString(), text: noteText.trim(), createdAt: new Date().toISOString() }],
      });
      setNoteText(''); setAddingNote(false);
    } catch(e) { console.error(e); } finally { setNoteSaving(false); }
  };

  const submitHelp = async () => {
    if (!task || !goal.groupId || !helpType || helpSaving) return;
    const uid  = auth.currentUser?.uid;
    const name = auth.currentUser?.displayName || 'Member';
    if (!uid) return;
    setHelpSaving(true);
    try {
      const now = new Date().toISOString();
      const threadRef = await addDoc(collection(db, 'groups', goal.groupId, 'threads'), {
        goalId:         goal.id, badge: 'help', title: task.text,
        linkedTaskId:   task.id, linkedTaskText: task.text,
        authorId: uid, authorName: name,
        previewText:    helpBlocking.trim() || `${helpType} needed`,
        replyCount: 0, usefulCount: 0, createdAt: now, lastActivityAt: now,
      });
      if (helpBlocking.trim()) {
        await addDoc(collection(db, 'groups', goal.groupId, 'threads', threadRef.id, 'replies'), {
          threadId: threadRef.id, goalId: goal.id, authorId: uid, authorName: name,
          text: `Type of help needed: ${helpType}\n\nWhat's blocking me: ${helpBlocking}`,
          reactions: {}, createdAt: now,
        });
      }
      setHelpDone(true); setHelpType(''); setHelpBlocking('');
    } catch(e) { console.error(e); } finally { setHelpSaving(false); }
  };

  const saveReminder = async () => {
    if (!task || reminderSaving) return;
    setReminderSaving(true);
    try {
      const iso = reminderValue ? new Date(reminderValue).toISOString() : null;
      await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), {
        reminderAt: iso ?? null,
      });
      setEditingReminder(false);
    } catch(e) { console.error(e); } finally { setReminderSaving(false); }
  };

  const removeReminder = async () => {
    if (!task || reminderSaving) return;
    setReminderSaving(true);
    try {
      await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), { reminderAt: null });
      setReminderValue('');
      setEditingReminder(false);
    } catch(e) { console.error(e); } finally { setReminderSaving(false); }
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

          {/* Micro-steps */}
          <div className="space-y-2">
            <span className="text-meta uppercase tracking-widest"
                  style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Steps</span>
            {generatingSteps ? (
              <div className="flex items-center gap-2 py-2" style={{ color: 'var(--c-text-3)' }}>
                <Loader2 size={13} className="animate-spin" />
                <span className="text-meta">Breaking it down…</span>
              </div>
            ) : (task.microSteps?.length ?? 0) > 0 ? (
              <div className="space-y-0.5">
                {task.microSteps!.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-3)', fontSize: 10, fontWeight: 700 }}>
                      {i + 1}
                    </span>
                    <p className="text-body flex-1 leading-snug">{step}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Reminder */}
          <div style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
            {editingReminder ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--c-text-2)' }}>
                  <Bell size={15} />
                  <span className="text-body">Reminder</span>
                </div>
                <input
                  type="datetime-local"
                  value={reminderValue}
                  onChange={e => setReminderValue(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl text-sm focus:outline-none"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
                />
                <div className="flex gap-2">
                  <button onClick={saveReminder} disabled={reminderSaving || !reminderValue}
                    className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                    {reminderSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Set
                  </button>
                  {task.reminderAt && (
                    <button onClick={removeReminder} disabled={reminderSaving}
                      className="px-4 py-2 rounded-xl text-meta disabled:opacity-40"
                      style={{ background: 'rgba(220,53,69,.08)', border: '1px solid rgba(220,53,69,.2)', color: '#e05260' }}>
                      Remove
                    </button>
                  )}
                  <button onClick={() => { setEditingReminder(false); setReminderValue(task.reminderAt ? toDatetimeLocal(task.reminderAt) : ''); }}
                    className="px-4 py-2 rounded-xl text-meta"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEditingReminder(true)}
                className="flex items-center justify-between w-full py-3"
                style={{ color: 'var(--c-text-2)' }}>
                <div className="flex items-center gap-2">
                  <Bell size={15} />
                  <span className="text-body">Reminder</span>
                </div>
                <span className="text-meta"
                      style={{ color: task.reminderAt ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
                  {task.reminderAt
                    ? new Date(task.reminderAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                    : 'Not set'}
                </span>
              </button>
            )}
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
            <div className="flex gap-2">
              <button onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-body font-medium"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                <Edit2 size={15} /> Edit
              </button>
              <button onClick={() => onDelete(task)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-body font-medium"
                style={{ background: 'rgba(220,53,69,.08)', border: '1px solid rgba(220,53,69,.2)', color: '#e05260' }}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}

          {/* Ask for Help */}
          {!editing && goal.groupId && (
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 16 }}>
              {helpDone ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                     style={{ background: 'rgba(74,124,89,.1)', border: '1px solid rgba(74,124,89,.2)' }}>
                  <Check size={14} style={{ color: 'var(--c-success)' }} />
                  <span className="text-body" style={{ color: 'var(--c-success)' }}>Posted to Goal Room</span>
                </div>
              ) : !showHelp ? (
                <button onClick={() => setShowHelp(true)}
                  className="flex items-center gap-2 text-body w-full py-1 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--c-text-3)' }}>
                  <HelpCircle size={15} /> Ask for help with this task
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-meta uppercase tracking-widest"
                     style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Ask for Help</p>
                  <div className="flex flex-wrap gap-2">
                    {['Advice', 'Accountability', 'Resource', 'Practice partner'].map(type => (
                      <button key={type} onClick={() => setHelpType(type)}
                        className="px-3 py-1.5 rounded-xl text-meta font-medium transition-all"
                        style={helpType === type
                          ? { background: 'var(--c-gold)', color: '#000' }
                          : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                        {type}
                      </button>
                    ))}
                  </div>
                  <textarea value={helpBlocking} onChange={e => setHelpBlocking(e.target.value)}
                    placeholder="What's blocking you? (optional)" rows={2}
                    className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
                  <div className="flex gap-2">
                    <button onClick={submitHelp} disabled={helpSaving || !helpType}
                      className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                      {helpSaving ? <Loader2 size={14} className="animate-spin" /> : <HelpCircle size={14} />}
                      Post to Goal Room
                    </button>
                    <button onClick={() => { setShowHelp(false); setHelpType(''); setHelpBlocking(''); }}
                      className="px-4 py-2 rounded-xl text-meta"
                      style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

type PendingDelete = { task: GoalTask; timerId: ReturnType<typeof setTimeout> };

function PlanTab({ goal, user }: { goal: Goal; user: FirebaseUser | null }) {
  const [tasks,         setTasks]         = useState<GoalTask[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [addingTask,    setAddingTask]    = useState(false);
  const [newTaskText,   setNewTaskText]   = useState('');
  const [saving,        setSaving]        = useState(false);
  const [detailTask,    setDetailTask]    = useState<GoalTask | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);

  const isTemp = goal.id.startsWith('temp-');

  useEffect(() => { pendingDeleteRef.current = pendingDelete; }, [pendingDelete]);

  // Commit any in-flight delete on unmount
  useEffect(() => {
    return () => {
      const pd = pendingDeleteRef.current;
      if (pd) {
        clearTimeout(pd.timerId);
        deleteDoc(doc(db, 'goals', goal.id, 'tasks', pd.task.id)).catch(console.error);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTemp) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'goals', goal.id, 'tasks'), orderBy('order', 'asc')),
      (snap) => {
        const updated = snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalTask);
        setTasks(updated);
        setLoading(false);
        setDetailTask(prev => prev ? (updated.find(t => t.id === prev.id) ?? prev) : null);
        // Keep goal progress in sync with actual task completion
        const active = updated.filter(t => t.id !== pendingDeleteRef.current?.task.id);
        if (active.length > 0) {
          const pct = Math.round(active.filter(t => t.isDone).length / active.length * 100);
          updateDoc(doc(db, 'goals', goal.id), { progressPercent: pct }).catch(console.error);
        }
      },
      (err) => { console.error(err); setLoading(false); }
    );
  }, [goal.id]);

  const toggleDone = async (task: GoalTask): Promise<void> => {
    const newDone = !task.isDone;
    // Optimistic progress: compute before Firestore confirms
    const active = tasks.filter(t => t.id !== pendingDeleteRef.current?.task.id);
    const newDoneCount = active.filter(t => t.id === task.id ? newDone : t.isDone).length;
    const newPct = active.length > 0 ? Math.round(newDoneCount / active.length * 100) : 0;
    await Promise.all([
      updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), {
        isDone: newDone,
        completedAt: newDone ? new Date().toISOString() : null,
      }),
      updateDoc(doc(db, 'goals', goal.id), { progressPercent: newPct }),
    ]);
  };

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

  const requestDelete = (task: GoalTask) => {
    const prev = pendingDeleteRef.current;
    if (prev) {
      clearTimeout(prev.timerId);
      deleteDoc(doc(db, 'goals', goal.id, 'tasks', prev.task.id)).catch(console.error);
    }
    setDetailTask(null);
    const timerId = setTimeout(async () => {
      await deleteDoc(doc(db, 'goals', goal.id, 'tasks', task.id)).catch(console.error);
      // Recalculate progress after hard delete
      const remaining = tasks.filter(t => t.id !== task.id);
      if (remaining.length > 0) {
        const pct = Math.round(remaining.filter(t => t.isDone).length / remaining.length * 100);
        updateDoc(doc(db, 'goals', goal.id), { progressPercent: pct }).catch(console.error);
      } else {
        updateDoc(doc(db, 'goals', goal.id), { progressPercent: 0 }).catch(console.error);
      }
      setPendingDelete(null);
    }, 5000);
    setPendingDelete({ task, timerId });
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timerId);
    setPendingDelete(null);
  };

  const displayTasks = tasks.filter(t => t.id !== pendingDelete?.task.id);
  const todo = displayTasks.filter(t => !t.isDone);
  const done = displayTasks.filter(t =>  t.isDone);

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
                <TaskCard key={t.id} task={t} isNextStep={i === 0}
                  onOpenDetail={setDetailTask} onToggleDone={toggleDone} />
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
                <TaskCard key={t.id} task={t} isNextStep={false}
                  onOpenDetail={setDetailTask} onToggleDone={toggleDone} />
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
        goal={goal}
        onClose={() => setDetailTask(null)}
        onDelete={requestDelete}
      />

      {/* Undo delete toast */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            key="undo-toast"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="fixed bottom-24 left-4 right-4 z-50 flex items-center justify-between px-4 py-3 rounded-2xl"
            style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', boxShadow: '0 4px 20px rgba(0,0,0,.35)' }}>
            <span className="text-body" style={{ color: 'var(--c-text-2)' }}>Task deleted</span>
            <button onClick={undoDelete}
              className="text-body font-semibold px-2 py-1 rounded-lg"
              style={{ color: 'var(--c-gold)' }}>
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
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

interface AuthorCredit {
  similarityPct?: number;   // from goal.similarGoals
  usefulGiven:   number;    // sum of usefulCount on their threads in this room
  helpOffered:   number;    // count of threads they posted with help/support badge
}

function buildAuthorCredit(
  authorId: string,
  allThreads: GoalRoomThread[],
  similarGoals: Goal['similarGoals'],
): AuthorCredit {
  const theirThreads = allThreads.filter(t => t.authorId === authorId);
  const usefulGiven  = theirThreads.reduce((s, t) => s + (t.usefulCount ?? 0), 0);
  const helpOffered  = theirThreads.filter(t => t.badge === 'help' || t.badge === 'support').length;
  const simEntry     = similarGoals?.find(g => g.userId === authorId);
  return {
    similarityPct: simEntry ? Math.round(simEntry.similarityScore * 100) : undefined,
    usefulGiven,
    helpOffered,
  };
}

function ThreadDetail({ thread, groupId, goalId, user, allThreads, similarGoals, onBack }: {
  thread: GoalRoomThread; groupId: string; goalId: string;
  user: FirebaseUser | null;
  allThreads: GoalRoomThread[];
  similarGoals: Goal['similarGoals'];
  onBack: () => void;
}) {
  const [replies,    setReplies]  = useState<GoalRoomReply[]>([]);
  const [loading,    setLoading]  = useState(true);
  const [replyText,  setReplyText]= useState('');
  const [sending,    setSending]  = useState(false);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  // Track reactions this session to prevent double-counting
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());

  const meta = BADGE_META[thread.badge];
  const isHelpThread = thread.badge === 'help' || thread.badge === 'support';
  const authorCredit = isHelpThread
    ? buildAuthorCredit(thread.authorId, allThreads, similarGoals)
    : null;

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
    const text = replyText.trim();
    setReplyText('');
    const now = new Date().toISOString();
    try {
      // Atomic: write reply + increment counters in one batch
      const replyRef = doc(collection(db, 'groups', groupId, 'threads', thread.id, 'replies'));
      const threadRef = doc(db, 'groups', groupId, 'threads', thread.id);
      const batch = writeBatch(db);
      batch.set(replyRef, {
        threadId: thread.id, goalId,
        authorId: user.uid, authorName: user.displayName || 'Member',
        text, reactions: {}, createdAt: now,
      });
      batch.update(threadRef, { replyCount: increment(1), lastActivityAt: now });
      await batch.commit();
    } catch(e) {
      console.error(e);
      setReplyText(text); // restore on failure
    } finally {
      setSending(false);
    }
  };

  const reactToReply = async (replyId: string, reaction: string) => {
    const key = `${replyId}-${reaction}`;
    if (myReactions.has(key) || !user) return;
    setMyReactions(prev => new Set([...prev, key])); // optimistic lock
    try {
      const replyRef  = doc(db, 'groups', groupId, 'threads', thread.id, 'replies', replyId);
      const threadRef = doc(db, 'groups', groupId, 'threads', thread.id);
      const batch = writeBatch(db);
      batch.update(replyRef, { [`reactions.${reaction}`]: increment(1) });
      if (reaction === 'useful') {
        batch.update(threadRef, { usefulCount: increment(1) });
      }
      await batch.commit();
    } catch(e) {
      console.error(e);
      setMyReactions(prev => { const n = new Set(prev); n.delete(key); return n; }); // rollback lock
    }
  };

  const saveReplyToNotes = async (reply: GoalRoomReply) => {
    if (!user || savedNotes.has(reply.id)) return;
    try {
      await addDoc(collection(db, 'goals', goalId, 'notes'), {
        goalId, ownerId: user.uid,
        text: reply.text, source: 'saved_from_room', privacy: 'private',
        savedFromAuthorName: reply.authorName, savedFromReplyId: reply.id,
        createdAt: new Date().toISOString(),
      });
      setSavedNotes(prev => new Set([...prev, reply.id]));
    } catch(e) { console.error(e); }
  };

  const REACTIONS = [
    { key: 'useful',   icon: <ThumbsUp size={13} />, label: 'Useful'       },
    { key: 'proud',    icon: <Star     size={13} />, label: 'Proud'        },
    { key: 'me_too',   icon: <Heart    size={13} />, label: 'Me too'       },
    { key: 'can_help', icon: <Hand     size={13} />, label: 'I can help'   },
  ];

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100dvh - 280px)' }}>
      {/* Back + badge */}
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
        <p className="text-body leading-relaxed mb-3" style={{ color: 'var(--c-text-2)' }}>
          {thread.previewText}
        </p>

        {/* Author row — with credibility for help/support threads */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
            {thread.authorName} · {timeAgo(thread.createdAt)}
          </p>
          {authorCredit && (
            <div className="flex items-center gap-3 flex-wrap">
              {authorCredit.similarityPct !== undefined && (
                <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
                  {authorCredit.similarityPct}% match
                </span>
              )}
              {authorCredit.usefulGiven > 0 && (
                <span className="flex items-center gap-1 text-meta" style={{ color: 'var(--c-gold)', fontSize: 11 }}>
                  <ThumbsUp size={10} /> {authorCredit.usefulGiven} useful
                </span>
              )}
              {authorCredit.helpOffered > 0 && (
                <span className="flex items-center gap-1 text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
                  <Hand size={10} /> helped {authorCredit.helpOffered}×
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto" style={{ paddingBottom: 100 }}>
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
          </div>
        )}
        {!loading && replies.length === 0 && (
          <p className="text-center text-meta py-8" style={{ color: 'var(--c-text-3)' }}>
            No replies yet. Be the first to respond.
          </p>
        )}
        {replies.map(reply => (
          <div key={reply.id} className="p-4 rounded-2xl"
               style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-meta font-semibold" style={{ color: 'var(--c-text-2)' }}>{reply.authorName}</span>
              <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>{timeAgo(reply.createdAt)}</span>
            </div>
            <p className="text-body leading-relaxed mb-3">{reply.text}</p>

            {/* Reactions */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {REACTIONS.map(r => {
                const count = reply.reactions?.[r.key as keyof typeof reply.reactions] ?? 0;
                const reacted = myReactions.has(`${reply.id}-${r.key}`);
                return (
                  <button key={r.key}
                    onClick={() => reactToReply(reply.id, r.key)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-meta transition-opacity hover:opacity-70"
                    style={{
                      background: reacted ? 'rgba(201,168,76,.12)' : 'var(--c-surface-2)',
                      border: `1px solid ${reacted ? 'var(--c-gold)' : 'var(--c-border)'}`,
                      color: reacted ? 'var(--c-gold)' : 'var(--c-text-3)',
                    }}>
                    {r.icon}
                    <span style={{ fontSize: 11 }}>{r.label}</span>
                    {count > 0 && (
                      <span style={{ color: 'var(--c-gold)', fontWeight: 700, fontSize: 11 }}>{count}</span>
                    )}
                  </button>
                );
              })}
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

      {/* Reply composer */}
      <div className="sticky bottom-0 px-4 pb-6 pt-3"
           style={{ background: 'var(--c-bg)', borderTop: '1px solid var(--c-border)' }}>
        <div className="flex gap-2">
          <input value={replyText} onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
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
  const [serverThreads,  setServerThreads]  = useState<GoalRoomThread[]>([]);
  const [pendingThread,  setPendingThread]  = useState<GoalRoomThread | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [filter,         setFilter]         = useState<ThreadBadge | 'all'>('all');
  const [selectedThread, setSelectedThread] = useState<GoalRoomThread | null>(null);
  const [creating,       setCreating]       = useState(false);

  const [newBadge, setNewBadge] = useState<ThreadBadge>('help');
  const [newTitle, setNewTitle] = useState('');
  const [newBody,  setNewBody]  = useState('');

  const groupId = goal.groupId;

  useEffect(() => {
    if (!groupId) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'groups', groupId, 'threads'), orderBy('lastActivityAt', 'desc'), limit(50)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalRoomThread);
        setServerThreads(list);
        setLoading(false);
        // Clear optimistic thread once its server copy has arrived
        setPendingThread(pt => {
          if (!pt) return null;
          const arrived = list.some(t =>
            t.authorId === pt.authorId &&
            t.title    === pt.title &&
            Math.abs(new Date(t.createdAt).getTime() - new Date(pt.createdAt).getTime()) < 10_000
          );
          return arrived ? null : pt;
        });
      },
      (err) => { console.error(err); setLoading(false); }
    );
  }, [groupId]);

  const createThread = () => {
    if (!newTitle.trim() || !user || !groupId) return;

    const title = newTitle.trim();
    const body  = newBody.trim();
    const badge = newBadge;
    const now   = new Date().toISOString();

    // Optimistic: add to UI immediately
    const tempId: string = `opt-${Date.now()}`;
    const optimistic: GoalRoomThread = {
      id: tempId, goalId: goal.id, badge, title,
      authorId: user.uid, authorName: user.displayName || 'Member',
      previewText: body || title,
      replyCount: 0, usefulCount: 0, createdAt: now, lastActivityAt: now,
    };
    setPendingThread(optimistic);

    // Close composer immediately
    setCreating(false);
    setNewTitle('');
    setNewBody('');
    setNewBadge('help');

    // Write in background; rollback on failure
    addDoc(collection(db, 'groups', groupId, 'threads'), {
      goalId: goal.id, badge, title,
      authorId: user.uid, authorName: user.displayName || 'Member',
      previewText: body || title,
      replyCount: 0, usefulCount: 0, createdAt: now, lastActivityAt: now,
    }).catch(() => {
      setPendingThread(pt => (pt?.id === tempId ? null : pt));
    });
  };

  // Merge: pending first (if not yet in server list), then server list
  const allThreads = pendingThread ? [pendingThread, ...serverThreads] : serverThreads;
  const filtered   = filter === 'all' ? allThreads : allThreads.filter(t => t.badge === filter);

  // ── No room assigned
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
        thread={selectedThread}
        groupId={groupId}
        goalId={goal.id}
        user={user}
        allThreads={allThreads}
        similarGoals={goal.similarGoals}
        onBack={() => setSelectedThread(null)}
      />
    );
  }

  // ── Thread list
  return (
    <div className="flex flex-col" style={{ paddingBottom: 100 }}>
      {/* Filter pills */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ borderBottom: '1px solid var(--c-border)' }}>
        {(['all', ...ALL_BADGES] as const).map(b => (
          <button key={b} onClick={() => setFilter(b)}
            className="flex-shrink-0 text-meta font-semibold"
            style={filter === b
              ? { background: 'var(--c-gold)', color: '#000', borderRadius: 999, padding: '6px 14px' }
              : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', borderRadius: 999, padding: '6px 14px' }}>
            {b === 'all' ? 'All' : BADGE_META[b].label}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-3 flex-1">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-body mb-1" style={{ color: 'var(--c-text-2)' }}>No threads yet.</p>
            <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Start a conversation below.</p>
          </div>
        )}
        <AnimatePresence>
          {filtered.map(thread => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onOpen={() => thread.id.startsWith('opt-') ? undefined : setSelectedThread(thread)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* FAB */}
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
                  style={newBadge !== b ? {
                    background: 'var(--c-surface-2)', border: '1px solid var(--c-border)',
                    color: 'var(--c-text-3)', borderRadius: 999, padding: '3px 10px',
                    fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
                  } : {}}>
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
          <button onClick={createThread} disabled={!newTitle.trim()}
            className="btn-gold w-full flex items-center justify-center gap-2 disabled:opacity-40">
            <Send size={16} /> Post Thread
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// People Tab
// ─────────────────────────────────────────────────────────────────────────────

interface RoomMember {
  goalId: string;
  userId: string;
  joinedAt: string;
}

interface MemberGoalData extends RoomMember {
  title: string;
  description: string;
  progressPercent: number;
  timeHorizon?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface MemberTaskItem {
  id: string;
  goalId: string;
  userId: string;
  memberName: string;
  text: string;
  isDone: boolean;
  completedAt?: string;
  createdAt: string;
}

function MemberDetailSheet({
  member,
  tasks,
  onClose,
}: {
  member: MemberGoalData;
  tasks: MemberTaskItem[];
  onClose: () => void;
}) {
  const doneTasks   = tasks.filter(t => t.isDone);
  const activeTasks = tasks.filter(t => !t.isDone);

  return (
    <>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <motion.div
        key="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
        style={{ background: 'var(--c-surface-1)', borderRadius: '20px 20px 0 0', maxHeight: '85vh', overflow: 'hidden' }}
      >
        <div className="overflow-y-auto flex-1 pb-10">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-3 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                   style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}>
                {member.displayName?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p style={{ fontWeight: 600 }}>{member.displayName ?? 'Member'}</p>
                <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                  Joined {timeAgo(member.joinedAt)}
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ color: 'var(--c-text-3)' }}>
              <X size={18} />
            </button>
          </div>

          {/* Their goal */}
          <div className="px-5 pb-4">
            <div className="card p-4" style={{ borderRadius: 14 }}>
              <p className="text-meta mb-1"
                 style={{ color: 'var(--c-text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Their Goal
              </p>
              <p className="text-body mb-1" style={{ fontWeight: 500 }}>{member.title}</p>
              {member.description && (
                <p className="text-meta" style={{ color: 'var(--c-text-2)' }}>{member.description}</p>
              )}
              <div className="flex items-center gap-5 mt-3">
                <div className="flex flex-col">
                  <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>Progress</span>
                  <span style={{ fontWeight: 600, fontSize: 18 }}>{member.progressPercent}%</span>
                </div>
                {member.timeHorizon && (
                  <div className="flex flex-col">
                    <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>Timeline</span>
                    <span style={{ fontWeight: 500 }}>{member.timeHorizon}</span>
                  </div>
                )}
                {doneTasks.length > 0 && (
                  <div className="flex flex-col">
                    <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>Tasks done</span>
                    <span style={{ fontWeight: 600, fontSize: 18, color: 'var(--c-gold)' }}>{doneTasks.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Their active tasks */}
          {activeTasks.length > 0 && (
            <div className="px-5 pb-4">
              <p className="text-label mb-3"
                 style={{ color: 'var(--c-text-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Working On ({activeTasks.length})
              </p>
              <div className="flex flex-col gap-2">
                {activeTasks.map(t => (
                  <div key={t.id} className="card p-3" style={{ borderRadius: 12 }}>
                    <p className="text-body" style={{ fontWeight: 400 }}>{t.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Their completed tasks */}
          {doneTasks.length > 0 && (
            <div className="px-5 pb-6">
              <p className="text-label mb-3"
                 style={{ color: 'var(--c-text-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Completed ({doneTasks.length})
              </p>
              <div className="flex flex-col gap-2">
                {doneTasks.map(t => (
                  <div key={t.id} className="card p-3 flex items-start gap-2" style={{ borderRadius: 12 }}>
                    <Check size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--c-gold)' }} />
                    <p className="text-body" style={{ fontWeight: 400, color: 'var(--c-text-2)' }}>{t.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && (
            <div className="px-5 pb-6">
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No tasks recorded yet.</p>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function PeopleTab({ goal, user }: { goal: Goal; user: FirebaseUser | null }) {
  const groupId = goal.groupId;
  const isInRoom = goal.groupJoined === true && !!groupId;

  const [groupName, setGroupName]         = useState<string>('');
  const [roomDescription, setRoomDescription] = useState<string>('');
  const [memberCount, setMemberCount]     = useState<number>(0);
  const [members, setMembers]             = useState<RoomMember[]>([]);
  const [memberGoals, setMemberGoals]     = useState<Map<string, MemberGoalData>>(new Map());
  const [memberTasks, setMemberTasks]     = useState<MemberTaskItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberGoalData | null>(null);

  useEffect(() => {
    if (!isInRoom || !groupId) { setLoading(false); return; }

    getDoc(doc(db, 'groups', groupId)).then(async (snap) => {
      if (!snap.exists()) { setLoading(false); return; }
      const data = snap.data() as any;

      setGroupName(data.derivedGoalTheme ?? 'Your Goal Room');
      setMemberCount(data.memberCount ?? 0);

      // Build description from matchingCriteria
      const cat     = data.matchingCriteria?.category as string | undefined;
      const horizon = data.matchingCriteria?.timeHorizon as string | undefined;
      const parts: string[] = [];
      if (cat)     parts.push(cat.charAt(0).toUpperCase() + cat.slice(1));
      if (horizon) parts.push(`${horizon} timeline`);
      setRoomDescription(
        parts.length ? `${parts.join(' · ')} · highly matched goals` : 'Highly matched goals',
      );

      const rawMembers: RoomMember[] = (data.members ?? []).filter(
        (m: any) => m.userId !== user?.uid,
      );
      setMembers(rawMembers);

      // Fetch each member's goal + user profile
      const results = await Promise.all(
        rawMembers.map(async (m) => {
          try {
            const [gSnap, uSnap] = await Promise.all([
              getDoc(doc(db, 'goals', m.goalId)),
              getDoc(doc(db, 'users', m.userId)),
            ]);
            const g = gSnap.exists() ? (gSnap.data() as any) : null;
            const u = uSnap.exists() ? (uSnap.data() as any) : null;
            return {
              goalId: m.goalId,
              userId: m.userId,
              joinedAt: m.joinedAt,
              title: g?.title ?? 'Goal',
              description: g?.description ?? '',
              progressPercent: g?.progressPercent ?? 0,
              timeHorizon: g?.timeHorizon,
              displayName: u?.displayName ?? u?.username ?? null,
              avatarUrl: u?.avatarUrl ?? null,
            } as MemberGoalData;
          } catch {
            return {
              goalId: m.goalId, userId: m.userId, joinedAt: m.joinedAt,
              title: 'Goal', description: '', progressPercent: 0,
            } as MemberGoalData;
          }
        }),
      );

      const map = new Map<string, MemberGoalData>();
      results.forEach(r => map.set(r.userId, r));
      setMemberGoals(map);

      // Fetch tasks from every member's goal
      const allTasks: MemberTaskItem[] = [];
      await Promise.all(
        results.map(async (mg) => {
          try {
            const tasksSnap = await getDocs(collection(db, 'goals', mg.goalId, 'tasks'));
            tasksSnap.docs.forEach(td => {
              const t = td.data() as any;
              if (!t.text) return;
              allTasks.push({
                id: td.id,
                goalId: mg.goalId,
                userId: mg.userId,
                memberName: mg.displayName ?? 'Member',
                text: t.text,
                isDone: t.isDone ?? false,
                completedAt: t.completedAt,
                createdAt: t.createdAt ?? '',
              });
            });
          } catch { /* ignore per-member failure */ }
        }),
      );
      setMemberTasks(allTasks);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [groupId, isInRoom, user?.uid]);

  if (!isInRoom) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
             style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
          <Users size={22} style={{ color: 'var(--c-text-3)' }} />
        </div>
        <div>
          <p className="text-card-title mb-1">Not in a room yet</p>
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
            Once your goal matches others at 90%+ similarity, you'll be placed in a shared room automatically.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--c-text-3)' }} />
      </div>
    );
  }

  // Similar Tasks: active tasks from room members, most recent first, top 5
  const similarTasks = memberTasks
    .filter(t => !t.isDone)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Most Popular Tasks: group by normalised text, rank by member count then completion count
  const taskGroups = new Map<string, { text: string; memberCount: number; doneCount: number }>();
  memberTasks.forEach(t => {
    const key = t.text.toLowerCase().trim();
    const existing = taskGroups.get(key);
    if (existing) {
      existing.memberCount++;
      if (t.isDone) existing.doneCount++;
    } else {
      taskGroups.set(key, { text: t.text, memberCount: 1, doneCount: t.isDone ? 1 : 0 });
    }
  });
  const popularTasks = [...taskGroups.values()]
    .sort((a, b) => b.memberCount - a.memberCount || b.doneCount - a.doneCount)
    .slice(0, 5);

  return (
    <div className="pb-32">

      {/* Your Goal Room */}
      <div className="px-5 pt-5 pb-3">
        <div className="card p-4" style={{ borderRadius: 16 }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                 style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
              <Users size={16} style={{ color: 'var(--c-gold)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-card-title mb-0.5 truncate">{groupName}</p>
              <p className="text-meta mb-1" style={{ color: 'var(--c-text-2)' }}>{roomDescription}</p>
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Members */}
      <section className="px-5 pt-4">
        <p className="text-label mb-3"
           style={{ color: 'var(--c-text-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Members
        </p>
        {members.length === 0 ? (
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No other members yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map(m => {
              const mg = memberGoals.get(m.userId);
              return (
                <button
                  key={m.userId}
                  className="card p-4 flex items-center gap-3 w-full text-left"
                  style={{ borderRadius: 14 }}
                  onClick={() => mg && setSelectedMember(mg)}
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold"
                       style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}>
                    {mg?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate" style={{ fontWeight: 500 }}>
                      {mg?.displayName ?? 'Member'}
                    </p>
                    <p className="text-meta truncate" style={{ color: 'var(--c-text-3)' }}>
                      {mg?.title ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                      {mg?.progressPercent ?? 0}%
                    </span>
                    <ChevronRight size={14} style={{ color: 'var(--c-text-3)' }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Similar Tasks */}
      {similarTasks.length > 0 && (
        <section className="px-5 pt-6">
          <p className="text-label mb-3"
             style={{ color: 'var(--c-text-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Similar Tasks
          </p>
          <div className="flex flex-col gap-2">
            {similarTasks.map(t => (
              <div key={`${t.goalId}-${t.id}`} className="card p-4" style={{ borderRadius: 14 }}>
                <p className="text-body mb-1" style={{ fontWeight: 500 }}>{t.text}</p>
                <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>{t.memberName}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Most Popular Tasks */}
      {popularTasks.length > 0 && (
        <section className="px-5 pt-6">
          <p className="text-label mb-3"
             style={{ color: 'var(--c-text-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Most Popular Tasks
          </p>
          <div className="flex flex-col gap-2">
            {popularTasks.map((g, i) => (
              <div key={i} className="card p-4" style={{ borderRadius: 14 }}>
                <p className="text-body mb-1" style={{ fontWeight: 500 }}>{g.text}</p>
                <div className="flex items-center gap-3">
                  <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                    {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                  </span>
                  {g.doneCount > 0 && (
                    <>
                      <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>·</span>
                      <span className="flex items-center gap-1 text-meta" style={{ color: 'var(--c-gold)' }}>
                        <Check size={12} /> {g.doneCount} completed
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Member detail sheet */}
      <AnimatePresence>
        {selectedMember && (
          <MemberDetailSheet
            member={selectedMember}
            tasks={memberTasks.filter(t => t.userId === selectedMember.userId)}
            onClose={() => setSelectedMember(null)}
          />
        )}
      </AnimatePresence>
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