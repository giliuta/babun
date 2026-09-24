// СЧЁТ ЧАСТЕЙ SMS НА СЕРВЕРЕ — копия packages/shared/src/local/sms-encoding.ts
// (STORY-089). Сервис берёт деньги за часть, а редактор шаблона в приложении
// считает части тем же кодом: владелец видит «2 SMS» — и списывается две.
// Сверку держит apps/mobile/src/features/sms/server-render-parity.test.ts.

const GSM7_BASE = new Set<string>(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM7_EXT = new Set<string>(Array.from("|^€{}[]~\\"));

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsEncodingInfo {
  length: number;
  weight: number;
  encoding: SmsEncoding;
  segments: number;
  singleLimit: number;
  multipartLimit: number;
  remaining: number;
}

const SINGLE_GSM7 = 160;
const MULTI_GSM7 = 153;
const SINGLE_UCS2 = 70;
const MULTI_UCS2 = 67;

function detectEncoding(body: string): SmsEncoding {
  for (const ch of body) {
    if (GSM7_BASE.has(ch)) continue;
    if (GSM7_EXT.has(ch)) continue;
    return "ucs2";
  }
  return "gsm7";
}

function gsm7Weight(body: string): number {
  let w = 0;
  for (const ch of body) {
    if (GSM7_EXT.has(ch)) w += 2;
    else w += 1;
  }
  return w;
}

export function analyzeSmsEncoding(body: string): SmsEncodingInfo {
  const encoding = detectEncoding(body);
  const weight =
    encoding === "gsm7"
      ? gsm7Weight(body)
      : Array.from(body).length;
  const singleLimit = encoding === "gsm7" ? SINGLE_GSM7 : SINGLE_UCS2;
  const multipartLimit = encoding === "gsm7" ? MULTI_GSM7 : MULTI_UCS2;

  let segments: number;
  let perSegmentCap: number;
  if (weight === 0) {
    segments = 1;
    perSegmentCap = singleLimit;
  } else if (weight <= singleLimit) {
    segments = 1;
    perSegmentCap = singleLimit;
  } else {
    segments = Math.ceil(weight / multipartLimit);
    perSegmentCap = multipartLimit;
  }

  const remaining = Math.max(0, perSegmentCap * segments - weight);

  return {
    length: Array.from(body).length,
    weight,
    encoding,
    segments,
    singleLimit,
    multipartLimit,
    remaining,
  };
}
