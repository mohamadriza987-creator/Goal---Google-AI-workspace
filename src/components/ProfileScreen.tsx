import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase';
import { motion } from 'motion/react';
import {
  Shield, LogOut, RefreshCw, Search, Users,
  Globe, ChevronRight, Lock,
  Check, Loader2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Goal, Group, User } from '../types';
import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, doc as fsDoc,
} from 'firebase/firestore';
import { useTranslation } from '../contexts/LanguageContext';

interface ProfileScreenProps {
  user:   FirebaseUser | null;
  dbUser: User | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const LANGS = [
  { code: 'en', name: 'English',  flag: '🇬🇧' },
  { code: 'es', name: 'Español',  flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'hi', name: 'हिन्दी',   flag: '🇮🇳' },
  { code: 'ar', name: 'العربية',  flag: '🇸🇦' },
  { code: 'zh', name: '中文',     flag: '🇨🇳' },
];

// ─── Row ──────────────────────────────────────────────────────────────────────

function Row({
  icon, label, sublabel, onPress, danger = false, right,
}: {
  icon: React.ReactNode; label: string; sublabel?: string;
  onPress?: () => void; danger?: boolean; right?: React.ReactNode;
}) {
  return (
    <button onClick={onPress} disabled={!onPress}
      className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-opacity hover:opacity-75 disabled:hover:opacity-100"
      style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: 'var(--c-surface-2)' }}>
        <span style={{ color: danger ? '#e07070' : 'var(--c-text-3)' }}>{icon}</span>
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-body font-medium" style={{ color: danger ? '#e07070' : 'var(--c-text)' }}>
          {label}
        </p>
        {sublabel && (
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>{sublabel}</p>
        )}
      </div>
      {right ?? (onPress && <ChevronRight size={16} style={{ color: 'var(--c-text-3)' }} />)}
    </button>
  );
}

// ─── Admin: Global Goal Map ───────────────────────────────────────────────────

function GlobalGoalMap({ allGoals, allGroups }: { allGoals: Goal[]; allGroups: Group[] }) {
  const grouped = React.useMemo(() => {
    const map: Record<string, Goal[]> = { ungrouped: [] };
    allGoals.forEach(g => {
      if (g.groupId) {
        if (!map[g.groupId]) map[g.groupId] = [];
        map[g.groupId].push(g);
      } else {
        map['ungrouped'].push(g);
      }
    });
    return map;
  }, [allGoals]);

  return (
    <div className="mt-3 p-4 rounded-2xl space-y-5"
         style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <h3 className="text-card-title flex items-center gap-2">
        <Users size={16} style={{ color: 'var(--c-gold)' }} /> Community Clusters
      </h3>
      {Object.entries(grouped).map(([groupId, goals]) => {
        const grp = allGroups.find(g => g.id === groupId);
        if (groupId === 'ungrouped' && goals.length === 0) return null;
        return (
          <div key={groupId}>
            <p className="text-meta uppercase tracking-widest mb-2"
               style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
              {groupId === 'ungrouped' ? 'Ungrouped' : (grp?.derivedGoalTheme || groupId.slice(0,8))}
              {' '}· {goals.length}
            </p>
            <div className="space-y-2">
              {goals.map(g => (
                <div key={g.id} className="px-3 py-2 rounded-xl flex items-center justify-between gap-3"
                     style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                  <p className="text-meta font-medium truncate flex-1">{g.title}</p>
                  <span className="text-meta flex-shrink-0"
                        style={{ color: g.visibility === 'private' ? '#e07070' : 'var(--c-success)', fontSize: 10 }}>
                    {g.visibility}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Admin: Moderation ────────────────────────────────────────────────────────

function ModerationPanel() {
  const [reports, setReports] = React.useState<any[]>([]);

  React.useEffect(() => {
    return onSnapshot(
      query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(50)),
      snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

  const resolve = async (id: string, status: 'resolved' | 'dismissed') => {
    await updateDoc(fsDoc(db, 'reports', id), { status, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="mt-3 p-4 rounded-2xl space-y-4"
         style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      <h3 className="text-card-title">Reported Content</h3>
      {reports.length === 0 ? (
        <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>No pending reports.</p>
      ) : reports.map(r => (
        <div key={r.id} className="p-3 rounded-xl space-y-2"
             style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 10 }}>
              #{r.id.slice(0,6)}
            </span>
            <span className="text-meta font-bold uppercase"
                  style={{ color: r.status === 'pending' ? 'var(--c-warning)' : 'var(--c-success)', fontSize: 10 }}>
              {r.status}
            </span>
          </div>
          <p className="text-body text-sm">{r.reason}</p>
          <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>User: {r.reportedUserId?.slice(0,8)}</p>
          <div className="flex gap-2">
            <button onClick={() => resolve(r.id, 'resolved')}
              className="flex-1 py-2 rounded-xl text-meta font-semibold"
              style={{ background: 'var(--c-gold)', color: '#000' }}>
              Resolve
            </button>
            <button onClick={() => resolve(r.id, 'dismissed')}
              className="flex-1 py-2 rounded-xl text-meta font-semibold"
              style={{ background: 'var(--c-surface-3)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ProfileScreen({ user, dbUser }: ProfileScreenProps) {
  const { t, language, setLanguage } = useTranslation();

  // Admin state
  const isAdmin     = user?.email === 'mohamadriza987@gmail.com';
  const [syncing,   setSyncing]   = React.useState(false);
  const [showMap,   setShowMap]   = React.useState(false);
  const [showMod,   setShowMod]   = React.useState(false);
  const [allGoals,  setAllGoals]  = React.useState<Goal[]>([]);
  const [allGroups, setAllGroups] = React.useState<Group[]>([]);

  // Language picker
  const [showLangs, setShowLangs] = React.useState(false);

  React.useEffect(() => {
    if (!showMap || !isAdmin) return;
    const u1 = onSnapshot(collection(db, 'goals'),  s => setAllGoals(s.docs.map(d => ({ id: d.id, ...d.data() } as Goal))));
    const u2 = onSnapshot(collection(db, 'groups'), s => setAllGroups(s.docs.map(d => ({ id: d.id, ...d.data() } as Group))));
    return () => { u1(); u2(); };
  }, [showMap, isAdmin]);

  const handleSync = async () => {
    if (!user || syncing) return;
    if (!window.confirm('Reconcile all goals? (Normalize → Embed → Group)')) return;
    setSyncing(true);
    try {
      const tok = await user.getIdToken();
      const res = await fetch('/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
      });
      const data = await res.json();
      alert(res.ok ? `Done! Processed ${data.processed} goals.` : `Failed: ${data.error}`);
    } catch(e) { alert('Sync failed.'); }
    finally { setSyncing(false); }
  };

  const avatarUrl = dbUser?.avatarUrl || user?.photoURL;
  const name      = dbUser?.displayName || user?.displayName || 'You';
  const username  = user?.email?.split('@')[0] || '';
  const bio       = dbUser?.bio;
  const locality  = dbUser?.locality;

  const currentLang = LANGS.find(l => l.code === language) || LANGS[0];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ minHeight: '100dvh', background: 'var(--c-bg)', paddingBottom: 120 }}>

      {/* ── Avatar + identity ──────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center px-5 pt-16 pb-8">
        {/* Avatar */}
        <div className="relative mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar"
              className="w-24 h-24 rounded-full object-cover"
              style={{ border: '3px solid var(--c-border)' }} />
          ) : (
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
                 style={{ background: 'var(--c-surface-2)', border: '3px solid var(--c-border)', color: 'var(--c-gold)' }}>
              {name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>{name}</h1>
        <p className="text-meta mt-0.5" style={{ color: 'var(--c-text-3)' }}>@{username}</p>

        {bio && (
          <p className="text-body mt-3 max-w-xs" style={{ color: 'var(--c-text-2)' }}>{bio}</p>
        )}

        {locality && (
          <p className="text-meta mt-1.5 flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
            <Globe size={12} /> {locality}
          </p>
        )}
      </div>

      {/* ── Settings ───────────────────────────────────────────────── */}
      <div className="px-4 space-y-3">

        {/* Language */}
        <div className="rounded-2xl overflow-hidden"
             style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <button onClick={() => setShowLangs(v => !v)}
            className="w-full flex items-center gap-4 px-4 py-4 transition-opacity hover:opacity-75">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ background: 'var(--c-surface-2)', fontSize: 18 }}>
              {currentLang.flag}
            </div>
            <div className="flex-1 text-left">
              <p className="text-body font-medium">{t('language')}</p>
              <p className="text-meta" style={{ color: 'var(--c-text-3)' }}>{currentLang.name}</p>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--c-text-3)', transform: showLangs ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
          </button>

          {showLangs && (
            <div className="px-4 pb-4 grid grid-cols-2 gap-2"
                 style={{ borderTop: '1px solid var(--c-border)' }}>
              {LANGS.map(lang => (
                <button key={lang.code}
                  onClick={() => { setLanguage(lang.code as any); setShowLangs(false); }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-body transition-all"
                  style={language === lang.code
                    ? { background: 'var(--c-gold)', color: '#000', fontWeight: 600 }
                    : { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                  <span style={{ fontSize: 16 }}>{lang.flag}</span>
                  <span className="text-sm">{lang.name}</span>
                  {language === lang.code && <Check size={13} className="ml-auto" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Privacy */}
        <Row
          icon={<Lock size={16} />}
          label={t('privacy')}
          sublabel="Manage blocked and hidden users"
          onPress={() => alert('Privacy settings coming soon.')}
        />

        {/* ── Admin section ─────────────────────────────────────────── */}
        {isAdmin && (
          <div className="space-y-3 pt-2">
            <p className="text-meta uppercase tracking-widest px-1"
               style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
              Admin Tools
            </p>

            <Row
              icon={syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              label="Sync All Goals"
              sublabel={syncing ? 'Processing…' : 'Normalize → Embed → Group'}
              onPress={handleSync}
            />

            <Row
              icon={<Search size={16} />}
              label="Global Goal Map"
              sublabel="All goals organized by cluster"
              onPress={() => setShowMap(v => !v)}
              right={
                <span className="text-meta" style={{ color: showMap ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
                  {showMap ? 'Hide' : 'Show'}
                </span>
              }
            />
            {showMap && <GlobalGoalMap allGoals={allGoals} allGroups={allGroups} />}

            <Row
              icon={<Shield size={16} />}
              label="Moderation"
              sublabel="Review reported content"
              onPress={() => setShowMod(v => !v)}
              right={
                <span className="text-meta" style={{ color: showMod ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
                  {showMod ? 'Hide' : 'Show'}
                </span>
              }
            />
            {showMod && <ModerationPanel />}
          </div>
        )}

        {/* Sign out */}
        <Row
          icon={<LogOut size={16} />}
          label={t('signOut')}
          danger
          onPress={() => auth.signOut()}
        />

        {/* Version */}
        <p className="text-center text-meta pt-2" style={{ color: 'var(--c-text-3)', fontSize: 11 }}>
          Goal · v0.1 · Built with ❤️
        </p>
      </div>
    </motion.div>
  );
}