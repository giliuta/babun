import {
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Phone,
  PhoneCall,
  Send,
  type LucideIcon,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import {
  smsUrl,
  telegramUrl,
  telUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { isMessagingReady } from "@/features/chats/readiness";
import type { CountryCode } from "libphonenumber-js";
import { tryToE164 } from "@/features/clients/phone";
import { MOBILE_CHANNEL_COLORS } from "@/theme/readable-color";

// СПОСОБЫ СВЯЗИ — один список на весь продукт (владелец 2026-07-26:
// «одна кнопка возле телефона, тап — и выбираешь, как связаться; это
// менее затратно по объёму… также это всё настраивается в настройках»).
//
// Почему не ряд кнопок у номера: каждый канал — это ещё 32pt поперёк
// строки, а у клиента их может быть пять. Одна кнопка + мини-лист даёт
// столько же возможностей при одной иконке на экране.
//
// Настройка «какие каналы вообще предлагать» — device-local (MMKV, как
// sort-pref и card-prefs): у одного бизнеса весь Кипр в WhatsApp, у
// другого — Viber, и мешать им друг друга не нужно.
//
// НО КЛЮЧ — ПО ТЕНАНТУ. Мастер работает на две фирмы с одного телефона: на
// общем ключе он отключал Viber в первой фирме и терял его во второй, где все
// клиенты именно там (аудит 2026-07-27). Настройка остаётся местной, но у
// каждой фирмы своя.

export type ChannelId =
  | "call"
  | "whatsapp"
  | "telegram"
  | "viber"
  | "sms"
  | "chat";

export interface ChannelDef {
  id: ChannelId;
  label: string;
  color: string;
  /** Значок в листе «Как связаться» — тот же приём, что в листе «Добавить». */
  icon: LucideIcon;
  /** Можно ли отключить в настройках. Звонок — нельзя. */
  optional: boolean;
}

/** Набор по умолчанию; фактический порядок задаёт пользователь. */
export const CONTACT_CHANNELS: ChannelDef[] = [
  {
    id: "call",
    label: "Позвонить",
    color: "#1F7A44",
    icon: Phone,
    optional: false,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: MOBILE_CHANNEL_COLORS.whatsapp,
    icon: MessageCircle,
    optional: true,
  },
  {
    id: "telegram",
    label: "Telegram",
    color: MOBILE_CHANNEL_COLORS.telegram,
    icon: Send,
    optional: true,
  },
  {
    id: "viber",
    label: "Viber",
    color: "#5b2d8e",
    icon: PhoneCall,
    optional: true,
  },
  {
    id: "sms",
    label: "SMS",
    color: MOBILE_CHANNEL_COLORS.sms,
    icon: MessageSquare,
    optional: true,
  },
  {
    id: "chat",
    label: "Чат в Babun",
    color: "#5b6678",
    icon: MessagesSquare,
    optional: true,
  },
];

/** Каналы, которые вообще имеет смысл ПРЕДЛАГАТЬ в настройках. Внутренний
 *  чат исключён, пока каналы сообщений не подключены: тумблер, который ни на
 *  что не влияет, — тот же мёртвый контрол, что и сама строка «Чат». */
export function offeredChannels(): ChannelDef[] {
  return CONTACT_CHANNELS.filter((c) => c.id !== "chat" || isMessagingReady());
}

/** Предлагаем ли этот канал вообще (см. offeredChannels). */
export function isChannelOffered(id: ChannelId): boolean {
  return offeredChannels().some((c) => c.id === id);
}

/** Определение канала по id — списки ходят по ПОРЯДКУ ПОЛЬЗОВАТЕЛЯ. */
export function channelDef(id: ChannelId): ChannelDef | undefined {
  return CONTACT_CHANNELS.find((c) => c.id === id);
}

// НАСТРОЙКА ЖИВЁТ НЕ ЗДЕСЬ. Каналы у номера и поля карточки слились в один
// набор «Способы связи» (`contact-ways`): человек думает «мы работаем в
// WhatsApp», а не «канал включён, а поле выключено». Здесь остались только
// определения каналов и правила, КУДА они ведут.

export interface ResolvedChannel extends ChannelDef {
  /** Куда вести. Для внутреннего чата — маршрут приложения. */
  url: string;
  internal?: boolean;
}

/** Каналы КОНКРЕТНОГО НОМЕРА (владелец 2026-07-26: «если я добавляю новый
 *  номер телефона, то кнопка появляется чётко на этот номер»). Канал —
 *  свойство номера, а не клиента: у мужа WhatsApp, у жены Viber, звонить
 *  надо ровно на тот номер, у которого нажали.
 *
 *  Telegram-username — единственное исключение: он принадлежит клиенту,
 *  поэтому у основного номера ведёт на @username, у остальных — на
 *  t.me по цифрам самого номера. */
export function resolveChannelsForNumber(
  number: string,
  enabled: ChannelId[],
  opts?: { telegramUsername?: string | null; country?: CountryCode },
): ResolvedChannel[] {
  // МЕССЕНДЖЕРУ НУЖЕН МЕЖДУНАРОДНЫЙ НОМЕР. Локально введённый «99 123456»
  // давал wa.me/99123456 и t.me/+99123456 — код страны терялся, и ссылка
  // вела в никуда. Приводим к E.164 по стране компании; неразбираемый
  // номер оставляем как есть — звонилка с ним справится, а мессенджер
  // всё равно не собрался бы.
  const dial = tryToE164(number, opts?.country) ?? number;
  const digits = (dial || "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 5) return [];
  const out: ResolvedChannel[] = [];
  // Идём по ПОРЯДКУ ПОЛЬЗОВАТЕЛЯ (enabled уже отсортирован настройкой), а не
  // по порядку константы: перетаскивание в настройках должно менять лист.
  for (const id of enabled) {
    const def = channelDef(id);
    if (!def) continue;
    let url: string | null = null;
    switch (def.id) {
      case "call":
        url = telUrl(dial);
        break;
      case "whatsapp":
        url = whatsappUrl(dial);
        break;
      case "telegram":
        url = telegramUrl(opts?.telegramUsername ?? null, dial);
        break;
      case "viber":
        url = `viber://chat?number=${encodeURIComponent(digits)}`;
        break;
      case "sms":
        url = smsUrl(dial);
        break;
      case "chat":
        // Внутренний чат — с КЛИЕНТОМ, не с номером: в меню номера его нет.
        url = null;
        break;
    }
    if (url) out.push({ ...def, url });
  }
  return out;
}

/** Что реально доступно ДЛЯ ЭТОГО клиента с учётом настроек. Канал без
 *  данных не показывается вовсе — мёртвых пунктов в листе не держим. */
export function resolveChannels(
  client: Client,
  enabled: ChannelId[],
  opts?: { country?: CountryCode },
): ResolvedChannel[] {
  const extras = client.phones ?? [];
  // Тот же перевод в E.164, что у кнопки номера; у основного телефона уже
  // есть посчитанный `phone_e164` — он и есть канон.
  const e164 = (raw: string | null | undefined) =>
    tryToE164(raw ?? "", opts?.country) ?? raw ?? "";
  const primary = client.phone_e164 || e164(client.phone);
  const waNumber = e164(
    client.whatsapp_phone ||
      extras.find((p) => p.label === "WhatsApp")?.number ||
      client.phone,
  );
  const digits = (primary || "").replace(/[^\d+]/g, "");

  const out: ResolvedChannel[] = [];
  // По порядку пользователя — см. resolveChannelsForNumber.
  for (const id of enabled) {
    const def = channelDef(id);
    if (!def) continue;
    let url: string | null = null;
    let internal = false;
    switch (def.id) {
      case "call":
        url = telUrl(primary);
        break;
      case "whatsapp":
        url = whatsappUrl(waNumber);
        break;
      case "telegram":
        url = telegramUrl(client.telegram_username, primary);
        break;
      case "viber":
        // Viber адресуется тем же номером; отдельного поля в модели нет.
        url = digits ? `viber://chat?number=${encodeURIComponent(digits)}` : null;
        break;
      case "sms":
        url = smsUrl(primary);
        break;
      case "chat":
        // Внутренний чат предлагаем ТОЛЬКО когда каналы реально подключены:
        // MESSAGING_READINESS держит все семь предпосылок в false, а ссылка
        // ведёт в КОРЕНЬ чужого таба «Чаты» — не в диалог с этим клиентом, и
        // «назад» на карточку оттуда не существует. Мёртвых контролов не
        // держим. Когда мессенджинг включат, здесь появится /chats/{chatId},
        // найденный по client_id.
        url = isMessagingReady() ? `/(dashboard)/chats` : null;
        internal = true;
        break;
    }
    if (url) out.push({ ...def, url, internal });
  }
  return out;
}
