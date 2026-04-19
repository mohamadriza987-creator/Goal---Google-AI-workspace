import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Shield, LogOut, Plus, RefreshCw, Search, Users, ArrowLeft, UserX, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Goal, Group, User } from '../types';
import { getDocs, updateDoc, doc as firestoreDoc, writeBatch, setDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface ProfileScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
  onNavigateHome: () => void;
}

import { useTranslation } from '../contexts/LanguageContext';

export function ProfileScreen({ user, dbUser, onNavigateHome }: ProfileScreenProps) {
  const { t, language, setLanguage } = useTranslation();
  const [isSyncing,      setIsSyncing]      = React.useState(false);
  const [syncProgress,   setSyncProgress]   = React.useState(0);
  const [syncTotal,      setSyncTotal]      = React.useState(0);
  const [showGoalMap,    setShowGoalMap]    = React.useState(false);
  const [syncResult,     setSyncResult]     = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmSync,    setConfirmSync]    = React.useState(false);
  const [allGoals, setAllGoals] = React.useState<Goal[]>([]);
  const [allGroups, setAllGroups] = React.useState<Group[]>([]);
  const [showModeration, setShowModeration] = React.useState(false);
  const [reports, setReports] = React.useState<any[]>([]);
  const [backfillStatus, setBackfillStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [backfillMsg, setBackfillMsg] = React.useState('');
  const [showIndexDebug, setShowIndexDebug] = React.useState(false);
  const [indexDataset, setIndexDataset] = React.useState<'group_index' | 'unassigned_active' | 'unassigned_inactive'>('group_index');
  const [indexRows, setIndexRows] = React.useState<any[]>([]);
  const [indexLoading, setIndexLoading] = React.useState(false);
  const [indexStatus, setIndexStatus] = React.useState<any>(null);
  const [indexStatusLoading, setIndexStatusLoading] = React.useState(false);
  const [forceRebuildStatus, setForceRebuildStatus] = React.useState<'idle'|'running'|'done'|'error'>('idle');
  const [forceRebuildMsg, setForceRebuildMsg] = React.useState('');
  const [modelOrder, setModelOrder] = React.useState<string[]>(['', '', '', '', '']);
  const [modelOrderSaving, setModelOrderSaving] = React.useState(false);
  const [modelOrderMsg, setModelOrderMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [modelStats, setModelStats] = React.useState<Record<string, { calls: number; quotaErrors: number }>>({});

  const isAdminUser = dbUser?.role === 'admin' || user?.email === 'mohamadriza987@gmail.com';

  React.useEffect(() => {
    if (!isAdminUser || !user) return;
    user.getIdToken().then((tok) =>
      fetch('/api/admin/gemini-model-order', { headers: { Authorization: `Bearer ${tok}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.modelOrder) {
            const padded = [...data.modelOrder, '', '', '', '', ''].slice(0, 5);
            setModelOrder(padded);
          }
        })
        .catch(() => {})
    );
  }, [isAdminUser, user]);

  React.useEffect(() => {
    if (!isAdminUser || !user) return;
    const fetchStats = () => {
      user.getIdToken().then((tok) =>
        fetch('/api/admin/gemini-model-stats', { headers: { Authorization: `Bearer ${tok}` } })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => { if (data?.stats) setModelStats(data.stats); })
          .catch(() => {})
      );
    };
    fetchStats();
    const id = setInterval(fetchStats, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAdminUser, user]);

  const saveModelOrder = async () => {
    if (!user) return;
    setModelOrderSaving(true);
    setModelOrderMsg(null);
    try {
      const tok = await user.getIdToken();
      const r = await fetch('/api/admin/gemini-model-order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOrder }),
      });
      const data = await r.json();
      if (r.ok) setModelOrderMsg({ ok: true, text: 'Saved' });
      else setModelOrderMsg({ ok: false, text: data.error ?? 'Failed' });
    } catch (e: any) {
      setModelOrderMsg({ ok: false, text: e.message ?? 'Error' });
    } finally {
      setModelOrderSaving(false);
    }
  };

  const loadIndexStatus = React.useCallback(async () => {
    if (!user || !isAdminUser) return;
    setIndexStatusLoading(true);
    try {
      const tok = await user.getIdToken();
      const r = await fetch('/api/admin/index-status', { headers: { Authorization: `Bearer ${tok}` } });
      if (r.ok) setIndexStatus(await r.json());
    } catch (e) { console.error('index-status error', e); }
    finally { setIndexStatusLoading(false); }
  }, [user, isAdminUser]);

  React.useEffect(() => {
    if (showIndexDebug && isAdminUser) loadIndexStatus();
  }, [showIndexDebug, isAdminUser, loadIndexStatus]);

  React.useEffect(() => {
    if (!showIndexDebug || !isAdminUser || !user) return;
    setIndexLoading(true);
    setIndexRows([]);
    (async () => {
      try {
        const tok = await user.getIdToken();
        const r = await fetch(`/api/admin/index-data?dataset=${indexDataset}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (r.ok) {
          const data = await r.json();
          setIndexRows(data.rows ?? []);
        }
      } catch (e) {
        console.error('index-data error', e);
        setIndexRows([]);
      } finally {
        setIndexLoading(false);
      }
    })();
  }, [showIndexDebug, indexDataset, isAdminUser, user]);

  const handleForceRebuild = async () => {
    if (!user || forceRebuildStatus === 'running') return;
    setForceRebuildStatus('running');
    setForceRebuildMsg('');
    try {
      const tok = await user.getIdToken();
      const r = await fetch('/api/admin/force-rebuild-index', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      });
      const data = await r.json();
      if (r.ok) {
        setForceRebuildStatus('done');
        const fixedNote = data.fixedMissingLastLoggedIn > 0 ? ` (fixed ${data.fixedMissingLastLoggedIn} missing timestamps)` : '';
        setForceRebuildMsg(`Done — ${data.groups ?? 0} groups, ${data.goals ?? 0} unassigned goals indexed${fixedNote}`);
        await loadIndexStatus();
      } else {
        setForceRebuildStatus('error');
        setForceRebuildMsg(data.error || 'Failed');
      }
    } catch (e: any) {
      setForceRebuildStatus('error');
      setForceRebuildMsg(e.message);
    }
  };

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

  const handleBackfillIndex = async () => {
    if (!user || backfillStatus === 'running' || backfillStatus === 'done') return;
    setBackfillStatus('running');
    setBackfillMsg('');
    try {
      const tok = await user.getIdToken();
      const r = await fetch('/api/admin/backfill-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
      });
      const data = await r.json();
      if (r.ok) {
        setBackfillStatus('done');
        setBackfillMsg(data.message || 'Done');
      } else {
        setBackfillStatus('error');
        setBackfillMsg(data.error || 'Failed');
      }
    } catch (err: any) {
      setBackfillStatus('error');
      setBackfillMsg(err.message || 'Network error');
    }
  };

  const handleFullSync = async () => {
    if (!user || isSyncing) return;
    setIsSyncing(true);
    setSyncResult(null);
    setConfirmSync(false);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSyncResult({ ok: true, msg: `Done. Processed ${data.processed ?? '?'} goals.` });
      } else {
        const errData = await res.json().catch(() => ({}));
        setSyncResult({ ok: false, msg: errData.error || "Reconciliation failed." });
      }
    } catch (err) {
      console.error("Sync error:", err);
      setSyncResult({ ok: false, msg: "Sync failed. Check console." });
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
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6"
      >
        <ArrowLeft size={20} />
        <span className="text-sm font-medium">Home</span>
      </button>

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
              { code: 'hi', name: 'हिन्दी' },
              { code: 'ml', name: 'മലയാളം' }
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
            {!confirmSync ? (
              <button
                onClick={() => setConfirmSync(true)}
                disabled={isSyncing}
                className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn(isSyncing && "animate-spin")} />
                <div className="flex-1 text-left">
                  <p className="font-semibold">Sync All Goals</p>
                  <p className="text-xs text-zinc-500">
                    {isSyncing
                      ? `Processing…${syncProgress > 0 ? ` (${syncProgress}/${syncTotal})` : ''}`
                      : syncResult
                        ? <span style={{ color: syncResult.ok ? '#6bbf7a' : '#e07070' }}>{syncResult.msg}</span>
                        : 'Normalize, Embed, and Group all goals'}
                  </p>
                </div>
              </button>
            ) : (
              <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-3">
                <p className="text-sm text-zinc-300">Reconcile all goals — normalize, embed, group. This may take a minute.</p>
                <div className="flex gap-2">
                  <button onClick={handleFullSync}
                    className="flex-1 py-2.5 rounded-2xl text-sm font-semibold bg-white text-black">
                    Confirm
                  </button>
                  <button onClick={() => setConfirmSync(false)}
                    className="flex-1 py-2.5 rounded-2xl text-sm font-semibold bg-zinc-800 text-zinc-300">
                    Cancel
                  </button>
                </div>
              </div>
            )}

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
        {/* Index Inspector — admin only, read-only */}
        {isAdminUser && (
          <div className="space-y-2">
            <button
              onClick={() => setShowIndexDebug(v => !v)}
              className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
            >
              <Search size={20} />
              <div className="flex-1 text-left">
                <p className="font-semibold text-sm">Index Inspector</p>
                <p className="text-xs text-zinc-500">Read-only view of matching index data</p>
              </div>
            </button>
            {showIndexDebug && (
              <div className="space-y-2">
                {/* Debug summary */}
                <div className="p-4 bg-zinc-900/80 border border-zinc-700 rounded-3xl space-y-2 font-mono text-xs">
                  {indexStatusLoading ? (
                    <p className="text-zinc-500">Loading status…</p>
                  ) : indexStatus ? (
                    <>
                      <p className="text-zinc-400">project: <span className="text-white">{indexStatus.projectId}</span></p>
                      <p className="text-zinc-400">db: <span className="text-white">{indexStatus.dbId}</span></p>
                      <p className="text-zinc-400">backfill flag: <span className={indexStatus.flag ? 'text-green-400' : 'text-yellow-400'}>{indexStatus.flag ? `✓ completed ${indexStatus.flag.completedAt?.slice(0,10) ?? ''}` : '✗ not set'}</span></p>
                      <p className="text-zinc-400">group_index: <span className="text-white">{indexStatus.counts.groupIndex} docs</span></p>
                      <p className="text-zinc-400">unassigned active: <span className="text-white">{indexStatus.counts.unassignedActive} docs</span></p>
                      <p className="text-zinc-400">unassigned inactive: <span className="text-white">{indexStatus.counts.unassignedInactive} docs</span></p>
                    </>
                  ) : (
                    <p className="text-zinc-500">Status unavailable</p>
                  )}
                </div>

                {/* Force rebuild */}
                <button
                  onClick={handleForceRebuild}
                  disabled={forceRebuildStatus === 'running'}
                  className="w-full p-4 bg-zinc-900/50 border border-zinc-700 rounded-3xl flex items-center gap-3 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={16} className={forceRebuildStatus === 'running' ? 'animate-spin' : ''} />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">
                      {forceRebuildStatus === 'running' ? 'Rebuilding…' : 'Force Rebuild Index'}
                    </p>
                    {forceRebuildMsg && (
                      <p className="text-xs mt-0.5" style={{ color: forceRebuildStatus === 'error' ? '#e07070' : '#6bbf7a' }}>
                        {forceRebuildMsg}
                      </p>
                    )}
                  </div>
                </button>

                {/* Table inspector */}
                <IndexInspector
                  dataset={indexDataset}
                  onDatasetChange={(d) => { setIndexDataset(d); }}
                  rows={indexRows}
                  loading={indexLoading}
                />
              </div>
            )}
          </div>
        )}

        {/* One-time index backfill — admin only, self-hides after success */}
        {isAdminUser && backfillStatus !== 'done' && (
          <button
            onClick={handleBackfillIndex}
            disabled={backfillStatus === 'running'}
            className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={20} className={backfillStatus === 'running' ? 'animate-spin' : ''} />
            <div className="flex-1 text-left">
              <p className="font-semibold text-sm">
                {backfillStatus === 'running' ? 'Building Index…' : 'Rebuild Matching Index'}
              </p>
              <p className="text-xs text-zinc-500">
                {backfillStatus === 'error'
                  ? backfillMsg
                  : 'One-time backfill of group_index + goals_unassigned_index'}
              </p>
            </div>
          </button>
        )}

        {/* Gemini Model Order — owner only */}
        {isAdminUser && (
          <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-4">
            <p className="font-semibold text-sm">Gemini Model Order</p>
            <p className="text-xs text-zinc-500">Fallback order for goal generation. Blank slots are skipped.</p>
            <div className="space-y-2">
              {modelOrder.map((val, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 w-5 shrink-0">{i + 1}.</span>
                  <select
                    value={val}
                    onChange={(e) => {
                      const next = [...modelOrder];
                      next[i] = e.target.value;
                      setModelOrder(next);
                    }}
                    className="flex-1 bg-zinc-800 text-white text-sm rounded-xl px-3 py-2.5 border border-zinc-700 outline-none"
                  >
                    <option value="">— none —</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                    <option value="gemini-3.1-pro">gemini-3.1-pro</option>
                    <option value="gemini-3.1-lite">gemini-3.1-lite</option>
                    <option value="gemini-3.1">gemini-3.1</option>
                    <option value="gemini-live">gemini-live</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveModelOrder}
                disabled={modelOrderSaving}
                className="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-zinc-200 transition-colors"
              >
                {modelOrderSaving ? 'Saving…' : 'Save'}
              </button>
              {modelOrderMsg && (
                <span className={`text-xs ${modelOrderMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {modelOrderMsg.text}
                </span>
              )}
            </div>
            <div className="border-t border-zinc-800 pt-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                <span>Model</span>
                <span className="flex gap-4">
                  <span>Calls</span>
                  <span className="text-amber-500">Quota</span>
                </span>
              </div>
              {['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro', 'gemini-3.1-lite', 'gemini-3.1', 'gemini-live'].map((m) => (
                <div key={m} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-mono">{m}</span>
                  <span className="flex gap-4 tabular-nums">
                    <span className="text-zinc-300 font-semibold w-6 text-right">{modelStats[m]?.calls ?? 0}</span>
                    <span className={`font-semibold w-6 text-right ${(modelStats[m]?.quotaErrors ?? 0) > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
                      {modelStats[m]?.quotaErrors ?? 0}
                    </span>
                  </span>
                </div>
              ))}
              <p className="text-xs text-zinc-600 pt-1">Resets every 15 min</p>
            </div>
          </div>
        )}

        {/* Blocked Users */}
        <BlockedUsersSection user={user} />

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

interface BlockedProfile {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

function BlockedUsersSection({ user }: { user: FirebaseUser | null }) {
  const [blocked,    setBlocked]    = React.useState<BlockedProfile[]>([]);
  const [loading,    setLoading]    = React.useState(true);
  const [unblocking, setUnblocking] = React.useState<string | null>(null);
  const [open,       setOpen]       = React.useState(false);

  React.useEffect(() => {
    if (!user || !open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = await user.getIdToken();
        const res   = await fetch('/api/blocked-users', { headers: { Authorization: `Bearer ${token}` } });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setBlocked(data.blockedUsers ?? []);
        }
      } catch (e) {
        console.error('Blocked users load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, open]);

  const handleUnblock = async (userId: string) => {
    if (!user) return;
    setUnblocking(userId);
    try {
      const token = await user.getIdToken();
      await fetch(`/api/blocked-users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setBlocked(prev => prev.filter(b => b.userId !== userId));
    } catch (e) {
      console.error('Unblock error', e);
    } finally {
      setUnblocking(null);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full p-6 flex items-center gap-4 text-left hover:bg-zinc-800/30 transition-colors">
        <UserX size={22} style={{ color: '#e05260', flexShrink: 0 }} />
        <div className="flex-1">
          <p className="font-semibold" style={{ color: 'var(--c-text)' }}>Blocked Users</p>
          <p className="text-xs text-zinc-500">Manage who you've blocked</p>
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5 space-y-2" style={{ borderTop: '1px solid var(--c-border)' }}>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
            </div>
          ) : blocked.length === 0 ? (
            <p className="py-4 text-sm text-center" style={{ color: 'var(--c-text-3)' }}>
              No blocked users.
            </p>
          ) : (
            blocked.map(b => (
              <div key={b.userId} className="flex items-center gap-3 py-2">
                {b.avatarUrl ? (
                  <img src={b.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                       style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
                    {b.displayName[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                <p className="flex-1 text-sm" style={{ color: 'var(--c-text)' }}>{b.displayName}</p>
                <button
                  onClick={() => handleUnblock(b.userId)}
                  disabled={unblocking === b.userId}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'rgba(224,82,96,.12)', border: '1px solid rgba(224,82,96,.3)', color: '#e05260' }}>
                  {unblocking === b.userId
                    ? <Loader2 size={12} className="animate-spin" />
                    : 'Unblock'}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type IndexDataset = 'group_index' | 'unassigned_active' | 'unassigned_inactive';

const GROUP_INDEX_COLS = ['_id', 'memberCount', 'categories', 'languages', 'ageCategories', 'locations', 'nationalities', 'updatedAt'] as const;
const UNASSIGNED_COLS  = ['_id', 'userId', 'ageCategory', 'activityStatus', 'categories', 'languages', 'currentLocation', 'nationality', 'lastLoggedInAt', 'updatedAt'] as const;

function formatCell(val: unknown): string {
  if (val === undefined || val === null) return '—';
  if (Array.isArray(val)) return val.length === 0 ? '[]' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function LastLoggedInCell({ val }: { val: unknown }) {
  if (!val || val === '') {
    return <span style={{ color: '#f59e0b' }}>— missing</span>;
  }
  const str = String(val);
  const d = new Date(str);
  const daysAgo = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const label = `${str.slice(0, 10)} (${daysAgo}d ago)`;
  const color = daysAgo <= 30 ? '#6bbf7a' : '#e07070';
  return <span style={{ color }}>{label}</span>;
}

function IndexInspector({
  dataset, onDatasetChange, rows, loading,
}: {
  dataset: IndexDataset;
  onDatasetChange: (d: IndexDataset) => void;
  rows: any[];
  loading: boolean;
}) {
  const cols = dataset === 'group_index' ? GROUP_INDEX_COLS : UNASSIGNED_COLS;

  return (
    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-3xl space-y-3">
      <select
        value={dataset}
        onChange={e => onDatasetChange(e.target.value as IndexDataset)}
        className="w-full bg-zinc-800 text-white text-sm rounded-2xl px-4 py-3 border border-zinc-700 outline-none"
      >
        <option value="group_index">Groups Index</option>
        <option value="unassigned_active">Goals Not Assigned — Active</option>
        <option value="unassigned_inactive">Goals Not Assigned — Inactive</option>
      </select>

      {loading ? (
        <p className="text-xs text-zinc-500 py-4 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500 py-4 text-center italic">No records found.</p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">{rows.length} record{rows.length !== 1 ? 's' : ''}</p>
          <div className="overflow-x-auto -mx-1">
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr>
                  {cols.map(col => (
                    <th key={col}
                        className="px-3 py-2 text-left text-zinc-400 font-semibold uppercase tracking-wider whitespace-nowrap"
                        style={{ borderBottom: '1px solid #3f3f46', background: '#18181b' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row._id ?? i} style={{ borderBottom: '1px solid #27272a' }}>
                    {cols.map(col => (
                      <td key={col}
                          className="px-3 py-2 text-zinc-300 align-top max-w-[180px] break-all"
                          style={{ whiteSpace: 'pre-wrap' }}>
                        {col === 'lastLoggedInAt'
                          ? <LastLoggedInCell val={row[col]} />
                          : formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
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
