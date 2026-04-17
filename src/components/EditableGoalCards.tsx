import React, { useMemo } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'motion/react';
import { useHomeEditMode } from '../contexts/HomeEditModeContext';
import { useLongPress } from '../hooks/useLongPress';
import { computeInitialCardLayouts, CARD_MIN_W, CARD_MIN_H, CARD_MAX_H, GRID_SNAP } from '../lib/homeLayout';
import { Goal } from '../types';

const JIGGLE_ANIMATE    = { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0] };
const JIGGLE_TRANSITION = { repeat: Infinity, duration: 0.45, ease: 'easeInOut' } as const;

interface EditableGoalCardsProps {
  goals:  Goal[];
  onOpen: (goalId: string) => void;
  renderCard: (goal: Goal, opts: { fillContainer?: boolean; onOpen: () => void }) => React.ReactNode;
}

export function EditableGoalCards({ goals, onOpen, renderCard }: EditableGoalCardsProps) {
  const { isEditMode, enterEditMode, layout, setGoalCardLayout } = useHomeEditMode();
  const longPressForCard = useLongPress(enterEditMode, { delay: 1200 });

  const cardMaxW = typeof window !== 'undefined' ? window.innerWidth - 32 : 380;

  /* Build effective card layouts, filling missing entries with auto-computed positions */
  const effectiveLayouts = useMemo(() => {
    if (!isEditMode) return layout.goalCards;
    const missing = goals.filter(g => !layout.goalCards[g.id]).map(g => g.id);
    if (!missing.length) return layout.goalCards;
    return { ...computeInitialCardLayouts(goals.map(g => g.id)), ...layout.goalCards };
  }, [isEditMode, goals, layout.goalCards]);

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

  /* ── Edit mode: free canvas ─────────────────────────────────────────────── */
  if (isEditMode) {
    return (
      <div
        className="mt-6"
        style={{ position: 'relative', minHeight: canvasHeight, overflow: 'visible' }}
      >
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
              onDragStop={(_e, d) =>
                setGoalCardLayout(goal.id, { ...cl, x: d.x, y: d.y })
              }
              onResizeStop={(_e, _dir, ref, _delta, pos) =>
                setGoalCardLayout(goal.id, {
                  x:      pos.x,
                  y:      pos.y,
                  width:  parseInt(ref.style.width),
                  height: parseInt(ref.style.height),
                })
              }
              style={{ zIndex: 5 }}
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
            {renderCard(goal, { onOpen: () => onOpen(goal.id) })}
          </div>
        ))}
      </div>
    </div>
  );
}
