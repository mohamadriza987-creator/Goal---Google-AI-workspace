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
  navOrder: ['home', 'calendar', 'challenge'],
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
