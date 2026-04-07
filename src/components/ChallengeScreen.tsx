import React from 'react';
import { User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { Trophy, Sparkles, Award } from 'lucide-react';

interface ChallengeScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
           style={{ background: 'rgba(201,168,76,.1)' }}>
        {icon}
      </div>
      <h2 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-3)' }}>
        {label}
      </h2>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="px-4 py-5 rounded-2xl"
         style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>{message}</p>
    </div>
  );
}

export function ChallengeScreen({ user, dbUser }: ChallengeScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto px-5 pb-32"
      style={{ paddingTop: 56 }}
    >
      {/* Page title */}
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, marginBottom: 28 }}>
        Challenge
      </h1>

      {/* Challenges */}
      <section style={{ marginBottom: 28 }}>
        <SectionHeader
          icon={<Trophy size={14} style={{ color: 'var(--c-gold)' }} />}
          label="Challenges"
        />
        <EmptyCard message="No active challenges yet." />
      </section>

      {/* Good News */}
      <section style={{ marginBottom: 28 }}>
        <SectionHeader
          icon={<Sparkles size={14} style={{ color: '#6bbf7a' }} />}
          label="Good News"
        />
        <EmptyCard message="Nothing to report yet." />
      </section>

      {/* Member Wins */}
      <section>
        <SectionHeader
          icon={<Award size={14} style={{ color: 'var(--c-gold)' }} />}
          label="Member Wins"
        />
        <EmptyCard message="No wins shared yet." />
      </section>
    </motion.div>
  );
}
