import React from 'react';
import { Goal } from '../types';
import { motion } from 'motion/react';
import { Target, ChevronRight, Loader2, AlertCircle, RefreshCw, Users } from 'lucide-react';
import { cn } from '../lib/utils';

interface GoalCardProps {
  goal: Goal;
  onClick: () => void;
  onRetry?: (goal: Goal) => void;
}

export function GoalCard({ goal, onClick, onRetry }: GoalCardProps) {
  const isOptimistic = goal.id.startsWith('temp-');
  const isSaving = goal.savingStatus === 'saving';
  const isError = goal.savingStatus === 'error';
  const similarCount = goal.similarGoals?.length || 0;

  return (
    <motion.div
      whileHover={!isSaving ? { y: -5, scale: 1.02 } : {}}
      whileTap={!isSaving ? { scale: 0.98 } : {}}
      onClick={!isSaving ? onClick : undefined}
      className={cn(
        "group relative p-8 bg-zinc-900/50 border rounded-[2.5rem] transition-all overflow-hidden",
        isError ? "border-red-500/50" : "border-zinc-800 hover:border-zinc-700",
        isSaving ? "cursor-wait opacity-80" : "cursor-pointer"
      )}
    >
      {/* Similar Goals Badge */}
      {similarCount > 0 && (
        <div className="absolute top-6 left-6 z-10 flex items-center gap-1.5 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/10">
          <Users size={12} className="text-white" />
          <span className="text-[10px] font-bold text-white tracking-widest">{similarCount} Similar</span>
        </div>
      )}

      {/* Saving Overlay */}
      {isSaving && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-white" size={24} />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Saving...</span>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {isError && (
        <div className="absolute inset-0 bg-red-500/5 backdrop-blur-[2px] flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <div className="flex items-center gap-2 text-red-500 mb-1">
              <AlertCircle size={18} />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Failed to save</span>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onRetry?.(goal);
              }}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 active:scale-95"
            >
              <RefreshCw size={12} />
              Retry Save
            </button>
          </div>
        </div>
      )}

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
      
      <h3 className="text-xl font-bold mb-2 group-hover:translate-x-1 transition-transform break-words">{goal.title}</h3>
      <p className="text-zinc-500 text-sm mb-8 leading-relaxed break-words">{goal.description}</p>
      
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
