import { Platform } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import type { CountryCode } from "libphonenumber-js";
import { dialableDigits } from "@babun/shared/common/utils/messenger-links";
import { channelDef, type ChannelId } from "@/features/clients/contact-channels";
import { tryToE164 } from "@/features/clients/phone";

// НАПОМНИТЬ ОБ ОПЛАТЕ — с карточки, а не только из Финансов.
//
// Долг на карточке был числом, с которым нельзя ничего сделать: текст
// напоминания и шаблоны жили на экране должников в другом табе. Диспетчер,
// открывший карточку должника, шёл искать его во втором списке.
//
// Канал выбирает пользователь из СВОИХ включённых способов связи — тех же,
// что в кнопке у номера. Здесь их подмножество: предзаполненный текст умеют
// нести только SMS и WhatsApp. Telegram по номеру открывает диалог, но текст
// в него не передать — молча отправить пустое окно хуже, чем не предлагать.

export interface DebtChannel {
  id: ChannelId;
  label: string;
  color: string;
  icon: LucideIcon;
  url: string;
}

const TEXT_CAPABLE: ChannelId[] = ["whatsapp", "sms"];

/** Ссылки «написать с готовым текстом» в порядке пользователя. */
export function debtReminderChannels(opts: {
  phone: string;
  phoneE164?: string | null;
  /** Номер, на котором у клиента WhatsApp, если он отличается от основного —
   *  тот же приоритет, что у кнопки связи (contact-channels.resolveChannels). */
  whatsappPhone?: string | null;
  text: string;
  enabled: readonly ChannelId[];
  country?: CountryCode;
}): DebtChannel[] {
  const toDial = (raw: string | null | undefined) =>
    tryToE164(raw ?? "", opts.country);
  const dial = opts.phoneE164 || toDial(opts.phone) || opts.phone;
  const digits = (dial ?? "").replace(/\D/g, "");
  if (digits.length < 5) return [];
  // МЕССЕНДЖЕР ТОЛЬКО НА РАЗОБРАННЫЙ НОМЕР. Из локального «99 12 34 56» без
  // кода страны собиралась ссылка wa.me/99123456 — сообщение с именем и
  // суммой долга уходило постороннему человеку в другой стране.
  const waRaw = toDial(opts.whatsappPhone) || opts.phoneE164 || toDial(opts.phone);
  const waDigits = (waRaw ?? "").replace(/\D/g, "");
  const body = encodeURIComponent(opts.text);
  const out: DebtChannel[] = [];
  for (const id of opts.enabled) {
    if (!TEXT_CAPABLE.includes(id)) continue;
    const def = channelDef(id);
    if (!def) continue;
    // iOS отделяет body от номера «&», Android — «?». Одна и та же ссылка на
    // другой платформе просто теряет текст.
    const sep = Platform.OS === "ios" ? "&" : "?";
    if (id === "whatsapp" && waDigits.length < 8) continue;
    const url =
      id === "whatsapp"
        ? `https://wa.me/${waDigits}?text=${body}`
        : `sms:${dialableDigits(dial)}${sep}body=${body}`;
    out.push({ id, label: def.label, color: def.color, icon: def.icon, url });
  }
  return out;
}

/** Строка в историю клиента. Формулировка осторожная: приложение знает,
 *  что переписку ОТКРЫЛИ с готовым текстом, — нажал ли человек «отправить»
 *  в чужом мессенджере, ему никто не сообщает. Врать в истории нельзя. */
export function debtReminderNote(amount: string, channelLabel: string): string {
  return `Написали об оплате ${amount} · ${channelLabel}`;
}
