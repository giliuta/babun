// Scheme-invariant UI tokens. COLOR lives exclusively in src/theme/colors.ts;
// the old static COLORS mirror was removed so the fixed light palette has one
// runtime source of truth.

// Lucide icon sizes — use these instead of scattered literals.
export const ICON = { lg: 24, md: 22, sm: 18, xs: 14 } as const;

// DS §2 type-scale anchor that repeats across screens: Display = the root
// (tab) screen title — Клиенты / Чаты / Финансы / Кабинет. The calendar root
// intentionally keeps its compact web-parity control bar instead.
export const TYPE = {
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
} as const;
