// Scheme-invariant UI tokens. COLOR lives exclusively in src/theme/colors.ts
// (runtime light+dark via useThemeColors) — the old static COLORS mirror was
// light-only and unused, so it was removed rather than risk a light palette
// leaking into dark mode.

// Lucide icon sizes — use these instead of scattered literals.
export const ICON = { lg: 24, md: 22, sm: 18, xs: 14 } as const;
