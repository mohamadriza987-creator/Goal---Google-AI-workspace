import React from 'react';
import { cn } from '../lib/utils';

interface PandaIconProps {
  size?:   number;
  active?: boolean;
}

export function PandaIcon({ size = 24, active = false }: PandaIconProps) {
  return (
    <div className={cn('relative flex items-center justify-center transition-all duration-300', active ? 'scale-110' : 'hover:scale-105')}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        className={cn('transition-all duration-300', active ? 'fill-black' : 'fill-zinc-400 group-hover:fill-white')}
      >
        <circle cx="50"  cy="50"  r="25" />
        <circle cx="150" cy="50"  r="25" />
        <circle
          cx="100" cy="100" r="80"
          fill={active ? 'white' : 'none'}
          stroke={active ? 'black' : 'currentColor'}
          strokeWidth="8"
        />
        <ellipse cx="70"  cy="90" rx="20" ry="25" />
        <ellipse cx="130" cy="90" rx="20" ry="25" />
        <circle  cx="100" cy="120" r="8" />
      </svg>
    </div>
  );
}
