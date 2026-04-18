import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, orderBy, limit, setDoc, collectionGroup, addDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { Goal, GoalTask, User, CalendarNote } from './types';
import { motion, AnimatePresence } from 'motion/react';

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

// ── Screen + feature imports ──────────────────────────────────────────────────

const HomeScreen       = React.lazy(() => import('./components/HomeScreen').then(m => ({ default: m.HomeScreen })));
const GoalDetailScreen = React.lazy(() => import('./components/GoalDetailScreen').then(m => ({ default: m.GoalDetailScreen })));
const CalendarScreen   = React.lazy(() => import('./components/CalendarScreen').then(m => ({ default: m.CalendarScreen })));
const ChallengeScreen  = React.lazy(() => import('./components/ChallengeScreen').then(m => ({ default: m.ChallengeScreen })));
const ProfileScreen    = React.lazy(() => import('./components/ProfileScreen').then(m => ({ default: m.ProfileScreen })));
import { SortableNavConsole }    from './components/SortableNavConsole';
import { HomeEditModeProvider }  from './contexts/HomeEditModeContext';
import { UserContext }           from './contexts/UserContext';

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
// ═════════════════════════════════════════════════════════════════════════════

  const [user,           setUser]           = useState<FirebaseUser | null>(null);
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
  // Stable ref so the reminders effect doesn't re-subscribe on every goals update
  const goalsRef = useRef<Goal[]>(goals);

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

  // ── Auth + user profile subscription ───────────────────────────────────
  useEffect(() => {
    let userUnsubscribe: (() => void) | null = null;

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
      } else {
        setDbUser(null);
        setGoals([]);
        setGoalsLoading(true);
        setGoalLimit(5);
        setHasMoreGoals(false);
        setCurrentScreen({ name: 'auth' });
        if (userUnsubscribe) userUnsubscribe();
      }
    });

    return () => {
      unsubscribeAuth();
      if (userUnsubscribe) userUnsubscribe();
    };
  }, []);

  // ── Goals subscription (paginated) ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setGoalsLoading(true);
    const q = query(
      collection(db, 'goals'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(goalLimit),
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const g = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
      goalsRef.current = g;
      setGoals(g);
      setGoalsLoading(false);
      // If we got exactly the limit there may be more; fewer means we've reached the end
      setHasMoreGoals(g.length === goalLimit);
      // Dedup by tempId only
      setOptimisticGoals(prev =>
        prev.filter(og => !g.some(rg => rg.tempId && rg.tempId === og.id))
      );
    }, (err) => handleFirestoreError(err, OperationType.GET, 'goals'));
    return () => unsub();
  }, [user, goalLimit]);

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

    const tQ = query(collectionGroup(db, 'tasks'), where('ownerId', '==', user.uid), limit(500));
    const unsubT = onSnapshot(tQ, (snap) => {
      latestTask = [];
      snap.docs.forEach(d => {
        const data = d.data() as GoalTask;
        if (!data.reminderAt) return;
        const goalId = d.ref.parent.parent?.id;
        const goal   = goalsRef.current.find(g => g.id === goalId);
        if (goal) latestTask.push({ task: { id: d.id, ...data }, goal, reminderAt: data.reminderAt });
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/tasks'));

    const nQ = query(collectionGroup(db, 'notes'), where('ownerId', '==', user.uid), limit(500));
    const unsubN = onSnapshot(nQ, (snap) => {
      latestNote = [];
      snap.docs.forEach(d => {
        const data  = d.data();
        if (!data.reminderAt) return;
        const taskR = d.ref.parent.parent;
        const goalR = taskR?.parent.parent;
        const goal  = goalsRef.current.find(g => g.id === goalR?.id);
        if (goal) latestNote.push({ task: { id: taskR?.id, text: 'Note Reminder' } as any, goal, reminderAt: data.reminderAt, noteText: data.text });
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/notes'));

    return () => { unsubT(); unsubN(); };
  }, [user]);

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
    updateOptimisticGoal(tempId, { savingStatus: 'saving', saveErrorMessage: undefined });

    try {
      // Single token reused across this save cycle — Firebase caches internally
      // but back-to-back awaits still serialise unnecessarily.
      const idToken = await user.getIdToken();
      const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` };

      // 1. Embedding — surface failure rather than silently saving without one
      let embedding: number[] | undefined;
      let embeddingFailed = false;
      try {
        const r = await fetch('/api/generate-embedding', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ text: structuredGoal.normalizedMatchingText }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        embedding = (await r.json()).embedding;
      } catch (e) {
        embeddingFailed = true;
        console.error('Embedding failed:', e);
      }

      // 2. Save goal doc — default visibility to 'public'
      const visibility = structuredGoal.privacy === 'private' ? 'private' : 'public';
      const goalRef = await addDoc(collection(db, 'goals'), {
        ownerId: user.uid,
        tempId,
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
          goalId: goalRef.id,
          ownerId: user.uid,
        });
      });
      manualTasks.forEach((text: string, i: number) => {
        const tRef = doc(collection(db, 'goals', goalRef.id, 'tasks'));
        batch.set(tRef, {
          text, isDone: false, order: structuredGoal.tasks.length + i,
          microSteps: [],
          createdAt: new Date().toISOString(),
          source: 'manual',
          goalId: goalRef.id,
          ownerId: user.uid,
        });
      });
      await batch.commit();

      if (embeddingFailed) {
        updateOptimisticGoal(tempId, {
          savingStatus: 'partial',
          saveErrorMessage: 'Saved, but no community room was matched. Open the goal to retry.',
        });
        return;
      }
      updateOptimisticGoal(tempId, { savingStatus: 'success' });

      // 4. Combined post-save: assign group + precompute matches + index — one
      //    round trip, one auth token, server runs them in the right order.
      if (embedding) {
        try {
          const res = await fetch('/api/goals/post-save', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ goalId: goalRef.id, embedding }),
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
          console.error('Post-save (group assign / index) failed', e);
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

  // ── Render ──────────────────────────────────────────────────────────────
  const isAuth = currentScreen.name === 'auth';

  return (
    <UserContext.Provider value={{ user, dbUser }}>
    <HomeEditModeProvider userId={user?.uid ?? null}>
    <div className="min-h-screen font-sans selection:bg-white selection:text-black"
         style={{ background: 'var(--c-bg)', color: 'var(--c-text)' }}>

      {/* ── Screens ─────────────────────────────────────────────────── */}
      <React.Suspense fallback={null}>
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
              goalsLoading={goalsLoading}
              hasMoreGoals={hasMoreGoals}
              loadMoreGoals={loadMoreGoals}
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
            <ProfileScreen user={user} dbUser={dbUser} onNavigateHome={() => navigate({ name: 'home' })} />
          </motion.div>
        )}

      </AnimatePresence>
      </React.Suspense>

      {/* ── Bottom navigation — sortable, edit-mode aware ──────────── */}
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
