import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  HomeLayout, NavId, CardLayout,
  DEFAULT_LAYOUT, loadLayout, saveLayout,
} from '../lib/homeLayout';

interface HomeEditModeCtx {
  isEditMode:          boolean;
  enterEditMode:       () => void;
  exitEditMode:        () => void;
  resetLayout:         () => void;
  layout:              HomeLayout;
  setNavOrder:         (order: NavId[]) => void;
  setInputWidgetPos:   (pos: { x: number; y: number }) => void;
  setGoalCardLayout:   (goalId: string, cardLayout: CardLayout) => void;
  canUndo:             boolean;
  undoLastMove:        () => void;
}

const HomeEditModeContext = createContext<HomeEditModeCtx | null>(null);

export function HomeEditModeProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId:   string | null;
}) {
  const [isEditMode,    setIsEditMode]    = useState(false);
  const [layout,        setLayout]        = useState<HomeLayout>(() => ({
    ...DEFAULT_LAYOUT,
    navOrder:  [...DEFAULT_LAYOUT.navOrder],
    goalCards: {},
  }));
  const [undoStack, setUndoStack] = useState<Record<string, CardLayout>[]>([]);

  const userIdRef = useRef<string | null>(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  useEffect(() => {
    if (userId) {
      setLayout(loadLayout(userId));
    } else {
      setLayout({ ...DEFAULT_LAYOUT, navOrder: [...DEFAULT_LAYOUT.navOrder], goalCards: {} });
    }
  }, [userId]);

  const persist = useCallback((l: HomeLayout) => {
    if (userIdRef.current) saveLayout(userIdRef.current, l);
  }, []);

  const enterEditMode = useCallback(() => {
    setIsEditMode(true);
    setUndoStack([]);
  }, []);

  const exitEditMode = useCallback(() => {
    setIsEditMode(false);
    setLayout(prev => { persist(prev); return prev; });
  }, [persist]);

  const resetLayout = useCallback(() => {
    const fresh: HomeLayout = { ...DEFAULT_LAYOUT, navOrder: [...DEFAULT_LAYOUT.navOrder], goalCards: {} };
    setLayout(fresh);
    if (userIdRef.current) saveLayout(userIdRef.current, fresh);
  }, []);

  const setNavOrder = useCallback((order: NavId[]) => {
    setLayout(prev => {
      const next = { ...prev, navOrder: order };
      persist(next);
      return next;
    });
  }, [persist]);

  const setInputWidgetPos = useCallback((pos: { x: number; y: number }) => {
    setLayout(prev => {
      const next = { ...prev, inputWidget: pos };
      persist(next);
      return next;
    });
  }, [persist]);

  const setGoalCardLayout = useCallback((goalId: string, cardLayout: CardLayout) => {
    setLayout(prev => {
      const existing = prev.goalCards[goalId];
      const changed = !existing
        || existing.x !== cardLayout.x
        || existing.y !== cardLayout.y
        || existing.width  !== cardLayout.width
        || existing.height !== cardLayout.height;
      if (changed) {
        setUndoStack(stack => [...stack.slice(-4), prev.goalCards]);
      }
      const next = { ...prev, goalCards: { ...prev.goalCards, [goalId]: cardLayout } };
      persist(next);
      return next;
    });
  }, [persist]);

  const undoLastMove = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack;
      const previousCards = stack[stack.length - 1];
      const remaining = stack.slice(0, -1);
      setLayout(prev => {
        const restored = { ...prev, goalCards: previousCards };
        persist(restored);
        return restored;
      });
      return remaining;
    });
  }, [persist]);

  return (
    <HomeEditModeContext.Provider
      value={{
        isEditMode, enterEditMode, exitEditMode, resetLayout,
        layout, setNavOrder, setInputWidgetPos, setGoalCardLayout,
        canUndo: undoStack.length > 0,
        undoLastMove,
      }}
    >
      {children}
    </HomeEditModeContext.Provider>
  );
}

export function useHomeEditMode(): HomeEditModeCtx {
  const ctx = useContext(HomeEditModeContext);
  if (!ctx) throw new Error('useHomeEditMode must be used within HomeEditModeProvider');
  return ctx;
}
