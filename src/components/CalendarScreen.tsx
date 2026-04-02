import React from 'react';
import { Goal, GoalTask } from '../types';
import { motion } from 'motion/react';
import { Bell, Calendar as CalendarIcon } from 'lucide-react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

interface CalendarScreenProps {
  allReminders: {task: GoalTask, goal: Goal, reminderAt: string, noteText?: string}[];
  goals: Goal[];
  setActiveGoal: (goal: Goal) => void;
  setFocusedTaskId: (id: string) => void;
  setCurrentScreen: (screen: any) => void;
}

import { useTranslation } from '../contexts/LanguageContext';

export function CalendarScreen({ allReminders, goals, setActiveGoal, setFocusedTaskId, setCurrentScreen }: CalendarScreenProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto p-6 pt-12 pb-32"
    >
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-3xl font-bold tracking-tight">{t('calendar')}</h1>
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs text-zinc-400">
          <div className="w-2 h-2 bg-white rounded-full" />
          {t('synced')}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] backdrop-blur-xl">
            <Calendar 
              className="w-full"
              tileContent={({ date, view }) => {
                if (view === 'month') {
                  const hasReminder = allReminders.some(r => {
                    const reminderDate = new Date(r.reminderAt);
                    return reminderDate.toDateString() === date.toDateString();
                  });
                  return hasReminder ? <div className="w-1 h-1 bg-white rounded-full mx-auto mt-1" /> : null;
                }
                return null;
              }}
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500 font-bold ml-2">{t('upcomingReminders')}</h3>
            <div className="grid gap-3">
              {allReminders.length > 0 ? (
                allReminders.slice(0, 5).map((reminder, idx) => (
                  <div key={idx} className="p-5 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl flex items-center justify-between group hover:border-zinc-700 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-400">
                        <Bell size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-zinc-200 break-words">{reminder.task.text}</h4>
                        {reminder.noteText && <p className="text-xs text-zinc-500 mt-1 break-words">{reminder.noteText}</p>}
                        <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-tighter break-words">
                          {reminder.goal.title} • {new Date(reminder.reminderAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setActiveGoal(reminder.goal);
                        setFocusedTaskId(reminder.task.id);
                        setCurrentScreen('goals');
                      }}
                      className="px-4 py-2 bg-zinc-800 rounded-xl text-[10px] uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {t('view')}
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center bg-zinc-900/20 border border-dashed border-zinc-800 rounded-[2rem]">
                  <p className="text-zinc-600 text-sm">{t('noReminders')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl">
            <h3 className="text-sm font-bold mb-4">Goal Breakdown</h3>
            <div className="space-y-3">
              {goals.map(goal => {
                const goalReminders = allReminders.filter(r => r.goal.id === goal.id);
                if (goalReminders.length === 0) return null;
                return (
                  <div key={goal.id} className="p-4 bg-zinc-800/30 rounded-2xl border border-zinc-700/30">
                    <p className="text-xs font-bold text-zinc-300 mb-1 break-words">{goal.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <Bell size={10} />
                      <span>{goalReminders.length} reminder{goalReminders.length > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                );
              })}
              {allReminders.length === 0 && (
                <p className="text-xs text-zinc-600 italic">No goals with active reminders</p>
              )}
            </div>
          </div>

          <div className="p-6 bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 rounded-3xl">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-4">
              <CalendarIcon size={20} className="text-white" />
            </div>
            <h3 className="font-bold text-sm mb-2">Internal Sync</h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Your calendar is automatically synced with all task reminders and notes you create within the app.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
