// Telemetry seam. Sentry itself is deferred to Phase 8 (push / observability)
// so the Phase 0 build doesn't pull the native @sentry/react-native module or
// its sentry-cli build phase. Re-wire here in Phase 8 behind the same
// initSentry() entry point (called from src/bootstrap.ts).
export function initSentry(): void {
  // no-op until Phase 8
}
