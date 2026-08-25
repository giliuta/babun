// Single source of truth for the app version.
//
// Two surfaces:
//
//   BUILD_VERSION  — descriptive slug ("v513-appointment-sync-error").
//                    Used for in-dev build-tag chip, Sentry release
//                    tags, and CI/PR titles. Bump on every meaningful
//                    change. NEVER render to end-user UI — the slug
//                    leaks internal commit-naming into the product.
//
//   DISPLAY_VERSION — formatted "v1.<minor>.<patch>" derived from
//                    BUILD_VERSION's numeric prefix:
//                    `v513-...` → `v1.5.13` (minor = floor(513/100),
//                    patch = 513 % 100). This is what the user sees
//                    in the sidebar footer and settings page footer.

export const BUILD_VERSION = "v828-finances-profit-panel";

function deriveDisplayVersion(slug: string): string {
  const match = slug.match(/^v(\d+)/);
  if (!match) return "v1.0.0";
  const build = parseInt(match[1], 10);
  if (!Number.isFinite(build) || build < 0) return "v1.0.0";
  const minor = Math.floor(build / 100);
  const patch = build % 100;
  return `v1.${minor}.${patch}`;
}

export const DISPLAY_VERSION = deriveDisplayVersion(BUILD_VERSION);
