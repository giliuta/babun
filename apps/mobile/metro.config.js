// Metro config for the Babun app inside a bun-workspaces monorepo.
//
//   1. getDefaultConfig — Expo SDK 54 provides monorepo watch/resolution
//      defaults; don't replace them with a partial list.
//   2. withNativeWind — compiles Tailwind classes -> RN styles via global.css.
//   3. react dedup — force exactly ONE physical react/react-dom into the bundle.
//
// The dedup is not optional. bun hoists react to the workspace root, but two
// things still create extra copies: the app pins react 19.1.0 exactly (required
// by RN 0.81.5's bundled renderer) so bun may keep a workspace-local copy, and
// libraries whose peer range predates React 19 — lucide-react-native declares
// "^16.5.1 || ^17.0.0 || ^18.0.0" — get their own nested install. Two module
// instances mean two React registries: "Invalid hook call", or the harder
// "react and react-native-renderer must be the exact same version".
//
// The path is RESOLVED, not written down. An earlier version hardcoded
// projectRoot/node_modules/react; when hoisting changed and that directory
// stopped existing, every bundle — web and native alike — failed to resolve
// react/jsx-runtime. require.resolve answers the same question correctly
// whichever way bun decides to lay the tree out.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
let config = withNativeWind(getDefaultConfig(projectRoot), { input: "./global.css" });

const DEDUPE = ["react", "react-dom"].map((name) => [
  name,
  path.dirname(require.resolve(`${name}/package.json`, { paths: [projectRoot] })),
]);

const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, dir] of DEDUPE) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      return context.resolveRequest(context, dir + moduleName.slice(name.length), platform);
    }
  }
  return (previous ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
