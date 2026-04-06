import React from 'react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface NavButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

export function NavButton({ active, icon, label, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center gap-0.5 px-5 py-2 rounded-full transition-all duration-300 group',
        active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
      )}
    >
      <div className={cn(
        'relative z-10 transition-transform duration-300',
        active ? 'scale-110' : 'group-hover:scale-105'
      )}>
        {icon}
      </div>
      <span className={cn(
        'text-[10px] font-semibold tracking-wide z-10 transition-colors duration-300',
        active ? 'text-gold' : 'text-zinc-600 group-hover:text-zinc-400'
      )}>
        {label}
      </span>

      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute inset-0 bg-white/8 rounded-full -z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: .2 }}
        />
      )}
    </button>
  );
}