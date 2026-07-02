import { useColorScheme } from "react-native";

// «Halo Cobalt» — single app-wide runtime palette (light + dark token inversion).
// This is the SINGLE source of truth for COLOR. Components call
// useThemeColors() and read t.* into inline styles, so the «no component
// rebuild» promise in DESIGN-SYSTEM.md holds app-wide; the auth screens read
// this via the useAuthTheme alias in components/auth/theme.ts.
//
// NativeWind v5-preview has no `dark:` variants wired, so COLOR never goes
// through classNames — only layout/spacing does. Hence the runtime hook.
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
  brandAccent: string; // finance / profit accent
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
  brandAccent: "#34aadc",
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
  chevron: "#c4c4c4",
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

export const dark: ThemeColors = {
  dark: true,
  statusBar: "light",
  canvas: "#0b0e14",
  surface: "#161b24",
  surfaceElevated: "rgba(22,27,36,0.72)",
  accent: "#5a86ff",
  accentFrom: "#5a86ff",
  accentTo: "#2c5be0",
  onAccent: "#ffffff",
  brandAccent: "#5ac8f5",
  ink: "#f2f5f9",
  body: "#c2ccda",
  sub: "#9ba6b6",
  faint: "#6b7686",
  placeholder: "#5e6878",
  success: "#2fd39a",
  danger: "#ff6b68",
  warning: "#f5b942",
  fill: "rgba(255,255,255,0.07)",
  separator: "rgba(255,255,255,0.10)",
  chevron: "#4a5260",
  highlight: "rgba(255,255,255,0.06)",
  pressed: "rgba(255,255,255,0.05)",
  scrim: "rgba(0,0,0,0.50)",
  cardShadow: undefined,
  brandShadow: "0px 8px 28px rgba(90,134,255,0.34)",
  disabledFill: "#222834",
  haloOpacity: 0.18,
  googleBg: "#131314",
  googleBorder: "#3a3f47",
  googleText: "#e3e3e3",
  radius: RADIUS,
};

export function useThemeColors(): ThemeColors {
  return useColorScheme() === "dark" ? dark : light;
}
