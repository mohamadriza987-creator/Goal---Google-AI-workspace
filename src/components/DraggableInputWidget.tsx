import React, { useRef } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'motion/react';
import { useHomeEditMode } from '../contexts/HomeEditModeContext';
import { useLongPress } from '../hooks/useLongPress';

const JIGGLE_ANIMATE    = { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0] };
const JIGGLE_TRANSITION = { repeat: Infinity, duration: 0.45, ease: 'easeInOut' } as const;

interface Props {
  children: React.ReactNode;
}

export function DraggableInputWidget({ children }: Props) {
  const { isEditMode, enterEditMode, layout, setInputWidgetPos } = useHomeEditMode();
  const longPress = useLongPress(enterEditMode, { delay: 1200 });

  /* rnd size — fixed width (fills the available lane), auto height */
  const rndWidth = typeof window !== 'undefined' ? window.innerWidth - 32 : 340;

  if (isEditMode) {
    return (
      <Rnd
        position={{ x: layout.inputWidget.x, y: layout.inputWidget.y }}
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
