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

  /* Normal mode: natural flow, long-press activates edit mode */
  return (
    <div className="px-4 mt-4" {...longPress}>
      {children}
    </div>
  );
}
