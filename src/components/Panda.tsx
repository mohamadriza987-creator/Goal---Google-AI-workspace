import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';

interface PandaProps {
  isListening: boolean;
  onClick?: () => void;
  className?: string;
}

export function Panda({ isListening, onClick, className }: PandaProps) {
  /* POLISH: reduce-motion users get a calm, still panda — no loops, no pupil drift */
  const prefersReduced = useReducedMotion();

  /* POLISH: pupil offset is driven by a <g transform> so the compositor does the work,
     instead of animating SVG cx/cy which forces per-frame paint. */
  const leftPupil  = isListening ? { x: 10, y:  5 } : { x: 0, y: 0 };
  const rightPupil = isListening ? { x: 10, y:  5 } : { x: 0, y: 0 };

  const idleY      = prefersReduced ? 0 : [0, -2, 0];
  const idleRot    = prefersReduced
    ? 0
    : (isListening ? [0, 1, -1, 0] : [0, 0.5, -0.5, 0]);

  return (
    <motion.div
      className={cn("relative cursor-pointer", className)}
      onClick={onClick}
      /* POLISH: idle float + rotate are gated on prefers-reduced-motion */
      animate={{ y: idleY, rotate: idleRot }}
      transition={{
        y:      { repeat: prefersReduced ? 0 : Infinity, duration: 4, ease: 'easeInOut' },
        rotate: { repeat: prefersReduced ? 0 : Infinity, duration: 6, ease: 'easeInOut' },
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      style={{ willChange: prefersReduced ? 'auto' : 'transform' }}
    >
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full fill-white drop-shadow-2xl"
        /* SAFARI: mirror Tailwind's `drop-shadow-2xl` with a -webkit-filter
           fallback so WebKit renders the soft shadow. The filter/WebkitFilter
           pair lives inline so an older Safari build always has one it can
           resolve even if Tailwind's output ever drops the prefix. */
        style={{
          filter:       'drop-shadow(0 25px 25px rgba(0,0,0,0.15))',
          WebkitFilter: 'drop-shadow(0 25px 25px rgba(0,0,0,0.15))',
        }}
      >
        {/* Ears */}
        <motion.circle
          cx="50" cy="50" r="25" fill="black"
          animate={{ scale: prefersReduced ? 1 : (isListening ? [1, 1.05, 1] : 1) }}
          transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 2 }}
        />
        <motion.circle
          cx="150" cy="50" r="25" fill="black"
          animate={{ scale: prefersReduced ? 1 : (isListening ? [1, 1.05, 1] : 1) }}
          transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 2, delay: 0.2 }}
        />

        {/* Head */}
        <motion.circle
          cx="100" cy="100" r="80" fill="white" stroke="black" strokeWidth="2"
          animate={{ scale: prefersReduced ? 1 : [1, 1.02, 1] }}
          transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 4, ease: 'easeInOut' }}
        />

        {/* Eyes — Black Patches */}
        <ellipse cx="70"  cy="90" rx="20" ry="25" fill="black" />
        <ellipse cx="130" cy="90" rx="20" ry="25" fill="black" />

        {/* POLISH: pupils now live inside a motion.g — we animate the group's transform
            (translateX/translateY) instead of the circle's cx/cy. GPU composited,
            zero paint work per frame.
            SAFARI: wrap the translate in translate3d(...) so WebKit promotes the
            group to its own layer instead of repainting on every spring tick. */}
        <motion.g
          animate={{ x: leftPupil.x, y: leftPupil.y }}
          transition={{ type: 'spring', stiffness: 100, damping: 14 }}
          style={{
            willChange:      prefersReduced ? 'auto' : 'transform',
            transform:       `translate3d(${leftPupil.x}px, ${leftPupil.y}px, 0)`,
            WebkitTransform: `translate3d(${leftPupil.x}px, ${leftPupil.y}px, 0)`,
          }}
        >
          <motion.circle
            cx={60} cy={85} r={5} fill="white"
            animate={{ scale: prefersReduced ? 1 : (isListening ? [1, 1.2, 1] : 1) }}
            transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 3 }}
          />
        </motion.g>

        <motion.g
          animate={{ x: rightPupil.x, y: rightPupil.y }}
          transition={{ type: 'spring', stiffness: 100, damping: 14 }}
          style={{
            willChange:      prefersReduced ? 'auto' : 'transform',
            transform:       `translate3d(${rightPupil.x}px, ${rightPupil.y}px, 0)`,
            WebkitTransform: `translate3d(${rightPupil.x}px, ${rightPupil.y}px, 0)`,
          }}
        >
          <motion.circle
            cx={120} cy={85} r={5} fill="white"
            animate={{ scale: prefersReduced ? 1 : (isListening ? [1, 1.2, 1] : 1) }}
            transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 3, delay: 0.5 }}
          />
        </motion.g>

        {/* Nose */}
        <motion.circle
          cx="100" cy="120" r="8" fill="black"
          animate={{ scale: prefersReduced ? 1 : [1, 1.1, 1] }}
          transition={{ repeat: prefersReduced ? 0 : Infinity, duration: 4, ease: 'easeInOut' }}
        />

        {/* Mouth */}
        <path
          d="M 90 135 Q 100 145 110 135"
          fill="none"
          stroke="black"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {isListening && !prefersReduced && (
        <motion.div
          /* POLISH: listening halo — transform + opacity only, never touches layout */
          className="absolute inset-0 rounded-full border-4 border-white/20"
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
          style={{ willChange: 'transform, opacity' }}
        />
      )}
    </motion.div>
  );
}
