import React, { useState, useEffect } from 'react';
import { Goal } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { Users, ChevronRight, Loader2, Eye, UserPlus, EyeOff, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SimilarMatch {
  goalId:         string;
  userId:         string;
  goalTitle:      string;
  similarityScore: number;
  groupId?:       string;
  description?:   string;
}

interface PeopleTabProps {
  goal: Goal;
  user: FirebaseUser | null;
  setCurrentScreen: (s: any) => void;
}

// A2: typed contract for the server group response so callers can't drift
// from the API shape without TS catching it.
interface GroupResponse {
  id: string;
  derivedGoalTheme?: string;
  memberCount?: number;
  matchingCriteria?: { category?: string; timeHorizon?: string; privacy?: string };
}

function activityLabel(score: number) {
  if (score >= 0.92) return 'Very similar';
  if (score >= 0.85) return 'Similar';
  return 'Somewhat similar';
}

function SimilarityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: .6, ease: [.25,.46,.45,.94] }}
          style={{ height: '100%', background: 'var(--c-gold)', borderRadius: 4 }}
        />
      </div>
      <span className="text-meta font-semibold" style={{ color: 'var(--c-gold)', minWidth: 32, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}

// ── Room suggestion card ──────────────────────────────────────────────────────
function RoomCard({ goal, user, setCurrentScreen }: PeopleTabProps) {
  const [joining, setJoining] = useState(false);
  const [groupData, setGroupData] = useState<GroupResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const { groupId, groupJoined } = goal as any;

  // S3: route group reads through the server so authorization is enforced
  // server-side rather than depending solely on Firestore rules.
  useEffect(() => {
    if (!groupId || !user) return;
    let cancelled = false;
    setLoading(true);
    user.getIdToken()
      .then(tok => fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
        headers: { 'Authorization': `Bearer ${tok}` },
      }))
      .then(res => res.ok ? res.json() : null)
      .then((data: GroupResponse | null) => { if (!cancelled && data) setGroupData(data); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, user]);

  if (!groupId) return null;

  const joinRoom = async () => {
    if (!user || joining || groupJoined) return;
    setJoining(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ goalId: goal.id, groupId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    } catch(e: any) {
      alert(e.message || 'Could not join. Try again.');
    } finally { setJoining(false); }
  };

  return (
    <div className="mb-8">
      <h3 className="text-meta uppercase tracking-widest mb-3"
          style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
        Your Goal Room
      </h3>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="p-5 rounded-2xl"
        style={{
          background: groupJoined ? 'rgba(201,168,76,.06)' : 'var(--c-surface)',
          border: groupJoined ? '1px solid rgba(201,168,76,.25)' : '1px solid var(--c-border)',
        }}>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1">
                <p className="text-card-title mb-1" style={{ fontSize: 15 }}>
                  {groupData?.derivedGoalTheme || 'Goal Room'}
                </p>
                <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                  {groupData?.memberCount ?? 0} members · {groupData?.matchingCriteria?.category || goal.category || 'General'}
                </p>
              </div>
              {groupJoined && (
                <span className="badge badge-completed flex-shrink-0">Joined</span>
              )}
            </div>

            {!groupJoined ? (
              <div className="flex gap-2 mt-4">
                <button onClick={joinRoom} disabled={joining}
                  className="btn-gold flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ padding: '11px 0', fontSize: 14 }}>
                  {joining ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                  Join Room
                </button>
                <button
                  onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: goal.id, initialTab: 'goal-room' })}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-meta transition-opacity hover:opacity-70"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                  <Eye size={14} /> Preview
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: goal.id, initialTab: 'goal-room' })}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-meta font-semibold transition-opacity hover:opacity-70 mt-2"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                Open Goal Room <ChevronRight size={15} />
              </button>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Main People tab ───────────────────────────────────────────────────────────
export function PeopleTab({ goal, user, setCurrentScreen }: PeopleTabProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const matches: SimilarMatch[] = goal.similarGoals ?? [];

  // Sort by similarity descending
  const sorted = [...matches]
    .filter(m => !hidden.has(m.userId))
    .sort((a, b) => b.similarityScore - a.similarityScore);

  const hideUser = (userId: string) => {
    // D3: optimistic hide, but roll back if the signal write fails so the
    // local state matches the server's view of who is actually hidden.
    setHidden(prev => new Set([...prev, userId]));
    if (!user) return;
    user.getIdToken()
      .then(tok => fetch('/api/moderation/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({ targetUserId: userId, action: 'hide', context: 'people_tab' }),
      }))
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch(err => {
        console.error('hide signal failed, rolling back:', err);
        setHidden(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      });
  };

  return (
    <div className="px-4 py-5" style={{ paddingBottom: 120 }}>

      {/* Room suggestion */}
      <RoomCard goal={goal} user={user} setCurrentScreen={setCurrentScreen} />

      {/* Similar people */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-meta uppercase tracking-widest"
              style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
            People on a Similar Path
          </h3>
          {matches.length > 0 && (
            <span className="text-meta" style={{ color: 'var(--c-text-3)' }}>
              {matches.length} found
            </span>
          )}
        </div>

        {/* Explanation */}
        <p className="text-meta mb-5" style={{ color: 'var(--c-text-3)' }}>
          Matched by shared tasks, goal similarity, and locality. Tap a card to explore.
        </p>

        {sorted.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                 style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
              <Users size={22} style={{ color: 'var(--c-text-3)' }} />
            </div>
            <p className="text-body mb-1" style={{ color: 'var(--c-text-2)' }}>No matches yet</p>
            <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>
              People with similar goals will appear here as more users join.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <AnimatePresence>
            {sorted.map((match, i) => (
              <motion.div key={match.userId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.04 }}
                className="p-4 rounded-2xl"
                style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>

                {/* Top row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Avatar placeholder */}
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                         style={{ background: 'var(--c-surface-3)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
                      {match.userId.slice(0,2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-semibold truncate">
                        {activityLabel(match.similarityScore)}
                      </p>
                      <p className="text-meta truncate" style={{ color: 'var(--c-text-3)' }}>
                        {match.goalTitle}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => hideUser(match.userId)}
                    className="flex-shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: 'var(--c-text-3)' }} title="Hide">
                    <EyeOff size={14} />
                  </button>
                </div>

                {/* Similarity bar */}
                <SimilarityBar score={match.similarityScore} />

                {/* Description snippet */}
                {match.description && (
                  <p className="text-meta mt-2 line-clamp-2" style={{ color: 'var(--c-text-2)' }}>
                    {match.description}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  {match.groupId && (
                    <button
                      onClick={() => setCurrentScreen({ name: 'goal-detail', goalId: goal.id, initialTab: 'goal-room' })}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-meta font-medium transition-opacity hover:opacity-70"
                      style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                      <Users size={13} /> View Room
                    </button>
                  )}
                  <button
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-meta font-medium transition-opacity hover:opacity-70"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
                    onClick={() => alert('Direct support threads coming in a future build.')}>
                    <Star size={13} /> Offer support
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}