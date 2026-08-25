// Auth screens read the app-wide «Halo Cobalt» palette. Kept as a thin alias so
// the existing `useAuthTheme` / `AuthTheme` imports in AuthCard + SocialAuthButtons
// keep working unchanged. Source of truth: src/theme/colors.ts.
export {
  useThemeColors as useAuthTheme,
  type ThemeColors as AuthTheme,
} from "@/theme/colors";
