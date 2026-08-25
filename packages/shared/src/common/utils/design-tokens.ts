// Telegram design tokens (Sprint 031).
//
// Typed mirror of the CSS variables declared in src/app/globals.css.
// Import these when a component needs a value outside of Tailwind's
// utility classes (inline styles, SVG fills, framer-motion props,
// Chart.js colours, etc.). For everyday styling prefer Tailwind
// classes — they read from the same `@theme` block so they stay
// consistent by construction.
//
// Kept the HIG-era export shape so existing imports don't break.

export const color = {
  surface: {
    grouped: "var(--surface-grouped)",
    card: "var(--surface-card)",
    cardSecondary: "var(--surface-card-secondary)",
    overlay: "var(--surface-overlay)",
    navBlur: "var(--surface-nav-blur)",
    tintAccent: "var(--surface-tint-accent)",
  },
  separator: {
    default: "var(--separator)",
    opaque: "var(--separator-opaque)",
  },
  label: {
    primary: "var(--label)",
    secondary: "var(--label-secondary)",
    tertiary: "var(--label-tertiary)",
    quaternary: "var(--label-quaternary)",
    onAccent: "var(--label-on-accent)",
  },
  fill: {
    primary: "var(--fill-primary)",
    secondary: "var(--fill-secondary)",
    tertiary: "var(--fill-tertiary)",
    quaternary: "var(--fill-quaternary)",
  },
  accent: {
    default: "var(--accent)",
    pressed: "var(--accent-pressed)",
    tint: "var(--accent-tint)",
    on: "var(--accent-on)",
  },
  system: {
    red: "var(--system-red)",
    orange: "var(--system-orange)",
    yellow: "var(--system-yellow)",
    green: "var(--system-green)",
    mint: "var(--system-mint)",
    teal: "var(--system-teal)",
    cyan: "var(--system-cyan)",
    blue: "var(--system-blue)",
    indigo: "var(--system-indigo)",
    purple: "var(--system-purple)",
    pink: "var(--system-pink)",
  },
  tile: {
    red: "var(--tile-red)",
    orange: "var(--tile-orange)",
    yellow: "var(--tile-yellow)",
    green: "var(--tile-green)",
    mint: "var(--tile-mint)",
    teal: "var(--tile-teal)",
    cyan: "var(--tile-cyan)",
    blue: "var(--tile-blue)",
    indigo: "var(--tile-indigo)",
    purple: "var(--tile-purple)",
    pink: "var(--tile-pink)",
    gray: "var(--tile-gray)",
  },
} as const;

// Telegram uses neutral tracking across all weights — the HIG-era
// negative tracking is gone. Sizes stay identical so the type scale
// stays compatible across components.
export const typography = {
  largeTitle: { size: 34, lineHeight: 41, weight: 700, tracking: "-0.01em" },
  title1: { size: 28, lineHeight: 34, weight: 700, tracking: "-0.01em" },
  title2: { size: 22, lineHeight: 28, weight: 600, tracking: "-0.01em" },
  title3: { size: 20, lineHeight: 25, weight: 600, tracking: "0" },
  headline: { size: 17, lineHeight: 22, weight: 600, tracking: "0" },
  body: { size: 17, lineHeight: 22, weight: 400, tracking: "0" },
  callout: { size: 16, lineHeight: 21, weight: 400, tracking: "0" },
  subhead: { size: 15, lineHeight: 20, weight: 400, tracking: "0" },
  footnote: { size: 13, lineHeight: 18, weight: 400, tracking: "0" },
  caption1: { size: 12, lineHeight: 16, weight: 500, tracking: "0" },
  caption2: { size: 11, lineHeight: 13, weight: 600, tracking: "0.02em" },
} as const;

// 8-pt grid (1:1 on web).
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  massive: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 16,
  xxl: 20,
  tile: 7,
  card: 10,
  sheet: 14,
  pill: 9999,
} as const;

export const duration = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

// Colour "tones" used by the Settings-style icon tiles. Paired with
// a lucide icon they produce the Telegram settings tile look
// (rounded-tile, white icon, coloured background). Bg classes read
// from the same CSS vars as the rest of the palette so dark-mode
// overrides Just Work.
export type IconTone =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "mint"
  | "teal"
  | "cyan"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "gray"
  /* Back-compat aliases kept so existing call sites don't break. */
  | "violet"
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "slate";

export const ICON_TONE_BG: Record<IconTone, string> = {
  red: "bg-[var(--tile-red)]",
  orange: "bg-[var(--tile-orange)]",
  yellow: "bg-[var(--tile-yellow)]",
  green: "bg-[var(--tile-green)]",
  mint: "bg-[var(--tile-mint)]",
  teal: "bg-[var(--tile-teal)]",
  cyan: "bg-[var(--tile-cyan)]",
  blue: "bg-[var(--tile-blue)]",
  indigo: "bg-[var(--tile-indigo)]",
  purple: "bg-[var(--tile-purple)]",
  pink: "bg-[var(--tile-pink)]",
  gray: "bg-[var(--tile-gray)]",
  /* Aliases → nearest Telegram tile. */
  violet: "bg-[var(--tile-purple)]",
  sky: "bg-[var(--tile-cyan)]",
  emerald: "bg-[var(--tile-green)]",
  amber: "bg-[var(--tile-orange)]",
  rose: "bg-[var(--tile-red)]",
  slate: "bg-[var(--tile-gray)]",
};
