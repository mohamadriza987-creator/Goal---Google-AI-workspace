import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Shield, MoreHorizontal, LogOut, Plus, RefreshCw, Search, Target, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { Goal, Group, User } from '../types';
import { getDocs, updateDoc, doc as firestoreDoc, writeBatch, setDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface ProfileScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
}

import { useTranslation } from '../contexts/LanguageContext';

export function ProfileScreen({ user, dbUser }: ProfileScreenProps) {
  const { t, language, setLanguage } = useTranslation();
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [syncProgress, setSyncProgress] = React.useState(0);
  const [syncTotal, setSyncTotal] = React.useState(0);
  const [showGoalMap, setShowGoalMap] = React.useState(false);
  const [allGoals, setAllGoals] = React.useState<Goal[]>([]);
  const [allGroups, setAllGroups] = React.useState<Group[]>([]);
  const [showModeration, setShowModeration] = React.useState(false);
  const [reports, setReports] = React.useState<any[]>([]);

  const isAdminUser = dbUser?.role === 'admin' || user?.email === 'mohamadriza987@gmail.com';

  React.useEffect(() => {
    if (showModeration && isAdminUser) {
      const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(50));
      const unsubscribe = onSnapshot(q, (snap) => {
        setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return () => unsubscribe();
    }
  }, [showModeration, isAdminUser]);

  React.useEffect(() => {
    if (showGoalMap) {
      const unsubGoals = onSnapshot(collection(db, 'goals'), (snap) => {
        setAllGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
      });
      const unsubGroups = onSnapshot(collection(db, 'groups'), (snap) => {
        setAllGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group)));
      });
      return () => {
        unsubGoals();
        unsubGroups();
      };
    }
  }, [showGoalMap]);

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      await updateDoc(firestoreDoc(db, 'reports', reportId), { status, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Error resolving report:", err);
    }
  };

  const handleFullSync = async () => {
    if (!user || isSyncing) return;
    const confirm = window.confirm("This will reconcile all goals: Normalization -> Embedding -> Similarity -> Grouping. This ensures everyone is connected. Continue?");
    if (!confirm) return;

    setIsSyncing(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`Reconciliation complete! Processed ${data.processed} goals.`);
      } else {
        const errData = await res.json();
        alert("Reconciliation failed: " + (errData.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Sync error:", err);
      alert("Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto p-6 pt-12 pb-32"
    >
      <div className="flex flex-col items-center text-center mb-12">
        <div className="w-24 h-24 rounded-full bg-zinc-800 mb-4" />
        <h2 className="text-2xl font-bold break-words w-full">{user?.displayName}</h2>
        <p className="text-zinc-500 text-sm break-words w-full">@{user?.email?.split('@')[0]}</p>
      </div>

      <div className="space-y-4">
        <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Plus size={20} />
            </div>
            <div className="flex-1">
              <p className="font-semibold">{t('language')}</p>
              <p className="text-xs text-zinc-500">{t('selectLanguage')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { code: 'en', name: 'English' },
              { code: 'es', name: 'Español' },
              { code: 'fr', name: 'Français' },
              { code: 'hi', name: 'हिन्दी' }
            ].map((lang) => (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code as any)}
                className={cn(
                  "py-3 px-4 rounded-2xl text-sm font-medium transition-all border",
                  language === lang.code 
                    ? "bg-white text-black border-white" 
                    : "bg-zinc-800/50 text-zinc-400 border-zinc-700 hover:border-zinc-500"
                )}
              >
                {lang.name}
              </button>
            ))}
          </div>
        </div>

        {user?.email === 'mohamadriza987@gmail.com' && (
          <div className="space-y-2">
            <button 
              onClick={handleFullSync}
              disabled={isSyncing}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn(isSyncing && "animate-spin")} />
              <div className="flex-1 text-left">
                <p className="font-semibold">Sync All Goals</p>
                <p className="text-xs text-zinc-500">
                  {isSyncing ? `Processing... (${syncProgress}/${syncTotal})` : 'Normalize, Embed, and Group all goals'}
                </p>
              </div>
            </button>

            <button 
              onClick={() => setShowGoalMap(!showGoalMap)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Search />
              <div className="flex-1 text-left">
                <p className="font-semibold">Global Goal Map</p>
                <p className="text-xs text-zinc-500">View all goals organized by similarity</p>
              </div>
            </button>

            {showGoalMap && (
              <GlobalGoalMap allGoals={allGoals} allGroups={allGroups} />
            )}

            <button 
              onClick={() => setShowModeration(!showModeration)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Shield />
              <span className="font-semibold">Moderation Dashboard</span>
            </button>

            {showModeration && isAdminUser && (
              <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
                <h3 className="font-bold text-lg">Reported Content</h3>
                <div className="space-y-4">
                  {reports.length === 0 ? (
                    <p className="text-zinc-500 italic text-sm">No pending reports.</p>
                  ) : (
                    reports.map(report => (
                      <div key={report.id} className="p-4 bg-zinc-800/50 border border-zinc-700 rounded-2xl space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Report #{report.id.slice(0, 6)}</span>
                          <span className={cn(
                            "text-[8px] px-2 py-0.5 rounded-full uppercase font-bold",
                            report.status === 'pending' ? "bg-yellow-500/20 text-yellow-500" : "bg-green-500/20 text-green-500"
                          )}>
                            {report.status}
                          </span>
                        </div>
                        <p className="text-sm font-medium">Reason: {report.reason}</p>
                        <p className="text-xs text-zinc-400">Reported User: {report.reportedUserId}</p>
                        {report.messageId && <p className="text-xs text-zinc-500 italic">Message ID: {report.messageId}</p>}
                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => handleResolveReport(report.id, 'resolved')}
                            className="flex-1 py-2 bg-white text-black rounded-xl text-[10px] font-bold uppercase"
                          >
                            Mark Resolved
                          </button>
                          <button 
                            onClick={() => handleResolveReport(report.id, 'dismissed')}
                            className="flex-1 py-2 bg-zinc-800 text-white rounded-xl text-[10px] font-bold uppercase"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Shield className="text-zinc-500" />
            <div>
              <p className="font-semibold">{t('privacy')}</p>
              <p className="text-xs text-zinc-500">Manage blocked and hidden users</p>
            </div>
          </div>
          <button className="text-zinc-500 hover:text-white"><MoreHorizontal /></button>
        </div>
        <button 
          onClick={() => auth.signOut()}
          className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <LogOut />
          <span className="font-semibold">{t('signOut')}</span>
        </button>
      </div>
    </motion.div>
  );
}

function GlobalGoalMap({ allGoals, allGroups }: { allGoals: Goal[], allGroups: Group[] }) {
  const groupedGoals = React.useMemo(() => {
    const groups: { [key: string]: Goal[] } = { 'ungrouped': [] };
    allGoals.forEach(g => {
      if (g.groupId) {
        if (!groups[g.groupId]) groups[g.groupId] = [];
        groups[g.groupId].push(g);
      } else {
        groups['ungrouped'].push(g);
      }
    });
    return groups;
  }, [allGoals]);

  return (
    <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-8">
      <h3 className="font-bold text-lg flex items-center gap-2">
        <Users size={20} /> Community Clusters
      </h3>
      
      <div className="space-y-6">
        {Object.entries(groupedGoals).map(([groupId, goals]) => {
          const group = allGroups.find(g => g.id === groupId);
          if (groupId === 'ungrouped' && goals.length === 0) return null;

          return (
            <div key={groupId} className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                  {groupId === 'ungrouped' ? 'Ungrouped Goals' : `Community: ${group?.derivedGoalTheme || groupId}`}
                </h4>
                <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-400">
                  {goals.length} goals
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {goals.map(g => (
                  <div key={g.id} className="p-4 bg-zinc-800/30 border border-zinc-800 rounded-2xl flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{g.title}</p>
                      <p className="text-[10px] text-zinc-500 mt-1 italic truncate">"{g.normalizedMatchingText}"</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold text-zinc-600">User: {g.ownerId.slice(0, 6)}</span>
                      <span className={cn(
                        "text-[8px] px-1.5 py-0.5 rounded-full uppercase font-bold",
                        g.visibility === 'private' ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
                      )}>
                        {g.visibility}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
