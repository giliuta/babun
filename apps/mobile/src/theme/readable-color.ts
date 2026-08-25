const LIGHT = "#ffffff";
const DARK = "#0b1220";

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(a: number, b: number): number {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

/** Pick the higher-contrast fixed-light foreground for a solid color. */
export function readableForeground(background: string): string {
  const bg = luminance(background);
  if (bg == null) return DARK;
  const light = contrast(bg, 1);
  const dark = contrast(bg, luminance(DARK) ?? 0);
  return light >= dark ? LIGHT : DARK;
}

/** Mobile-accessible variants of recognizable messenger hues. */
export const MOBILE_CHANNEL_COLORS = {
  whatsapp: "#075e54",
  instagram: "#b91c5c",
  telegram: "#0b6e99",
  sms: "#5b6678",
} as const;
