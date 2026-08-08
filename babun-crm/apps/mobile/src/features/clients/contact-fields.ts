import { Instagram, Mail, MessageCircle, Send } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import {
  instagramUrl,
  telegramUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { MOBILE_CHANNEL_COLORS } from "@/theme/readable-color";
import { createEnabledPrefs } from "@/lib/enabled-prefs";

// СПОСОБЫ СВЯЗИ КЛИЕНТА, КОТОРЫЕ НЕ ЯВЛЯЮТСЯ НОМЕРОМ — Telegram, Instagram,
// WhatsApp на другом номере, почта.
//
// Владелец 2026-08-02: «убираем „+ Добавить номер“ — нажимаешь плюс, снизу
// вылазит плашка, как выбор метки, и одной кнопкой сразу добавляешь WhatsApp,
// Telegram и так далее; и справа появляется значок — по нему чётко переходит
// в телеграм».
//
// Раньше эти поля жили на отдельной странице «Ещё» внизу карточки: чтобы
// вписать @username, нужно было доскроллить до конца и уйти с карточки. Теперь
// они стоят там же, где номера — в блоке контактов, — и появляются ТОЛЬКО
// когда заполнены. Пустых полок карточка по-прежнему не держит.
//
// Viber в этот список не входит: отдельного поля под него в модели клиента
// нет, и Viber адресуется тем же номером — он живёт каналом в кнопке связи
// у номера (contact-channels.ts).

export type ContactFieldId = "telegram" | "instagram" | "whatsapp" | "email";

export interface ContactFieldDef {
  id: ContactFieldId;
  /** Ярлык строки и подпись пункта в листе «Добавить». */
  label: string;
  /** Подсказка в пустом поле. */
  placeholder: string;
  icon: LucideIcon;
  color: string;
  keyboardType?: "email-address" | "phone-pad";
  /** @username и почта — без автозаглавных: «@Artem_test» вместо
   *  «@artem_test» это уже другой логин на вид. */
  autoCapitalize?: "none";
  /** Что показывать в строке ("" — поля у клиента нет). */
  display: (client: Client) => string;
  /** Патч клиента для введённого значения. */
  patch: (value: string) => Partial<Client>;
  /** Приставка, которая уже стоит в пустом поле («@»), как «+357» у
   *  телефона. Стереть её можно — это обычный текст. */
  prefix?: string;
  /** Куда ведёт значок справа — ОТ ТЕКУЩЕГО ЗНАЧЕНИЯ СТРОКИ, а не от
   *  сохранённого клиента: значок обязан появиться, пока логин ещё печатают,
   *  а не после ухода со строки. null — вести некуда, значка нет. */
  url: (value: string) => string | null;
}

/** @username хранится без «собачки»: её рисует поле, а не данные. */
const stripAt = (v: string): string => v.trim().replace(/^@+/, "");

/** Порядок = порядок строк на карточке и пунктов в листе «Добавить». */
export const CONTACT_FIELDS: ContactFieldDef[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    placeholder: "Номер, если отличается",
    icon: MessageCircle,
    color: MOBILE_CHANNEL_COLORS.whatsapp,
    keyboardType: "phone-pad",
    display: (c) => c.whatsapp_phone ?? "",
    patch: (v) => ({ whatsapp_phone: v.trim() }),
    url: (v) => whatsappUrl(v),
  },
  {
    id: "telegram",
    label: "Telegram",
    placeholder: "@username",
    prefix: "@",
    autoCapitalize: "none",
    icon: Send,
    color: MOBILE_CHANNEL_COLORS.telegram,
    display: (c) => (stripAt(c.telegram_username ?? "") ? `@${stripAt(c.telegram_username ?? "")}` : ""),
    patch: (v) => ({ telegram_username: stripAt(v) }),
    // По @username, а не по номеру: по номеру и так переходит кнопка связи
    // у самого номера (владелец 2026-08-02).
    url: (v) => (stripAt(v) ? telegramUrl(v, null) : null),
  },
  {
    id: "instagram",
    label: "Instagram",
    placeholder: "@username",
    prefix: "@",
    autoCapitalize: "none",
    icon: Instagram,
    color: MOBILE_CHANNEL_COLORS.instagram,
    display: (c) => (stripAt(c.instagram_username ?? "") ? `@${stripAt(c.instagram_username ?? "")}` : ""),
    patch: (v) => ({ instagram_username: stripAt(v) }),
    url: (v) => instagramUrl(v),
  },
  {
    id: "email",
    label: "Почта",
    placeholder: "email@example.com",
    icon: Mail,
    color: "#5b6678",
    keyboardType: "email-address",
    autoCapitalize: "none",
    display: (c) => c.email ?? "",
    // Мусор в почту не пишем: адрес либо похож на адрес, либо стирается.
    // Иначе «арт» тихо ложился в базу и уезжал в рассылки.
    patch: (v) => {
      const value = v.trim();
      if (!value) return { email: "" };
      return /.+@.+\..+/.test(value) ? { email: value } : {};
    },
    // Хотя бы «a@b»: mailto: на «арт» открывал бы пустое письмо в никуда.
    url: (v) => (/.+@.+\..+/.test(v.trim()) ? `mailto:${v.trim()}` : null),
  },
];

// ЧТО ПРЕДЛАГАТЬ В ЛИСТЕ «ДОБАВИТЬ» (владелец 2026-08-02: «справа шестерёнка,
// чтобы тумблерами включать способы связи, добавления и так далее»). У кого
// весь Кипр в WhatsApp, тому Instagram в листе — лишняя строка на каждом
// клиенте. Уже заполненное у клиента поле показывается на карточке всегда,
// даже если способ выключен: спрятать введённые данные хуже, чем показать.
const prefs = createEnabledPrefs<ContactFieldId>({
  storageKey: "babun-contact-fields",
  queryKey: "contact-fields",
  all: CONTACT_FIELDS.map((f) => f.id),
  defaults: CONTACT_FIELDS.map((f) => f.id),
});

export const useEnabledContactFields = prefs.use;
export const useContactFieldsOrder = prefs.useOrder;
export const useToggleContactField = prefs.useToggle;
export const useReorderContactFields = prefs.useReorder;

/** Определение поля по id — списки ходят по ПОРЯДКУ ПОЛЬЗОВАТЕЛЯ. */
export function contactFieldDef(id: ContactFieldId): ContactFieldDef | undefined {
  return CONTACT_FIELDS.find((f) => f.id === id);
}
