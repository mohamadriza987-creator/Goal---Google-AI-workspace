import { useRef, useCallback, useEffect } from 'react';

interface LongPressOptions {
  delay?:          number; // ms — default 1200
  moveThreshold?:  number; // px — default 8
  /* POLISH: optional 0..1 progress callback driven by requestAnimationFrame,
     for rendering a radial countdown ring / fill while the user holds. */
  onProgress?:     (progress: number) => void;
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
  const { delay = 1200, moveThreshold = 8, onProgress } = options;

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef      = useRef<number | null>(null);
  const startTime   = useRef<number>(0);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    /* POLISH: stop the progress loop and snap back to 0 so consumers can
       collapse any countdown ring they were drawing. */
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    onProgress?.(0);
  }, [onProgress]);

  /* Safety net — if the component unmounts mid-press, don't leak timers / rAFs */
  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startPosRef.current = { x: e.clientX, y: e.clientY };
      startTime.current   = performance.now();

      /* POLISH: per-frame progress 0..1 for radial countdown UI */
      if (onProgress) {
        const tick = () => {
          const elapsed = performance.now() - startTime.current;
          onProgress(Math.min(elapsed / delay, 1));
          if (elapsed < delay) {
            rafRef.current = requestAnimationFrame(tick);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        /* POLISH: haptic-style nudge on phones that support the Vibration API.
           Guarded — Safari iOS doesn't support it, and some Android browsers
           gate it behind user-gesture policies. */
        try { navigator.vibrate?.(10); } catch {}
        onProgress?.(1);
        onLongPress();
      }, delay);
    },
    [onLongPress, delay, onProgress],
  );

  const onPointerUp     = useCallback(() => clearTimer(), [clearTimer]);
  const onPointerLeave  = useCallback(() => clearTimer(), [clearTimer]);
  const onPointerCancel = useCallback(() => clearTimer(), [clearTimer]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current) return;
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > moveThreshold || dy > moveThreshold) clearTimer();
    },
    [moveThreshold, clearTimer],
  );

  return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onPointerMove };
}
