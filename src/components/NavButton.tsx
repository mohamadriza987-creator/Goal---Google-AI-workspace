import React from 'react';
import { cn } from '../lib/utils';

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
        "p-4 rounded-full transition-all",
        active ? "bg-white text-black" : "text-zinc-500 hover:text-white"
      )}
    >
      {icon}
    </button>
  );
}
