import React from 'react';

/* POLISH: shared skeleton primitive — drives the .skeleton-shimmer keyframe
   defined in styles/animations.css (GPU translateX gradient, not background-
   position). Variants cover the common silhouettes we repeat across screens. */

type SkeletonVariant = 'text' | 'title' | 'circle' | 'card' | 'block';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?:   number | string;
  height?:  number | string;
  radius?:  number | string;
  className?: string;
  style?:   React.CSSProperties;
}

const VARIANT_DEFAULTS: Record<SkeletonVariant, { w: string; h: number; r: string }> = {
  text:   { w: '70%',  h: 12, r: '6px'          },
  title:  { w: '50%',  h: 16, r: '8px'          },
  circle: { w: '44px', h: 44, r: '50%'          },
  card:   { w: '100%', h: 96, r: 'var(--r-lg)'  },
  block:  { w: '100%', h: 40, r: 'var(--r-md)'  },
};

export function Skeleton({
  variant = 'text',
  width,
  height,
  radius,
  className,
  style,
}: SkeletonProps) {
  const d = VARIANT_DEFAULTS[variant];
  return (
    <span
      aria-hidden
      className={`skeleton-shimmer block ${className ?? ''}`}
      style={{
        width:        width  ?? d.w,
        height:       height ?? d.h,
        borderRadius: radius ?? d.r,
        background:   'var(--c-surface-2)',
        ...style,
      }}
    />
  );
}

/* POLISH: convenience wrapper — a stack of rows (default 3) mimicking a
   paragraph or list; descending widths give a more natural "text" feel. */
export function SkeletonStack({ rows = 3, gap = 8 }: { rows?: number; gap?: number }) {
  const widths = ['85%', '72%', '60%', '78%', '64%'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="text" width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
