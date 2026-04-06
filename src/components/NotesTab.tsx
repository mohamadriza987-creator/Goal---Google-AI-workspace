import React, { useState, useEffect } from 'react';
import { Note, NotePrivacy, Goal } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { BookOpen, Plus, Lock, Globe, Trash2, Edit2, Check, X, Loader2, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { cn } from '../lib/utils';

interface NotesTabProps {
  goal: Goal;
  user: FirebaseUser | null;
}

type FilterType = 'all' | 'private' | 'shared' | 'saved_from_room';

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)    return 'just now';
  if (d < 3600)  return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

// ── Note Card ─────────────────────────────────────────────────────────────────
function NoteCard({ note, goalId, onEdit }: { note: Note; goalId: string; onEdit: (n: Note) => void }) {
  const [deleting, setDeleting] = useState(false);

  const deleteNote = async () => {
    if (deleting || !window.confirm('Delete this note?')) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'goals', goalId, 'notes', note.id));
    } catch(e) { console.error(e); setDeleting(false); }
  };

  const isSaved = note.source === 'saved_from_room';

  return (
    <motion.div layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-4 rounded-2xl"
      style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>

      {/* Source badge if saved from room */}
      {isSaved && note.savedFromAuthorName && (
        <div className="flex items-center gap-1.5 mb-2">
          <ChevronRight size={11} style={{ color: 'var(--c-text-3)' }} />
          <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
            Saved from {note.savedFromAuthorName}'s reply
          </span>
        </div>
      )}

      {/* Note title if any */}
      {note.title && (
        <p className="text-card-title mb-1" style={{ fontSize: 15 }}>{note.title}</p>
      )}

      {/* Note text */}
      <p className="text-body leading-relaxed mb-3" style={{ color: 'var(--c-text-2)', whiteSpace: 'pre-wrap' }}>
        {note.text}
      </p>

      {/* Linked task */}
      {note.linkedTaskText && (
        <p className="text-meta mb-3 flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
          <ChevronRight size={11} /> {note.linkedTaskText}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-meta flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
            {note.privacy === 'private'
              ? <><Lock size={11} /> Private</>
              : <><Globe size={11} /> Shared</>}
          </span>
          <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>
            {timeAgo(note.createdAt)}
          </span>
        </div>

        {!isSaved && (
          <div className="flex items-center gap-2">
            <button onClick={() => onEdit(note)}
              className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'var(--c-text-3)' }}>
              <Edit2 size={13} />
            </button>
            <button onClick={deleteNote} disabled={deleting}
              className="p-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ color: '#e07070' }}>
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Notes Tab ─────────────────────────────────────────────────────────────
export function NotesTab({ goal, user }: NotesTabProps) {
  const [notes,    setNotes]    = useState<Note[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<FilterType>('all');
  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<Note | null>(null);

  // Form state
  const [formText,    setFormText]    = useState('');
  const [formTitle,   setFormTitle]   = useState('');
  const [formPrivacy, setFormPrivacy] = useState<NotePrivacy>('private');
  const [formSaving,  setFormSaving]  = useState(false);

  const isTemp = goal.id.startsWith('temp-');

  useEffect(() => {
    if (isTemp || !user) { setLoading(false); return; }
    return onSnapshot(
      query(
        collection(db, 'goals', goal.id, 'notes'),
        where('ownerId', '==', user.uid),
        orderBy('createdAt', 'desc')
      ),
      (snap) => { setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Note)); setLoading(false); },
      (err)  => { console.error(err); setLoading(false); }
    );
  }, [goal.id, user?.uid]);

  const openCreate = () => {
    setEditing(null);
    setFormText(''); setFormTitle(''); setFormPrivacy('private');
    setCreating(true);
  };

  const openEdit = (note: Note) => {
    setCreating(false);
    setEditing(note);
    setFormText(note.text);
    setFormTitle(note.title ?? '');
    setFormPrivacy(note.privacy);
  };

  const closeForm = () => { setCreating(false); setEditing(null); setFormText(''); setFormTitle(''); };

  const saveNote = async () => {
    if (!formText.trim() || formSaving || !user) return;
    setFormSaving(true);
    const now = new Date().toISOString();
    try {
      if (editing) {
        await updateDoc(doc(db, 'goals', goal.id, 'notes', editing.id), {
          text:      formText.trim(),
          title:     formTitle.trim() || null,
          privacy:   formPrivacy,
          updatedAt: now,
        });
      } else {
        await addDoc(collection(db, 'goals', goal.id, 'notes'), {
          goalId:    goal.id,
          ownerId:   user.uid,
          text:      formText.trim(),
          title:     formTitle.trim() || null,
          privacy:   formPrivacy,
          source:    'manual',
          createdAt: now,
        });
      }
      closeForm();
    } catch(e) { console.error(e); }
    finally { setFormSaving(false); }
  };

  // Filter
  const FILTERS: { key: FilterType; label: string }[] = [
    { key: 'all',           label: 'All'          },
    { key: 'private',       label: 'Private'      },
    { key: 'shared',        label: 'Shared'       },
    { key: 'saved_from_room', label: 'Saved'      },
  ];

  const filtered = notes.filter(n => {
    if (filter === 'all')            return true;
    if (filter === 'saved_from_room') return n.source === 'saved_from_room';
    return n.privacy === filter;
  });

  if (isTemp) {
    return (
      <div className="px-5 py-10 text-center">
        <Loader2 size={20} className="animate-spin mx-auto mb-3" style={{ color: 'var(--c-gold)' }} />
        <p className="text-body" style={{ color: 'var(--c-text-2)' }}>Saving your goal…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ paddingBottom: 120 }}>

      {/* Filter pills */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto flex-shrink-0"
           style={{ borderBottom: '1px solid var(--c-border)' }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="flex-shrink-0 text-meta font-semibold transition-all"
            style={filter === f.key
              ? { background: 'var(--c-gold)', color: '#000', borderRadius: 999, padding: '6px 14px' }
              : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', borderRadius: 999, padding: '6px 14px' }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Note form (create or edit) */}
      <AnimatePresence>
        {(creating || editing) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
            style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-card-title" style={{ fontSize: 15 }}>
                  {editing ? 'Edit Note' : 'New Note'}
                </p>
                <button onClick={closeForm} style={{ color: 'var(--c-text-3)' }}>
                  <X size={18} />
                </button>
              </div>

              <input value={formTitle} onChange={e => setFormTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />

              <textarea value={formText} onChange={e => setFormText(e.target.value)}
                placeholder="Write your note…" rows={4} autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />

              {/* Privacy toggle */}
              <div className="flex items-center gap-3">
                <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>Visibility:</span>
                <div className="flex rounded-xl overflow-hidden"
                     style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface-2)' }}>
                  {(['private','shared'] as NotePrivacy[]).map(p => (
                    <button key={p} onClick={() => setFormPrivacy(p)}
                      className="flex items-center gap-1.5 px-3 py-2 text-meta font-semibold transition-all capitalize"
                      style={formPrivacy === p
                        ? { background: 'var(--c-gold)', color: '#000' }
                        : { color: 'var(--c-text-3)' }}>
                      {p === 'private' ? <Lock size={11} /> : <Globe size={11} />}
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={saveNote} disabled={formSaving || !formText.trim()}
                className="btn-gold w-full flex items-center justify-center gap-2 disabled:opacity-40">
                {formSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {editing ? 'Update Note' : 'Save Note'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notes list */}
      <div className="px-4 py-4 flex-1 space-y-3">

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                 style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
              <BookOpen size={22} style={{ color: 'var(--c-text-3)' }} />
            </div>
            <p className="text-body mb-1" style={{ color: 'var(--c-text-2)' }}>
              {filter === 'all' ? 'No notes yet.' : `No ${filter.replace('_', ' ')} notes.`}
            </p>
            <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
              {filter === 'saved_from_room'
                ? 'Save replies from Goal Room to see them here.'
                : 'Tap the button below to add your first note.'}
            </p>
          </div>
        )}

        <AnimatePresence>
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} goalId={goal.id} onEdit={openEdit} />
          ))}
        </AnimatePresence>
      </div>

      {/* FAB — new note */}
      {!creating && !editing && (
        <button onClick={openCreate}
          className="fixed z-30 flex items-center gap-2 px-5 py-3.5 rounded-full font-semibold shadow-xl"
          style={{ bottom: 100, right: 20, background: 'var(--c-gold)', color: '#000', boxShadow: '0 4px 24px rgba(201,168,76,.35)' }}>
          <Plus size={18} /> New Note
        </button>
      )}
    </div>
  );
}