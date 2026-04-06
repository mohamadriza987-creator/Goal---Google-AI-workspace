import React, { useState, useEffect } from 'react';
import { Goal, User, GoalRoomThread } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import {
  MessageCircle, HelpCircle, ThumbsUp, Users,
  Zap, MapPin, Bell, CheckCircle2, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../firebase';
import {
  collection, query, orderBy, onSnapshot,
  limit,
} from 'firebase/firestore';

interface ActivityScreenProps {
  user:   FirebaseUser | null;
  dbUser: User | null;
  goals?: Goal[];
  setCurrentScreen?: (s: any) => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)    return 'just now';
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ─── Item type config ─────────────────────────────────────────────────────────

type Section = 'for_me' | 'can_help' | 'room_updates';

interface ActivityItem {
  id:          string;
  section:     Section;
  icon:        React.ReactNode;
  title:       string;
  subtitle:    string;
  meta:        string;
  goalId?:     string;
  threadId?:   string;
  groupId?:    string;
  isRead:      boolean;
}

// ─── Activity Item Card ───────────────────────────────────────────────────────

function ActivityCard({
  item, onPress,
}: {
  item: ActivityItem;
  onPress?: () => void;
}) {
  return (
    <motion.button
      onClick={onPress}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full text-left flex items-start gap-4 p-4 rounded-2xl transition-all hover:opacity-80"
      style={{
        background: item.isRead ? 'var(--c-surface)' : 'rgba(201,168,76,.06)',
        border:     item.isRead ? '1px solid var(--c-border)' : '1px solid rgba(201,168,76,.2)',
      }}
    >
      {/* Icon bubble */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
           style={{ background: item.isRead ? 'var(--c-surface-2)' : 'rgba(201,168,76,.12)', border: '1px solid var(--c-border)' }}>
        {item.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium leading-snug mb-0.5"
           style={{ color: item.isRead ? 'var(--c-text-2)' : 'var(--c-text)' }}>
          {item.title}
        </p>
        <p className="text-meta line-clamp-2" style={{ color: 'var(--c-text-3)' }}>
          {item.subtitle}
        </p>
      </div>

      {/* Time */}
      <span className="flex-shrink-0 text-meta" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
        {item.meta}
      </span>
    </motion.button>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-meta uppercase tracking-widest font-bold"
          style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
        {title}
      </h2>
      {count > 0 && (
        <span className="text-meta px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(201,168,76,.15)', color: 'var(--c-gold)', fontSize: 11 }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ActivityScreen({
  user, dbUser, goals = [], setCurrentScreen,
}: ActivityScreenProps) {
  const [items,   setItems]   = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Build activity items from live Firestore data
  useEffect(() => {
    if (!user) { setLoading(false); return; }

    const joinedGoals = goals.filter(g => g.groupJoined && g.groupId);
    const allUnsubs: (() => void)[] = [];
    const itemMap = new Map<string, ActivityItem>();

    const flush = () => {
      const sorted = [...itemMap.values()].sort(
        (a, b) => new Date(b.meta).getTime() - new Date(a.meta).getTime()
      );
      setItems(sorted);
    };

    // ── For each joined room, listen to recent threads ────────────────────
    for (const goal of joinedGoals) {
      const groupId = goal.groupId!;

      const unsub = onSnapshot(
        query(
          collection(db, 'groups', groupId, 'threads'),
          orderBy('lastActivityAt', 'desc'),
          limit(10)
        ),
        (snap) => {
          snap.docs.forEach(d => {
            const thread = { id: d.id, ...d.data() } as GoalRoomThread;
            const isMyThread = thread.authorId === user.uid;
            const isoTime    = thread.lastActivityAt;

            if (isMyThread && thread.replyCount > 0) {
              // Someone replied to my thread
              itemMap.set(`reply_${thread.id}`, {
                id:       `reply_${thread.id}`,
                section:  'for_me',
                icon:     <MessageCircle size={16} style={{ color: 'var(--c-gold)' }} />,
                title:    'New reply to your thread',
                subtitle: thread.title,
                meta:     timeAgo(isoTime),
                goalId:   goal.id,
                threadId: thread.id,
                groupId,
                isRead:   false,
              });
            }

            if (thread.usefulCount > 0 && isMyThread) {
              // My thread got marked useful
              itemMap.set(`useful_${thread.id}`, {
                id:      `useful_${thread.id}`,
                section: 'for_me',
                icon:    <ThumbsUp size={16} style={{ color: 'var(--c-gold)' }} />,
                title:   'Your thread was marked useful',
                subtitle: `${thread.usefulCount} people found "${thread.title}" helpful`,
                meta:    timeAgo(isoTime),
                goalId:  goal.id,
                groupId,
                isRead:  false,
              });
            }

            if (!isMyThread && thread.badge === 'help') {
              // Someone needs help — I might be able to help
              itemMap.set(`help_${thread.id}`, {
                id:       `help_${thread.id}`,
                section:  'can_help',
                icon:     <HelpCircle size={16} style={{ color: '#e07070' }} />,
                title:    'Someone needs help',
                subtitle: thread.title,
                meta:     timeAgo(isoTime),
                goalId:   goal.id,
                threadId: thread.id,
                groupId,
                isRead:   true,
              });
            }

            if (!isMyThread && thread.badge === 'together') {
              itemMap.set(`together_${thread.id}`, {
                id:       `together_${thread.id}`,
                section:  'can_help',
                icon:     <Users size={16} style={{ color: 'var(--c-gold)' }} />,
                title:    'Someone wants to do this together',
                subtitle: thread.title,
                meta:     timeAgo(isoTime),
                goalId:   goal.id,
                threadId: thread.id,
                groupId,
                isRead:   true,
              });
            }

            if (!isMyThread && thread.badge === 'completed') {
              itemMap.set(`completed_${thread.id}`, {
                id:       `completed_${thread.id}`,
                section:  'room_updates',
                icon:     <CheckCircle2 size={16} style={{ color: 'var(--c-success)' }} />,
                title:    'Someone completed a task',
                subtitle: thread.title,
                meta:     timeAgo(isoTime),
                goalId:   goal.id,
                threadId: thread.id,
                groupId,
                isRead:   true,
              });
            }

            if (!isMyThread && (thread.badge === 'useful' || thread.badge === 'support')) {
              itemMap.set(`room_${thread.id}`, {
                id:       `room_${thread.id}`,
                section:  'room_updates',
                icon:     <Zap size={16} style={{ color: 'var(--c-gold)' }} />,
                title:    `New ${thread.badge} thread in your room`,
                subtitle: thread.title,
                meta:     timeAgo(isoTime),
                goalId:   goal.id,
                threadId: thread.id,
                groupId,
                isRead:   true,
              });
            }
          });
          flush();
          setLoading(false);
        },
        (err) => { console.error('Activity threads error:', err); setLoading(false); }
      );

      allUnsubs.push(unsub);
    }

    // ── Similar goals — people stuck on tasks you've completed ────────────
    goals.forEach(g => {
      // We don't have tasks in memory here, but we can use similarGoals
      // to generate "people you could help" items
      (g.similarGoals ?? []).forEach(sg => {
        if (!itemMap.has(`similar_${sg.goalId}`)) {
          itemMap.set(`similar_${sg.goalId}`, {
            id:      `similar_${sg.goalId}`,
            section: 'can_help',
            icon:    <Users size={16} style={{ color: 'var(--c-text-2)' }} />,
            title:   'Someone is on a similar path',
            subtitle: sg.goalTitle || 'Similar goal',
            meta:    'recently',
            goalId:  sg.goalId,
            isRead:  true,
          });
        }
      });
    });

    if (joinedGoals.length === 0) {
      setLoading(false);
    }

    flush();

    return () => allUnsubs.forEach(u => u());
  }, [user, goals]);

  // Navigate to the relevant screen when an item is tapped
  const handleItemPress = (item: ActivityItem) => {
    if (!setCurrentScreen) return;
    if (item.goalId && item.threadId) {
      setCurrentScreen({ name: 'goal-detail', goalId: item.goalId, initialTab: 'goal-room' });
    } else if (item.goalId) {
      setCurrentScreen({ name: 'goal-detail', goalId: item.goalId, initialTab: 'plan' });
    }
  };

  // Split into sections
  const forMe      = items.filter(i => i.section === 'for_me');
  const canHelp    = items.filter(i => i.section === 'can_help');
  const roomUpdates= items.filter(i => i.section === 'room_updates');
  const unreadCount= items.filter(i => !i.isRead).length;

  const joinedGoals = goals.filter(g => g.groupJoined && g.groupId);

  return (
    <div className="min-h-screen" style={{ background: 'var(--c-bg)', paddingBottom: 120 }}>

      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5 }}>Activity</h1>
          {unreadCount > 0 && (
            <span className="text-meta px-3 py-1 rounded-full font-bold"
                  style={{ background: 'var(--c-gold)', color: '#000', fontSize: 12 }}>
              {unreadCount} new
            </span>
          )}
        </div>
        <p className="text-meta mt-1" style={{ color: 'var(--c-text-3)' }}>
          Replies, help requests, and Goal Room updates
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
        </div>
      )}

      {/* No joined rooms yet */}
      {!loading && joinedGoals.length === 0 && (
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
               style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
            <Bell size={24} style={{ color: 'var(--c-text-3)' }} />
          </div>
          <h2 className="text-card-title mb-2">Nothing yet</h2>
          <p className="text-body" style={{ color: 'var(--c-text-3)', maxWidth: 280 }}>
            Join a Goal Room from one of your goals to start seeing activity here.
          </p>
          {setCurrentScreen && (
            <button
              onClick={() => setCurrentScreen({ name: 'home' })}
              className="btn-ghost mt-6">
              Go to My Goals
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {!loading && joinedGoals.length > 0 && (
        <div className="px-4 space-y-8">

          {/* Support for me */}
          {forMe.length > 0 && (
            <section>
              <SectionHeader title="Support for Me" count={forMe.filter(i => !i.isRead).length} />
              <div className="space-y-3">
                <AnimatePresence>
                  {forMe.map((item, i) => (
                    <motion.div key={item.id} transition={{ delay: i * 0.04 }}>
                      <ActivityCard item={item} onPress={() => handleItemPress(item)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* People I can help */}
          {canHelp.length > 0 && (
            <section>
              <SectionHeader title="People I Can Help" count={0} />
              <div className="space-y-3">
                <AnimatePresence>
                  {canHelp.map((item, i) => (
                    <motion.div key={item.id} transition={{ delay: i * 0.04 }}>
                      <ActivityCard item={item} onPress={() => handleItemPress(item)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* Goal Room updates */}
          {roomUpdates.length > 0 && (
            <section>
              <SectionHeader title="Goal Room Updates" count={0} />
              <div className="space-y-3">
                <AnimatePresence>
                  {roomUpdates.map((item, i) => (
                    <motion.div key={item.id} transition={{ delay: i * 0.04 }}>
                      <ActivityCard item={item} onPress={() => handleItemPress(item)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* All empty but has joined rooms */}
          {forMe.length === 0 && canHelp.length === 0 && roomUpdates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                   style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                <Bell size={24} style={{ color: 'var(--c-text-3)' }} />
              </div>
              <h2 className="text-card-title mb-2">All quiet</h2>
              <p className="text-body" style={{ color: 'var(--c-text-3)', maxWidth: 260 }}>
                Activity from your Goal Rooms will appear here as people post and reply.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}