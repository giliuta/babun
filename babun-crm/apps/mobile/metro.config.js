// Metro config for the Babun mobile app inside a bun-workspaces monorepo.
//
//   1. getDefaultConfig — Expo SDK 54 provides monorepo watch/resolution
//      defaults; don't replace them with a partial list.
//   2. withNativeWind — compiles Tailwind classes -> RN styles via global.css.
//   3. react dedup — force ONE copy of react. The mobile app pins react 19.1.0
//      (required by RN 0.81.5's bundled renderer) while the web workspace
//      hoists react 19.2.4 to the monorepo root. Without this, hoisted
//      react-native imports root 19.2.4 while app code uses 19.1.0 → the
//      "react and react-native-renderer must be the exact same version" crash.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
let config = getDefaultConfig(projectRoot);

config = withNativeWind(config, { input: "./global.css" });

// Pin react/react-dom to the app's own 19.1.0 copy (chained AFTER NativeWind).
const DEDUPE = ["react", "react-dom"];
const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const name of DEDUPE) {
    if (moduleName === name || moduleName.startsWith(name + "/")) {
      return context.resolveRequest(
        context,
        path.join(projectRoot, "node_modules", name) + moduleName.slice(name.length),
        platform,
      );
    }
  }
  return (prevResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
