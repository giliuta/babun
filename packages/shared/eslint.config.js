// Same rules as the app (apps/mobile/eslint.config.js): the shared package
// is part of the app's bundle, so it is linted by the same config.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig]);
