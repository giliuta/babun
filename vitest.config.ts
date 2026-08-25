import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for the React Native app and the shared package. Lives at the
// repo root since the Next.js app that used to host this config is gone —
// the web target is now Expo Web, built from apps/mobile.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    clearMocks: true,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/ios/**", "**/android/**", "**/dist/**"],
  },
  resolve: {
    alias: {
      // Subpath imports (@babun/shared/local/X) must land on the TS source,
      // not the package root — see v512.
      "@babun/shared": path.resolve(__dirname, "./packages/shared/src"),
      "@": path.resolve(__dirname, "./apps/mobile/src"),
    },
  },
});
