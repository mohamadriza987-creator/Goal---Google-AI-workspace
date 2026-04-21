import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useUserContext } from '../contexts/UserContext';
import { Goal, GoalTask, GoalRoomThread, GoalRoomReply, User, ThreadBadge } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeft, Lock, Edit2, Check, Plus, Send,
  HelpCircle, Loader2, X, BookOpen, Zap, Bell, Info, Trash2,
  MessageCircle, Users, ChevronRight,
  ThumbsUp, Heart, Hand, Star,
  Bookmark, Volume2, VolumeX, UserX, BellOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { generateMicroSteps } from '../services/geminiService';
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
          /* POLISH: share the ease token — duration intentionally kept at .7s for the long fill */
          style={{ transition: 'stroke-dashoffset .7s var(--ease-out-quad)' }} />
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
  /* POLISH: lock background scroll + kill iOS rubber-band while the sheet is open */
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* POLISH: 60% black scrim w/ 4px blur — tap to close (already wired). */}
          <motion.div key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{
              background:           'rgba(0,0,0,.6)',
              backdropFilter:       'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
            onClick={onClose} />
          <motion.div key="sh"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
            className="fixed bottom-0 left-0 right-0 z-50 px-5 pt-6 max-h-[90dvh] overflow-y-auto"
            /* POLISH: modal shadow ladder for lift, safe-area-aware bottom padding,
               paint containment so sheet content doesn't repaint the page beneath. */
            style={{
              background:    'var(--c-surface)',
              borderRadius:  '28px 28px 0 0',
              borderTop:     '1px solid var(--c-border)',
              boxShadow:     'var(--shadow-1), var(--shadow-2), var(--shadow-modal)',
              paddingBottom: 'max(40px, calc(env(safe-area-inset-bottom) + 24px))',
              contain:       'layout style paint',
            }}>
            {/* POLISH: 36×4 drag handle (token scale) — was 40×4 */}
            <div
              className="rounded-full mx-auto mb-5"
              style={{ width: 36, height: 4, background: 'var(--c-border-light)' }}
              aria-hidden
            />
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
        {/* POLISH: checkbox — 44×44 invisible tap area around a 24 visible circle,
            anim-press scale pulse, check-mark drops in with a 180ms scale-in. */}
        <button
          onClick={handleToggle}
          disabled={toggling}
          aria-label={task.isDone ? 'Mark task not done' : 'Mark task done'}
          className="tap-target anim-press flex-shrink-0"
          style={{ touchAction: 'manipulation' }}
        >
          <span
            className="flex items-center justify-center rounded-full border-2 transition-colors"
            style={task.isDone
              ? { width: 24, height: 24, background: 'var(--c-success)', borderColor: 'var(--c-success)' }
              : { width: 24, height: 24, borderColor: 'var(--c-border-light)' }}
          >
            {toggling
              ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--c-text-3)' }} />
              : task.isDone && (
                <motion.span
                  /* POLISH: scale-in check */
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                  style={{ display: 'inline-flex' }}
                >
                  <Check size={13} color="#fff" strokeWidth={3} />
                </motion.span>
              )}
          </span>
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
        {/* POLISH: 44×44 tap target + anim-press */}
        <button onClick={(e) => { e.stopPropagation(); onOpenDetail(task); }}
          className="flex-shrink-0 tap-target anim-press rounded-lg transition-opacity hover:opacity-70"
          style={{ color: task.reminderAt ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
          <Bell size={15} fill={task.reminderAt ? 'currentColor' : 'none'} />
        </button>

        {/* Info */}
        {/* POLISH: 44×44 tap target + anim-press */}
        <button onClick={() => onOpenDetail(task)}
          className="flex-shrink-0 tap-target anim-press rounded-lg transition-opacity hover:opacity-70"
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
  const [microStepsError, setMicroStepsError] = useState<string | null>(null);
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderValue,   setReminderValue]   = useState('');
  const [reminderSaving,  setReminderSaving]  = useState(false);

  useEffect(() => {
    if (!task) return;
    setEditText(task.text); setEditing(false);
    setAddingNote(false); setNoteText('');
    setShowHelp(false); setHelpType(''); setHelpBlocking(''); setHelpDone(false);
    setGeneratingSteps(false);
    setMicroStepsError(null);
    setEditingReminder(false);
    setReminderValue(task.reminderAt ? toDatetimeLocal(task.reminderAt) : '');

    // Auto-generate micro-steps only for manual tasks — AI tasks always have embedded microSteps
    if (!task.microSteps?.length && task.source !== 'ai') {
      const run = async () => {
        const user = auth.currentUser;
        if (!user) return;
        setGeneratingSteps(true);
        setMicroStepsError(null);
        try {
          const idToken = await user.getIdToken();
          const steps = await generateMicroSteps(task.text, idToken);
          if (steps.length > 0) {
            await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), { microSteps: steps });
          }
        } catch (e) {
          // B2: previously the error was console-logged and the spinner just
          // disappeared, leaving the user with no idea why nothing showed up.
          console.error('micro-steps generation failed', e);
          setMicroStepsError("Couldn't generate sub-steps right now. Tap retry.");
        } finally {
          setGeneratingSteps(false);
        }
      };
      run();
    }
  }, [task?.id]);

  const retryMicroSteps = async () => {
    if (!task) return;
    const user = auth.currentUser;
    if (!user) return;
    setGeneratingSteps(true);
    setMicroStepsError(null);
    try {
      const idToken = await user.getIdToken();
      const steps = await generateMicroSteps(task.text, idToken);
      if (steps.length > 0) {
        await updateDoc(doc(db, 'goals', goal.id, 'tasks', task.id), { microSteps: steps });
      }
    } catch (e) {
      console.error('micro-steps retry failed', e);
      setMicroStepsError("Still couldn't generate sub-steps. Try again later.");
    } finally {
      setGeneratingSteps(false);
    }
  };

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
    let threadRef: any = null;
    try {
      const now = new Date().toISOString();
      threadRef = await addDoc(collection(db, 'groups', goal.groupId, 'threads'), {
        goalId:         goal.id, badge: 'help', title: task.text,
        linkedTaskId:   task.id, linkedTaskText: task.text,
        authorId: uid, authorName: name,
        previewText:    helpBlocking.trim() || `${helpType} needed`,
        replyCount: 0, usefulCount: 0, createdAt: now, lastActivityAt: now,
      });
      if (helpBlocking.trim()) {
        try {
          await addDoc(collection(db, 'groups', goal.groupId, 'threads', threadRef.id, 'replies'), {
            threadId: threadRef.id, goalId: goal.id, authorId: uid, authorName: name,
            text: `Type of help needed: ${helpType}\n\nWhat's blocking me: ${helpBlocking}`,
            reactions: {}, createdAt: now,
          });
        } catch (replyErr) {
          // B3: don't leave an orphan empty thread that has no body. The
          // thread + first reply must commit together or not at all.
          console.error('Reply write failed; rolling back thread.', replyErr);
          try {
            await deleteDoc(doc(db, 'groups', goal.groupId, 'threads', threadRef.id));
          } catch (rollbackErr) {
            console.error('Thread rollback failed:', rollbackErr);
          }
          throw replyErr;
        }
      }
      setHelpDone(true); setHelpType(''); setHelpBlocking('');
    } catch(e) {
      console.error('submitHelp failed:', e);
      alert("Couldn't post your help request. Please try again.");
    } finally { setHelpSaving(false); }
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
            ) : microStepsError ? (
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-meta" style={{ color: '#e88' }}>{microStepsError}</span>
                <button onClick={retryMicroSteps}
                  className="text-meta px-3 py-1 rounded-lg"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                  Retry
                </button>
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
  // D1: ref must be assigned synchronously inside requestDelete/undoDelete so
  // that the realtime tasks snapshot fired between setState and the next
  // effect commit still sees the correct pending-delete state. The useEffect
  // sync was a *replication* of state, not a source of truth.
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  // tasksRef gives the delete timer access to the *latest* tasks rather than
  // the closure copy at the time setTimeout was scheduled.
  const tasksRef = useRef<GoalTask[]>([]);

  const isTemp = goal.id.startsWith('temp-');

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

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
        source: 'manual', goalId: goal.id, ownerId: user.uid, createdAt: new Date().toISOString(),
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
      // Read latest tasks via ref — closure-captured `tasks` would be stale
      // if other tasks were toggled during the 5s undo window.
      const remaining = tasksRef.current.filter(t => t.id !== task.id);
      const pct = remaining.length > 0
        ? Math.round(remaining.filter(t => t.isDone).length / remaining.length * 100)
        : 0;
      updateDoc(doc(db, 'goals', goal.id), { progressPercent: pct }).catch(console.error);
      pendingDeleteRef.current = null;
      setPendingDelete(null);
    }, 5000);
    const pd = { task, timerId };
    // Synchronous ref assignment: the next snapshot listener tick must already
    // see this pending delete, otherwise progress is recalculated as if the
    // task were still active.
    pendingDeleteRef.current = pd;
    setPendingDelete(pd);
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timerId);
    pendingDeleteRef.current = null;
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
          {/* POLISH: 44×44 tap target + anim-press */}
          <button onClick={() => { setAddingTask(false); setNewTaskText(''); }}
            className="tap-target anim-press rounded-xl"
            style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
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

function ThreadDetail({ thread, groupId, goalId, user, blockedUsers, hiddenUsers, onBack }: {
  thread: GoalRoomThread; groupId: string; goalId: string;
  user: FirebaseUser | null;
  blockedUsers: string[];
  hiddenUsers: string[];
  onBack: () => void;
}) {
  const [replies,     setReplies]   = useState<GoalRoomReply[]>([]);
  const [loading,     setLoading]   = useState(true);
  const [replyText,   setReplyText] = useState('');
  const [sending,     setSending]   = useState(false);
  const [savedNotes,  setSavedNotes]= useState<Set<string>>(new Set());

  const meta = BADGE_META[thread.badge];
  const filtered = replies.filter(r => !blockedUsers.includes(r.authorId) && !hiddenUsers.includes(r.authorId));

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

        {!loading && filtered.length === 0 && (
          <p className="text-center text-meta py-8" style={{ color: 'var(--c-text-3)' }}>
            No replies yet. Be the first to respond.
          </p>
        )}

        {filtered.map(reply => (
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

function GoalRoomTab({ goal, user, blockedUsers, hiddenUsers }: {
  goal: Goal; user: FirebaseUser | null;
  blockedUsers: string[]; hiddenUsers: string[];
}) {
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
    let debounce: ReturnType<typeof setTimeout>;
    const unsub = onSnapshot(
      query(collection(db, 'groups', groupId, 'threads'), orderBy('lastActivityAt', 'desc'), limit(50)),
      (snap) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GoalRoomThread));
          setLoading(false);
        }, 100);
      },
      (err)  => { clearTimeout(debounce); console.error(err); setLoading(false); }
    );
    return () => { clearTimeout(debounce); unsub(); };
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

  const filtered = useMemo(
    () => filter === 'all' ? threads : threads.filter(t => t.badge === filter),
    [filter, threads],
  );

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
        user={user} blockedUsers={blockedUsers} hiddenUsers={hiddenUsers}
        onBack={() => setSelectedThread(null)}
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

interface MemberDetail {
  userId:          string;
  displayName:     string;
  avatarUrl:       string;
  goalTitle:       string;
  goalDescription: string;
  progressPercent: number;
  joinedAt:        string;
  activeTasks:     string[];
  completedTasks:  string[];
}

interface PeopleData {
  members:      MemberDetail[];
  similarTasks: { text: string }[];
  popularTasks: { text: string; count: number }[];
}

// ── Small/medium progress ring ────────────────────────────────────────────────
function MiniRing({ pct, size = 28 }: { pct: number; size?: number }) {
  const sw = size <= 28 ? 3 : 4;
  const r  = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} strokeWidth={sw} fill="none" stroke="var(--c-border)" />
      <circle cx={cx} cy={cy} r={r} strokeWidth={sw} fill="none" stroke="var(--c-gold)"
        strokeLinecap="round" strokeDasharray={circ}
        strokeDashoffset={circ - (Math.min(pct, 100) / 100) * circ}
        /* POLISH: share the ease token */
        style={{ transition: 'stroke-dashoffset .4s var(--ease-out-quad)' }} />
    </svg>
  );
}

// ── Add-to-my-task popup ─────────────────────────────────────────────────────
function AddTaskPopup({
  initialText, myGoalId, onClose,
}: {
  initialText: string; myGoalId: string; onClose: () => void;
}) {
  const { user } = useUserContext();
  const [text,    setText]    = useState(initialText);
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);

  /* SAFARI: lock background while the sheet is open — kills rubber-band */
  useEffect(() => {
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, []);

  const handleDone = async () => {
    if (!text.trim() || !user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      await fetch(`/api/goals/${myGoalId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ goalId: myGoalId, text: text.trim(), notes: notes.trim() || undefined }),
      });
      setSuccess(true);
      setTimeout(onClose, 800);
    } catch (e) {
      console.error('AddTask error', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div key="at-ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div key="at-sh" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 36 }}
        className="fixed bottom-0 left-0 right-0 z-[70] px-5 pb-10 pt-6"
        style={{ background: 'var(--c-surface)', borderRadius: '28px 28px 0 0', borderTop: '1px solid var(--c-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--c-border-light)' }} />
        <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Add to My Tasks</h3>
        <div className="space-y-3">
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            placeholder="Task text…" rows={2}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12,
              border: '1px solid var(--c-gold)', background: 'var(--c-bg)',
              color: 'var(--c-text)', fontSize: 14, resize: 'none', outline: 'none',
            }} />
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)…" rows={2}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12,
              border: '1px solid var(--c-border)', background: 'var(--c-bg)',
              color: 'var(--c-text)', fontSize: 14, resize: 'none', outline: 'none',
            }} />
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} disabled={saving}
              style={{ flex: 1, padding: '11px', borderRadius: 12, background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', fontSize: 15, fontWeight: 500 }}>
              Cancel
            </button>
            <button onClick={handleDone} disabled={saving || !text.trim() || success}
              className="flex items-center justify-center gap-2"
              style={{ flex: 1, padding: '11px', borderRadius: 12, background: success ? 'var(--c-success)' : 'var(--c-gold)', border: 'none', color: '#000', fontSize: 15, fontWeight: 600, opacity: (!text.trim() || saving) ? 0.5 : 1 }}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : success ? <Check size={15} /> : null}
              {success ? 'Added!' : saving ? 'Adding…' : 'Done'}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Ask-for-help popup ────────────────────────────────────────────────────────
function AskForHelpPopup({
  taskText, goal, members, onClose,
}: {
  taskText: string; goal: Goal; members: MemberDetail[]; onClose: () => void;
}) {
  const { user, dbUser } = useUserContext();
  const [description, setDescription] = useState('');
  const [sending,     setSending]     = useState(false);
  const [success,     setSuccess]     = useState(false);

  /* SAFARI: lock background while the sheet is open — kills rubber-band */
  useEffect(() => {
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, []);

  // Only notify members who actually have this task in their active list
  const taskKey = taskText.toLowerCase().trim();
  const notifyIds = members
    .filter(m => m.activeTasks.some(t => t.toLowerCase().trim() === taskKey))
    .map(m => m.userId);

  const handleSend = async () => {
    if (!user || !goal.groupId) return;
    setSending(true);
    try {
      const token = await user.getIdToken();
      await fetch('/api/ask-for-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          goalId: goal.id,
          groupId: goal.groupId,
          taskText,
          description: description.trim() || undefined,
          authorName: dbUser?.displayName || 'Someone',
          authorAvatar: dbUser?.avatarUrl || '',
          notifyUserIds: notifyIds,
        }),
      });
      setSuccess(true);
      setTimeout(onClose, 800);
    } catch (e) {
      console.error('AskForHelp error', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div key="afh-ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div key="afh-sh" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 36 }}
        className="fixed bottom-0 left-0 right-0 z-[70] px-5 pb-10 pt-6"
        style={{ background: 'var(--c-surface)', borderRadius: '28px 28px 0 0', borderTop: '1px solid var(--c-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--c-border-light)' }} />
        <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Ask for Help</h3>
        <p className="text-meta mb-4" style={{ color: 'var(--c-gold)', fontSize: 13, fontStyle: 'italic' }}>"{taskText}"</p>
        <div className="space-y-3">
          <textarea
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Add extra context (optional)…" rows={3}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12,
              border: '1px solid var(--c-border)', background: 'var(--c-bg)',
              color: 'var(--c-text)', fontSize: 14, resize: 'none', outline: 'none',
            }} />
          <p className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
            {notifyIds.length > 0
              ? `Will notify ${notifyIds.length} member${notifyIds.length !== 1 ? 's' : ''} who also have this task.`
              : 'No other members have this exact task — the help thread will still be posted.'}
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} disabled={sending}
              style={{ flex: 1, padding: '11px', borderRadius: 12, background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', fontSize: 15, fontWeight: 500 }}>
              Cancel
            </button>
            <button onClick={handleSend} disabled={sending || success}
              className="flex items-center justify-center gap-2"
              style={{ flex: 1, padding: '11px', borderRadius: 12, background: success ? 'var(--c-success)' : 'var(--c-gold)', border: 'none', color: '#000', fontSize: 15, fontWeight: 600 }}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : success ? <Check size={15} /> : <Send size={15} />}
              {success ? 'Sent!' : sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Task action row (shared by MemberSheet, SimilarTasks, PopularTasks) ───────
function TaskActionRow({
  text, isDone, myGoalId, goal, members,
}: {
  text: string; isDone?: boolean; myGoalId: string;
  goal: Goal; members: MemberDetail[];
}) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
      <div className="flex items-start gap-2.5 px-4 py-2.5 rounded-xl"
           style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', opacity: isDone ? 0.6 : 1 }}>
        {isDone
          ? <Check size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--c-gold)' }} />
          : <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: 'var(--c-gold)' }} />
        }
        <p className={`text-sm leading-snug flex-1 ${isDone ? 'line-through' : ''}`}
           style={{ color: isDone ? 'var(--c-text-3)' : 'var(--c-text-2)' }}>{text}</p>
        {!isDone && (
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
            <button onClick={() => setShowAdd(true)}
              className="px-2 py-0.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: 'rgba(201,168,76,.15)', color: 'var(--c-gold)', border: '1px solid rgba(201,168,76,.3)' }}>
              + Mine
            </button>
            <button onClick={() => setShowHelp(true)}
              className="px-2 py-0.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: 'rgba(255,255,255,.06)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              Help
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddTaskPopup
          initialText={text} myGoalId={myGoalId}
          onClose={() => setShowAdd(false)} />
      )}
      {showHelp && (
        <AskForHelpPopup
          taskText={text} goal={goal}
          members={members} onClose={() => setShowHelp(false)} />
      )}
    </>
  );
}

// ── User action popup ─────────────────────────────────────────────────────────
function UserActionPopup({
  member, onClose,
}: {
  member: MemberDetail; onClose: () => void;
}) {
  const { user, dbUser } = useUserContext();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [done,       setDone]       = useState<string | null>(null);

  /* SAFARI: lock background while the sheet is open — kills rubber-band */
  useEffect(() => {
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, []);

  const doAction = async (action: 'favourite' | 'poke' | 'silence' | 'block') => {
    if (!user) return;
    setBusyAction(action);
    try {
      const token = await user.getIdToken();
      if (action === 'favourite') {
        await fetch('/api/favourites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            targetUserId:   member.userId,
            targetUserName: member.displayName,
            targetAvatarUrl: member.avatarUrl,
          }),
        });
      } else if (action === 'poke') {
        await fetch('/api/poke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ targetUserId: member.userId, senderName: dbUser?.displayName || 'Someone' }),
        });
      } else if (action === 'silence') {
        await fetch('/api/silence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ targetUserId: member.userId, silent: true }),
        });
      } else if (action === 'block') {
        await fetch('/api/moderation/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ targetUserId: member.userId, action: 'block' }),
        });
      }
      setDone(action);
      setTimeout(onClose, 700);
    } catch (e) {
      console.error('UserAction error', e);
    } finally {
      setBusyAction(null);
    }
  };

  const Row = ({ id, label, icon, danger }: { id: 'favourite' | 'poke' | 'silence' | 'block'; label: string; icon: React.ReactNode; danger?: boolean }) => (
    <button
      onClick={() => doAction(id)}
      disabled={!!busyAction || done === id}
      className="w-full flex items-center gap-4 px-5 py-4 transition-opacity active:opacity-60"
      style={{ borderBottom: '1px solid var(--c-border)', color: danger ? '#e05260' : 'var(--c-text)' }}>
      <span style={{ color: danger ? '#e05260' : 'var(--c-gold)' }}>{icon}</span>
      <span style={{ fontSize: 15, fontWeight: 500, flex: 1, textAlign: 'left' }}>{label}</span>
      {busyAction === id && <Loader2 size={15} className="animate-spin" style={{ color: 'var(--c-text-3)' }} />}
      {done === id && <Check size={15} style={{ color: 'var(--c-success)' }} />}
    </button>
  );

  return (
    <AnimatePresence>
      <motion.div key="ua-ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div key="ua-sh" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 36 }}
        className="fixed bottom-0 left-0 right-0 z-[70] pb-10"
        style={{ background: 'var(--c-surface)', borderRadius: '28px 28px 0 0', borderTop: '1px solid var(--c-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-1" style={{ background: 'var(--c-border-light)' }} />
        {/* User header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
          {member.avatarUrl ? (
            <img src={member.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                 style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
              {member.displayName[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div>
            <p style={{ fontSize: 15, fontWeight: 600 }}>{member.displayName}</p>
            <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{member.goalTitle}</p>
          </div>
        </div>
        <Row id="favourite" label="Add to Favourites" icon={<Bookmark size={18} />} />
        <Row id="poke"      label="Poke"              icon={<Hand size={18} />} />
        <Row id="silence"   label="Silence"           icon={<BellOff size={18} />} />
        <Row id="block"     label="Block"             icon={<UserX size={18} />} danger />
        <button onClick={onClose} className="w-full py-4 text-center"
          style={{ color: 'var(--c-text-3)', fontSize: 15 }}>
          Cancel
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Member detail sheet ───────────────────────────────────────────────────────
function MemberSheet({
  member, myGoalId, goal, allMembers, onClose,
}: {
  member: MemberDetail; myGoalId: string; goal: Goal;
  allMembers: MemberDetail[]; onClose: () => void;
}) {
  const [showUserActions, setShowUserActions] = useState(false);

  /* SAFARI: lock background while the sheet is open — kills rubber-band */
  useEffect(() => {
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, []);

  return (
    <>
      <motion.div
        key="member-sheet"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 340, damping: 34 }}
        className="fixed inset-0 z-50 flex flex-col justify-end"
        style={{ background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="rounded-t-3xl pb-10 overflow-y-auto"
          style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', maxHeight: '88dvh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
          </div>

          {/* Header — tap user avatar/name to get user actions */}
          <div className="flex items-start gap-4 px-5 pt-4 pb-5"
               style={{ borderBottom: '1px solid var(--c-border)' }}>

            {/* Tappable user profile */}
            <button className="flex items-center gap-3 flex-shrink-0" onClick={() => setShowUserActions(true)}>
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
                     style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
                  {member.displayName[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="text-left">
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>{member.displayName}</p>
                <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>tap to interact</p>
              </div>
            </button>

            {/* Goal title */}
            <div className="flex-1 min-w-0">
              <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.3, lineHeight: 1.25, color: 'var(--c-text)' }}
                  className="mb-1 truncate">
                {member.goalTitle}
              </h2>
              {member.goalDescription && (
                <p className="text-meta line-clamp-2" style={{ color: 'var(--c-text-2)' }}>
                  {member.goalDescription}
                </p>
              )}
              <p className="text-meta mt-1" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
                Joined {new Date(member.joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </p>
            </div>

            {/* Progress ring */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <MiniRing pct={member.progressPercent} size={44} />
              <span style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{member.progressPercent}%</span>
            </div>
          </div>

          <div className="px-5 pt-5 space-y-6">
            {/* Active tasks */}
            <section>
              <h3 className="text-meta uppercase tracking-widest mb-3"
                  style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em', fontSize: 11 }}>
                Active Tasks
              </h3>
              {member.activeTasks.length > 0 ? (
                <div className="space-y-1.5">
                  {member.activeTasks.map((t, i) => (
                    <TaskActionRow key={i} text={t} isDone={false}
                      myGoalId={myGoalId} goal={goal}
                      members={allMembers} />
                  ))}
                </div>
              ) : (
                <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No active tasks.</p>
              )}
            </section>

            {/* Completed tasks */}
            {member.completedTasks.length > 0 && (
              <section>
                <h3 className="text-meta uppercase tracking-widest mb-3"
                    style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em', fontSize: 11 }}>
                  Completed
                </h3>
                <div className="space-y-1.5">
                  {member.completedTasks.map((t, i) => (
                    <TaskActionRow key={i} text={t} isDone={true}
                      myGoalId={myGoalId} goal={goal}
                      members={allMembers} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </motion.div>

      {showUserActions && (
        <UserActionPopup member={member}
          onClose={() => setShowUserActions(false)} />
      )}
    </>
  );
}

// ── People tab ────────────────────────────────────────────────────────────────
function PeopleTab({ goal }: { goal: Goal }) {
  const { user } = useUserContext();
  const [data,           setData]           = useState<PeopleData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberDetail | null>(null);
  const [userActionTarget, setUserActionTarget] = useState<MemberDetail | null>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res   = await fetch(`/api/goals/${goal.id}/people-tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) setData(await res.json());
      } catch (e) {
        console.error('PeopleTab load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [goal.id, user]);

  const { members, similarTasks, popularTasks } = useMemo(() => ({
    members:      data?.members      ?? [],
    similarTasks: data?.similarTasks ?? [],
    popularTasks: data?.popularTasks ?? [],
  }), [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
      </div>
    );
  }

  const SectionLabel = ({ label }: { label: string }) => (
    <h3 className="text-meta uppercase tracking-widest mb-3"
        style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em', fontSize: 11 }}>
      {label}
    </h3>
  );

  const Empty = ({ msg }: { msg: string }) => (
    <div className="px-4 py-5 rounded-2xl text-center"
         style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>{msg}</p>
    </div>
  );

  return (
    <>
      <div className="px-5 pt-6 pb-32 space-y-8">

        {/* Members */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel label="Members" />
            {members.length > 0 && (
              <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
                {members.length}
              </span>
            )}
          </div>
          {members.length > 0 ? (
            <div className="space-y-2">
              {members.map((m, i) => (
                <div key={i} className="rounded-2xl overflow-hidden"
                     style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  {/* User row — tap avatar/name for user actions */}
                  <button
                    onClick={() => setUserActionTarget(m)}
                    className="w-full flex items-center gap-3 px-4 pt-3 pb-2 text-left transition-opacity active:opacity-70">
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                           style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
                        {m.displayName[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--c-text)' }}>
                        {m.displayName}
                      </p>
                      <p className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
                        {m.activeTasks.length} active · {m.completedTasks.length} done
                      </p>
                    </div>
                    <MiniRing pct={m.progressPercent} />
                  </button>
                  {/* Goal title row — tap to open task sheet */}
                  <button
                    onClick={() => setSelectedMember(m)}
                    className="w-full flex items-center gap-2 px-4 pb-3 text-left transition-opacity active:opacity-70">
                    <ChevronRight size={13} style={{ color: 'var(--c-gold)', flexShrink: 0 }} />
                    <p className="text-sm truncate" style={{ color: 'var(--c-text-2)' }}>{m.goalTitle}</p>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty msg="No other members in this room yet." />
          )}
        </section>

        {/* Similar Tasks */}
        <section>
          <SectionLabel label="Similar Tasks" />
          {similarTasks.length > 0 ? (
            <div className="space-y-2">
              {similarTasks.map((item, i) => (
                <TaskActionRow key={i} text={item.text}
                  myGoalId={goal.id} goal={goal}
                  members={members} />
              ))}
            </div>
          ) : (
            <Empty msg="Tasks from room members appear here as the group grows." />
          )}
        </section>

        {/* Most Popular Tasks */}
        <section>
          <SectionLabel label="Most Popular Tasks" />
          {popularTasks.length > 0 ? (
            <div className="space-y-2">
              {popularTasks.map((item, i) => (
                <div key={i} className="relative">
                  <TaskActionRow text={item.text}
                    myGoalId={goal.id} goal={goal}
                    members={members} />
                  {item.count > 1 && (
                    <span className="absolute right-3 top-2.5 text-meta"
                          style={{ color: 'var(--c-text-3)', fontSize: 11, pointerEvents: 'none' }}>
                      ×{item.count}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty msg="Popular tasks appear as the room grows." />
          )}
        </section>

      </div>

      {/* User action popup */}
      <AnimatePresence>
        {userActionTarget && (
          <UserActionPopup
            member={userActionTarget}
            onClose={() => setUserActionTarget(null)} />
        )}
      </AnimatePresence>

      {/* Member task detail sheet */}
      <AnimatePresence>
        {selectedMember && (
          <MemberSheet
            member={selectedMember}
            myGoalId={goal.id}
            goal={goal}
            allMembers={members}
            onClose={() => setSelectedMember(null)} />
        )}
      </AnimatePresence>
    </>
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

export function GoalDetailScreen({ user, dbUser, goalId, goals, initialTab, setCurrentScreen }: GoalDetailScreenProps) {
  const [activeTab,        setActiveTab]        = useState<Tab>(initialTab);
  const [isEditingGoal,    setIsEditingGoal]    = useState(false);
  const [editTitle,        setEditTitle]        = useState('');
  const [editDescription,  setEditDescription]  = useState('');
  const [isSavingGoal,     setIsSavingGoal]     = useState(false);
  const [showDeleteConfirm,setShowDeleteConfirm]= useState(false);
  const [isDeleting,       setIsDeleting]       = useState(false);

  /* SAFARI: lock background scroll while the delete-confirm sheet is open */
  useEffect(() => {
    if (!showDeleteConfirm) return;
    document.body.classList.add('body-locked');
    return () => document.body.classList.remove('body-locked');
  }, [showDeleteConfirm]);

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

  const handleStartEdit = () => {
    setEditTitle(goal.title ?? '');
    setEditDescription(goal.description ?? '');
    setIsEditingGoal(true);
  };

  const handleCancelEdit = () => {
    setIsEditingGoal(false);
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    setIsSavingGoal(true);
    try {
      await updateDoc(doc(db, 'goals', goal.id), {
        title:       editTitle.trim(),
        description: editDescription.trim(),
      });
      setIsEditingGoal(false);
    } catch (e) {
      console.error('Failed to save goal edits', e);
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleDeleteGoal = async () => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'goals', goal.id));
      setCurrentScreen({ name: 'home' });
    } catch (e) {
      console.error('Failed to delete goal', e);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)' }}>

      {/* Delete confirmation overlay */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div key="del-ov"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50"
              style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
              onClick={() => !isDeleting && setShowDeleteConfirm(false)}
            />
            <motion.div key="del-sh"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 36 }}
              className="fixed bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-6"
              style={{ background: 'var(--c-surface)', borderRadius: '28px 28px 0 0', borderTop: '1px solid var(--c-border)' }}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: 'var(--c-border-light)' }} />
              <div className="flex flex-col items-center text-center gap-3 mb-8">
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(220,53,69,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={22} color="#e05260" />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 600 }}>Delete goal?</h3>
                <p style={{ color: 'var(--c-text-2)', fontSize: 14, maxWidth: 280 }}>
                  This will permanently delete <strong>"{goal.title}"</strong> and all its tasks. This cannot be undone.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-xl font-medium"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', fontSize: 15 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteGoal}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                  style={{ background: 'rgba(220,53,69,.12)', border: '1px solid rgba(220,53,69,.3)', color: '#e05260', fontSize: 15 }}
                >
                  {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-14 pb-3">
        <button onClick={() => setCurrentScreen({ name: 'home' })}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: 'var(--c-text-2)' }}>
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-4" style={{ color: 'var(--c-text-3)' }}>
          <button
            onClick={isEditingGoal ? handleCancelEdit : handleStartEdit}
            className="transition-opacity hover:opacity-70"
            style={{ color: isEditingGoal ? 'var(--c-gold)' : 'var(--c-text-3)' }}
          >
            <Edit2 size={17} />
          </button>
          <button className="transition-opacity hover:opacity-70"><Lock size={17} /></button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="transition-opacity hover:opacity-70"
            style={{ color: '#e05260' }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      {/* Goal header */}
      <div className="px-5 pb-5 text-center">
        {isEditingGoal ? (
          <div className="flex flex-col gap-3 mb-6">
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Goal title"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid var(--c-gold)',
                background: 'var(--c-surface)',
                color: 'var(--c-text)',
                fontSize: 18,
                fontWeight: 600,
                textAlign: 'center',
                outline: 'none',
              }}
            />
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid var(--c-border)',
                background: 'var(--c-surface)',
                color: 'var(--c-text)',
                fontSize: 14,
                resize: 'none',
                outline: 'none',
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={handleCancelEdit}
                disabled={isSavingGoal}
                style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', fontSize: 14, fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSavingGoal || !editTitle.trim()}
                className="flex items-center justify-center gap-2"
                style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--c-gold)', border: 'none', color: '#000', fontSize: 14, fontWeight: 600, opacity: (!editTitle.trim() || isSavingGoal) ? 0.5 : 1 }}
              >
                {isSavingGoal ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {isSavingGoal ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.3, lineHeight: 1.25 }} className="mb-1.5">
              {goal.title}
            </h1>
            <p className="text-meta mb-6 mx-auto max-w-xs" style={{ color: 'var(--c-text-2)' }}>
              {goal.description}
            </p>
          </>
        )}
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
            /* POLISH: tab swap — shared ease token, transform + opacity only */
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}>

            {activeTab === 'plan' && <PlanTab goal={goal} user={user} />}

            {activeTab === 'goal-room' && (
              <GoalRoomTab goal={goal} user={user}
                blockedUsers={dbUser?.blockedUsers ?? []}
                hiddenUsers={dbUser?.hiddenUsers ?? []}
              />
            )}

            {activeTab === 'people' && (
              <PeopleTab goal={goal} />
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}