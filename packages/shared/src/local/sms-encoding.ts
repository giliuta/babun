// v547 §3.10 — SMS encoding analysis.
//
// Carriers charge per *segment*, not per visual character. Segment size
// depends on which encoding the message body needs:
//
//   GSM-7 (basic Latin + a few European symbols):
//     • single SMS  = 160 characters
//     • multipart   = 153 characters per segment (7 bytes of the 160
//                     reserved for UDH so segments can be reassembled)
//
//   GSM-7 «extended» characters (^ { } \ [ ] ~ | €):
//     count as TWO GSM-7 chars each. Cuts capacity below the user's
//     intuitive char count.
//
//   UCS-2 (anything else — Cyrillic, Greek, Chinese, emoji, etc.):
//     • single SMS  = 70 characters
//     • multipart   = 67 characters per segment
//
// One Cyrillic letter inside an otherwise-Latin body flips the whole
// message into UCS-2 mode, dropping capacity from 160→70. Surfacing
// this in the editor (with a yellow «Кириллица») warning lets the
// user know they're paying ~2.3× more before they hit Save.

const GSM7_BASE = new Set<string>(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM7_EXT = new Set<string>(Array.from("|^€{}[]~\\"));

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsEncodingInfo {
  /** Visual length of the rendered message body. */
  length: number;
  /** Effective byte cost in the active encoding (extended GSM-7 chars
   *  count as 2). */
  weight: number;
  /** Detected encoding. UCS-2 the moment any non-GSM-7 char appears. */
  encoding: SmsEncoding;
  /** How many SMS segments the carrier will bill. Always >= 1. */
  segments: number;
  /** Max characters per single SMS in the active encoding (160 / 70). */
  singleLimit: number;
  /** Max characters per segment when the message is multipart
   *  (153 / 67). */
  multipartLimit: number;
  /** How many more characters fit in the current segment before
   *  rolling over into one more. */
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

/** Computes segment count + remaining-in-segment for the given body.
 *  Pure, no React; safe for both the editor (RU UI) and the SMS-send
 *  cost preview down the line. */
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
