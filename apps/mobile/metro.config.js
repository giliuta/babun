// Metro config for the Babun app inside a bun-workspaces monorepo.
//
//   1. getDefaultConfig — Expo SDK 54 provides monorepo watch/resolution
//      defaults; don't replace them with a partial list.
//   2. withNativeWind — compiles Tailwind classes -> RN styles via global.css.
//
// A resolveRequest hook used to pin react/react-dom to this app's own copy:
// the Next.js workspace hoisted react 19.2.4 to the monorepo root while the
// app pinned 19.1.0 (required by RN 0.81.5's bundled renderer), and the two
// copies crashed the renderer. That app was removed on 2026-08-25, so bun now
// hoists a single react 19.1.0 to the root and `apps/mobile/node_modules`
// no longer exists — the hook pointed at a directory that isn't there and
// broke every web/native bundle. One react in the tree needs no dedup.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

module.exports = withNativeWind(getDefaultConfig(__dirname), {
  input: "./global.css",
});
