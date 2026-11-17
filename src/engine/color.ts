/** RGBA color with components 0...1 (like SKColor / UIColor) */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function rgb(r: number, g: number, b: number, a = 1): Color {
  return { r, g, b, a };
}

export function white(w: number, a = 1): Color {
  return { r: w, g: w, b: w, a };
}

/** HSB (HSV) color, every component 0...1 */
export function hsb(h: number, s: number, v: number, a = 1): Color {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return { r, g, b, a };
}

export function hex(value: string): Color {
  const n = parseInt(value.replace("#", "").trim(), 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function withAlpha(c: Color, a: number): Color {
  return { r: c.r, g: c.g, b: c.b, a };
}

export function darker(c: Color, by = 0.3): Color {
  return { r: Math.max(c.r - by, 0), g: Math.max(c.g - by, 0), b: Math.max(c.b - by, 0), a: c.a };
}

export function lighter(c: Color, by = 0.2): Color {
  return { r: Math.min(c.r + by, 1), g: Math.min(c.g + by, 1), b: Math.min(c.b + by, 1), a: c.a };
}

export function mix(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

export function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

const cssCache = new Map<number, string>();

/** CSS color string (cached) */
export function css(c: Color): string {
  const r = Math.round(Math.min(Math.max(c.r, 0), 1) * 255);
  const g = Math.round(Math.min(Math.max(c.g, 0), 1) * 255);
  const b = Math.round(Math.min(Math.max(c.b, 0), 1) * 255);
  const a = Math.round(Math.min(Math.max(c.a, 0), 1) * 1000);
  const key = ((r * 256 + g) * 256 + b) * 1001 + a;
  let s = cssCache.get(key);
  if (!s) {
    s = a >= 1000 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a / 1000})`;
    cssCache.set(key, s);
  }
  return s;
}

/** Named colors with the same values as UIKit's */
export const Colors = {
  clear: rgb(0, 0, 0, 0),
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
  red: rgb(1, 0, 0),
  green: rgb(0, 1, 0),
  blue: rgb(0, 0, 1),
  yellow: rgb(1, 1, 0),
  orange: rgb(1, 0.5, 0),
  purple: rgb(0.5, 0, 0.5),
  cyan: rgb(0, 1, 1),
  magenta: rgb(1, 0, 1),
  gray: white(0.5),
  darkGray: white(1 / 3),
  lightGray: white(2 / 3),
} as const;
