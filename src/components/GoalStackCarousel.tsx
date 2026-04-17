import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { Goal, GoalTask } from '../types';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { Bell, Users, ChevronRight, FileText, Loader2 } from 'lucide-react';

const PEEK   = 72;  // px of next card peeking from bottom
const SPRING = { type: 'spring' as const, stiffness: 360, damping: 38 };

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
      style={{
        height: '100%',
        borderRadius: 24,
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: isActive
          ? '0 20px 60px rgba(0,0,0,0.5)'
          : '0 8px 28px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* ── Stats bar ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px 12px',
        borderBottom: '1px solid var(--c-border)',
        flexShrink: 0,
      }}>
        {/* Notifications */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Bell
            size={15}
            style={{ color: activity > 0 ? 'var(--c-gold)' : 'var(--c-text-3)' }}
            fill={activity > 0 ? 'var(--c-gold)' : 'none'}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: activity > 0 ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
            {activity}
          </span>
        </div>

        {/* Members */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Users size={15} style={{ color: 'var(--c-text-3)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-2)' }}>
            {members}
          </span>
        </div>

        {/* Progress bar + percent */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 56,
            height: 5,
            borderRadius: 999,
            background: 'var(--c-border)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--c-gold)',
              borderRadius: 999,
              transition: 'width 0.6s ease',
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-gold)', minWidth: 30 }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <div
        onPointerDown={e => e.stopPropagation()}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 18px 24px',
          scrollbarWidth: 'none',
        } as React.CSSProperties}
      >
        {/* Title */}
        <h2 style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -0.5,
          lineHeight: 1.25,
          marginBottom: 10,
          color: 'var(--c-text)',
        }}>
          {goal.title}
        </h2>

        {/* Description */}
        {goal.description && (
          <p style={{
            fontSize: 14,
            color: 'var(--c-text-2)',
            lineHeight: 1.65,
            marginBottom: 22,
          }}>
            {goal.description}
          </p>
        )}

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

      {/* ── Drag handle strip ────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 8,
        paddingBottom: 10,
        borderTop: '1px solid var(--c-border)',
      }}>
        <div style={{
          width: 36,
          height: 4,
          borderRadius: 999,
          background: 'var(--c-border-light)',
        }} />
      </div>
    </div>
  );
}

// ── Stack carousel ────────────────────────────────────────────────────────────

interface Props {
  goals:       Goal[];
  onOpen:      (goalId: string) => void;
  hasMore?:    boolean;
  onLoadMore?: () => void;
}

export function GoalStackCarousel({ goals, onOpen, hasMore, onLoadMore }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(0);
  const [activeIdx,  setActiveIdx]  = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setContainerH(e[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load more when approaching the end
  useEffect(() => {
    if (hasMore && onLoadMore && activeIdx >= goals.length - 2) onLoadMore();
  }, [activeIdx, goals.length, hasMore, onLoadMore]);

  const cardH = containerH > 0 ? containerH - PEEK : 0;

  const getY = (i: number) => {
    if (containerH === 0) return 0;
    const off = i - activeIdx;
    if (off < 0)  return -containerH;
    if (off === 0) return 0;
    if (off === 1) return containerH - PEEK;
    return containerH - PEEK * 0.55;
  };

  const getScale = (i: number) => {
    const off = i - activeIdx;
    if (off <= 0)  return 1;
    if (off === 1) return 0.962;
    return 0.928;
  };

  const getZ = (i: number) => {
    const off = i - activeIdx;
    return off < 0 ? 0 : goals.length - off + 1;
  };

  const handleDragEnd = useCallback((i: number, info: PanInfo) => {
    const { offset, velocity } = info;
    if ((offset.y < -55 || velocity.y < -320) && i < goals.length - 1) {
      setActiveIdx(i + 1);
    } else if ((offset.y > 55 || velocity.y > 320) && i > 0) {
      setActiveIdx(i - 1);
    }
  }, [goals.length]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', height: '100%', overflow: 'hidden' }}
    >
      {goals.map((goal, i) => {
        const off      = i - activeIdx;
        if (off < -1 || off > 2) return null;
        const isActive = off === 0;
        const isNext   = off === 1;

        return (
          <motion.div
            key={goal.id}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '88%',
              height: cardH || '100%',
              zIndex: getZ(i),
              willChange: 'transform',
            }}
            animate={{ y: getY(i), scale: getScale(i) }}
            transition={SPRING}
            drag={isActive ? 'y' : false}
            dragConstraints={{ top: -containerH * 0.9, bottom: 70 }}
            dragElastic={{ top: 0.78, bottom: 0.22 }}
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

      {/* Dot indicators */}
      {goals.length > 1 && (
        <div style={{
          position: 'absolute',
          bottom: PEEK / 2 - 6,
          left: '12%',
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 5,
          zIndex: 999,
          pointerEvents: 'none',
        }}>
          {goals.slice(0, 7).map((_, i) => (
            <div key={i} style={{
              width:      i === activeIdx ? 18 : 5,
              height:     5,
              borderRadius: 999,
              background: i === activeIdx ? 'var(--c-gold)' : 'rgba(255,255,255,0.22)',
              transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
