import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { Goal, GoalTask } from '../types';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { Bell, Users, ChevronRight, FileText, Loader2 } from 'lucide-react';

const PEEK_RIGHT = 52;  // px of the next card visible on the right
const SPRING     = { type: 'spring' as const, stiffness: 360, damping: 38 };

// ── Per-card content ──────────────────────────────────────────────────────────

function GoalStackCard({
  goal,
  isActive,
  isNext,
  onTap,
}: {
  goal:     Goal;
  isActive: boolean;
  isNext:   boolean;
  onTap:    () => void;
}) {
  const [tasks,    setTasks]    = useState<GoalTask[]>([]);
  const [activity, setActivity] = useState(0);
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    if (!isActive && !isNext) return;
    const q = query(collection(db, 'goals', goal.id, 'tasks'), orderBy('order', 'asc'));
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoalTask)));
      setReady(true);
    });
  }, [goal.id, isActive, isNext]);

  useEffect(() => {
    if (!isActive || !goal.groupId) return;
    const q = query(collection(db, 'groups', goal.groupId, 'threads'), limit(99));
    return onSnapshot(q, snap => setActivity(snap.size));
  }, [goal.groupId, isActive]);

  const nextTask = tasks.find(t => !t.isDone);
  const pct      = goal.progressPercent ?? 0;
  const members  = (goal.similarGoals?.length ?? 0) + 1;
  const notes    = nextTask?.notes ?? [];

  return (
    <div
      onClick={onTap}
      /* POLISH: token-driven shadow ladder — idle card uses ambient+key,
         active card gains the modal layer for stronger lift. Radius uses --r-xl (24). */
      style={{
        height:        '100%',
        borderRadius:  'var(--r-xl)',
        background:    'var(--c-surface)',
        border:        '1px solid var(--c-border)',
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        boxShadow:     isActive
          ? 'var(--shadow-1), var(--shadow-2), var(--shadow-modal)'
          : 'var(--shadow-1), var(--shadow-2)',
        cursor:        isActive ? 'grab' : 'pointer',
        userSelect:    'none',
      }}
    >
      {/* Progress bar — top accent */}
      <div style={{ height: 3, background: 'var(--c-border)', flexShrink: 0 }}>
        <div style={{
          height:       '100%',
          width:        `${pct}%`,
          background:   'var(--c-gold)',
          borderRadius: 999,
          /* POLISH: token ease matches every other progress surface */
          transition:   'width 0.6s var(--ease-out-quad)',
        }} />
      </div>

      {/* Card body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Title + progress */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: -0.4,
            lineHeight: 1.25,
            color: 'var(--c-text)',
            flex: 1,
          }}>
            {goal.title}
          </h2>
          {/* Circular progress badge */}
          <div style={{
            flexShrink: 0,
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: 'rgba(201,168,76,0.1)',
            border: `2px solid ${pct > 0 ? 'var(--c-gold)' : 'var(--c-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-gold)' }}>{pct}%</span>
          </div>
        </div>

        {/* Description */}
        {goal.description && (
          <p style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--c-text-2)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {goal.description}
          </p>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 14 }}>
          {members > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Users size={13} style={{ color: 'var(--c-text-3)' }} />
              <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{members}</span>
            </div>
          )}
          {activity > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Bell size={13} style={{ color: 'var(--c-text-3)' }} />
              <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{activity}</span>
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: goal.status === 'active' ? 'var(--c-gold)' : 'var(--c-text-3)',
            }}>
              {goal.status}
            </span>
          </div>
        </div>

        {/* Loading spinner */}
        {!ready && isActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-text-3)' }}>
            <Loader2 size={13} className="animate-spin" />
            <span style={{ fontSize: 12 }}>Loading tasks…</span>
          </div>
        )}

        {/* Next task */}
        {ready && nextTask && (
          <div style={{
            borderRadius: 16,
            background: 'rgba(201,168,76,0.07)',
            border: '1px solid rgba(201,168,76,0.22)',
            padding: '13px 15px',
          }}>
            <p style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--c-gold)',
              marginBottom: 8,
            }}>
              Next step
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <ChevronRight size={15} style={{ color: 'var(--c-gold)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-text)', lineHeight: 1.5 }}>
                {nextTask.text}
              </p>
            </div>
            {notes.length > 0 && (
              <div style={{ marginTop: 10, paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {notes.map((note, ni) => (
                  <div key={ni} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <FileText size={12} style={{ color: 'var(--c-text-3)', flexShrink: 0, marginTop: 2 }} />
                    <p style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.5 }}>
                      {note.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {ready && !nextTask && tasks.length > 0 && (
          <div style={{
            borderRadius: 16,
            border: '1px solid var(--c-border)',
            padding: '14px 15px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>All tasks complete 🎉</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Horizontal stack carousel ─────────────────────────────────────────────────

interface Props {
  goals:       Goal[];
  onOpen:      (goalId: string) => void;
  hasMore?:    boolean;
  onLoadMore?: () => void;
}

export function GoalStackCarousel({ goals, onOpen, hasMore, onLoadMore }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [activeIdx,  setActiveIdx]  = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load more when approaching the end
  useEffect(() => {
    if (hasMore && onLoadMore && activeIdx >= goals.length - 2) onLoadMore();
  }, [activeIdx, goals.length, hasMore, onLoadMore]);

  // card width leaves PEEK_RIGHT px for the next card to show
  const cardW = containerW > 0 ? containerW - PEEK_RIGHT : 0;

  const getX = useCallback((i: number) => {
    if (containerW === 0) return 0;
    const off = i - activeIdx;
    if (off < 0)  return -(cardW + 20);   // off-screen left (extra 20 so it's fully hidden)
    if (off === 0) return 0;              // active: flush left edge
    if (off === 1) return cardW;          // next: starts at cardW, shows PEEK_RIGHT px on right
    return cardW + PEEK_RIGHT + 8;        // further right: fully hidden
  }, [containerW, activeIdx, cardW]);

  const handleDragEnd = useCallback((i: number, info: PanInfo) => {
    const { offset, velocity } = info;
    if ((offset.x < -50 || velocity.x < -300) && i < goals.length - 1) {
      setActiveIdx(i + 1);
    } else if ((offset.x > 50 || velocity.x > 300) && i > 0) {
      setActiveIdx(i - 1);
    }
  }, [goals.length]);

  return (
    <div
      ref={containerRef}
      /* POLISH: paint + style containment on the stack — cards drag over millions of
         pixels each frame; we keep repaints local to this subtree.
         SAMSUNG INTERNET: overscroll-behavior-x contains horizontal drag so the
         swipe never bubbles up to the browser chrome; scroll-snap-stop: always
         (with -webkit- variants for older Samsung builds) prevents skipping
         intermediate goal cards during a fast flick. */
      style={{
        position:             'relative',
        width:                '100%',
        height:               '100%',
        overflow:             'hidden',
        contain:              'layout style paint',
        overscrollBehaviorX:  'contain',
        scrollSnapType:       'x mandatory',
        WebkitScrollSnapType: 'x mandatory',
        scrollSnapStop:       'always',
        WebkitScrollSnapStop: 'always',
      } as React.CSSProperties}
    >
      {goals.map((goal, i) => {
        const off      = i - activeIdx;
        // Only render visible cards (active, next peek, and 1 off each side)
        if (off < -1 || off > 2) return null;
        const isActive = off === 0;
        const isNext   = off === 1;

        return (
          <motion.div
            key={goal.id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: cardW || '100%',
              height: '100%',
              zIndex: isActive ? 2 : 1,
              /* POLISH: only hint the compositor for the card the user is steering — others idle */
              willChange: isActive ? 'transform' : 'auto',
              // Non-active off-screen cards must not intercept touches
              pointerEvents: isActive ? 'auto' : 'none',
            }}
            /* POLISH: first-mount stagger — 40ms between cards, opacity + x */
            initial={{ opacity: 0, x: getX(i) + 12 }}
            animate={{ opacity: 1, x: getX(i) }}
            transition={{ ...SPRING, opacity: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.04 } }}
            drag={isActive ? 'x' : false}
            dragConstraints={{ left: -(cardW * 0.6), right: cardW * 0.3 }}
            dragElastic={{ left: 0.12, right: 0.18 }}
            dragMomentum={false}
            onDragEnd={(_, info) => isActive && handleDragEnd(i, info)}
          >
            <GoalStackCard
              goal={goal}
              isActive={isActive}
              isNext={isNext}
              onTap={() => isActive ? onOpen(goal.id) : setActiveIdx(i)}
            />
          </motion.div>
        );
      })}

      {/* Dot indicators — centered at the bottom */}
      {goals.length > 1 && (
        <div style={{
          position: 'absolute',
          bottom: 4,           /* POLISH: dots now live inside 44×44 buttons, so raise the row */
          left: 0,
          right: PEEK_RIGHT,
          display: 'flex',
          justifyContent: 'center',
          gap: 0,              /* gap comes from the invisible hit-area padding instead */
          zIndex: 10,
        }}>
          {goals.slice(0, 9).map((_, i) => (
            /* POLISH: 44×44 tap target, visual dot stays compact in the center */
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              aria-label={`Go to goal ${i + 1}`}
              className="anim-press"
              style={{
                width: 44,
                height: 32,
                background: 'transparent',
                border: 'none',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              <span style={{
                display: 'block',
                width:        i === activeIdx ? 18 : 5,
                height:       5,
                borderRadius: 999,
                background:   i === activeIdx ? 'var(--c-gold)' : 'rgba(255,255,255,0.22)',
                transition:   'width 160ms var(--ease-spring), background-color 160ms var(--ease-out-quad)',
              }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
