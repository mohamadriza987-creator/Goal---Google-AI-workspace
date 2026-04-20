import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { motion, useReducedMotion } from 'motion/react';
import { useHomeEditMode } from '../contexts/HomeEditModeContext';
import { useLongPress } from '../hooks/useLongPress';
import {
  computeInitialCardLayouts,
  resolveCardOverlap,
  CARD_MIN_W,
  CARD_MIN_H,
  CARD_MAX_H,
  GRID_SNAP,
  CardLayout,
} from '../lib/homeLayout';
import { Goal } from '../types';

const JIGGLE_ANIMATE    = { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0] };
const JIGGLE_TRANSITION = { repeat: Infinity, duration: 0.45, ease: 'easeInOut' } as const;

interface EditableGoalCardsProps {
  goals:       Goal[];
  onOpen:      (goalId: string) => void;
  /* POLISH: renderCard now receives stagger index so cards can enter in sequence */
  renderCard:  (goal: Goal, opts: { fillContainer?: boolean; onOpen: () => void; index?: number }) => React.ReactNode;
  hasMore?:    boolean;
  onLoadMore?: () => void;
}

export function EditableGoalCards({ goals, onOpen, renderCard, hasMore = false, onLoadMore }: EditableGoalCardsProps) {
  const { isEditMode, enterEditMode, exitEditMode, layout, setGoalCardLayout } = useHomeEditMode();
  const longPressForCard = useLongPress(enterEditMode, { delay: 1200 });
  /* POLISH: silence the idle jiggle for users who prefer reduced motion */
  const prefersReduced = useReducedMotion();

  const [cardMaxW, setCardMaxW] = useState(
    typeof window !== 'undefined' ? window.innerWidth - 32 : 380,
  );
  useEffect(() => {
    const onResize = () => setCardMaxW(window.innerWidth - 32);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const carouselRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el || !onLoadMore) return;
    const handleScroll = () => {
      if (loadingMoreRef.current || !hasMore) return;
      // Trigger when user has scrolled past 75% of the scroll width
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth * 0.75) {
        loadingMoreRef.current = true;
        onLoadMore();
        // Reset flag after a short delay to prevent rapid re-triggers
        setTimeout(() => { loadingMoreRef.current = false; }, 1000);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, onLoadMore]);

  /* Ghost state: track which card is dragging, its raw drag position, and resolved position */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragCandidate, setDragCandidate] = useState<CardLayout | null>(null);
  const [ghostLayout, setGhostLayout] = useState<CardLayout | null>(null);

  /* Build effective card layouts, filling missing entries with auto-computed positions.
     Also clamp saved x positions so cards dragged on a wide screen don't overflow on narrow. */
  const effectiveLayouts = useMemo(() => {
    if (!isEditMode) return layout.goalCards;
    const missing = goals.filter(g => !layout.goalCards[g.id]).map(g => g.id);
    const base = missing.length
      ? { ...computeInitialCardLayouts(goals.map(g => g.id)), ...layout.goalCards }
      : layout.goalCards;
    // Clamp any stored card that overflows the current viewport
    const clamped: typeof base = {};
    for (const [id, cl] of Object.entries(base)) {
      clamped[id] = {
        ...cl,
        x: Math.min(cl.x, Math.max(0, cardMaxW - CARD_MIN_W)),
      };
    }
    return clamped;
  }, [isEditMode, goals, layout.goalCards, cardMaxW]);

  /* Canvas height = bottom of lowest card + padding */
  const canvasHeight = useMemo(() => {
    if (!isEditMode) return 0;
    let maxY = 0;
    goals.forEach(g => {
      const cl = effectiveLayouts[g.id];
      if (cl) maxY = Math.max(maxY, cl.y + cl.height);
    });
    return Math.max(maxY + 48, goals.length * 180);
  }, [isEditMode, goals, effectiveLayouts]);

  const handleDrag = useCallback(
    (goalId: string, x: number, y: number) => {
      const cl = effectiveLayouts[goalId];
      if (!cl) return;
      const candidate: CardLayout = { ...cl, x, y };
      const resolved = resolveCardOverlap(goalId, candidate, effectiveLayouts, cardMaxW);
      setDragCandidate(candidate);
      setGhostLayout(resolved);
    },
    [effectiveLayouts, cardMaxW],
  );

  const handleDragStop = useCallback(
    (goalId: string, x: number, y: number) => {
      const cl = effectiveLayouts[goalId];
      if (!cl) return;
      const candidate: CardLayout = { ...cl, x, y };
      const resolved = resolveCardOverlap(goalId, candidate, effectiveLayouts, cardMaxW);
      setGoalCardLayout(goalId, resolved);
      setDraggingId(null);
      setDragCandidate(null);
      setGhostLayout(null);
    },
    [effectiveLayouts, cardMaxW, setGoalCardLayout],
  );

  const handleResizeStop = useCallback(
    (goalId: string, x: number, y: number, width: number, height: number) => {
      const candidate: CardLayout = { x, y, width, height };
      const resolved = resolveCardOverlap(goalId, candidate, effectiveLayouts, cardMaxW);
      setGoalCardLayout(goalId, resolved);
    },
    [effectiveLayouts, cardMaxW, setGoalCardLayout],
  );

  /* ── Edit mode: free canvas ─────────────────────────────────────────────── */
  if (isEditMode) {
    return (
      <>
        {/* Floating edit-mode banner */}
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(20,18,14,0.92)',
            border: '1px solid rgba(201,168,76,0.45)',
            borderRadius: 999,
            padding: '8px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          } as React.CSSProperties}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'rgba(201,168,76,0.9)',
              flexShrink: 0,
              boxShadow: '0 0 6px rgba(201,168,76,0.6)',
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(201,168,76,0.95)',
              letterSpacing: 0.2,
              whiteSpace: 'nowrap',
            }}
          >
            Editing cards
          </span>
          <button
            onClick={exitEditMode}
            style={{
              marginLeft: 4,
              padding: '4px 14px',
              borderRadius: 999,
              border: 'none',
              background: 'rgba(201,168,76,0.18)',
              color: 'rgba(201,168,76,0.95)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: 0.2,
            }}
          >
            Done
          </button>
        </div>

        <div
        className="mt-6"
        style={{
          position: 'relative',
          minHeight: canvasHeight,
          overflow: 'visible',
          backgroundImage: `radial-gradient(circle, rgba(201,168,76,0.28) 1px, transparent 1px)`,
          backgroundSize: `${GRID_SNAP * 4}px ${GRID_SNAP * 4}px`,
          backgroundPosition: '0 0',
        }}
      >
        {/* Ghost drop-zone outline — only shown when collision resolution displaces the card */}
        {draggingId && ghostLayout && dragCandidate && (() => {
          const isDisplaced =
            ghostLayout.x !== dragCandidate.x || ghostLayout.y !== dragCandidate.y;
          if (!isDisplaced) return null;
          return (
            <div
              /* POLISH: drive position via transform — no layout thrash as the ghost glides */
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: ghostLayout.width,
                height: ghostLayout.height,
                transform: `translate3d(${ghostLayout.x}px, ${ghostLayout.y}px, 0)`,
                border: '2px dashed rgba(201,168,76,0.55)',
                borderRadius: 12,
                background: 'rgba(201,168,76,0.07)',
                pointerEvents: 'none',
                zIndex: 4,
                transition: 'transform 80ms var(--ease-out-quad)',
                willChange: 'transform',
              }}
            />
          );
        })()}

        {goals.map((goal, i) => {
          const cl = effectiveLayouts[goal.id] ?? { x: 16, y: 16, width: 220, height: 150 };

          return (
            <Rnd
              key={goal.id}
              position={{ x: cl.x, y: cl.y }}
              size={{ width: cl.width, height: cl.height }}
              minWidth={CARD_MIN_W}
              maxWidth={cardMaxW}
              minHeight={CARD_MIN_H}
              maxHeight={CARD_MAX_H}
              bounds="parent"
              dragGrid={[GRID_SNAP, GRID_SNAP]}
              resizeGrid={[GRID_SNAP, GRID_SNAP]}
              onDragStart={() => setDraggingId(goal.id)}
              onDrag={(_e, d) => handleDrag(goal.id, d.x, d.y)}
              onDragStop={(_e, d) => handleDragStop(goal.id, d.x, d.y)}
              onResizeStop={(_e, _dir, ref, _delta, pos) =>
                handleResizeStop(
                  goal.id,
                  pos.x,
                  pos.y,
                  parseInt(ref.style.width),
                  parseInt(ref.style.height),
                )
              }
              style={{ zIndex: draggingId === goal.id ? 10 : 5 }}
              /* Resize handle — small dark square with faint gold tint */
              resizeHandleStyles={{
                bottomRight: {
                  width: 14, height: 14,
                  bottom: 6, right: 6,
                  background: 'rgba(201,168,76,0.35)',
                  borderRadius: 3,
                  cursor: 'se-resize',
                },
              }}
            >
              <motion.div
                /* POLISH: skip the jiggle entirely for reduced-motion users */
                animate={prefersReduced ? undefined : JIGGLE_ANIMATE}
                transition={prefersReduced ? undefined : JIGGLE_TRANSITION}
                style={{ width: '100%', height: '100%', cursor: 'grab' }}
              >
                {renderCard(goal, { fillContainer: true, onOpen: () => {}, index: i /* POLISH: stagger */ })}
              </motion.div>
            </Rnd>
          );
        })}
      </div>
      </>
    );
  }

  /* ── Normal mode: horizontal carousel ──────────────────────────────────── */
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between px-4 mb-3">
        <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.3 }}>My Goals</h2>
        <span className="text-meta" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
          {goals.length} {goals.length === 1 ? 'goal' : 'goals'}
        </span>
      </div>
      <div
        ref={carouselRef}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pl-4 pr-4 pb-1"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {goals.map((goal, i) => (
          <div key={goal.id} {...longPressForCard} className="snap-start" style={{ flexShrink: 0 }}>
            {renderCard(goal, { onOpen: () => { exitEditMode(); onOpen(goal.id); }, index: i /* POLISH: stagger */ })}
          </div>
        ))}
        {hasMore && (
          <div
            className="snap-start flex-shrink-0 flex items-center justify-center"
            style={{ width: 64, opacity: 0.4 }}
          >
            <div
              className="animate-spin"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: '2px solid var(--c-gold)',
                borderTopColor: 'transparent',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
