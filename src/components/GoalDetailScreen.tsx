import React, { useState } from 'react';
import { Goal, User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { ArrowLeft, Lock, Edit2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface GoalDetailScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
  goalId: string;
  goals: Goal[];
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

// Full implementation coming in Builds 3-5.
// This stub renders the shell so navigation works immediately.
export function GoalDetailScreen({ goalId, goals, initialTab, setCurrentScreen }: GoalDetailScreenProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const goal = goals.find(g => g.id === goalId);

  if (!goal) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ color: 'var(--c-text-2)' }}>
        <p>Goal not found.</p>
        <button className="btn-ghost mt-4" onClick={() => setCurrentScreen({ name: 'home' })}>Go Home</button>
      </div>
    );
  }

  const pct = goal.progressPercent ?? 0;
  const r   = 48;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)', paddingBottom: 100 }}>

      {/* ── Top bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 pt-14 pb-4">
        <button onClick={() => setCurrentScreen({ name: 'home' })}
                className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
                style={{ color: 'var(--c-text-2)' }}>
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-3" style={{ color: 'var(--c-text-3)' }}>
          <button><Edit2 size={18} /></button>
          <button><Lock  size={18} /></button>
        </div>
      </div>

      {/* ── Goal header ─────────────────────────────────────────────── */}
      <div className="px-5 pb-6 text-center">
        <h1 className="text-card-title mb-1" style={{ fontSize: 22, fontWeight: 600 }}>{goal.title}</h1>
        <p className="text-meta mb-5" style={{ color: 'var(--c-text-2)' }}>{goal.description}</p>

        {/* Progress ring */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <svg width={120} height={120} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={60} cy={60} r={r} strokeWidth={8} className="progress-ring-track" />
              <circle cx={60} cy={60} r={r} strokeWidth={8}
                className="progress-ring-fill"
                strokeDasharray={circ}
                strokeDashoffset={offset} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-card-title" style={{ color: 'var(--c-gold)', fontSize: 24 }}>{pct}%</span>
            </div>
          </div>
          <p className="text-meta mt-2" style={{ color: 'var(--c-text-3)' }}>{pct}% Complete</p>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <div className="tab-bar sticky top-0 z-10">
        {TABS.map(tab => (
          <button key={tab.key}
            className={cn('tab-item', activeTab === tab.key && 'active')}
            onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content placeholder ──────────────────────────────────── */}
      <motion.div key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .2 }}
        className="flex-1 flex items-center justify-center px-6 py-16 text-center">
        <div>
          <p className="text-section-title mb-2" style={{ color: 'var(--c-text-2)', fontSize: 16 }}>
            {TABS.find(t => t.key === activeTab)?.label} tab
          </p>
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
            Full implementation in next build.
          </p>
        </div>
      </motion.div>

    </div>
  );
}