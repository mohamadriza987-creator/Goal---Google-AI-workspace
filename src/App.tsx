import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, orderBy, setDoc, collectionGroup, addDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { Goal, GoalTask, User, CalendarNote } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Calendar as CalendarIcon, Trophy } from 'lucide-react';

// ── Screen types ──────────────────────────────────────────────────────────────

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

// ── Panda logo (centre home button) ──────────────────────────────────────────

const PandaIcon = ({ size = 24, active = false }: { size?: number; active?: boolean }) => (
  <div className={cn('relative flex items-center justify-center transition-all duration-300', active ? 'scale-110' : 'hover:scale-105')}>
    <svg width={size} height={size} viewBox="0 0 200 200"
      className={cn('transition-all duration-300', active ? 'fill-black' : 'fill-zinc-400 group-hover:fill-white')}>
      <circle cx="50"  cy="50"  r="25" />
      <circle cx="150" cy="50"  r="25" />
      <circle cx="100" cy="100" r="80" fill={active ? 'white' : 'none'} stroke={active ? 'black' : 'currentColor'} strokeWidth="8" />
      <ellipse cx="70"  cy="90" rx="20" ry="25" />
      <ellipse cx="130" cy="90" rx="20" ry="25" />
      <circle  cx="100" cy="120" r="8" />
    </svg>
  </div>
);

// ── Screen imports ───────────────────────────────────────────────────────────

import { HomeScreen }       from './components/HomeScreen';
import { GoalDetailScreen } from './components/GoalDetailScreen';
import { CalendarScreen }   from './components/CalendarScreen';
import { ChallengeScreen }  from './components/ChallengeScreen';
import { ProfileScreen }    from './components/ProfileScreen';
import { NavButton }        from './components/NavButton';

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
// ═════════════════════════════════════════════════════════════════════════════

  const [user,           setUser]           = useState<FirebaseUser | null>(null);
  const [dbUser,         setDbUser]         = useState<User | null>(null);
  const [currentScreen,  setCurrentScreen]  = useState<ScreenState>({ name: 'auth' });
  const [goals,          setGoals]          = useState<Goal[]>([]);
  const [allReminders,   setAllReminders]   = useState<{task: GoalTask; goal: Goal; reminderAt: string; noteText?: string}[]>([]);
  const [calendarNotes,  setCalendarNotes]  = useState<CalendarNote[]>([]);
  const [optimisticGoals,setOptimisticGoals]= useState<Goal[]>([]);
  const [navVisible,     setNavVisible]     = useState(true);
  const lastScrollY = useRef(0);

  // ── Nav hide-on-scroll ──────────────────────────────────────────────────
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

  // ── Error handler ───────────────────────────────────────────────────────
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    console.error('Firestore Error:', JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path,
      userId: auth.currentUser?.uid,
    }));
  };

  // ── Auth + realtime subscriptions ───────────────────────────────────────
  useEffect(() => {
    let userUnsubscribe:  (() => void) | null = null;
    let goalsUnsubscribe: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // User profile
        const userRef = doc(db, 'users', u.uid);
        userUnsubscribe = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setDbUser({ id: snap.id, ...snap.data() } as User);
          } else {
            const newUser: Partial<User> = {
              displayName: u.displayName || 'Anonymous',
              username:    u.email?.split('@')[0] || 'user',
              avatarUrl:   u.photoURL || undefined,
              blockedUsers: [],
              hiddenUsers:  [],
              createdAt:   new Date().toISOString(),
            };
            setDoc(userRef, newUser, { merge: true })
              .catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${u.uid}`));

        if (currentScreen.name === 'auth') setCurrentScreen({ name: 'home' });

        // Goals (own goals only)
        const q = query(collection(db, 'goals'), where('ownerId', '==', u.uid), orderBy('createdAt', 'desc'));
        goalsUnsubscribe = onSnapshot(q, (snapshot) => {
          const g = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
          setGoals(g);
          setOptimisticGoals(prev =>
            prev.filter(og => !g.some(rg =>
              rg.title === og.title &&
              Math.abs(new Date(rg.createdAt).getTime() - new Date(og.createdAt).getTime()) < 5000
            ))
          );
        }, (err) => handleFirestoreError(err, OperationType.GET, 'goals'));

      } else {
        setDbUser(null);
        setCurrentScreen({ name: 'auth' });
        if (userUnsubscribe)  userUnsubscribe();
        if (goalsUnsubscribe) goalsUnsubscribe();
      }
    });

    return () => {
      unsubscribeAuth();
      if (userUnsubscribe)  userUnsubscribe();
      if (goalsUnsubscribe) goalsUnsubscribe();
    };
  }, []);

  // ── Reminders (calendar data) ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    let latestTask: {task: GoalTask; goal: Goal; reminderAt: string}[]           = [];
    let latestNote: {task: GoalTask; goal: Goal; reminderAt: string; noteText: string}[] = [];

    const recompute = () => {
      const merged = [...latestTask, ...latestNote];
      merged.sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime());
      setAllReminders(merged);
    };

    const tQ = query(collectionGroup(db, 'tasks'), where('reminderAt', '!=', null));
    const unsubT = onSnapshot(tQ, (snap) => {
      latestTask = [];
      snap.docs.forEach(d => {
        const data = d.data() as GoalTask;
        const goalId = d.ref.parent.parent?.id;
        const goal   = goals.find(g => g.id === goalId);
        if (goal && data.reminderAt) latestTask.push({ task: { id: d.id, ...data }, goal, reminderAt: data.reminderAt });
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/tasks'));

    const nQ = query(collectionGroup(db, 'notes'), where('reminderAt', '!=', null));
    const unsubN = onSnapshot(nQ, (snap) => {
      latestNote = [];
      snap.docs.forEach(d => {
        const data  = d.data();
        const taskR = d.ref.parent.parent;
        const goalR = taskR?.parent.parent;
        const goal  = goals.find(g => g.id === goalR?.id);
        if (goal && data.reminderAt) latestNote.push({ task: { id: taskR?.id, text: 'Note Reminder' } as any, goal, reminderAt: data.reminderAt, noteText: data.text });
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/notes'));

    return () => { unsubT(); unsubN(); };
  }, [user, goals]);

  // ── Calendar notes ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'calendarNotes'), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setCalendarNotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as CalendarNote)));
    }, err => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/calendarNotes`));
    return () => unsub();
  }, [user]);

  const saveCalendarNote = async (date: string, text: string) => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid, 'calendarNotes', date);
    await setDoc(ref, { id: date, date, text, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
  };

  const deleteCalendarNote = async (date: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'calendarNotes', date));
  };

  // ── Auth ────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'auth_popup');
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
    updateOptimisticGoal(tempId, { savingStatus: 'saving' });

    try {
      // 1. Embedding
      let embedding: number[] | undefined;
      try {
        const tok = await user.getIdToken();
        const r   = await fetch('/api/generate-embedding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({ text: structuredGoal.normalizedMatchingText }),
        });
        if (r.ok) embedding = (await r.json()).embedding;
      } catch (e) { console.error('Embedding failed:', e); }

      // 2. Save goal doc — default visibility to 'public'
      const visibility = structuredGoal.privacy === 'private' ? 'private' : 'public';
      const goalRef = await addDoc(collection(db, 'goals'), {
        ownerId: user.uid,
        title:   structuredGoal.title,
        description: structuredGoal.description,
        category: structuredGoal.categories[0],
        categories: structuredGoal.categories,
        tags:     structuredGoal.tags,
        timeHorizon: structuredGoal.timeHorizon,
        progressPercent: 0,
        status:   'active',
        visibility,
        publicFields: visibility === 'public' ? ['title', 'description', 'tasks', 'progress'] : [],
        createdAt: goal.createdAt,
        sourceText: structuredGoal.transcript,
        normalizedMatchingText: structuredGoal.normalizedMatchingText,
        embedding,
        embeddingUpdatedAt: embedding ? new Date().toISOString() : undefined,
        matchingMetadata: { age: dbUser?.age ?? null, locality: dbUser?.locality ?? null },
      });

      // 3. Tasks batch
      const batch = writeBatch(db);
      structuredGoal.tasks.forEach((task, i) => {
        const tRef = doc(collection(db, 'goals', goalRef.id, 'tasks'));
        batch.set(tRef, {
          text: task.text, isDone: false, order: i,
          microSteps: task.microSteps,
          createdAt: new Date().toISOString(),
          source: 'ai',
        });
      });
      manualTasks.forEach((text, i) => {
        const tRef = doc(collection(db, 'goals', goalRef.id, 'tasks'));
        batch.set(tRef, {
          text, isDone: false, order: structuredGoal.tasks.length + i,
          microSteps: [],
          createdAt: new Date().toISOString(),
          source: 'manual',
        });
      });
      await batch.commit();
      updateOptimisticGoal(tempId, { savingStatus: 'success' });

      // 4. Group assign + precompute + new index layer (all fire-and-forget)
      if (embedding) {
        const tok = await user.getIdToken();
        fetch('/api/groups/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({ goalId: goalRef.id }),
        }).catch(console.error);

        const tok2 = await user.getIdToken();
        fetch('/api/goals/precompute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok2}` },
          body: JSON.stringify({ goalId: goalRef.id, embedding }),
        }).catch(console.error);

        // New structured index layer — runs in parallel, does not block UI
        const tok3 = await user.getIdToken();
        fetch('/api/goals/index-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok3}` },
          body: JSON.stringify({ goalId: goalRef.id }),
        }).catch(console.error);
      }
    } catch (err) {
      console.error('Save error:', err);
      updateOptimisticGoal(tempId, { savingStatus: 'error' });
    }
  };

  const displayGoals = React.useMemo(() => [...optimisticGoals, ...goals], [optimisticGoals, goals]);

  const navigate = (s: ScreenState | Screen) =>
    setCurrentScreen(typeof s === 'string' ? { name: s } : s);

  // ── Render ──────────────────────────────────────────────────────────────
  const isAuth = currentScreen.name === 'auth';

  return (
    <div className="min-h-screen font-sans selection:bg-white selection:text-black"
         style={{ background: 'var(--c-bg)', color: 'var(--c-text)' }}>

      {/* ── Screens ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">

        {/* AUTH */}
        {currentScreen.name === 'auth' && (
          <motion.div key="auth"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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

        {/* HOME */}
        {currentScreen.name === 'home' && (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <HomeScreen
              user={user}
              dbUser={dbUser}
              goals={displayGoals}
              setCurrentScreen={navigate}
              handleFirestoreError={handleFirestoreError}
              addOptimisticGoal={addOptimisticGoal}
              performSaveGoal={performSaveGoal}
            />
          </motion.div>
        )}

        {/* GOAL DETAIL */}
        {currentScreen.name === 'goal-detail' && currentScreen.goalId && (
          <motion.div key="goal-detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GoalDetailScreen
              user={user}
              dbUser={dbUser}
              goalId={currentScreen.goalId}
              goals={displayGoals}
              initialTab={currentScreen.initialTab ?? 'plan'}
              setCurrentScreen={navigate}
              handleFirestoreError={handleFirestoreError}
            />
          </motion.div>
        )}

        {/* CALENDAR */}
        {currentScreen.name === 'calendar' && (
          <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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

        {/* CHALLENGE */}
        {currentScreen.name === 'challenge' && (
          <motion.div key="challenge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ChallengeScreen user={user} dbUser={dbUser} />
          </motion.div>
        )}

        {/* PROFILE */}
        {currentScreen.name === 'profile' && (
          <motion.div key="profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ProfileScreen user={user} dbUser={dbUser} />
          </motion.div>
        )}

      </AnimatePresence>

      {/* ── Bottom navigation (hidden on auth & profile) ───────────── */}
      {!isAuth && currentScreen.name !== 'profile' && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 z-50"
          initial={false}
          animate={{ y: navVisible ? 0 : 80, opacity: navVisible ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        >
          {/* Gradient fade above nav */}
          <div className="h-6 pointer-events-none"
               style={{ background: 'linear-gradient(to bottom, transparent, var(--c-bg))' }} />

          <nav className="flex items-center justify-around px-2 pb-safe"
               style={{
                 background:    'rgba(10,10,10,0.92)',
                 backdropFilter: 'blur(24px)',
                 borderTop:     '1px solid var(--c-border)',
                 paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
                 paddingTop:    8,
               }}>

            {/* Home (Panda — centre/brand) */}
            <button
              onClick={() => navigate({ name: 'home' })}
              className={cn(
                'group relative flex flex-col items-center justify-center gap-0.5 px-5 py-1 rounded-full transition-all duration-300',
                currentScreen.name === 'home' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <div className={cn('transition-transform duration-300', currentScreen.name === 'home' ? 'scale-110' : 'hover:scale-105')}>
                <PandaIcon size={22} active={currentScreen.name === 'home'} />
              </div>
              <span className="text-[10px] font-semibold"
                    style={{ color: currentScreen.name === 'home' ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
                Home
              </span>
            </button>

            {/* Calendar */}
            <NavButton
              active={currentScreen.name === 'calendar'}
              icon={<CalendarIcon size={20} />}
              label="Calendar"
              onClick={() => navigate({ name: 'calendar' })}
            />

            {/* Challenge */}
            <NavButton
              active={currentScreen.name === 'challenge'}
              icon={<Trophy size={20} />}
              label="Challenge"
              onClick={() => navigate({ name: 'challenge' })}
            />

          </nav>
        </motion.div>
      )}
    </div>
  );
}
