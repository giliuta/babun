// Deterministic avatar colour from a name — each client gets a stable hue
// so the list isn't a wall of one colour, without decorating with meaning.

// Legacy 12 iOS system colours — mirror the --tile-* tokens in globals.css;
// still power settings ListRow icon tiles via getAvatarColor.
const COLORS = [
  "#FF3B30", // tile-red      systemRed
  "#FF9500", // tile-orange   systemOrange
  "#FFCC00", // tile-yellow   systemYellow
  "#34C759", // tile-green    systemGreen
  "#00C7BE", // tile-mint     systemMint
  "#30B0C7", // tile-teal     systemTeal
  "#32ADE6", // tile-cyan     systemCyan
  "#007AFF", // tile-blue     systemBlue
  "#5E5CE6", // tile-indigo   systemIndigo
  "#AF52DE", // tile-purple   systemPurple
  "#FF2D55", // tile-pink     systemPink
  "#A2845E", // tile-brown    systemBrown
];

// COOL avatar hues — for the soft-tinted client avatar. Deliberately drops
// the semantic trio (red=долг, green=деньги, amber=caution) and the cobalt
// accent (=action): a tinted avatar must never read as a money / status /
// action signal sitting in the same row as the real ones.
const AVATAR_HUES = [
  "#5E5CE6", // indigo
  "#7B61FF", // violet
  "#AF52DE", // purple
  "#30B0C7", // teal
  "#2AA6C9", // deep cyan
  "#3E78C9", // muted blue (not the cobalt accent)
  "#0E7490", // deep teal
  "#8B6F5C", // warm brown
];

// DJB2-ish hash with a prime mix step so names like «Анастасия П», «Анна»,
// «Ангела М» (same leading code units) don't collide; length mixed back in
// so equal-prefix names of different length land on different hues. Walks
// code points so surrogate-pair / Cyrillic input stays stable.
function hashName(name: string): number {
  let hash = 5381;
  const cps = Array.from(name.trim());
  for (let i = 0; i < cps.length; i++) {
    hash = ((hash << 5) + hash) ^ cps[i].codePointAt(0)!;
  }
  return (hash ^ (cps.length * 2654435761)) >>> 0;
}

export function getAvatarColor(name: string): string {
  return COLORS[hashName(name) % COLORS.length];
}

/** Soft-tint avatar hue (clients list) — cool palette, no semantic clash. */
export function getAvatarHue(name: string): string {
  return AVATAR_HUES[hashName(name) % AVATAR_HUES.length];
}

// Clients occasionally name their contacts with emoji prefixes
// ("⭐ Мария", "🔥 Дима") as ad-hoc VIP flags. `.slice(0, 2)` on the
// raw string then chops the emoji surrogate pair in half and the
// avatar shows a broken glyph. Strip emoji/symbols/punctuation first,
// then walk code points (not code units) so Cyrillic / accented
// letters still render their first grapheme correctly.
export function getInitials(name: string): string {
  const cleaned = name
    .replace(
      /[\p{Extended_Pictographic}\p{Emoji_Component}\p{Symbol}\p{Punctuation}]/gu,
      " ",
    )
    .trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/);
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last =
    parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  if (parts.length === 1) {
    const cps = Array.from(parts[0]);
    return ((cps[0] ?? "?") + (cps[1] ?? "")).toUpperCase();
  }
  return (first + last).toUpperCase();
}
