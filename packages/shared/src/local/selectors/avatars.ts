// Avatar presets for master cards.
//
// 14 cartoon-style avatars generated on-demand by DiceBear's public
// `avataaars` style — the little flat-colour cartoon people. Seeds
// are fixed so the same preset renders identically across devices.
// Uploaded photos are stored as data URLs inside the Master record
// (localStorage today, Supabase Storage eventually).

const DICEBEAR_BASE = "https://api.dicebear.com/9.x/avataaars/svg";

// 48 hand-picked seeds that produce visually distinct faces — hair,
// skin, clothes, accessories. Together with the «Upload your own»
// tile in the picker this makes a 7×7 grid (1 upload + 48 presets).
// Replace with your own art later; the only contract is that
// getAvatarPreset(i) returns a stable URL.
const PRESET_SEEDS: readonly string[] = [
  "babun-1-felix",
  "babun-2-maya",
  "babun-3-leo",
  "babun-4-zoe",
  "babun-5-noah",
  "babun-6-aria",
  "babun-7-ivan",
  "babun-8-mira",
  "babun-9-omar",
  "babun-10-kira",
  "babun-11-sam",
  "babun-12-luna",
  "babun-13-theo",
  "babun-14-nora",
  "babun-15-dima",
  "babun-16-olya",
  "babun-17-grisha",
  "babun-18-vera",
  "babun-19-max",
  "babun-20-tanya",
  "babun-21-pasha",
  "babun-22-sonia",
  "babun-23-boris",
  "babun-24-lera",
  "babun-25-anton",
  "babun-26-nina",
  "babun-27-vlad",
  "babun-28-katya",
  "babun-29-roman",
  "babun-30-yana",
  "babun-31-denis",
  "babun-32-alina",
  "babun-33-kostya",
  "babun-34-oksana",
  "babun-35-ilya",
  "babun-36-polina",
  "babun-37-gleb",
  "babun-38-margo",
  "babun-39-stas",
  "babun-40-daria",
  "babun-41-arthur",
  "babun-42-vika",
  "babun-43-petr",
  "babun-44-ksyu",
  "babun-45-egor",
  "babun-46-uliana",
  "babun-47-matvey",
  "babun-48-liza",
];

export const AVATAR_PRESET_COUNT = PRESET_SEEDS.length;

export function getAvatarPreset(index: number): string {
  const safe = ((index % PRESET_SEEDS.length) + PRESET_SEEDS.length) %
    PRESET_SEEDS.length;
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(PRESET_SEEDS[safe])}`;
}

export function getAvatarPresets(): string[] {
  return PRESET_SEEDS.map((_, i) => getAvatarPreset(i));
}

/** True for any recognised avatar value (preset URL or uploaded data URL). */
export function isAvatarSet(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}
