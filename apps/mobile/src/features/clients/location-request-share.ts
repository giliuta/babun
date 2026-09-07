import { Platform, Share } from "react-native";

// «ПОДЕЛИТЬСЯ» И «СКОПИРОВАТЬ» — платформа в одном месте (STORY-077).
//
// На iOS ссылка уходит через системный лист «Поделиться»: там же WhatsApp,
// Telegram, SMS и «Скопировать» — отдельной кнопки копирования на нативе нет
// (expo-clipboard не собран в dev-клиент, а `Clipboard` из react-native
// снят с поддержки). В браузере — `navigator.share`, где он есть (телефоны),
// иначе буфер обмена.

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

export function canCopyLink(): boolean {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard
  );
}

export async function copyLink(link: string): Promise<boolean> {
  if (!canCopyLink()) return false;
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

/** `text` — фраза БЕЗ ссылки: в браузере она и ссылка едут разными полями,
 *  на нативе склеиваются переводом строки. */
export async function shareLink(text: string, link: string): Promise<ShareOutcome> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url: link });
        return "shared";
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") {
          return "dismissed";
        }
      }
    }
    return (await copyLink(link)) ? "copied" : "failed";
  }
  try {
    const result = await Share.share({ message: `${text}\n${link}` });
    return result.action === Share.dismissedAction ? "dismissed" : "shared";
  } catch {
    return "failed";
  }
}
