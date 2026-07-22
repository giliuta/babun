export function parseCashInputToCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 9_000_000_000_000_000) {
    return null;
  }
  return cents;
}

export function cashCentsToInput(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  const whole = Math.floor(safeValue / 100);
  const fraction = String(safeValue % 100).padStart(2, "0");
  return fraction === "00" ? String(whole) : `${whole}.${fraction}`;
}
