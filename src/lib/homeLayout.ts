export type NavId = 'home' | 'calendar' | 'challenge';

export interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HomeLayout {
  navOrder: NavId[];
  inputWidget: { x: number; y: number };
  goalCards: Record<string, CardLayout>;
}

export const DEFAULT_LAYOUT: HomeLayout = {
  navOrder: ['challenge', 'home', 'calendar'],
  inputWidget: { x: 16, y: 16 },
  goalCards: {},
};

export const CARD_MIN_W = 160;
export const CARD_MIN_H = 100;
export const CARD_MAX_H = 400;
export const GRID_SNAP  = 8;

export function getLayoutKey(userId: string): string {
  return `layout_${userId}`;
}

export function loadLayout(userId: string): HomeLayout {
  try {
    const raw = localStorage.getItem(getLayoutKey(userId));
    if (!raw) return { ...DEFAULT_LAYOUT, navOrder: [...DEFAULT_LAYOUT.navOrder], goalCards: {} };
    const parsed = JSON.parse(raw) as Partial<HomeLayout>;
    return {
      navOrder:    Array.isArray(parsed.navOrder) && parsed.navOrder.length === 3 ? parsed.navOrder : [...DEFAULT_LAYOUT.navOrder],
      inputWidget: parsed.inputWidget ?? { ...DEFAULT_LAYOUT.inputWidget },
      goalCards:   parsed.goalCards  ?? {},
    };
  } catch {
    return { ...DEFAULT_LAYOUT, navOrder: [...DEFAULT_LAYOUT.navOrder], goalCards: {} };
  }
}

export function saveLayout(userId: string, layout: HomeLayout): void {
  try {
    localStorage.setItem(getLayoutKey(userId), JSON.stringify(layout));
  } catch { /* quota exceeded — silently skip */ }
}

/**
 * Given a card that was just moved/resized, check if it overlaps any other card.
 * If so, find the nearest grid-snapped position that does NOT overlap and return it.
 * If no overlap exists, returns `newLayout` unchanged.
 */
export function resolveCardOverlap(
  movedId: string,
  newLayout: CardLayout,
  allLayouts: Record<string, CardLayout>,
  maxW: number,
): CardLayout {
  function overlaps(a: CardLayout, b: CardLayout): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  const others = Object.values(
    Object.fromEntries(Object.entries(allLayouts).filter(([id]) => id !== movedId)),
  );

  if (!others.some(o => overlaps(newLayout, o))) return newLayout;

  let best: CardLayout | null = null;
  let bestDist = Infinity;

  const searchRadius = 24;

  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = 0; dy <= searchRadius * 2; dy++) {
      const candidate: CardLayout = {
        ...newLayout,
        x: Math.max(0, Math.min(newLayout.x + dx * GRID_SNAP, maxW - newLayout.width)),
        y: Math.max(0, newLayout.y + (dy - searchRadius) * GRID_SNAP),
      };

      if (!others.some(o => overlaps(candidate, o))) {
        const dist = dx * dx + (dy - searchRadius) * (dy - searchRadius);
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      }
    }
  }

  return best ?? newLayout;
}

export function computeInitialCardLayouts(goalIds: string[]): Record<string, CardLayout> {
  const cardW   = 220;
  const cardH   = 150;
  const gap     = 16;
  const padding = 16;
  const availW  = typeof window !== 'undefined' ? window.innerWidth - 2 * padding : 380;
  const cols    = Math.max(1, Math.floor(availW / (cardW + gap)));

  const result: Record<string, CardLayout> = {};
  goalIds.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    result[id] = {
      x: padding + col * (cardW + gap),
      y: padding + row * (cardH + gap),
      width:  cardW,
      height: cardH,
    };
  });
  return result;
}
