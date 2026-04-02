import React, { useState, useEffect } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, orderBy, setDoc, collectionGroup, addDoc } from 'firebase/firestore';
import { Goal, GoalTask, User } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Users, 
  Settings, 
  Calendar as CalendarIcon,
  CheckCircle2,
  Mic
} from 'lucide-react';

import { HomeScreen } from './components/HomeScreen';
import { GoalsScreen } from './components/GoalsScreen';
import { CommunityScreen } from './components/CommunityScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { NavButton } from './components/NavButton';

type Screen = 'auth' | 'home' | 'goals' | 'community' | 'calendar' | 'profile';

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

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>('auth');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [allReminders, setAllReminders] = useState<{task: GoalTask, goal: Goal, reminderAt: string, noteText?: string}[]>([]);

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

        if (currentScreen === 'auth') setCurrentScreen('home');
        
        const q = query(collection(db, 'goals'), where('ownerId', '==', u.uid), orderBy('createdAt', 'desc'));
        goalsUnsubscribe = onSnapshot(q, (snapshot) => {
          const g = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
          setGoals(g);
        }, (err) => handleFirestoreError(err, OperationType.GET, 'goals'));

      } else {
        setDbUser(null);
        setCurrentScreen('auth');
        if (userUnsubscribe) userUnsubscribe();
        if (goalsUnsubscribe) goalsUnsubscribe();
      }
    });

    return () => {
      unsubscribeAuth();
      if (userUnsubscribe) userUnsubscribe();
      if (goalsUnsubscribe) goalsUnsubscribe();
    };
  }, []);

  // Fetch all reminders for calendar
  useEffect(() => {
    if (!user || currentScreen !== 'calendar') return;

    const fetchAllReminders = async () => {
      try {
        const tasksQuery = query(collectionGroup(db, 'tasks'), where('reminderAt', '!=', null));
        const tasksSnap = await onSnapshot(tasksQuery, (snapshot) => {
          const reminders: any[] = [];
          snapshot.docs.forEach(taskDoc => {
            const taskData = taskDoc.data() as GoalTask;
            const goalId = taskDoc.ref.parent.parent?.id;
            const goal = goals.find(g => g.id === goalId);
            if (goal && taskData.reminderAt) {
              reminders.push({ task: { id: taskDoc.id, ...taskData }, goal, reminderAt: taskData.reminderAt });
            }
          });

          // Also fetch notes with reminders
          const notesQuery = query(collectionGroup(db, 'notes'), where('reminderAt', '!=', null));
          onSnapshot(notesQuery, (notesSnap) => {
            notesSnap.docs.forEach(noteDoc => {
              const noteData = noteDoc.data();
              const taskRef = noteDoc.ref.parent.parent;
              const goalRef = taskRef?.parent.parent;
              const goal = goals.find(g => g.id === goalRef?.id);
              if (goal && noteData.reminderAt) {
                reminders.push({ 
                  task: { id: taskRef?.id, text: 'Note Reminder' } as any, 
                  goal, 
                  reminderAt: noteData.reminderAt,
                  noteText: noteData.text 
                });
              }
            });
            setAllReminders(reminders.sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime()));
          });
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'reminders');
      }
    };

    fetchAllReminders();
  }, [user, currentScreen, goals]);

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

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white selection:text-black">
      <AnimatePresence mode="wait">
        {currentScreen === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center h-screen p-6 text-center"
          >
            <h1 className="text-5xl font-bold tracking-tighter mb-4">Project Goal</h1>
            <p className="text-zinc-400 max-w-xs mb-12">Speak your intent. Let AI structure your path. Join the community.</p>
            <button
              onClick={handleLogin}
              className="px-8 py-4 bg-white text-black rounded-full font-semibold hover:bg-zinc-200 transition-colors flex items-center gap-3"
            >
              Continue with Google
            </button>
          </motion.div>
        )}

        {currentScreen === 'home' && (
          <HomeScreen 
            user={user} 
            dbUser={dbUser} 
            setCurrentScreen={setCurrentScreen} 
            handleFirestoreError={handleFirestoreError} 
          />
        )}

        {currentScreen === 'goals' && (
          <GoalsScreen 
            goals={goals} 
            activeGoal={activeGoal} 
            setActiveGoal={setActiveGoal} 
            focusedTaskId={focusedTaskId} 
            setFocusedTaskId={setFocusedTaskId} 
            handleFirestoreError={handleFirestoreError} 
            setCurrentScreen={setCurrentScreen}
          />
        )}

        {currentScreen === 'community' && user && (
          <CommunityScreen 
            user={user} 
            dbUser={dbUser} 
            handleFirestoreError={handleFirestoreError} 
            reportUser={reportUser} 
          />
        )}

        {currentScreen === 'calendar' && (
          <CalendarScreen 
            allReminders={allReminders} 
            goals={goals} 
            setActiveGoal={setActiveGoal} 
            setFocusedTaskId={setFocusedTaskId} 
            setCurrentScreen={setCurrentScreen} 
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen user={user} />
        )}
      </AnimatePresence>

      {currentScreen !== 'auth' && (
        <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-full p-2 flex items-center gap-2 shadow-2xl z-50">
          <NavButton active={currentScreen === 'home'} icon={<Mic size={24} />} onClick={() => setCurrentScreen('home')} />
          <NavButton active={currentScreen === 'goals'} icon={<CheckCircle2 size={24} />} onClick={() => setCurrentScreen('goals')} />
          <NavButton active={currentScreen === 'community'} icon={<Users size={24} />} onClick={() => setCurrentScreen('community')} />
          <NavButton active={currentScreen === 'calendar'} icon={<CalendarIcon size={24} />} onClick={() => setCurrentScreen('calendar')} />
          <NavButton active={currentScreen === 'profile'} icon={<Settings size={24} />} onClick={() => setCurrentScreen('profile')} />
        </nav>
      )}
    </div>
  );
}
