import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { Trophy, Sparkles, Award, Bookmark, X, Loader2 } from 'lucide-react';

interface FavouriteEntry {
  id: string;
  targetUserId: string;
  targetUserName: string;
  targetAvatarUrl: string;
  createdAt: string;
}

interface ChallengeScreenProps {
  user: FirebaseUser | null;
  dbUser: User | null;
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
           style={{ background: 'rgba(201,168,76,.1)' }}>
        {icon}
      </div>
      <h2 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-3)' }}>
        {label}
      </h2>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  /* POLISH: shared .empty-state utility — consistent depth, spacing + typography
     across every empty block in the app. */
  return (
    <div className="empty-state" style={{ alignItems: 'flex-start', textAlign: 'left' }}>
      <p className="empty-state__body" style={{ maxWidth: 'none' }}>{message}</p>
    </div>
  );
}

function FavouritesSection({ user }: { user: FirebaseUser | null }) {
  const [favourites, setFavourites] = useState<FavouriteEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [removing,   setRemoving]   = useState<string | null>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res   = await fetch('/api/favourites', { headers: { Authorization: `Bearer ${token}` } });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setFavourites(data.favourites ?? []);
        }
      } catch (e) {
        console.error('Favourites load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleRemove = async (fav: FavouriteEntry) => {
    if (!user) return;
    setRemoving(fav.targetUserId);
    try {
      const token = await user.getIdToken();
      await fetch(`/api/favourites/${fav.targetUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setFavourites(prev => prev.filter(f => f.targetUserId !== fav.targetUserId));
    } catch (e) {
      console.error('Remove favourite error', e);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon={<Bookmark size={14} style={{ color: 'var(--c-gold)' }} />}
        label="Favourites"
      />
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
        </div>
      ) : favourites.length === 0 ? (
        <EmptyCard message="No favourites yet. Tap a member in the People tab to add them." />
      ) : (
        <div className="space-y-2">
          {favourites.map(fav => (
            <div key={fav.id}
              /* POLISH: token radius + shadow ladder, 44+ row height */
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background:   'var(--c-surface)',
                border:       '1px solid var(--c-border)',
                borderRadius: 'var(--r-lg)',
                boxShadow:    'var(--shadow-1), var(--shadow-2)',
                minHeight:    44,
              }}>
              {fav.targetAvatarUrl ? (
                <img src={fav.targetAvatarUrl} alt=""
                  className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                     style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-gold)' }}>
                  {fav.targetUserName[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <p className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--c-text)' }}>
                {fav.targetUserName}
              </p>
              {/* POLISH: 44×44 tap target + anim-press */}
              <button
                onClick={() => handleRemove(fav)}
                disabled={removing === fav.targetUserId}
                className="flex-shrink-0 tap-target anim-press rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                aria-label={`Remove ${fav.targetUserName}`}
                style={{ color: 'var(--c-text-3)' }}>
                {removing === fav.targetUserId
                  ? <Loader2 size={14} className="animate-spin" />
                  : <X size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ChallengeScreen({ user, dbUser }: ChallengeScreenProps) {
  return (
    <motion.div
      /* POLISH: shared panel enter — token ease, transform + opacity only;
         safe-area top padding respects the iOS notch. */
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="max-w-2xl mx-auto px-5 pb-32"
      style={{ paddingTop: 'calc(56px + env(safe-area-inset-top))' }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, marginBottom: 28 }}>
        Challenge
      </h1>

      {/* Favourites */}
      <FavouritesSection user={user} />

      {/* Challenges */}
      <section style={{ marginBottom: 28 }}>
        <SectionHeader
          icon={<Trophy size={14} style={{ color: 'var(--c-gold)' }} />}
          label="Challenges"
        />
        <EmptyCard message="No active challenges yet." />
      </section>

      {/* Good News */}
      <section style={{ marginBottom: 28 }}>
        <SectionHeader
          icon={<Sparkles size={14} style={{ color: '#6bbf7a' }} />}
          label="Good News"
        />
        <EmptyCard message="Nothing to report yet." />
      </section>

      {/* Member Wins */}
      <section>
        <SectionHeader
          icon={<Award size={14} style={{ color: 'var(--c-gold)' }} />}
          label="Member Wins"
        />
        <EmptyCard message="No wins shared yet." />
      </section>
    </motion.div>
  );
}
