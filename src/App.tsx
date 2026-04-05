import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, orderBy, setDoc, collectionGroup, addDoc, writeBatch, updateDoc } from 'firebase/firestore';
import { Goal, GoalTask, User, Group } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { 
  Users, 
  Settings, 
  Calendar as CalendarIcon
} from 'lucide-react';

const PandaIcon = ({ size = 24, active = false }: { size?: number, active?: boolean }) => (
  <div className={cn(
    "relative flex items-center justify-center transition-all duration-300",
    active ? "scale-110" : "hover:scale-105"
  )}>
    <svg width={size} height={size} viewBox="0 0 200 200" className={cn("transition-all duration-300", active ? "fill-black" : "fill-zinc-400 group-hover:fill-white")}>
      {/* Ears */}
      <circle cx="50" cy="50" r="25" />
      <circle cx="150" cy="50" r="25" />
      {/* Head */}
      <circle cx="100" cy="100" r="80" fill={active ? "white" : "none"} stroke={active ? "black" : "currentColor"} strokeWidth="8" />
      {/* Eye Patches */}
      <ellipse cx="70" cy="90" rx="20" ry="25" />
      <ellipse cx="130" cy="90" rx="20" ry="25" />
      {/* Nose */}
      <circle cx="100" cy="120" r="8" />
    </svg>
  </div>
);

const FootballIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m12 2-2.5 4.5L12 11l2.5-4.5L12 2Z" />
    <path d="m12 22-2.5-4.5L12 13l2.5 4.5L12 22Z" />
    <path d="m2 12 4.5-2.5L11 12l-4.5 2.5L2 12Z" />
    <path d="m22 12-4.5-2.5L13 12l4.5 2.5L22 12Z" />
  </svg>
);

import { HomeScreen } from './components/HomeScreen';
import { GoalsScreen } from './components/GoalsScreen';
import { CommunityScreen } from './components/CommunityScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { NavButton } from './components/NavButton';

type Screen = 'auth' | 'home' | 'goals' | 'community' | 'calendar' | 'profile';

interface ScreenState {
  name: Screen;
  groupId?: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

import { useTranslation } from './contexts/LanguageContext';

// FIX: groupsUnsubscribe is hoisted outside the effect so it can be
// properly cleaned up on logout and on effect teardown.
let groupsUnsubscribe: (() => void) | null = null;

export default function App() {
  const { t, setLanguage, language } = useTranslation();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [currentScreen, setCurrentScreen] = useState<ScreenState>({ name: 'auth' });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [allReminders, setAllReminders] = useState<{task: GoalTask, goal: Goal, reminderAt: string, noteText?: string}[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const [optimisticGoals, setOptimisticGoals] = useState<Goal[]>([]);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY < 10) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY.current) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  };

  useEffect(() => {
    let userUnsubscribe: (() => void) | null = null;
    let goalsUnsubscribe: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        userUnsubscribe = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setDbUser({ id: snap.id, ...snap.data() } as User);
          } else {
            const newUser: Partial<User> = {
              displayName: u.displayName || 'Anonymous',
              username: u.email?.split('@')[0] || 'user',
              avatarUrl: u.photoURL || undefined,
              blockedUsers: [],
              hiddenUsers: [],
              createdAt: new Date().toISOString(),
            };
            setDoc(userRef, newUser, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${u.uid}`));

        if (currentScreen.name === 'auth') setCurrentScreen({ name: 'home' });
        
        const q = query(collection(db, 'goals'), where('ownerId', '==', u.uid), orderBy('createdAt', 'desc'));
        goalsUnsubscribe = onSnapshot(q, (snapshot) => {
          const g = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
          setGoals(g);
          // Remove optimistic goals that now exist in the real goals list
          setOptimisticGoals(prev => prev.filter(og => !g.some(realG => realG.title === og.title && Math.abs(new Date(realG.createdAt).getTime() - new Date(og.createdAt).getTime()) < 5000)));
        }, (err) => handleFirestoreError(err, OperationType.GET, 'goals'));

        // FIX: Use the hoisted groupsUnsubscribe variable so it can be
        // cleaned up properly on logout and effect teardown.
        groupsUnsubscribe = onSnapshot(collection(db, 'groups'), (snapshot) => {
          const grps = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Group));
          setGroups(grps);
        }, (err) => handleFirestoreError(err, OperationType.GET, 'groups'));

      } else {
        setDbUser(null);
        setCurrentScreen({ name: 'auth' });
        if (userUnsubscribe) userUnsubscribe();
        if (goalsUnsubscribe) goalsUnsubscribe();
        // FIX: Clean up groups listener on logout
        if (groupsUnsubscribe) {
          groupsUnsubscribe();
          groupsUnsubscribe = null;
        }
      }
    });

    return () => {
      unsubscribeAuth();
      if (userUnsubscribe) userUnsubscribe();
      if (goalsUnsubscribe) goalsUnsubscribe();
      // FIX: Clean up groups listener on effect teardown
      if (groupsUnsubscribe) {
        groupsUnsubscribe();
        groupsUnsubscribe = null;
      }
    };
  }, []);

  // FIX: Reminders effect completely rewritten.
  // Old code used "await onSnapshot(...)" which is wrong — onSnapshot returns
  // an unsubscribe function, not a Promise. It also created a nested onSnapshot
  // with no cleanup, causing zombie listeners to stack on every calendar visit.
  //
  // New code: two separate onSnapshot calls, each properly cleaned up in the
  // effect's return function. State is merged in a shared recompute function.
  useEffect(() => {
    if (!user || currentScreen.name !== 'calendar') return;

    let latestTaskReminders: {task: GoalTask, goal: Goal, reminderAt: string}[] = [];
    let latestNoteReminders: {task: GoalTask, goal: Goal, reminderAt: string, noteText: string}[] = [];

    const recompute = () => {
      const merged = [...latestTaskReminders, ...latestNoteReminders];
      merged.sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime());
      setAllReminders(merged);
    };

    const tasksQuery = query(
      collectionGroup(db, 'tasks'),
      where('reminderAt', '!=', null)
    );

    const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
      latestTaskReminders = [];
      snapshot.docs.forEach(taskDoc => {
        const taskData = taskDoc.data() as GoalTask;
        const goalId = taskDoc.ref.parent.parent?.id;
        const goal = goals.find(g => g.id === goalId);
        if (goal && taskData.reminderAt) {
          latestTaskReminders.push({
            task: { id: taskDoc.id, ...taskData },
            goal,
            reminderAt: taskData.reminderAt
          });
        }
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/tasks'));

    const notesQuery = query(
      collectionGroup(db, 'notes'),
      where('reminderAt', '!=', null)
    );

    const unsubNotes = onSnapshot(notesQuery, (notesSnap) => {
      latestNoteReminders = [];
      notesSnap.docs.forEach(noteDoc => {
        const noteData = noteDoc.data();
        const taskRef = noteDoc.ref.parent.parent;
        const goalRef = taskRef?.parent.parent;
        const goal = goals.find(g => g.id === goalRef?.id);
        if (goal && noteData.reminderAt) {
          latestNoteReminders.push({
            task: { id: taskRef?.id, text: 'Note Reminder' } as any,
            goal,
            reminderAt: noteData.reminderAt,
            noteText: noteData.text
          });
        }
      });
      recompute();
    }, (err) => handleFirestoreError(err, OperationType.GET, 'reminders/notes'));

    // FIX: Both listeners are properly cleaned up when screen changes or user logs out.
    return () => {
      unsubTasks();
      unsubNotes();
    };
  }, [user, currentScreen.name, goals]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'auth_popup');
    }
  };

  const reportUser = async (reportedUserId: string, messageId: string, reason: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: user.uid,
        reportedUserId,
        messageId,
        reason,
        createdAt: new Date().toISOString(),
        status: 'pending'
      });
      alert("User reported successfully. Our moderators will review the content.");
    } catch (error) {
      console.error("Error reporting user:", error);
    }
  };

  const addOptimisticGoal = (goal: Goal) => {
    setOptimisticGoals(prev => [goal, ...prev]);
  };

  const updateOptimisticGoal = (tempId: string, updates: Partial<Goal>) => {
    setOptimisticGoals(prev => prev.map(g => g.id === tempId ? { ...g, ...updates } : g));
  };

  const removeOptimisticGoal = (tempId: string) => {
    setOptimisticGoals(prev => prev.filter(g => g.id !== tempId));
  };

  const performSaveGoal = async (goal: Goal) => {
    if (!user || !goal.draftData) return;
    
    const { structuredGoal, manualTasks } = goal.draftData;
    const tempId = goal.id;
    
    updateOptimisticGoal(tempId, { savingStatus: 'saving' });

    try {
      // 1. Generate embedding
      let embedding: number[] | undefined;
      try {
        const idToken = await user.getIdToken();
        const embRes = await fetch("/api/generate-embedding", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`
          },
          body: JSON.stringify({ text: structuredGoal.normalizedMatchingText })
        });
        if (embRes.ok) {
          const embData = await embRes.json();
          embedding = embData.embedding;
        }
      } catch (embErr) {
        console.error("Failed to generate embedding during save:", embErr);
      }

      // 2. Save goal document
      const goalData = {
        ownerId: user.uid,
        title: structuredGoal.goalTitle,
        description: structuredGoal.goalDescription,
        category: structuredGoal.category,
        tags: structuredGoal.tags,
        timeHorizon: structuredGoal.timeHorizon,
        progressPercent: 0,
        status: 'active',
        visibility: structuredGoal.privacy,
        publicFields: structuredGoal.privacy === 'public' ? ['title', 'description', 'tasks', 'progress'] : [],
        createdAt: goal.createdAt,
        sourceText: structuredGoal.transcript,
        normalizedMatchingText: structuredGoal.normalizedMatchingText,
        embedding,
        embeddingUpdatedAt: embedding ? new Date().toISOString() : undefined,
        matchingMetadata: {
          age: dbUser?.age ?? null,
          locality: dbUser?.locality ?? null
        }
      };

      const goalRef = await addDoc(collection(db, 'goals'), goalData);
      
      // 3. Save tasks
      const batch = writeBatch(db);
      const allTasks = [...structuredGoal.suggestedTasks, ...manualTasks];
      
      allTasks.forEach((taskText, index) => {
        const taskRef = doc(collection(db, 'goals', goalRef.id, 'tasks'));
        batch.set(taskRef, {
          text: taskText,
          isDone: false,
          order: index,
          createdAt: new Date().toISOString(),
          source: structuredGoal.suggestedTasks.includes(taskText) ? 'ai' : 'manual'
        });
      });

      await batch.commit();
      updateOptimisticGoal(tempId, { savingStatus: 'success' });

      // 4. Assign to group (server handles all writes — no client updateDoc needed)
      if (embedding) {
        try {
          const idToken = await user.getIdToken();
          await fetch("/api/groups/assign", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
              goalId: goalRef.id
            })
          });
          // FIX: Removed the duplicate client-side updateDoc that used to follow here.
          // The server's /api/groups/assign already writes groupId, eligibleAt, and
          // groupJoined atomically inside a transaction. The old client write was
          // a non-transactional overwrite that could race with the server.

          // 5. Precompute similarity
          try {
            const idToken2 = await user.getIdToken();
            await fetch("/api/goals/precompute", {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken2}`
              },
              body: JSON.stringify({
                goalId: goalRef.id,
                embedding
              })
            });
          } catch (precomputeErr) {
            console.error("Failed to precompute similarity:", precomputeErr);
          }
        } catch (assignErr) {
          console.error("Failed to assign group:", assignErr);
        }
      }
    } catch (err) {
      console.error('Save error:', err);
      updateOptimisticGoal(tempId, { savingStatus: 'error' });
    }
  };

  const displayGoals = React.useMemo(() => {
    return [...optimisticGoals, ...goals];
  }, [optimisticGoals, goals]);

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white selection:text-black">
      {/* Top Bar for Language Toggle */}
      {currentScreen.name !== 'auth' && language !== 'en' && (
        <div className="fixed top-0 left-0 right-0 z-[60] p-2 flex justify-center">
          <button 
            onClick={() => setLanguage('en')}
            className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all"
          >
            {t('changeToEnglish')}
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {currentScreen.name === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center h-screen p-6 text-center"
          >
            <h1 className="text-5xl font-bold tracking-tighter mb-4">{t('appName')}</h1>
            <p className="text-zinc-400 max-w-xs mb-12">{t('authSubtitle')}</p>
            <button
              onClick={handleLogin}
              className="px-8 py-4 bg-white text-black rounded-full font-semibold hover:bg-zinc-200 transition-colors flex items-center gap-3"
            >
              {t('continueWithGoogle')}
            </button>
          </motion.div>
        )}

        {currentScreen.name === 'home' && (
          <HomeScreen 
            user={user} 
            dbUser={dbUser} 
            setCurrentScreen={(s) => setCurrentScreen(typeof s === 'string' ? { name: s } : s)} 
            handleFirestoreError={handleFirestoreError}
            addOptimisticGoal={addOptimisticGoal}
            performSaveGoal={performSaveGoal}
          />
        )}

        {currentScreen.name === 'goals' && (
          <GoalsScreen 
            goals={displayGoals} 
            activeGoal={activeGoal} 
            setActiveGoal={setActiveGoal} 
            focusedTaskId={focusedTaskId} 
            setFocusedTaskId={setFocusedTaskId} 
            handleFirestoreError={handleFirestoreError} 
            setCurrentScreen={(s) => setCurrentScreen(typeof s === 'string' ? { name: s } : s)}
            onRetrySave={performSaveGoal}
          />
        )}

        {currentScreen.name === 'community' && user && (
          <CommunityScreen 
            user={user} 
            dbUser={dbUser} 
            handleFirestoreError={handleFirestoreError} 
            reportUser={reportUser} 
          />
        )}

        {currentScreen.name === 'calendar' && (
          <CalendarScreen 
            allReminders={allReminders} 
            goals={goals} 
            setActiveGoal={setActiveGoal} 
            setFocusedTaskId={setFocusedTaskId} 
            setCurrentScreen={(s) => setCurrentScreen(typeof s === 'string' ? { name: s } : s)} 
          />
        )}

        {currentScreen.name === 'profile' && (
          <ProfileScreen user={user} dbUser={dbUser} />
        )}
      </AnimatePresence>

      {currentScreen.name !== 'auth' && (
        <motion.div 
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-full max-w-[320px] px-4"
          initial={false}
          animate={{ 
            y: isVisible ? 0 : 100,
            opacity: isVisible ? 1 : 0,
            scale: isVisible ? 1 : 0.9
          }}
          transition={{ 
            type: "spring", 
            stiffness: 300, 
            damping: 30 
          }}
        >
          <nav className="bg-zinc-900/70 backdrop-blur-2xl border border-white/5 rounded-full p-1.5 flex items-center justify-between shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
            <NavButton 
              active={currentScreen.name === 'calendar'} 
              icon={<CalendarIcon size={18} />} 
              onClick={() => setCurrentScreen({ name: 'calendar' })} 
            />
            <NavButton 
              active={currentScreen.name === 'community'} 
              icon={<Users size={18} />} 
              onClick={() => setCurrentScreen({ name: 'community' })} 
            />
            
            <div className="relative">
              <button
                onClick={() => setCurrentScreen({ name: 'home' })}
                className={cn(
                  "group relative flex items-center justify-center w-11 h-11 rounded-full transition-all duration-500 shadow-xl",
                  currentScreen.name === 'home' 
                    ? "bg-white text-black scale-110" 
                    : "bg-zinc-800/90 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                )}
              >
                <PandaIcon size={22} active={currentScreen.name === 'home'} />
                {currentScreen.name === 'home' && (
                  <motion.div
                    layoutId="active-glow"
                    className="absolute inset-0 rounded-full bg-white/40 blur-md -z-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  />
                )}
              </button>
            </div>

            <NavButton 
              active={currentScreen.name === 'goals'} 
              icon={<FootballIcon size={18} />} 
              onClick={() => setCurrentScreen({ name: 'goals' })} 
            />
            <NavButton 
              active={currentScreen.name === 'profile'} 
              icon={<Settings size={18} />} 
              onClick={() => setCurrentScreen({ name: 'profile' })} 
            />
          </nav>
        </motion.div>
      )}
    </div>
  );
}