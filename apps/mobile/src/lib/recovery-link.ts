export type RecoveryLinkCredential =
  | {
      kind: "session";
      accessToken: string;
      refreshToken: string;
    }
  | {
      kind: "token-hash";
      tokenHash: string;
    };

/** Parse both current token-hash links and legacy access-token fragments. */
export function parseRecoveryLink(
  link: string | null | undefined,
): RecoveryLinkCredential | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const value = (name: string) =>
      url.searchParams.get(name) ?? fragment.get(name);
    const accessToken = value("access_token");
    const refreshToken = value("refresh_token");
    if (accessToken && refreshToken) {
      return { kind: "session", accessToken, refreshToken };
    }
    const tokenHash = value("token_hash");
    return tokenHash ? { kind: "token-hash", tokenHash } : null;
  } catch {
    return null;
  }
}
