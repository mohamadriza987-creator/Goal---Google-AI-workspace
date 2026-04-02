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
  const [isBackfilling, setIsBackfilling] = React.useState(false);
  const [backfillProgress, setBackfillProgress] = React.useState(0);
  const [backfillTotal, setBackfillTotal] = React.useState(0);
  const [isBackfillingEmbeddings, setIsBackfillingEmbeddings] = React.useState(false);
  const [embBackfillProgress, setEmbBackfillProgress] = React.useState(0);
  const [embBackfillTotal, setEmbBackfillTotal] = React.useState(0);
  const [showSimilarityChecker, setShowSimilarityChecker] = React.useState(false);
  const [selectedGoalForMatch, setSelectedGoalForMatch] = React.useState<Goal | null>(null);
  const [similarMatches, setSimilarMatches] = React.useState<any[]>([]);
  const [isMatching, setIsMatching] = React.useState(false);
  const [allGoals, setAllGoals] = React.useState<Goal[]>([]);
  const [allGroups, setAllGroups] = React.useState<Group[]>([]);
  const [isBackfillingGroups, setIsBackfillingGroups] = React.useState(false);
  const [groupBackfillProgress, setGroupBackfillProgress] = React.useState(0);
  const [groupBackfillTotal, setGroupBackfillTotal] = React.useState(0);
  const [showGroupInspector, setShowGroupInspector] = React.useState(false);
  const [selectedGroupForInspect, setSelectedGroupForInspect] = React.useState<Group | null>(null);
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

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      await updateDoc(firestoreDoc(db, 'reports', reportId), { status, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Error resolving report:", err);
    }
  };

  React.useEffect(() => {
    if (showSimilarityChecker || showGroupInspector) {
      getDocs(collection(db, 'goals')).then(snap => {
        setAllGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
      });
      getDocs(collection(db, 'groups')).then(snap => {
        setAllGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group)));
      });
    }
  }, [showSimilarityChecker, showGroupInspector]);

  const handleGroupBackfill = async () => {
    if (!user || isBackfillingGroups) return;
    
    const confirm = window.confirm("This will iterate through all goals and assign them to groups based on similarity. Continue?");
    if (!confirm) return;

    setIsBackfillingGroups(true);
    setGroupBackfillProgress(0);
    
    try {
      const goalsSnap = await getDocs(collection(db, 'goals'));
      const goalsToAssign = goalsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Goal))
        .filter(g => g.embedding && !g.groupId);
      
      const groupsSnap = await getDocs(collection(db, 'groups'));
      let currentGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Group));
      
      setGroupBackfillTotal(goalsToAssign.length);

      for (const goal of goalsToAssign) {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch("/api/groups/assign", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
              goal
            })
          });

          if (res.ok) {
            const data = await res.json();
            if (data.action === 'assigned') {
              await updateDoc(firestoreDoc(db, 'goals', goal.id), { groupId: data.groupId });
              await updateDoc(firestoreDoc(db, 'groups', data.groupId), { memberCount: (currentGroups.find(g => g.id === data.groupId)?.memberCount || 0) + 1 });
              // Add user to members subcollection
              await updateDoc(firestoreDoc(db, 'groups', data.groupId), {
                [`members.${goal.ownerId}`]: {
                  userId: goal.ownerId,
                  joinedAt: new Date().toISOString()
                }
              }).catch(async () => {
                // Fallback if members is not a map or doesn't exist yet
                // Actually, the rules say it's a subcollection.
                await setDoc(firestoreDoc(db, 'groups', data.groupId, 'members', goal.ownerId), {
                  userId: goal.ownerId,
                  joinedAt: new Date().toISOString()
                });
              });
            } else if (data.action === 'create') {
              const newGroupRef = await addDoc(collection(db, 'groups'), {
                derivedGoalTheme: data.groupName,
                memberCount: data.memberGoalIds.length,
                maxMembers: 70,
                representativeEmbedding: data.representativeEmbedding,
                matchingCriteria: data.matchingCriteria,
                createdAt: new Date().toISOString()
              });
              
              const newGroup = { id: newGroupRef.id, derivedGoalTheme: data.groupName, memberCount: data.memberGoalIds.length, representativeEmbedding: data.representativeEmbedding } as Group;
              currentGroups.push(newGroup);

              const batch = writeBatch(db);
              data.memberGoalIds.forEach((gid: string) => {
                batch.update(firestoreDoc(db, 'goals', gid), { groupId: newGroupRef.id });
                // We also need to add each goal owner to the members subcollection
                const goalToAssign = goalsSnap.docs.find(d => d.id === gid)?.data() as Goal;
                if (goalToAssign) {
                  batch.set(firestoreDoc(db, 'groups', newGroupRef.id, 'members', goalToAssign.ownerId), {
                    userId: goalToAssign.ownerId,
                    joinedAt: new Date().toISOString()
                  });
                }
              });
              
              const msgRef = collection(db, 'groups', newGroupRef.id, 'messages');
              batch.set(firestoreDoc(msgRef), {
                groupId: newGroupRef.id,
                userId: 'system',
                content: `Welcome to the ${data.groupName} community! We've grouped you together because of your similar goals.`,
                contentType: 'text',
                reactions: {},
                createdAt: new Date().toISOString()
              });
              await batch.commit();
            }
          }
          setGroupBackfillProgress(prev => prev + 1);
        } catch (err) {
          console.error(`Error assigning goal ${goal.id}:`, err);
        }
      }
      alert("Group backfill complete!");
    } catch (err) {
      console.error("Group backfill error:", err);
    } finally {
      setIsBackfillingGroups(false);
    }
  };

  const handleMembersBackfill = async () => {
    if (!user || isBackfillingGroups) return;
    const confirm = window.confirm("This will ensure all users with goals in a group are added to the members subcollection. Continue?");
    if (!confirm) return;

    setIsBackfillingGroups(true);
    try {
      const goalsSnap = await getDocs(collection(db, 'goals'));
      const goalsWithGroups = goalsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Goal))
        .filter(g => g.groupId);
      
      for (const goal of goalsWithGroups) {
        if (goal.groupId) {
          await setDoc(firestoreDoc(db, 'groups', goal.groupId, 'members', goal.ownerId), {
            userId: goal.ownerId,
            joinedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
      alert("Members backfill complete!");
    } catch (err) {
      console.error("Members backfill error:", err);
    } finally {
      setIsBackfillingGroups(false);
    }
  };

  const handleMatchCheck = async (goal: Goal) => {
    if (!goal.embedding) {
      alert("This goal has no embedding yet. Backfill embeddings first.");
      return;
    }
    setSelectedGoalForMatch(goal);
    setIsMatching(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/goals/similar", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          goalId: goal.id,
          embedding: goal.embedding
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSimilarMatches(data.matches);
      }
    } catch (err) {
      console.error("Match error:", err);
    } finally {
      setIsMatching(false);
    }
  };

  const handleEmbeddingBackfill = async () => {
    if (!user || isBackfillingEmbeddings) return;
    
    const confirm = window.confirm("This will generate embeddings for ALL goals that don't have one. Continue?");
    if (!confirm) return;

    setIsBackfillingEmbeddings(true);
    setEmbBackfillProgress(0);
    
    try {
      const goalsSnap = await getDocs(collection(db, 'goals'));
      const goalsToBackfill = goalsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Goal))
        .filter(g => g.normalizedMatchingText && !g.embedding);
      
      setEmbBackfillTotal(goalsToBackfill.length);

      if (goalsToBackfill.length === 0) {
        alert("All goals already have embeddings!");
        setIsBackfillingEmbeddings(false);
        return;
      }

      for (const goal of goalsToBackfill) {
        try {
          const idToken = await user.getIdToken();
          const response = await fetch("/api/generate-embedding", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({ text: goal.normalizedMatchingText })
          });

          if (response.ok) {
            const { embedding } = await response.json();
            await updateDoc(firestoreDoc(db, 'goals', goal.id), {
              embedding,
              embeddingUpdatedAt: new Date().toISOString()
            });
          }
          setEmbBackfillProgress(prev => prev + 1);
        } catch (err) {
          console.error(`Error embedding goal ${goal.id}:`, err);
        }
      }
      alert(`Embedding backfill complete! Processed ${goalsToBackfill.length} goals.`);
    } catch (err) {
      console.error("Embedding backfill error:", err);
    } finally {
      setIsBackfillingEmbeddings(false);
    }
  };

  const handleBackfill = async () => {
    if (!user || isBackfilling) return;
    
    const confirm = window.confirm("This will iterate through ALL goals in the database and generate normalized matching metadata. This may take a while and consume API quota. Continue?");
    if (!confirm) return;

    setIsBackfilling(true);
    setBackfillProgress(0);
    
    try {
      const goalsSnap = await getDocs(collection(db, 'goals'));
      const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
      
      // Filter goals that need backfill (either missing normalizedMatchingText or missing sourceText)
      const goalsToBackfill = allGoals.filter(g => !g.normalizedMatchingText);
      setBackfillTotal(goalsToBackfill.length);

      if (goalsToBackfill.length === 0) {
        alert("All goals are already normalized!");
        setIsBackfilling(false);
        return;
      }

      for (const goal of goalsToBackfill) {
        try {
          const idToken = await user.getIdToken();
          const response = await fetch("/api/normalize-goal", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
              goalData: {
                title: goal.title,
                description: goal.description,
                category: goal.category || 'other',
                tags: goal.tags || [],
                timeHorizon: goal.timeHorizon || 'unknown',
                privacy: goal.visibility,
                sourceText: goal.sourceText || goal.originalVoiceTranscript || `${goal.title}: ${goal.description}`
              }
            })
          });

          if (response.ok) {
            const { normalizedMatchingText } = await response.json();
            await updateDoc(firestoreDoc(db, 'goals', goal.id), {
              normalizedMatchingText,
              sourceText: goal.sourceText || goal.originalVoiceTranscript || `${goal.title}: ${goal.description}`,
              updatedAt: new Date().toISOString()
            });
          }
          
          setBackfillProgress(prev => prev + 1);
        } catch (err) {
          console.error(`Error backfilling goal ${goal.id}:`, err);
        }
      }
      
      alert(`Backfill complete! Processed ${goalsToBackfill.length} goals.`);
    } catch (err) {
      console.error("Backfill error:", err);
      alert("Failed to backfill goals. Check console for details.");
    } finally {
      setIsBackfilling(false);
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
              onClick={async () => {
                const groupRef = await addDoc(collection(db, 'groups'), {
                  derivedGoalTheme: 'Learning & Growth',
                  localityCenter: 'Global',
                  memberCount: 1,
                  maxMembers: 70,
                  createdAt: new Date().toISOString(),
                });
                await addDoc(collection(db, 'groups', groupRef.id, 'messages'), {
                  groupId: groupRef.id,
                  userId: 'system',
                  content: 'Welcome to the Learning & Growth group! Share your goals and progress here.',
                  contentType: 'text',
                  reactions: {},
                  createdAt: new Date().toISOString(),
                });
                alert('Demo group created!');
              }}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Plus />
              <span className="font-semibold">Create Demo Group</span>
            </button>

            <button 
              onClick={handleBackfill}
              disabled={isBackfilling}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn(isBackfilling && "animate-spin")} />
              <span className="font-semibold">
                {isBackfilling ? `Normalizing... (${backfillProgress}/${backfillTotal})` : 'Backfill All Normalization'}
              </span>
            </button>

            <button 
              onClick={handleEmbeddingBackfill}
              disabled={isBackfillingEmbeddings}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Target className={cn(isBackfillingEmbeddings && "animate-spin")} />
              <span className="font-semibold">
                {isBackfillingEmbeddings ? `Embedding... (${embBackfillProgress}/${embBackfillTotal})` : 'Backfill All Embeddings'}
              </span>
            </button>

            <button 
              onClick={() => setShowSimilarityChecker(!showSimilarityChecker)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Search />
              <span className="font-semibold">Similarity Verification Tool</span>
            </button>

            <button 
              onClick={handleGroupBackfill}
              disabled={isBackfillingGroups}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Users className={cn(isBackfillingGroups && "animate-spin")} />
              <span className="font-semibold">
                {isBackfillingGroups ? `Grouping... (${groupBackfillProgress}/${groupBackfillTotal})` : 'Backfill Group Assignments'}
              </span>
            </button>

            <button 
              onClick={handleMembersBackfill}
              disabled={isBackfillingGroups}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Users className={cn(isBackfillingGroups && "animate-spin")} />
              <span className="font-semibold">
                {isBackfillingGroups ? 'Backfilling Members...' : 'Backfill Group Memberships'}
              </span>
            </button>

            <button 
              onClick={() => setShowGroupInspector(!showGroupInspector)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Users />
              <span className="font-semibold">Group Inspector (Admin)</span>
            </button>

            {showGroupInspector && (
              <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
                <h3 className="font-bold text-lg">Active Communities:</h3>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                  {allGroups.map(grp => (
                    <button
                      key={grp.id}
                      onClick={() => setSelectedGroupForInspect(grp)}
                      className={cn(
                        "w-full text-left p-3 rounded-xl border transition-all text-sm",
                        selectedGroupForInspect?.id === grp.id ? "bg-white text-black border-white" : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-500"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <p className="font-bold">{grp.derivedGoalTheme}</p>
                        <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded-full">{grp.memberCount} members</span>
                      </div>
                      <p className="text-[10px] opacity-60 mt-1">ID: {grp.id}</p>
                    </button>
                  ))}
                </div>

                {selectedGroupForInspect && (
                  <div className="mt-6 space-y-4 border-t border-zinc-800 pt-4">
                    <h4 className="font-bold">Members of "{selectedGroupForInspect.derivedGoalTheme}"</h4>
                    <div className="space-y-2">
                      {allGoals.filter(g => g.groupId === selectedGroupForInspect.id).map(g => (
                        <div key={g.id} className="p-3 bg-zinc-800/30 border border-zinc-800 rounded-xl text-xs">
                          <p className="font-bold">{g.title}</p>
                          <p className="text-zinc-500 mt-1 italic">"{g.normalizedMatchingText}"</p>
                          <div className="flex justify-between mt-2 text-[10px] text-zinc-600">
                            <span>User: {g.ownerId.slice(0, 6)}</span>
                            <span>Privacy: {g.visibility}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showSimilarityChecker && (
              <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
                <h3 className="font-bold text-lg">Select a goal to test matching:</h3>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                  {allGoals.map(g => (
                    <button
                      key={g.id}
                      onClick={() => handleMatchCheck(g)}
                      className={cn(
                        "w-full text-left p-3 rounded-xl border transition-all text-sm",
                        selectedGoalForMatch?.id === g.id ? "bg-white text-black border-white" : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-500"
                      )}
                    >
                      <p className="font-bold truncate">{g.title}</p>
                      <p className="text-xs opacity-60 truncate">{g.normalizedMatchingText}</p>
                    </button>
                  ))}
                </div>

                {selectedGoalForMatch && (
                  <div className="mt-6 space-y-4 border-t border-zinc-800 pt-4">
                    <h4 className="font-bold">Top Matches for: "{selectedGoalForMatch.title}"</h4>
                    {isMatching ? (
                      <div className="flex items-center gap-2 text-zinc-500 italic">
                        <RefreshCw size={14} className="animate-spin" />
                        Finding matches...
                      </div>
                    ) : similarMatches.length > 0 ? (
                      <div className="space-y-3">
                        {similarMatches.map((match, idx) => (
                          <div key={match.id} className="p-3 bg-zinc-800/30 border border-zinc-800 rounded-xl text-xs">
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-bold text-sm">#{idx + 1} {match.goalTitle}</span>
                              <span className="bg-white text-black px-2 py-0.5 rounded-full font-mono font-bold">
                                {(match.similarityScore * 100).toFixed(1)}%
                              </span>
                            </div>
                            <p className="text-zinc-400 mb-1 italic">"{match.normalizedMatchingText}"</p>
                            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
                              <span>{match.category}</span>
                              <span>•</span>
                              <span>{match.timeHorizon}</span>
                              {match.locality && (
                                <>
                                  <span>•</span>
                                  <span>{match.locality}</span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-zinc-500 italic">No matches found.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={() => setShowModeration(!showModeration)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Shield />
              <span className="font-semibold">Moderation Dashboard (Admin)</span>
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
