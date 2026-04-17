import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'motion/react';
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
  goals:  Goal[];
  onOpen: (goalId: string) => void;
  renderCard: (goal: Goal, opts: { fillContainer?: boolean; onOpen: () => void }) => React.ReactNode;
}

export function EditableGoalCards({ goals, onOpen, renderCard }: EditableGoalCardsProps) {
  const { isEditMode, enterEditMode, exitEditMode, layout, setGoalCardLayout } = useHomeEditMode();
  const longPressForCard = useLongPress(enterEditMode, { delay: 1200 });

  const [cardMaxW, setCardMaxW] = useState(
    typeof window !== 'undefined' ? window.innerWidth - 32 : 380,
  );
  useEffect(() => {
    const onResize = () => setCardMaxW(window.innerWidth - 32);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      <div
        className="mt-6"
        style={{ position: 'relative', minHeight: canvasHeight, overflow: 'visible' }}
      >
        {/* Ghost drop-zone outline — only shown when collision resolution displaces the card */}
        {draggingId && ghostLayout && dragCandidate && (() => {
          const isDisplaced =
            ghostLayout.x !== dragCandidate.x || ghostLayout.y !== dragCandidate.y;
          if (!isDisplaced) return null;
          return (
            <div
              style={{
                position: 'absolute',
                left: ghostLayout.x,
                top: ghostLayout.y,
                width: ghostLayout.width,
                height: ghostLayout.height,
                border: '2px dashed rgba(201,168,76,0.55)',
                borderRadius: 12,
                background: 'rgba(201,168,76,0.07)',
                pointerEvents: 'none',
                zIndex: 4,
                transition: 'left 80ms, top 80ms',
              }}
            />
          );
        })()}

        {goals.map(goal => {
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
                animate={JIGGLE_ANIMATE}
                transition={JIGGLE_TRANSITION}
                style={{ width: '100%', height: '100%', cursor: 'grab' }}
              >
                {renderCard(goal, { fillContainer: true, onOpen: () => {} })}
              </motion.div>
            </Rnd>
          );
        })}
      </div>
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
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pl-4 pr-4 pb-1"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {goals.map(goal => (
          <div key={goal.id} {...longPressForCard} className="snap-start" style={{ flexShrink: 0 }}>
            {renderCard(goal, { onOpen: () => { exitEditMode(); onOpen(goal.id); } })}
          </div>
        ))}
      </div>
    </div>
  );
}
