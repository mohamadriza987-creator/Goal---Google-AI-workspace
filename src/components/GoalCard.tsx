import React from 'react';
import { Goal } from '../types';
import { motion } from 'motion/react';
import { Target, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface GoalCardProps {
  goal: Goal;
  onClick: () => void;
}

export function GoalCard({ goal, onClick }: GoalCardProps) {
  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative p-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] cursor-pointer hover:border-zinc-700 transition-all overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-white/10 transition-all" />
      
      <div className="flex items-start justify-between mb-8">
        <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white group-hover:bg-zinc-700 transition-all">
          <Target size={28} />
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold mb-1">Progress</span>
          <span className="text-2xl font-light tabular-nums">{goal.progressPercent}%</span>
        </div>
      </div>
      
      <h3 className="text-xl font-bold mb-2 group-hover:translate-x-1 transition-transform">{goal.title}</h3>
      <p className="text-zinc-500 text-sm line-clamp-2 mb-8 leading-relaxed">{goal.description}</p>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold border",
            goal.category === 'health' ? "border-green-500/20 text-green-500 bg-green-500/5" :
            goal.category === 'learning' ? "border-blue-500/20 text-blue-500 bg-blue-500/5" :
            goal.category === 'personal' ? "border-purple-500/20 text-purple-500 bg-purple-500/5" :
            "border-orange-500/20 text-orange-500 bg-orange-500/5"
          )}>
            {goal.category}
          </span>
        </div>
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
          <ChevronRight size={16} />
        </div>
      </div>
      
      <div className="absolute bottom-0 left-0 h-1 bg-white/10 w-full">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${goal.progressPercent}%` }}
          className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]"
        />
      </div>
    </motion.div>
  );
}
