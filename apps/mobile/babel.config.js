// NativeWind v5 + Expo Router babel config.
//
//   * "nativewind/babel" (= react-native-css/babel) is a babel-PLUGIN-based
//     transform in v5 — NO `jsxImportSource` needed (that was the v4 way,
//     and v5 doesn't ship nativewind/jsx-runtime).
//   * react-native-reanimated/plugin (worklets) MUST be the LAST plugin.
//     (If SDK 54's babel-preset-expo auto-injects worklets and errors on a
//     duplicate, drop this line — see apps/mobile/SETUP.md.)
//   * nativewind/babel is scoped to APP SOURCE ONLY via `overrides.exclude`.
//     Its import-plugin rewrites every `from "react-native"` /
//     `from "react-native-web"` it sees into `react-native-css/components/*`
//     — and it does that in node_modules too. On the WEB target that closes
//     a require cycle through react-native-web's barrel index: the barrel
//     defines its lazy getters BEFORE its `var` block runs, so the re-entry
//     reads `FlatList` while the backing var is still undefined and the app
//     dies at boot with "Cannot read properties of undefined (reading
//     'default')" — a blank page, no React tree. Native never hit it because
//     that bundle resolves react-native directly instead of via the barrel.
//     App code is the only place `className` exists, so excluding
//     node_modules costs nothing.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
    overrides: [
      {
        exclude: /node_modules/,
        presets: ["nativewind/babel"],
      },
    ],
  };
};
