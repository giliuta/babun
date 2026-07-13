// «Halo Cobalt» — single app-wide runtime palette. LIGHT-ONLY: the app is
// locked to the light scheme (see bootstrap.ts «Appearance.setColorScheme» +
// app.json «userInterfaceStyle: light»), so there is no dark palette.
// This is the SINGLE source of truth for COLOR. Components call
// useThemeColors() and read t.* into inline styles, so the «no component
// rebuild» promise in DESIGN-SYSTEM.md holds app-wide; the auth screens read
// this via the useAuthTheme alias in components/auth/theme.ts.
export type ThemeColors = {
  dark: boolean;
  statusBar: "dark" | "light";
  // surfaces
  canvas: string;
  surface: string;
  surfaceElevated: string;
  // brand + the ONLY gradient
  accent: string;
  accentFrom: string;
  accentTo: string;
  onAccent: string;
  brandAccent: string; // finance / profit accent — kept as a token but
  // aliased to the cobalt accent (DS: single accent, no second teal hue).
  // text tiers
  ink: string;
  body: string;
  sub: string;
  faint: string;
  placeholder: string;
  // semantic = meaning
  success: string;
  danger: string;
  warning: string;
  // seams + depth
  fill: string; // idle chip / segmented track / inset input fill
  separator: string;
  chevron: string;
  highlight: string;
  pressed: string; // row/button pressed fill
  scrim: string; // modal backdrop
  cardShadow?: string; // undefined in dark — surfaces lift by tone
  brandShadow: string;
  disabledFill: string;
  haloOpacity: number;
  // auth social chips
  googleBg: string;
  googleBorder: string;
  googleText: string;
  // radii (scheme-invariant — colocated so one import drives a screen)
  radius: { card: number; input: number; pill: number; logo: number };
};

const RADIUS = { card: 20, input: 14, pill: 999, logo: 18 } as const;

export const light: ThemeColors = {
  dark: false,
  statusBar: "dark",
  canvas: "#f4f6f9",
  surface: "#ffffff",
  surfaceElevated: "rgba(255,255,255,0.72)",
  accent: "#2c5be0",
  accentFrom: "#3e84ff",
  accentTo: "#1f4fcc",
  onAccent: "#ffffff",
  brandAccent: "#2c5be0",
  ink: "#0b1220",
  body: "#39414e",
  sub: "#5b6678",
  // WCAG AA: 4.6:1 on canvas / 5.0:1 on surface (was #97a0ae ≈ 2.4:1 —
  // unreadable captions). Still lighter than `sub`, so the tier order holds.
  faint: "#66707e",
  placeholder: "#8b94a3",
  success: "#1fb47a",
  danger: "#f0473c",
  warning: "#f5a623",
  fill: "#eef1f5",
  separator: "#e7ebf0",
  // «Из чёрного, не серого»: прозрачный ink вместо плоского #c4c4c4 — шевроны
  // читаемы, но остаются самым тихим слоем иерархии.
  chevron: "rgba(11,18,32,0.24)",
  highlight: "rgba(255,255,255,0.9)",
  pressed: "rgba(11,18,32,0.04)",
  scrim: "rgba(11,18,32,0.30)",
  cardShadow: "0px 1px 2px rgba(11,18,32,0.04), 0px 8px 24px rgba(11,18,32,0.06)",
  brandShadow: "0px 8px 28px rgba(44,91,224,0.28)",
  // Light enough that a `sub`-colored disabled label reads at ≥4.5:1.
  disabledFill: "#e2e7ee",
  haloOpacity: 0.12,
  googleBg: "#ffffff",
  googleBorder: "#d9dee5",
  googleText: "#1f1f1f",
  radius: RADIUS,
};

export function useThemeColors(): ThemeColors {
  return light;
}
