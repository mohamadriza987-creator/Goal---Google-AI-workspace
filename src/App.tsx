import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Goal, GoalTask, User, CalendarNote } from './types';
import { motion, AnimatePresence } from 'motion/react';

const PANEL_INITIAL = { opacity: 0, y: 8 };
const PANEL_ANIMATE = { opacity: 1, y: 0 };
const PANEL_EXIT    = { opacity: 0, y: -4 };
const PANEL_TRANS   = { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as const };

type Screen =
  | 'auth'
  | 'home'
  | 'goal-detail'
  | 'calendar'
  | 'challenge'
  | 'profile';

interface ScreenState {
  name: Screen;
  goalId?: string;
  groupId?: string;
  initialTab?: 'plan' | 'goal-room' | 'people';
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST   = 'list',
  GET    = 'get',
  WRITE  = 'write',
}

const HomeScreen       = React.lazy(() => import('./components/HomeScreen').then(m => ({ default: m.HomeScreen })));
const GoalDetailScreen = React.lazy(() => import('./components/GoalDetailScreen').then(m => ({ default: m.GoalDetailScreen })));
const CalendarScreen   = React.lazy(() => import('./components/CalendarScreen').then(m => ({ default: m.CalendarScreen })));
const ChallengeScreen  = React.lazy(() => import('./components/ChallengeScreen').then(m => ({ default: m.ChallengeScreen })));
const ProfileScreen    = React.lazy(() => import('./components/ProfileScreen').then(m => ({ default: m.ProfileScreen })));
import { SortableNavConsole }    from './components/SortableNavConsole';
import { HomeEditModeProvider }  from './contexts/HomeEditModeContext';
import { UserContext }           from './contexts/UserContext';

export default function App() {
  const [user,           setUser]           = useState<SupabaseUser | null>(null);
  const [dbUser,         setDbUser]         = useState<User | null>(null);
  const [currentScreen,  setCurrentScreen]  = useState<ScreenState>({ name: 'auth' });
  const [goals,          setGoals]          = useState<Goal[]>([]);
  const [goalsLoading,   setGoalsLoading]   = useState(true);
  const [goalLimit,      setGoalLimit]      = useState(5);
  const [hasMoreGoals,   setHasMoreGoals]   = useState(false);
  const [allReminders,   setAllReminders]   = useState<{task: GoalTask; goal: Goal; reminderAt: string; noteText?: string}[]>([]);
  const [calendarNotes,  setCalendarNotes]  = useState<CalendarNote[]>([]);
  const [optimisticGoals,setOptimisticGoals]= useState<Goal[]>([]);
  const [navVisible,     setNavVisible]     = useState(true);
  const lastScrollY = useRef(0);
  const goalsRef = useRef<Goal[]>(goals);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 10)                      setNavVisible(true);
      else if (y > lastScrollY.current) setNavVisible(false);
      else                              setNavVisible(true);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleDbError = (error: unknown, operationType: OperationType, path: string | null) => {
    console.error('Supabase Error:', JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path,
      userId: user?.id,
    }));
  };

  // ── Auth + user profile subscription ───────────────────────────────────
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setCurrentScreen({ name: 'home' });
        subscribeToUserProfile(session.user.id);
      }
    });

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        setCurrentScreen(prev => prev.name === 'auth' ? { name: 'home' } : prev);
        subscribeToUserProfile(u.id);
      } else {
        setDbUser(null);
        setGoals([]);
        setGoalsLoading(true);
        setGoalLimit(5);
        setHasMoreGoals(false);
        setCurrentScreen({ name: 'auth' });
      }
    });

    return () => { authSub.unsubscribe(); };
  }, []);

  const userProfileChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  /**
   * Called once on first login when no public.users profile exists yet.
   * Looks up the caller's Google provider_id (= Firebase UID for Google OAuth
   * users) and re-assigns any migrated goals/tasks/notes that still carry the
   * old Firebase UID as owner_id. See server_legacy/goals/backfill-owner.ts.
   */
  async function runOwnerBackfill() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/goals/backfill-owner', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) { console.warn('[backfill] HTTP', res.status, await res.text()); return; }
      const body = await res.json();
      if (body.migrated) {
        console.log(`[backfill] Re-owned ${body.goals_updated} goals to current user`);
      }
    } catch (e) {
      console.warn('[backfill] Failed (non-critical):', e);
    }
  }

  function subscribeToUserProfile(userId: string) {
    if (userProfileChannelRef.current) {
      supabase.removeChannel(userProfileChannelRef.current);
    }

    // Initial fetch
    supabase.from('users').select('*').eq('id', userId).single().then(({ data }) => {
      if (data) {
        setDbUser(mapDbUser(data));
      } else {
        // First login: create profile from Supabase auth metadata, then attempt
        // to migrate any goals that were stored under a legacy Firebase UID.
        supabase.auth.getUser().then(({ data: authData }) => {
          const u = authData.user;
          if (!u) return;
          const newUser = {
            id:           u.id,
            email:        u.email,
            display_name: u.user_metadata?.full_name || u.user_metadata?.name || 'Anonymous',
            username:     u.email?.split('@')[0] || 'user',
            avatar_url:   u.user_metadata?.avatar_url || null,
            blocked_users: [],
            hidden_users:  [],
            created_at:   new Date().toISOString(),
          };
          supabase.from('users').upsert(newUser).then(() => {
            setDbUser(mapDbUser(newUser));
            // Non-blocking: attempt to migrate legacy Firebase-owned rows
            runOwnerBackfill();
          });
        });
      }
    });

    // Real-time subscription
    const channel = supabase
      .channel(`users:${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'users',
        filter: `id=eq.${userId}`,
      }, (payload) => {
        if (payload.new) setDbUser(mapDbUser(payload.new as any));
      })
      .subscribe();

    userProfileChannelRef.current = channel;
  }

  function mapDbUser(data: any): User {
    return {
      id:               data.id,
      displayName:      data.display_name || 'Anonymous',
      username:         data.username     || data.email?.split('@')[0] || 'user',
      avatarUrl:        data.avatar_url,
      age:              data.age,
      locality:         data.locality,
      nationality:      data.nationality,
      languages:        data.languages,
      preferredLanguage: data.preferred_language,
      lastLoggedInAt:   data.last_logged_in_at,
      role:             data.role,
      blockedUsers:     data.blocked_users  || [],
      hiddenUsers:      data.hidden_users   || [],
      createdAt:        data.created_at,
    };
  }

  // ── Goals subscription (paginated) ─────────────────────────────────────
  const goalsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user) return;
    setGoalsLoading(true);

    const fetchGoals = async () => {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(goalLimit);

      if (error) {
        console.error('[goals] Fetch failed:', error.message, { code: error.code, details: error.details });
        handleDbError(error, OperationType.LIST, 'goals');
        setGoalsLoading(false);
        return;
      }

      const g = (data || []).map(mapGoal);
      goalsRef.current = g;
      setGoals(g);
      setGoalsLoading(false);
      setHasMoreGoals(g.length === goalLimit);
      setOptimisticGoals(prev =>
        prev.filter(og => !g.some(rg => rg.tempId && rg.tempId === og.id))
      );
    };

    fetchGoals();

    if (goalsChannelRef.current) supabase.removeChannel(goalsChannelRef.current);

    const channel = supabase
      .channel(`goals:${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'goals',
        filter: `owner_id=eq.${user.id}`,
      }, () => { fetchGoals(); })
      .subscribe();

    goalsChannelRef.current = channel;

    return () => {
      if (goalsChannelRef.current) supabase.removeChannel(goalsChannelRef.current);
    };
  }, [user, goalLimit]);

  function mapGoal(data: any): Goal {
    return {
      id:                      data.id,
      ownerId:                 data.owner_id,
      title:                   data.title        || '',
      description:             data.description  || '',
      visibility:              data.visibility   || 'public',
      publicFields:            data.public_fields,
      category:                data.category,
      categories:              data.categories,
      tags:                    data.tags,
      status:                  data.status       || 'active',
      progressPercent:         data.progress_percent ?? 0,
      likesCount:              0,
      groupId:                 data.group_id,
      groupJoined:             data.group_joined,
      joinedAt:                data.joined_at,
      eligibleAt:              data.eligible_at,
      createdAt:               data.created_at,
      tempId:                  data.temp_id,
      sourceText:              data.source_text,
      normalizedMatchingText:  data.normalized_matching_text,
      timeHorizon:             data.time_horizon,
      embedding:               data.embedding,
      embeddingUpdatedAt:      data.embedding_updated_at,
      similarGoals:            data.similar_goals,
    };
  }

  // ── Reminders (tasks + notes with reminderAt) ──────────────────────────
  useEffect(() => {
    if (!user) return;

    const fetchReminders = async () => {
      const { data: taskRows } = await supabase
        .from('tasks')
        .select('id, goal_id, text, is_done, reminder_at, order, micro_steps, source, created_at')
        .eq('owner_id', user.id)
        .not('reminder_at', 'is', null)
        .limit(500);

      const taskReminders: typeof allReminders = [];
      for (const t of (taskRows || [])) {
        const goal = goalsRef.current.find(g => g.id === t.goal_id);
        if (goal) {
          taskReminders.push({
            task: { id: t.id, text: t.text, isDone: t.is_done, order: t.order, microSteps: t.micro_steps, source: t.source, reminderAt: t.reminder_at, createdAt: t.created_at } as GoalTask,
            goal,
            reminderAt: t.reminder_at,
          });
        }
      }

      const { data: noteRows } = await supabase
        .from('goal_notes')
        .select('id, goal_id, task_id, text, reminder_at')
        .eq('owner_id', user.id)
        .not('reminder_at', 'is', null)
        .limit(500);

      const noteReminders: typeof allReminders = [];
      for (const n of (noteRows || [])) {
        const goal = goalsRef.current.find(g => g.id === n.goal_id);
        if (goal) {
          noteReminders.push({
            task: { id: n.task_id, text: 'Note Reminder' } as any,
            goal,
            reminderAt: n.reminder_at,
            noteText: n.text,
          });
        }
      }

      const merged = [...taskReminders, ...noteReminders];
      merged.sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime());
      setAllReminders(merged);
    };

    fetchReminders();
  }, [user, goals]);

  // ── Calendar notes ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    supabase
      .from('calendar_notes')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: true })
      .then(({ data }) => {
        setCalendarNotes((data || []).map((n: any) => ({
          id:        n.date,
          date:      n.date,
          text:      n.text,
          createdAt: n.created_at,
          updatedAt: n.updated_at,
        } as CalendarNote)));
      });
  }, [user]);

  const saveCalendarNote = async (date: string, text: string) => {
    if (!user) return;
    const now = new Date().toISOString();
    await supabase.from('calendar_notes').upsert({
      user_id:    user.id,
      date,
      text,
      created_at: now,
      updated_at: now,
    }, { onConflict: 'user_id,date' });
    setCalendarNotes(prev => {
      const existing = prev.find(n => n.date === date);
      if (existing) return prev.map(n => n.date === date ? { ...n, text, updatedAt: now } : n);
      return [...prev, { id: date, date, text, createdAt: now, updatedAt: now }];
    });
  };

  const deleteCalendarNote = async (date: string) => {
    if (!user) return;
    await supabase.from('calendar_notes').delete().eq('user_id', user.id).eq('date', date);
    setCalendarNotes(prev => prev.filter(n => n.date !== date));
  };

  // ── Auth ────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
    } catch (err) {
      handleDbError(err, OperationType.GET, 'auth_oauth');
    }
  };

  // ── Optimistic goals ────────────────────────────────────────────────────
  const addOptimisticGoal    = (goal: Goal)                         => setOptimisticGoals(prev => [goal, ...prev]);
  const updateOptimisticGoal = (tempId: string, upd: Partial<Goal>) => setOptimisticGoals(prev => prev.map(g => g.id === tempId ? { ...g, ...upd } : g));
  const removeOptimisticGoal = (tempId: string)                     => setOptimisticGoals(prev => prev.filter(g => g.id !== tempId));

  // ── Save goal ───────────────────────────────────────────────────────────
  const performSaveGoal = async (goal: Goal) => {
    if (!user || !goal.draftData) return;
    const { structuredGoal, manualTasks } = goal.draftData;
    const tempId = goal.id;
    updateOptimisticGoal(tempId, { savingStatus: 'saving', saveErrorMessage: undefined });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };

      // 1. Embedding
      let embedding: number[] | undefined;
      let embeddingFailed = false;
      try {
        const r = await fetch('/api/generate-embedding', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ text: structuredGoal.normalizedMatchingText }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        embedding = (await r.json()).embedding;
      } catch (e) {
        embeddingFailed = true;
        console.error('Embedding failed:', e);
      }

      // 2. Save goal doc
      const visibility = structuredGoal.privacy === 'private' ? 'private' : 'public';
      const { data: goalRow, error: goalErr } = await supabase.from('goals').insert({
        owner_id:                 user.id,
        temp_id:                  tempId,
        title:                    structuredGoal.title,
        description:              structuredGoal.description,
        category:                 structuredGoal.categories[0],
        categories:               structuredGoal.categories,
        tags:                     structuredGoal.tags,
        time_horizon:             structuredGoal.timeHorizon,
        progress_percent:         0,
        status:                   'active',
        visibility,
        public_fields:            visibility === 'public' ? ['title', 'description', 'tasks', 'progress'] : [],
        created_at:               goal.createdAt,
        source_text:              structuredGoal.transcript,
        normalized_matching_text: structuredGoal.normalizedMatchingText,
        embedding,
        embedding_updated_at:     embedding ? new Date().toISOString() : null,
        matching_metadata:        { age: dbUser?.age ?? null, locality: dbUser?.locality ?? null },
      }).select('id').single();

      if (goalErr || !goalRow) throw new Error(goalErr?.message || 'Failed to create goal');

      // 3. Tasks
      const allTasks = [
        ...structuredGoal.tasks.map((task, i) => ({
          goal_id:    goalRow.id,
          owner_id:   user.id,
          text:       task.text,
          is_done:    false,
          order:      i,
          micro_steps: task.microSteps,
          created_at: new Date().toISOString(),
          source:     'ai',
        })),
        ...manualTasks.map((text: string, i: number) => ({
          goal_id:    goalRow.id,
          owner_id:   user.id,
          text,
          is_done:    false,
          order:      structuredGoal.tasks.length + i,
          micro_steps: [],
          created_at: new Date().toISOString(),
          source:     'manual',
        })),
      ];
      if (allTasks.length > 0) await supabase.from('tasks').insert(allTasks);

      if (embeddingFailed) {
        updateOptimisticGoal(tempId, {
          savingStatus: 'partial',
          saveErrorMessage: 'Saved, but no community room was matched. Open the goal to retry.',
        });
        return;
      }
      updateOptimisticGoal(tempId, { savingStatus: 'success' });

      // 4. Post-save: assign group + precompute matches + index
      if (embedding) {
        try {
          const res = await fetch('/api/goals/post-save', {
            method: 'POST', headers: authHeaders,
            body: JSON.stringify({ goalId: goalRow.id, embedding }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data && data.groupId === null) {
            updateOptimisticGoal(tempId, {
              savingStatus: 'partial',
              saveErrorMessage: 'No matching community room yet. We\'ll keep looking as more goals join.',
            });
          }
        } catch (e) {
          console.error('Post-save failed', e);
          updateOptimisticGoal(tempId, {
            savingStatus: 'partial',
            saveErrorMessage: 'Goal saved, but joining a community room failed. Open the goal to retry.',
          });
        }
      }
    } catch (err) {
      console.error('Save error:', err);
      updateOptimisticGoal(tempId, {
        savingStatus: 'error',
        saveErrorMessage: 'Could not save goal. Please try again.',
      });
    }
  };

  const loadMoreGoals = useCallback(() => {
    if (hasMoreGoals) setGoalLimit(prev => prev + 5);
  }, [hasMoreGoals]);

  const displayGoals = React.useMemo(() => [...optimisticGoals, ...goals], [optimisticGoals, goals]);

  const navigate = (s: ScreenState | Screen) =>
    setCurrentScreen(typeof s === 'string' ? { name: s } : s);

  const isAuth = currentScreen.name === 'auth';

  return (
    <UserContext.Provider value={{ user, dbUser }}>
    <HomeEditModeProvider userId={user?.id ?? null}>
    <div className="min-h-screen font-sans selection:bg-white selection:text-black"
         style={{
           background:  'var(--c-bg)',
           color:       'var(--c-text)',
           contain:     'layout paint',
           paddingTop:  'env(safe-area-inset-top)',
         }}>

      <React.Suspense fallback={null}>
      <AnimatePresence mode="wait">

        {currentScreen.name === 'auth' && (
          <motion.div key="auth"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}
            className="flex flex-col items-center justify-center h-screen p-6 text-center">
            <h1 className="text-page-title mb-3" style={{ fontSize: 38, letterSpacing: -1 }}>Goal</h1>
            <p className="text-body mb-12" style={{ color: 'var(--c-text-2)' }}>
              Move forward, one step at a time.
            </p>
            <button onClick={handleLogin} className="btn-gold px-10 py-4 text-base">
              Continue with Google
            </button>
          </motion.div>
        )}

        {currentScreen.name === 'home' && (
          <motion.div key="home"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}>
            <HomeScreen
              user={user}
              dbUser={dbUser}
              goals={displayGoals}
              goalsLoading={goalsLoading}
              hasMoreGoals={hasMoreGoals}
              loadMoreGoals={loadMoreGoals}
              setCurrentScreen={navigate}
              handleDbError={handleDbError}
              addOptimisticGoal={addOptimisticGoal}
              performSaveGoal={performSaveGoal}
            />
          </motion.div>
        )}

        {currentScreen.name === 'goal-detail' && currentScreen.goalId && (
          <motion.div key="goal-detail"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}>
            <GoalDetailScreen
              user={user}
              dbUser={dbUser}
              goalId={currentScreen.goalId}
              goals={displayGoals}
              initialTab={currentScreen.initialTab ?? 'plan'}
              setCurrentScreen={navigate}
              handleDbError={handleDbError}
            />
          </motion.div>
        )}

        {currentScreen.name === 'calendar' && (
          <motion.div key="calendar"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}>
            <CalendarScreen
              allReminders={allReminders}
              goals={displayGoals}
              setCurrentScreen={navigate}
              calendarNotes={calendarNotes}
              onSaveCalendarNote={saveCalendarNote}
              onDeleteCalendarNote={deleteCalendarNote}
            />
          </motion.div>
        )}

        {currentScreen.name === 'challenge' && (
          <motion.div key="challenge"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}>
            <ChallengeScreen user={user} dbUser={dbUser} />
          </motion.div>
        )}

        {currentScreen.name === 'profile' && (
          <motion.div key="profile"
            initial={PANEL_INITIAL} animate={PANEL_ANIMATE} exit={PANEL_EXIT} transition={PANEL_TRANS}>
            <ProfileScreen user={user} dbUser={dbUser} onNavigateHome={() => navigate({ name: 'home' })} />
          </motion.div>
        )}

      </AnimatePresence>
      </React.Suspense>

      {!isAuth && currentScreen.name !== 'profile' && (
        <SortableNavConsole
          currentScreen={currentScreen.name}
          navigate={navigate}
          navVisible={navVisible}
        />
      )}
    </div>
    </HomeEditModeProvider>
    </UserContext.Provider>
  );
}
