import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import type { Client } from "@babun/shared/local/clients";
import {
  telegramUrl,
  telUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { isMessagingReady } from "@/features/chats/readiness";
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

const KEY = "babun-contact-channels";

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
  /** Можно ли отключить в настройках. Звонок — нельзя. */
  optional: boolean;
}

/** Порядок = порядок в мини-листе и в настройках. */
export const CONTACT_CHANNELS: ChannelDef[] = [
  { id: "call", label: "Позвонить", color: "#1F7A44", optional: false },
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: MOBILE_CHANNEL_COLORS.whatsapp,
    optional: true,
  },
  {
    id: "telegram",
    label: "Telegram",
    color: MOBILE_CHANNEL_COLORS.telegram,
    optional: true,
  },
  { id: "viber", label: "Viber", color: "#5b2d8e", optional: true },
  { id: "sms", label: "SMS", color: MOBILE_CHANNEL_COLORS.sms, optional: true },
  { id: "chat", label: "Чат в Babun", color: "#5b6678", optional: true },
];

/** Каналы, которые вообще имеет смысл ПРЕДЛАГАТЬ в настройках. Внутренний
 *  чат исключён, пока каналы сообщений не подключены: тумблер, который ни на
 *  что не влияет, — тот же мёртвый контрол, что и сама строка «Чат». */
export function offeredChannels(): ChannelDef[] {
  return CONTACT_CHANNELS.filter(
    (c) => c.id !== "chat" || isMessagingReady(),
  );
}

const DEFAULT_ENABLED: ChannelId[] = [
  "call",
  "whatsapp",
  "telegram",
  "sms",
  "chat",
];

export function getEnabledChannels(): ChannelId[] {
  try {
    const raw = getStorage().get<string[]>(KEY);
    if (!Array.isArray(raw)) return DEFAULT_ENABLED;
    const valid = raw.filter((id) =>
      CONTACT_CHANNELS.some((c) => c.id === id),
    ) as ChannelId[];
    // Звонок не отключается: без него кнопка связи теряет смысл.
    return valid.includes("call") ? valid : ["call", ...valid];
  } catch {
    return DEFAULT_ENABLED;
  }
}

/** Живой список включённых каналов — тумблер в настройках сразу меняет
 *  мини-лист на карточке. */
export function useEnabledChannels() {
  return useQuery({
    queryKey: ["contact-channels"],
    queryFn: () => getEnabledChannels(),
    staleTime: Infinity,
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  return useMutation({
    // Локальная запись — не должна ждать сети.
    networkMode: "always",
    mutationFn: async (id: ChannelId) => {
      const cur = getEnabledChannels();
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id];
      const ordered = CONTACT_CHANNELS.filter(
        (c) => c.id === "call" || next.includes(c.id),
      ).map((c) => c.id);
      try {
        getStorage().set(KEY, ordered);
      } catch {
        // Запись best-effort.
      }
      return ordered;
    },
    onSuccess: (next) => qc.setQueryData(["contact-channels"], next),
  });
}

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
  opts?: { telegramUsername?: string | null },
): ResolvedChannel[] {
  const digits = (number || "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 5) return [];
  const out: ResolvedChannel[] = [];
  for (const def of CONTACT_CHANNELS) {
    if (!enabled.includes(def.id)) continue;
    let url: string | null = null;
    switch (def.id) {
      case "call":
        url = telUrl(number);
        break;
      case "whatsapp":
        url = whatsappUrl(number);
        break;
      case "telegram":
        url = telegramUrl(opts?.telegramUsername ?? null, number);
        break;
      case "viber":
        url = `viber://chat?number=${encodeURIComponent(digits)}`;
        break;
      case "sms":
        url = `sms:${digits}`;
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
): ResolvedChannel[] {
  const extras = client.phones ?? [];
  const waNumber =
    client.whatsapp_phone ||
    extras.find((p) => p.label === "WhatsApp")?.number ||
    client.phone;
  const digits = (client.phone || "").replace(/[^\d+]/g, "");

  const out: ResolvedChannel[] = [];
  for (const def of CONTACT_CHANNELS) {
    if (!enabled.includes(def.id)) continue;
    let url: string | null = null;
    let internal = false;
    switch (def.id) {
      case "call":
        url = telUrl(client.phone);
        break;
      case "whatsapp":
        url = whatsappUrl(waNumber);
        break;
      case "telegram":
        url = telegramUrl(client.telegram_username, client.phone);
        break;
      case "viber":
        // Viber адресуется тем же номером; отдельного поля в модели нет.
        url = digits ? `viber://chat?number=${encodeURIComponent(digits)}` : null;
        break;
      case "sms":
        url = digits ? `sms:${digits}` : null;
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
