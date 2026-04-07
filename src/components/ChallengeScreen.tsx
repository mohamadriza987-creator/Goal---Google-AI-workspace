import React from 'react';
import { User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { Trophy, Sparkles, Award } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';

interface ChallengeScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
}

export function ChallengeScreen({ user, dbUser }: ChallengeScreenProps) {
  const { t } = useTranslation();
  const firstName = dbUser?.displayName?.split(' ')[0] || user?.displayName?.split(' ')[0] || '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto px-5 pt-14 pb-32"
    >
      <h1 className="text-2xl font-bold tracking-tight mb-8">{t('challenge')}</h1>

      {/* Challenges */}
      <section className="mb-10">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(201,168,76,.12)' }}>
            <Trophy size={16} style={{ color: 'var(--c-gold)' }} />
          </div>
          <h2 className="text-base font-semibold">{t('challenges')}</h2>
        </div>
        <div className="rounded-2xl p-6"
             style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            {t('noChallengesYet')}
          </p>
        </div>
      </section>

      {/* Good News */}
      <section className="mb-10">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(74,124,89,.12)' }}>
            <Sparkles size={16} style={{ color: 'var(--c-success)' }} />
          </div>
          <h2 className="text-base font-semibold">{t('goodNews')}</h2>
        </div>
        <div className="rounded-2xl p-6"
             style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            {t('noGoodNewsYet')}
          </p>
        </div>
      </section>

      {/* Member Wins */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(201,168,76,.08)' }}>
            <Award size={16} style={{ color: 'var(--c-gold)' }} />
          </div>
          <h2 className="text-base font-semibold">{t('memberWins')}</h2>
        </div>
        <div className="rounded-2xl p-6"
             style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            {t('noMemberWinsYet')}
          </p>
        </div>
      </section>
    </motion.div>
  );
}
