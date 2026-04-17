import React, { useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, Trophy } from 'lucide-react';
import { cn } from '../lib/utils';
import { useHomeEditMode } from '../contexts/HomeEditModeContext';
import { useLongPress } from '../hooks/useLongPress';
import { NavId } from '../lib/homeLayout';
import { NavButton } from './NavButton';
import { PandaIcon } from './PandaIcon';

// ── Jiggle spring ─────────────────────────────────────────────────────────────
const JIGGLE_ANIMATE   = { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0] };
const JIGGLE_TRANSITION = { repeat: Infinity, duration: 0.45, ease: 'easeInOut' } as const;

// ── Nav item config ───────────────────────────────────────────────────────────
const NAV_ITEMS: Record<NavId, { label: string; screen: string }> = {
  home:      { label: 'Home',      screen: 'home'      },
  calendar:  { label: 'Calendar',  screen: 'calendar'  },
  challenge: { label: 'Challenge', screen: 'challenge' },
};

// ── Single sortable slot ──────────────────────────────────────────────────────
function SortableNavItem({
  id,
  activeScreen,
  isEditMode,
  onNavigate,
}: {
  id:            NavId;
  activeScreen:  string;
  isEditMode:    boolean;
  onNavigate:    (screen: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const active = activeScreen === NAV_ITEMS[id].screen;

  const dndStyle: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.4 : 1,
    touchAction: 'none',
  };

  const handleClick = () => {
    if (!isEditMode) onNavigate(NAV_ITEMS[id].screen);
  };

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      {...(isEditMode ? { ...attributes, ...listeners } : {})}
    >
      <motion.div
        animate={isEditMode ? JIGGLE_ANIMATE   : { rotate: 0 }}
        transition={isEditMode ? JIGGLE_TRANSITION : { duration: 0.25 }}
      >
        {id === 'home' ? (
          /* Panda — custom markup to preserve brand styling */
          <button
            onClick={handleClick}
            className={cn(
              'group relative flex flex-col items-center justify-center gap-0.5 px-5 py-1 rounded-full transition-all duration-300',
              active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <PandaIcon size={22} active={active} />
            <span
              className="text-[10px] font-semibold"
              style={{ color: active ? 'var(--c-gold)' : 'var(--c-text-3)' }}
            >
              Home
            </span>
          </button>
        ) : id === 'calendar' ? (
          <NavButton
            active={active}
            icon={<CalendarIcon size={20} />}
            label="Calendar"
            onClick={handleClick}
          />
        ) : (
          <NavButton
            active={active}
            icon={<Trophy size={20} />}
            label="Challenge"
            onClick={handleClick}
          />
        )}
      </motion.div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
interface SortableNavConsoleProps {
  currentScreen: string;
  navigate:      (s: any) => void;
  navVisible:    boolean;
}

export function SortableNavConsole({ currentScreen, navigate, navVisible }: SortableNavConsoleProps) {
  const { isEditMode, enterEditMode, exitEditMode, resetLayout, layout, setNavOrder, canUndo, undoLastMove } =
    useHomeEditMode();

  /* Auto-exit edit mode when user leaves the home screen (including goal-detail) */
  useEffect(() => {
    if (isEditMode && currentScreen !== 'home') exitEditMode();
  }, [currentScreen, isEditMode, exitEditMode]);

  /* Also exit edit mode immediately when navigating to goal-detail */
  const handleNavigate = (screen: string) => {
    if (isEditMode) exitEditMode();
    navigate({ name: screen });
  };

  const longPress = useLongPress(enterEditMode, { delay: 1200 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 0, tolerance: 6 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = layout.navOrder.indexOf(active.id as NavId);
      const newIdx = layout.navOrder.indexOf(over.id  as NavId);
      setNavOrder(arrayMove(layout.navOrder, oldIdx, newIdx));
    }
  };

  return (
    <>
      {/* Floating Done + Reset — only on home screen in edit mode */}
      <AnimatePresence>
        {isEditMode && currentScreen === 'home' && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={  { opacity: 0, y: -8,  scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{
              position: 'fixed',
              top:      16,
              right:    16,
              zIndex:   200,
              display:  'flex',
              flexDirection: 'column',
              alignItems:    'flex-end',
              gap:           6,
            }}
          >
            <button
              onClick={exitEditMode}
              className="btn-gold"
              style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, borderRadius: 999 }}
            >
              Done
            </button>
            <AnimatePresence>
              {canUndo && (
                <motion.button
                  key="undo-btn"
                  initial={{ opacity: 0, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1,    y: 0  }}
                  exit={  { opacity: 0, scale: 0.85, y: -4  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  onClick={undoLastMove}
                  style={{
                    padding: '6px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 999,
                    background: 'rgba(201,168,76,0.12)',
                    border: '1px solid rgba(201,168,76,0.35)',
                    color: 'var(--c-gold)',
                    cursor: 'pointer',
                  }}
                >
                  ↩ Undo
                </motion.button>
              )}
            </AnimatePresence>
            <button
              onClick={resetLayout}
              className="text-meta"
              style={{ color: 'var(--c-text-3)', fontSize: 11, paddingRight: 4 }}
            >
              Reset layout
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nav bar */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 z-50"
        initial={false}
        animate={{ y: navVisible ? 0 : 80, opacity: navVisible ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        {/* Fade above nav */}
        <div
          className="h-6 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--c-bg))' }}
        />

        <nav
          {...longPress}
          className="flex items-center justify-around px-2"
          style={{
            background:     'rgba(10,10,10,0.92)',
            backdropFilter: 'blur(24px)',
            borderTop:      '1px solid var(--c-border)',
            paddingBottom:  'max(env(safe-area-inset-bottom), 12px)',
            paddingTop:     8,
          }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={layout.navOrder} strategy={horizontalListSortingStrategy}>
              {layout.navOrder.map(id => (
                <SortableNavItem
                  key={id}
                  id={id}
                  activeScreen={currentScreen}
                  isEditMode={isEditMode}
                  onNavigate={handleNavigate}
                />
              ))}
            </SortableContext>
          </DndContext>
        </nav>
      </motion.div>
    </>
  );
}
