import React from 'react';
import { User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { Bell } from 'lucide-react';

interface ActivityScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
}

export function ActivityScreen({ dbUser }: ActivityScreenProps) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: 100 }}
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
      >
        <Bell size={24} style={{ color: 'var(--c-gold)' }} />
      </div>
      <h2 className="text-section-title mb-2">Activity</h2>
      <p className="text-body" style={{ color: 'var(--c-text-2)' }}>
        Your support threads, help requests, and Goal Room updates will appear here.
      </p>
    </div>
  );
}