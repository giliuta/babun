// Public share link for an appointment — encodes a minimal snapshot of
// the visit data into a URL-safe base64 token. The client can open the
// link without any auth: everything needed to render the card is in the
// URL. Tokens are snapshots — they freeze the appointment state at the
// moment of sharing, so edits on the dispatcher side don't retro-change
// what the client already saw. Resend a fresh link if details change.
//
// When Supabase lands we'll swap to opaque short tokens backed by a
// `appointment_share_links` table; the call sites stay the same because
// `encodeShareSnapshot` and `decodeShareSnapshot` remain the public API.

export interface ShareSnapshot {
  v: number;
  d: string; // YYYY-MM-DD
  ts: string; // HH:MM
  te: string; // HH:MM
  c?: string; // client name (empty for anonymous)
  s?: string[]; // service names
  a?: string; // address
  b?: string; // brigade / team name
  t?: number; // total euros
  st?: string; // status
  ph?: string; // client phone (only for dispatcher reshare; omit on public share)
}

const SCHEMA_VERSION = 1;

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromUrlSafe(token: string): string {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return b64 + pad;
}

export function encodeShareSnapshot(data: Omit<ShareSnapshot, "v">): string {
  const withVersion: ShareSnapshot = { ...data, v: SCHEMA_VERSION };
  const json = JSON.stringify(withVersion);
  // btoa handles ASCII only — encode via TextEncoder for Cyrillic safety.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return toUrlSafe(b64);
}

export function decodeShareSnapshot(token: string): ShareSnapshot | null {
  try {
    const b64 = fromUrlSafe(token);
    let binary: string;
    if (typeof atob === "function") binary = atob(b64);
    else binary = Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as ShareSnapshot;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.v !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildShareUrl(
  origin: string,
  snapshot: Omit<ShareSnapshot, "v">
): string {
  const token = encodeShareSnapshot(snapshot);
  return `${origin.replace(/\/$/, "")}/b/${token}`;
}
