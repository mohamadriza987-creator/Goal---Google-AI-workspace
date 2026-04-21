import React, { useRef, useEffect, useState } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'motion/react';
import { useHomeEditMode } from '../contexts/HomeEditModeContext';
import { useLongPress } from '../hooks/useLongPress';

const JIGGLE_ANIMATE    = { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0] };
const JIGGLE_TRANSITION = { repeat: Infinity, duration: 0.45, ease: 'easeInOut' } as const;

const WIDGET_PADDING = 32; // 16px each side

function getAvailableWidth() {
  return typeof window !== 'undefined' ? window.innerWidth - WIDGET_PADDING : 340;
}

interface Props {
  children: React.ReactNode;
}

export function DraggableInputWidget({ children }: Props) {
  const { isEditMode, enterEditMode, layout, setInputWidgetPos } = useHomeEditMode();
  const longPress = useLongPress(enterEditMode, { delay: 1200 });
  const [rndWidth, setRndWidth] = useState(getAvailableWidth);

  // Keep width in sync with window size
  useEffect(() => {
    const onResize = () => setRndWidth(getAvailableWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Clamp saved position so widget is never off-screen after resize
  const clampedX = Math.min(layout.inputWidget.x, Math.max(0, getAvailableWidth() - 80));
  const clampedY = Math.max(0, layout.inputWidget.y);

  if (isEditMode) {
    return (
      <Rnd
        position={{ x: clampedX, y: clampedY }}
        size={{ width: rndWidth, height: 'auto' as any }}
        enableResizing={false}
        bounds="parent"
        dragGrid={[8, 8]}
        onDragStop={(_e, d) => setInputWidgetPos({ x: d.x, y: d.y })}
        style={{ zIndex: 10 }}
      >
        <motion.div
          animate={JIGGLE_ANIMATE}
          transition={JIGGLE_TRANSITION}
          className="px-4"
          style={{ cursor: 'grab' }}
        >
          {children}
        </motion.div>
      </Rnd>
    );
  }

  /* Normal mode: fixed bar above the nav */
  return (
    <div
      /* POLISH: safe-area-aware bottom padding so the bar never hides behind
         the iOS home indicator; layered shadow + saturate blur to match nav;
         paint containment keeps this element out of global repaints.
         SAFARI: translate3d promotes this fixed bar to its own compositor
         layer so the backdrop-filter doesn't flicker during scroll. */
      style={{
        position:             'fixed',
        bottom:               68,
        left:                 0,
        right:                0,
        zIndex:               45,
        paddingTop:           10,
        paddingLeft:          16,
        paddingRight:         16,
        paddingBottom:        'max(10px, env(safe-area-inset-bottom))',
        background:           'rgba(10,10,10,0.92)',
        backdropFilter:       'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderTop:            '1px solid var(--c-border)',
        boxShadow:            'var(--shadow-1), var(--shadow-2)',
        contain:              'layout style paint',
        transform:            'translate3d(0, 0, 0)',
        WebkitTransform:      'translate3d(0, 0, 0)',
      }}
      {...longPress}
    >
      {children}
    </div>
  );
}
