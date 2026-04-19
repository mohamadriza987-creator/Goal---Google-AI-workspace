import { useRef, useCallback } from 'react';

interface LongPressOptions {
  delay?:          number; // ms — default 1200
  moveThreshold?:  number; // px — default 8
}

interface LongPressHandlers {
  onPointerDown:   (e: React.PointerEvent) => void;
  onPointerUp:     (e: React.PointerEvent) => void;
  onPointerLeave:  (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onPointerMove:   (e: React.PointerEvent) => void;
}

export function useLongPress(
  onLongPress: () => void,
  options: LongPressOptions = {},
): LongPressHandlers {
  const { delay = 1200, moveThreshold = 8 } = options;

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startPosRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onLongPress();
      }, delay);
    },
    [onLongPress, delay],
  );

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    clearTimer();
  }, []);

  const onPointerLeave = useCallback((_e: React.PointerEvent) => {
    clearTimer();
  }, []);

  const onPointerCancel = useCallback((_e: React.PointerEvent) => {
    clearTimer();
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current) return;
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > moveThreshold || dy > moveThreshold) clearTimer();
    },
    [moveThreshold],
  );

  return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onPointerMove };
}
