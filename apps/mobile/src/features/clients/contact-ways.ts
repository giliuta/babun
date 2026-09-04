import { getStorage } from "@babun/shared/storage";
import type { LucideIcon } from "lucide-react-native";
import { createEnabledPrefs } from "@/lib/enabled-prefs";
import {
  CONTACT_CHANNELS,
  isChannelOffered,
  type ChannelId,
} from "@/features/clients/contact-channels";
import {
  CONTACT_FIELDS,
  type ContactFieldId,
} from "@/features/clients/contact-fields";

// ЧЕМ СВЯЗЫВАЮТСЯ С КЛИЕНТОМ — ОДИН НАБОР ВМЕСТО ДВУХ.
//
// Владелец 2026-09-04: «мы можем это всё в одну настройку пихнуть и
// совместить — зачем „можно добавить в карточку“ или „у номера“, ну типа
// немного странно».
//
// И правда странно: WhatsApp и Telegram стояли на странице ДВАЖДЫ, в двух
// секциях с двумя галками, потому что внутри продукта это два разных списка —
// каналы у номера и поля карточки. Это различие ПРОДУКТА, а не человека:
// человек думает «мы работаем в WhatsApp», а не «WhatsApp у номера включён, а
// WhatsApp-поле выключено».
//
// Теперь набор один: «чем связываемся». Что способ умеет — свойство самого
// способа, а не отдельная настройка:
//   • `byPhone` — открывается прямо по номеру (кнопка связи справа от него);
//   • `asField` — заводится своим полем в карточке (плюс в контактах).
// WhatsApp умеет и то и другое, SMS и Viber — только первое, Instagram и
// почта — только второе. Галка одна на способ, порядок один на всё.
//
// СТАРОЕ НЕ ТЕРЯЕТСЯ: при первом чтении набор собирается ОБЪЕДИНЕНИЕМ двух
// прежних (`migrate` ниже) — включённое хоть где-то остаётся включённым.
// Направление выбрано так намеренно: молча выключить способ, которым фирма
// пользуется, хуже, чем оставить лишнюю строку в листе.

export type ContactWayId = ChannelId | ContactFieldId;

export interface ContactWayDef {
  id: ContactWayId;
  label: string;
  color: string;
  icon: LucideIcon;
  /** Открывается по номеру телефона — кнопкой связи справа от него. */
  byPhone: boolean;
  /** Заводится своим полем в карточке — по плюсу в контактах. */
  asField: boolean;
  /** Можно ли выключить. Звонок — нельзя. */
  optional: boolean;
}

const FIELD_IDS = new Set<string>(CONTACT_FIELDS.map((f) => f.id));

/** Полный набор в порядке по умолчанию: сперва то, что живёт у номера,
 *  затем то, что бывает только отдельным полем. */
export const CONTACT_WAYS: ContactWayDef[] = [
  ...CONTACT_CHANNELS.map((c) => ({
    id: c.id as ContactWayId,
    label: c.label,
    color: c.color,
    icon: c.icon,
    byPhone: true,
    asField: FIELD_IDS.has(c.id),
    optional: c.optional,
  })),
  ...CONTACT_FIELDS.filter(
    (f) => !CONTACT_CHANNELS.some((c) => c.id === f.id),
  ).map((f) => ({
    id: f.id as ContactWayId,
    label: f.label,
    color: f.color,
    icon: f.icon,
    byPhone: false,
    asField: true,
    optional: true,
  })),
];

const CHANNEL_IDS = new Set<string>(CONTACT_CHANNELS.map((c) => c.id));

export function contactWayDef(id: ContactWayId): ContactWayDef | undefined {
  return CONTACT_WAYS.find((w) => w.id === id);
}

/** Способы, которые вообще имеет смысл предлагать: внутренний чат исчезает,
 *  пока каналы сообщений не подключены (тот же гейт, что был у каналов). */
export function isWayOffered(id: ContactWayId): boolean {
  return CHANNEL_IDS.has(id) ? isChannelOffered(id as ChannelId) : true;
}

const OLD_CHANNELS_KEY = "babun-contact-channels";
const OLD_FIELDS_KEY = "babun-contact-fields";
const OLD_CHANNEL_DEFAULTS: ChannelId[] = [
  "call",
  "whatsapp",
  "telegram",
  "sms",
  "chat",
];
const OLD_FIELD_DEFAULTS: ContactFieldId[] = CONTACT_FIELDS.map((f) => f.id);

const readOld = <T extends string>(
  storageKey: string,
  tenantId: string | null,
  suffix: "" | ":order",
): T[] | null => {
  try {
    const base = tenantId ? `${storageKey}:${tenantId}` : storageKey;
    const raw = getStorage().get<string[]>(`${base}${suffix}`);
    return Array.isArray(raw) ? (raw as T[]) : null;
  } catch {
    return null;
  }
};

const prefs = createEnabledPrefs<ContactWayId>({
  storageKey: "babun-contact-ways",
  queryKey: "contact-ways",
  all: CONTACT_WAYS.map((w) => w.id),
  defaults: [...OLD_CHANNEL_DEFAULTS, ...OLD_FIELD_DEFAULTS].filter(
    (id, i, arr) => arr.indexOf(id) === i,
  ),
  // «Позвонить» всегда включён и всегда первый: без него кнопка связи теряет
  // смысл, и переставлять его некуда (владелец 2026-08-02).
  pinned: ["call"],
  migrate: (tenantId) => {
    const oldChannels = readOld<ChannelId>(OLD_CHANNELS_KEY, tenantId, "");
    const oldFields = readOld<ContactFieldId>(OLD_FIELDS_KEY, tenantId, "");
    if (!oldChannels && !oldFields) return null;
    const enabled = new Set<ContactWayId>([
      ...(oldChannels ?? OLD_CHANNEL_DEFAULTS),
      ...(oldFields ?? OLD_FIELD_DEFAULTS),
    ]);
    // Порядок: как стояли каналы, потом поля, которых среди каналов нет.
    const channelOrder =
      readOld<ChannelId>(OLD_CHANNELS_KEY, tenantId, ":order") ??
      CONTACT_CHANNELS.map((c) => c.id);
    const fieldOrder =
      readOld<ContactFieldId>(OLD_FIELDS_KEY, tenantId, ":order") ??
      OLD_FIELD_DEFAULTS;
    const order = [
      ...channelOrder,
      ...fieldOrder.filter((id) => !CHANNEL_IDS.has(id)),
    ].filter((id, i, arr) => arr.indexOf(id) === i) as ContactWayId[];
    return {
      enabled: order.filter((id) => enabled.has(id)),
      order,
    };
  },
});

/** Включённые способы В ПОРЯДКЕ ПОКАЗА — для страницы настройки. */
export const useEnabledWays = prefs.use;
/** Полный порядок (включая выключенное) — для страницы настройки. */
export const useWaysOrder = prefs.useOrder;
export const useToggleWay = prefs.useToggle;
export const useReorderWays = prefs.useReorder;

/** Что предложить у НОМЕРА: включённые способы, которые умеют звонить/писать
 *  по самому номеру. Порядок — общий порядок набора. */
export function useEnabledChannels(): ChannelId[] {
  const ways = useEnabledWays();
  return ways.filter((id): id is ChannelId => {
    const def = contactWayDef(id);
    return !!def?.byPhone;
  });
}

/** Что предложить по ПЛЮСУ в карточке: включённые способы со своим полем. */
export function useEnabledContactFields(): ContactFieldId[] {
  const ways = useEnabledWays();
  return ways.filter((id): id is ContactFieldId => {
    const def = contactWayDef(id);
    return !!def?.asField;
  });
}
