import React from 'react';
import { motion } from 'motion/react';

interface PandaProps {
  isListening: boolean;
  onClick?: () => void;
}

export function Panda({ isListening, onClick }: PandaProps) {
  return (
    <motion.div
      className="relative w-64 h-64 cursor-pointer"
      onClick={onClick}
      animate={{
        y: [0, -5, 0],
        rotate: isListening ? [0, 1, -1, 0] : [0, 0.5, -0.5, 0],
      }}
      transition={{
        y: { repeat: Infinity, duration: 4, ease: "easeInOut" },
        rotate: { repeat: Infinity, duration: 6, ease: "easeInOut" },
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <svg viewBox="0 0 200 200" className="w-full h-full fill-white drop-shadow-2xl">
        {/* Ears */}
        <motion.circle 
          cx="50" cy="50" r="25" fill="black" 
          animate={{ scale: isListening ? [1, 1.05, 1] : 1 }}
          transition={{ repeat: Infinity, duration: 2 }}
        />
        <motion.circle 
          cx="150" cy="50" r="25" fill="black" 
          animate={{ scale: isListening ? [1, 1.05, 1] : 1 }}
          transition={{ repeat: Infinity, duration: 2, delay: 0.2 }}
        />
        
        {/* Head */}
        <motion.circle 
          cx="100" cy="100" r="80" fill="white" stroke="black" strokeWidth="2" 
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
        />
        
        {/* Eyes - Black Patches */}
        <ellipse cx="70" cy="90" rx="20" ry="25" fill="black" />
        <ellipse cx="130" cy="90" rx="20" ry="25" fill="black" />
        
        {/* Pupils */}
        <motion.circle
          cx={isListening ? 70 : 60}
          cy={isListening ? 90 : 85}
          r="5"
          fill="white"
          animate={{
            cx: isListening ? 70 : 60,
            cy: isListening ? 90 : 85,
            scale: isListening ? [1, 1.2, 1] : 1
          }}
          transition={{ 
            type: 'spring', 
            stiffness: 100,
            scale: { repeat: Infinity, duration: 3 }
          }}
        />
        <motion.circle
          cx={isListening ? 130 : 120}
          cy={isListening ? 90 : 85}
          r="5"
          fill="white"
          animate={{
            cx: isListening ? 130 : 120,
            cy: isListening ? 90 : 85,
            scale: isListening ? [1, 1.2, 1] : 1
          }}
          transition={{ 
            type: 'spring', 
            stiffness: 100,
            scale: { repeat: Infinity, duration: 3, delay: 0.5 }
          }}
        />
        
        {/* Nose */}
        <motion.circle 
          cx="100" cy="120" r="8" fill="black" 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
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
      
      {isListening && (
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-white/20"
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
        />
      )}
    </motion.div>
  );
}
