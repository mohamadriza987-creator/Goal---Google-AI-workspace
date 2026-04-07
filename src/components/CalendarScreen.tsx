import React, { useState } from 'react';
import { Goal, GoalTask, CalendarNote } from '../types';
import { motion } from 'motion/react';
import { Bell, CheckCircle2, FileText, Plus, Check, Loader2 } from 'lucide-react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

interface CalendarScreenProps {
  allReminders: { task: GoalTask; goal: Goal; reminderAt: string; noteText?: string }[];
  goals: Goal[];
  setCurrentScreen: (screen: any) => void;
  calendarNotes: CalendarNote[];
  onSaveCalendarNote: (date: string, text: string) => Promise<void>;
  onDeleteCalendarNote: (date: string) => Promise<void>;
}

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CalendarScreen({
  allReminders, goals, setCurrentScreen,
  calendarNotes, onSaveCalendarNote, onDeleteCalendarNote,
}: CalendarScreenProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingNote,  setEditingNote]  = useState(false);
  const [noteText,     setNoteText]     = useState('');
  const [noteSaving,   setNoteSaving]   = useState(false);

  const now         = new Date();
  const selectedKey = toDateKey(selectedDate);

  // Split upcoming vs completed
  const upcoming  = allReminders
    .filter(r => !r.task.isDone && new Date(r.reminderAt) >= now)
    .slice(0, 6);
  const completed = allReminders
    .filter(r => r.task.isDone)
    .slice(0, 6);

  // Selected date items
  const dateReminders = allReminders.filter(
    r => toDateKey(new Date(r.reminderAt)) === selectedKey,
  );
  const dateNote = calendarNotes.find(n => n.date === selectedKey);

  // Dot sets for calendar tiles
  const upcomingDates  = new Set(allReminders.filter(r => !r.task.isDone).map(r => toDateKey(new Date(r.reminderAt))));
  const completedDates = new Set(allReminders.filter(r => r.task.isDone).map(r => toDateKey(new Date(r.reminderAt))));
  const noteDates      = new Set(calendarNotes.map(n => n.date));

  const startEdit = () => { setNoteText(dateNote?.text ?? ''); setEditingNote(true); };

  const saveNote = async () => {
    if (noteSaving || !noteText.trim()) return;
    setNoteSaving(true);
    try {
      await onSaveCalendarNote(selectedKey, noteText.trim());
      setEditingNote(false);
    } catch (e) { console.error(e); } finally { setNoteSaving(false); }
  };

  const deleteNote = async () => {
    if (noteSaving) return;
    setNoteSaving(true);
    try {
      await onDeleteCalendarNote(selectedKey);
      setNoteText('');
      setEditingNote(false);
    } catch (e) { console.error(e); } finally { setNoteSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto px-5 pt-12 pb-32">

      <h1 className="text-page-title mb-8">Calendar</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: calendar + selected date ────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* react-calendar */}
          <div className="p-4 rounded-3xl overflow-hidden"
               style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <Calendar
              value={selectedDate}
              onChange={v => { setSelectedDate(v as Date); setEditingNote(false); }}
              className="w-full"
              tileContent={({ date, view }) => {
                if (view !== 'month') return null;
                const key = toDateKey(date);
                const dots: React.ReactNode[] = [];
                if (upcomingDates.has(key))
                  dots.push(<span key="u" className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--c-gold)' }} />);
                if (completedDates.has(key))
                  dots.push(<span key="c" className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--c-success, #4a7c59)' }} />);
                if (noteDates.has(key))
                  dots.push(<span key="n" className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#7c6af7' }} />);
                if (!dots.length) return null;
                return <div className="flex justify-center gap-0.5 mt-0.5">{dots}</div>;
              }}
            />
          </div>

          {/* Selected date detail */}
          <div className="space-y-3">
            <p className="text-meta uppercase tracking-widest"
               style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
              {selectedDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>

            {/* Reminders on selected date */}
            {dateReminders.map((r, i) => (
              <button key={i}
                onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: r.goal.id, initialTab: 'plan' })}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-opacity hover:opacity-80"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                {r.task.isDone
                  ? <CheckCircle2 size={14} style={{ color: 'var(--c-success, #4a7c59)', flexShrink: 0 }} />
                  : <Bell        size={14} style={{ color: 'var(--c-gold)',              flexShrink: 0 }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-body truncate"
                     style={{ color: r.task.isDone ? 'var(--c-text-3)' : 'var(--c-text)',
                              textDecoration: r.task.isDone ? 'line-through' : 'none' }}>
                    {r.task.text}
                  </p>
                  <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                    {r.goal.title} · {new Date(r.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </button>
            ))}

            {/* Date note: editor / display / add button */}
            {editingNote ? (
              <div className="space-y-2">
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                  autoFocus rows={3} placeholder="Note for this day…"
                  className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
                <div className="flex gap-2">
                  <button onClick={saveNote} disabled={noteSaving || !noteText.trim()}
                    className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                    {noteSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                  </button>
                  {dateNote && (
                    <button onClick={deleteNote} disabled={noteSaving}
                      className="px-4 py-2 rounded-xl text-meta disabled:opacity-40"
                      style={{ background: 'rgba(220,53,69,.08)', border: '1px solid rgba(220,53,69,.2)', color: '#e05260' }}>
                      Remove
                    </button>
                  )}
                  <button onClick={() => setEditingNote(false)}
                    className="px-4 py-2 rounded-xl text-meta"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : dateNote ? (
              <button onClick={startEdit}
                className="w-full flex items-start gap-3 px-4 py-3 rounded-2xl text-left transition-opacity hover:opacity-80"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                <FileText size={14} style={{ color: '#7c6af7', flexShrink: 0, marginTop: 2 }} />
                <p className="text-body flex-1 leading-snug" style={{ color: 'var(--c-text)' }}>{dateNote.text}</p>
              </button>
            ) : (
              <button onClick={startEdit}
                className="flex items-center gap-2 text-meta transition-opacity hover:opacity-70"
                style={{ color: 'var(--c-text-3)' }}>
                <Plus size={14} /> Add a note for this day
              </button>
            )}

            {dateReminders.length === 0 && !dateNote && !editingNote && (
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>Nothing scheduled for this day.</p>
            )}
          </div>
        </div>

        {/* ── Right: upcoming + completed + legend ──────────────────── */}
        <div className="space-y-6">

          {/* Upcoming reminders */}
          <div>
            <p className="text-meta uppercase tracking-widest mb-3"
               style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Upcoming</p>
            <div className="space-y-2">
              {upcoming.length > 0 ? upcoming.map((r, i) => (
                <button key={i}
                  onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: r.goal.id, initialTab: 'plan' })}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-2xl text-left transition-opacity hover:opacity-80"
                  style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <Bell size={13} style={{ color: 'var(--c-gold)', flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-body truncate">{r.task.text}</p>
                    <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                      {new Date(r.reminderAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      {' · '}
                      {new Date(r.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </button>
              )) : (
                <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No upcoming reminders.</p>
              )}
            </div>
          </div>

          {/* Completed reminders */}
          {completed.length > 0 && (
            <div>
              <p className="text-meta uppercase tracking-widest mb-3"
                 style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Completed</p>
              <div className="space-y-2">
                {completed.map((r, i) => (
                  <button key={i}
                    onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: r.goal.id, initialTab: 'plan' })}
                    className="w-full flex items-start gap-3 px-4 py-3 rounded-2xl text-left transition-opacity hover:opacity-80"
                    style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                    <CheckCircle2 size={13} style={{ color: 'var(--c-success, #4a7c59)', flexShrink: 0, marginTop: 2 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-body truncate"
                         style={{ color: 'var(--c-text-3)', textDecoration: 'line-through' }}>
                        {r.task.text}
                      </p>
                      <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>{r.goal.title}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="px-4 py-4 rounded-2xl space-y-2"
               style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <p className="text-meta uppercase tracking-widest mb-2"
               style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>Legend</p>
            {[
              { color: 'var(--c-gold)',              label: 'Reminder due' },
              { color: 'var(--c-success, #4a7c59)',  label: 'Task completed' },
              { color: '#7c6af7',                    label: 'Day note' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 text-meta"
                   style={{ color: 'var(--c-text-2)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>

        </div>
      </div>
    </motion.div>
  );
}
