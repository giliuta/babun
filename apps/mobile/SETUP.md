# Babun Mobile (Expo + RN) — Phase 0

**Status: RUNNING ✅** — boots to the login screen on iOS Simulator (iPhone 17 / iOS 26.5),
Expo Router + NativeWind v5 + Supabase + MMKV all verified working.

> ⚠️ The repo lives at **`/Users/artem/Documents/babun2`** (NOT under "Project Claude" —
> Expo/iOS build scripts break on the space in that path). A symlink at the old location
> keeps old paths resolving. **Always build from the real path** below.

## Prerequisites (installed)
- Xcode 26.5 + iOS 26.5 Simulator runtime (`xcodebuild -downloadPlatform iOS`)
- Node ≥ 20, watchman, cocoapods (`brew install node watchman cocoapods`)
- bun (`/Users/artem/.bun/bin/bun`)

## Run
```bash
cd /Users/artem/Documents/babun2/babun-crm
bun install
cd apps/mobile
# CocoaPods needs a UTF-8 locale or it throws ASCII-8BIT:
LANG=en_US.UTF-8 npx pod-install                 # only after a fresh prebuild
LANG=en_US.UTF-8 npx expo run:ios --device "iPhone 17"
```
`.env.local` is already filled (Supabase URL + publishable key). MMKV/SecureStore are native
modules → use a dev build (`expo run:ios`), NOT Expo Go.

If you change `babel.config.js` / `global.css` / `metro.config.js`, clear Metro cache:
```bash
lsof -ti tcp:8081 | xargs kill -9
rm -rf "$TMPDIR"/metro-cache apps/mobile/.expo node_modules/.cache
```

## Working stack config — the non-obvious bits (DON'T regress these)
1. **Tailwind v4 everywhere.** Mobile uses **NativeWind v5 (`5.0.0-preview.4`) + Tailwind v4**,
   same major as the web app (one tailwind in the monorepo). NativeWind v4 + Tailwind v4 is
   incompatible ("only supports v3").
2. **babel.config.js** = `presets: ["babel-preset-expo", "nativewind/babel"]`. NO
   `jsxImportSource` (that's the v4 way; v5 is a babel plugin with no jsx-runtime export).
3. **postcss.config.js** (`@tailwindcss/postcss`) is REQUIRED — NativeWind v5's Metro
   transformer runs the Expo web-CSS/PostCSS pipeline on `global.css` first; without it the
   `@import`/`@theme` reach lightningcss raw and fail to parse.
4. **lightningcss pinned to `1.30.1`** via root `package.json` → `"overrides"`. react-native-css
   3.0.7 was built against ^1.30.1; 1.32 changed the visitor `Specifier` struct → "failed to
   deserialize" on every CSS compile.
5. **react deduped in `metro.config.js`** (`resolver.resolveRequest`). The web workspace hoists
   react 19.2.4 to the root; RN 0.81.5 needs the app's nested 19.1.0. Without the dedup →
   "react and react-native-renderer must be the exact same version" runtime crash.
6. **global.css** = the 4 canonical v5 imports + `@theme` brand colors + `@source ./app` `./src`.
7. **NativeWind className works on core components** (View/Text/TextInput/Pressable) but NOT on
   wrapper components (`SafeAreaView`, `KeyboardAvoidingView`) out of the box — those use inline
   `style={{ flex: 1 }}` for now. Phase 1 will register cssInterop / a `Screen` primitive.
8. **Sentry deferred to Phase 8** (its sentry-cli postinstall + build phase add friction; the
   telemetry seam in `src/lib/sentry.ts` is a no-op stub).

## Phase 0 verification
- [x] Boots to login screen, styled, centered, RU text renders.
- [x] MMKV storage initializes on device; no runtime errors.
- [ ] **Login with a real Supabase account → 5-tab navigator** (needs credentials).
- [ ] Session persists across relaunch (SecureStore); logout returns to login.

## What Phase 0 does NOT do yet
No offline cache/sync (Phase 2), no real screens (Phases 3–7), no push/deep-links/billing (Phase 8).
Design tokens are seeded in `global.css @theme`; full design system is Phase 1.
