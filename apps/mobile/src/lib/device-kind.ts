// Вид устройства по платформе — чистое правило, его держит
// `device-kind.test.ts`; слова к виду — `device-word.ts`.

export type DeviceKind = "iphone" | "phone" | "browser";

export function deviceKindOf(os: string): DeviceKind {
  if (os === "web") return "browser";
  if (os === "android") return "phone";
  return "iphone";
}
