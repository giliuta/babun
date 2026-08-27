// СВОЁ ВРЕМЯ → ЗОНА IANA. Чистые функции, без React Native: их гоняет
// `bun test`, а он не умеет парсить flow-типы из react-native.
//
// ЗНАК У `Etc/GMT` ПЕРЕВЁРНУТ — И ЭТО НЕ ОПЕЧАТКА. В базе IANA `Etc/GMT-3`
// означает UTC+3, а `Etc/GMT+3` — UTC−3. Инверсия досталась от POSIX и
// противоречит здравому смыслу настолько, что её «чинят» примерно все, кто
// видит впервые. Цена ошибки — сутки: касса за день закроется не тем днём.
//
// Поэтому знак живёт в ОДНОМ месте и заперт тестом рядом.

/** Смещение в часах → зона IANA. Знак ИНВЕРТИРОВАН: Etc/GMT-3 = UTC+3. */
export function offsetToZone(hours: number): string {
  const clamped = Math.max(-12, Math.min(14, Math.round(hours)));
  if (clamped === 0) return "Etc/GMT";
  return clamped > 0 ? `Etc/GMT-${clamped}` : `Etc/GMT+${Math.abs(clamped)}`;
}

/** Обратное: зона → смещение в часах. null, если зона не из `Etc/GMT`. */
export function zoneToOffset(zone: string): number | null {
  if (zone === "Etc/GMT") return 0;
  const m = /^Etc\/GMT([+-])(\d{1,2})$/.exec(zone);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "-" ? n : -n;
}
