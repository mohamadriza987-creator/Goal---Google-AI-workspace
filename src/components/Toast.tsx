import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, AlertTriangle, Info, X } from 'lucide-react';

/* POLISH: lightweight toast provider — single-stack, self-dismissing, safe-area-
   aware, transform + opacity only, reduced-motion collapses the spring to a
   near-instant fade. No logic/data dependency; purely a visual primitive. */

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show:    (message: string, variant?: ToastVariant, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error:   (message: string, durationMs?: number) => void;
  info:    (message: string, durationMs?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICON_MAP: Record<ToastVariant, React.ReactNode> = {
  success: <Check         size={15} />,
  error:   <AlertTriangle size={15} />,
  info:    <Info          size={15} />,
};

const ACCENT_MAP: Record<ToastVariant, string> = {
  success: 'var(--c-success, #4a7c59)',
  error:   '#e05260',
  info:    'var(--c-gold)',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prefersReduced = useReducedMotion();

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = 'info', durationMs = 3200) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, message, variant }]);
    const timer = setTimeout(() => dismiss(id), durationMs);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const value: ToastContextValue = {
    show,
    success: (m, d) => show(m, 'success', d),
    error:   (m, d) => show(m, 'error',   d),
    info:    (m, d) => show(m, 'info',    d),
    dismiss,
  };

  /* POLISH: reduced-motion users get an instant fade, not a spring */
  const enter = prefersReduced
    ? { duration: 0.01 }
    : { type: 'spring' as const, stiffness: 420, damping: 34 };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        /* POLISH: bottom-centre stack, above the nav, safe-area aware */
        style={{
          position:  'fixed',
          left:      0,
          right:     0,
          bottom:    'calc(88px + env(safe-area-inset-bottom))',
          zIndex:    200,
          display:   'flex',
          flexDirection: 'column',
          alignItems:    'center',
          gap:       8,
          pointerEvents: 'none',
        }}
      >
        <AnimatePresence initial={false}>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              /* POLISH: transform + opacity only, reduced-motion-aware spring */
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit=  {{ opacity: 0, y: 8,   scale: 0.96 }}
              transition={enter}
              role="status"
              aria-live="polite"
              style={{
                pointerEvents: 'auto',
                display:       'inline-flex',
                alignItems:    'center',
                gap:           10,
                maxWidth:      'min(90vw, 420px)',
                padding:       '10px 14px',
                borderRadius:  'var(--r-lg)',
                background:    'rgba(20,20,20,0.96)',
                border:        '1px solid var(--c-border)',
                boxShadow:     'var(--shadow-1), var(--shadow-2), var(--shadow-modal)',
                color:         'var(--c-text)',
                fontSize:      13,
                lineHeight:    1.4,
                contain:       'layout style paint',
              }}
            >
              <span
                aria-hidden
                style={{
                  display:       'inline-flex',
                  alignItems:    'center',
                  justifyContent:'center',
                  width:  22,
                  height: 22,
                  borderRadius: '50%',
                  background:   'rgba(255,255,255,0.06)',
                  color:        ACCENT_MAP[t.variant],
                  flexShrink:   0,
                }}
              >
                {ICON_MAP[t.variant]}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="tap-target anim-press"
                style={{
                  color:      'var(--c-text-3)',
                  flexShrink: 0,
                  marginRight: -6,
                }}
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
