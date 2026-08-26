// Telemetry seam, called once from src/bootstrap.ts before anything else runs.
//
// Without EXPO_PUBLIC_SENTRY_DSN this stays a no-op: a developer checkout with
// no .env.local must boot silently rather than crash or spam a stranger's
// project. The DSN is publishable by design — it ships inside the client
// bundle and is visible to anyone who opens the web app.
//
// PRIVACY IS NOT OPTIONAL HERE. Babun holds real client names, phone numbers
// and addresses. An error reporter that helpfully attaches "context" is one
// misconfiguration away from copying a tenant's address book to a third party,
// so the defaults below are deliberately narrow:
//
//   sendDefaultPii: false  — no IP addresses, no request bodies, no user data
//                            beyond what we attach on purpose (nothing, today).
//   tracesSampleRate: 0    — performance tracing off. It samples navigation and
//                            network spans, whose URLs carry row ids; we have
//                            no use for the numbers and every reason to skip
//                            the exposure.
//
// Stack traces arrive minified until source-map upload is wired. That needs a
// SENTRY_AUTH_TOKEN in the build environment plus the @sentry/react-native
// config plugin, which is a separate decision — see docs/APPLE-RELEASE.md.
import * as Sentry from "@sentry/react-native";

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Separates "the owner broke it on his laptop" from "a crew hit it on a
    // roof in Limassol". Without this both land in one bucket and the counts
    // stop meaning anything.
    environment: __DEV__ ? "development" : "production",
    // Errors thrown while Metro is attached are already visible in the
    // terminal and on the red screen; shipping them too just burns quota and
    // buries the reports that came from real devices.
    enabled: !__DEV__,
  });
}
