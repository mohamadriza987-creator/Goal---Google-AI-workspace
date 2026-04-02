import React from 'react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface NavButtonProps {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}

export function NavButton({ active, icon, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative p-2.5 rounded-full transition-all duration-300 group",
        active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      <div className={cn(
        "relative z-10 transition-transform duration-300",
        active ? "scale-110" : "group-hover:scale-105"
      )}>
        {icon}
      </div>
      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute inset-0 bg-white/10 rounded-full -z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
      )}
    </button>
  );
}
