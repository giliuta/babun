import {
  ArrowRightLeft,
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarRange,
  CalendarDays,
  Infinity as InfinityIcon,
  CalendarPlus,
  CalendarX2,
  CircleCheck,
  Contact,
  Ellipsis,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Globe,
  HandCoins,
  House,
  Landmark,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Navigation,
  Palette,
  Paperclip,
  PenLine,
  PencilLine,
  ReceiptText,
  Shapes,
  Shield,
  ShieldAlert,
  StickyNote,
  Tag,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  FileText,
  NotebookPen,
  PiggyBank,
  type LucideIcon,
} from "lucide-react-native";

import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import type { AccessLevel } from "../access-map";

// ПЛИТКА СТРОКИ ПРАВА (владелец 29.09, на настройках календаря: «вот так»).
// Права команды стоят теми же строками, что настройки календаря: цветная
// плитка со значком, имя, под ним — ступень. Значок и цвет — те же, что у
// самого блока в продукте: «Услуги» — синий портфель, как в настройках
// календаря, «Метка» — лиловая, как справочник меток, «Отмена и удаление» —
// красная, как всё, где ошибка стоит денег.

export interface RightLook {
  icon: LucideIcon;
  tile: string;
}

const LOOK: Record<string, RightLook> = {
  "calendar.records": { icon: CalendarPlus, tile: SETTINGS_TILE.blue },
  "calendar.window": { icon: CalendarClock, tile: SETTINGS_TILE.teal },
  "calendar.create": { icon: CalendarPlus, tile: SETTINGS_TILE.blue },
  "calendar.move": { icon: ArrowRightLeft, tile: SETTINGS_TILE.teal },
  "calendar.cancel": { icon: CalendarX2, tile: SETTINGS_TILE.red },
  "calendar.events": { icon: CalendarDays, tile: SETTINGS_TILE.indigo },
  "calendar.day_labels": { icon: Bookmark, tile: SETTINGS_TILE.purple },
  "calendar.schedule": { icon: CalendarClock, tile: SETTINGS_TILE.blue },
  // Те же значки и цвета, что у строк шестерёнки календаря.
  "calendar.identity": { icon: PenLine, tile: SETTINGS_TILE.indigo },
  "calendar.timezone": { icon: Globe, tile: SETTINGS_TILE.orange },
  "calendar.hours": { icon: CalendarRange, tile: SETTINGS_TILE.teal },
  "calendar.booking_form": { icon: ClipboardList, tile: SETTINGS_TILE.blue },
  "calendar.services": { icon: Briefcase, tile: SETTINGS_TILE.blue },
  "calendar.labels": { icon: Tags, tile: SETTINGS_TILE.purple },
  "record.team": { icon: Users, tile: SETTINGS_TILE.teal },
  "record.label": { icon: Tag, tile: SETTINGS_TILE.purple },
  "record.when": { icon: Clock, tile: SETTINGS_TILE.teal },
  "record.color": { icon: Palette, tile: SETTINGS_TILE.blue },
  "record.client": { icon: UserRound, tile: SETTINGS_TILE.blue },
  "record.object": { icon: House, tile: SETTINGS_TILE.green },
  "record.services": { icon: Briefcase, tile: SETTINGS_TILE.blue },
  "record.amount": { icon: ReceiptText, tile: SETTINGS_TILE.green },
  "record.payment": { icon: CreditCard, tile: SETTINGS_TILE.green },
  "record.status": { icon: CircleCheck, tile: SETTINGS_TILE.orange },
  "record.files": { icon: Paperclip, tile: SETTINGS_TILE.indigo },
  "record.sms": { icon: MessageSquare, tile: SETTINGS_TILE.green },
  "record.note": { icon: StickyNote, tile: SETTINGS_TILE.orange },
  "event.label": { icon: Tag, tile: SETTINGS_TILE.purple },
  "event.type": { icon: Tags, tile: SETTINGS_TILE.indigo },
  "event.client": { icon: UserRound, tile: SETTINGS_TILE.blue },
  "event.object": { icon: House, tile: SETTINGS_TILE.green },
  "event.note": { icon: StickyNote, tile: SETTINGS_TILE.orange },
  "event.files": { icon: Paperclip, tile: SETTINGS_TILE.indigo },
  "finance.income": { icon: TrendingUp, tile: SETTINGS_TILE.green },
  "finance.expense": { icon: TrendingDown, tile: SETTINGS_TILE.red },
  "finance.accounts": { icon: Landmark, tile: SETTINGS_TILE.indigo },
  "finance.debts": { icon: HandCoins, tile: SETTINGS_TILE.orange },
  // Плитки «Документы» и «Прибыль» (03.10).
  "finance.documents": { icon: FileText, tile: SETTINGS_TILE.blue },
  "finance.profit": { icon: PiggyBank, tile: SETTINGS_TILE.purple },
  "finance.window": { icon: CalendarClock, tile: SETTINGS_TILE.teal },
  // Строки шестерёнки финансов — её значками (03.10).
  "finance.settings_accounts": { icon: Wallet, tile: SETTINGS_TILE.blue },
  "finance.settings_trash": { icon: Trash2, tile: SETTINGS_TILE.red },
  "finance.settings_categories_income": { icon: HandCoins, tile: SETTINGS_TILE.green },
  "finance.settings_categories_expense": { icon: ReceiptText, tile: SETTINGS_TILE.red },
  "finance.settings_categories_debts": { icon: NotebookPen, tile: SETTINGS_TILE.yellow },
  "finance.settings_invoices": { icon: FileText, tile: SETTINGS_TILE.blue },
  "finance.settings_currency": { icon: Banknote, tile: SETTINGS_TILE.green },
  "finance.settings_requisites": { icon: Building2, tile: SETTINGS_TILE.green },
  clients: { icon: Users, tile: SETTINGS_TILE.blue },
  "clients.scope": { icon: UserCheck, tile: SETTINGS_TILE.teal },
  // «Создание клиента» и «Меню клиента» (02.10).
  "clients.create": { icon: UserPlus, tile: SETTINGS_TILE.green },
  "clients.menu": { icon: Ellipsis, tile: SETTINGS_TILE.indigo },
  "clients.delete": { icon: Trash2, tile: SETTINGS_TILE.red },
  "clients.note": { icon: StickyNote, tile: SETTINGS_TILE.orange },
  "clients.people": { icon: Users, tile: SETTINGS_TILE.indigo },
  "clients.objects": { icon: House, tile: SETTINGS_TILE.green },
  // Метка — закладка, тег — ярлыки: те же значки, что у плиток «Метка | Тег»
  // на карточке клиента (03.10, права разделены).
  "clients.labels": { icon: Bookmark, tile: SETTINGS_TILE.teal },
  "clients.tags": { icon: Tags, tile: SETTINGS_TILE.purple },
  "clients.personal": { icon: UserRound, tile: SETTINGS_TILE.blue },
  "clients.files": { icon: Paperclip, tile: SETTINGS_TILE.indigo },
  // Здание, как плашка реквизитов на карточке (03.10); банк — у счетов.
  "clients.requisites": { icon: Building2, tile: SETTINGS_TILE.teal },
  // Блоки «Клиент», «История», «SMS» (02.10) — как на странице клиента.
  "clients.client": { icon: Contact, tile: SETTINGS_TILE.blue },
  "clients.history": { icon: CalendarClock, tile: SETTINGS_TILE.blue },
  "clients.sms": { icon: MessageSquare, tile: SETTINGS_TILE.green },
  // Настройки клиентов — те же значки и цвета, что у строк шестерёнки клиентов.
  "clients.settings_card": { icon: Eye, tile: SETTINGS_TILE.blue },
  "clients.settings_ways": { icon: MessageCircle, tile: SETTINGS_TILE.green },
  "clients.settings_objects": { icon: Shapes, tile: SETTINGS_TILE.teal },
  "clients.settings_maps": { icon: Navigation, tile: SETTINGS_TILE.blue },
  "clients.settings_tags": { icon: Tags, tile: SETTINGS_TILE.purple },
  "clients.settings_sources": { icon: Megaphone, tile: SETTINGS_TILE.orange },
  "company.sms_templates": { icon: MessageSquare, tile: SETTINGS_TILE.green },
};

/** Право, которого ещё нет в словаре (реестр живёт на сервере и может
 *  обогнать сборку), — нейтральный щит, а не пустая плитка. */
const FALLBACK: RightLook = { icon: Shield, tile: SETTINGS_TILE.blue };

export function rightLook(key: string): RightLook {
  return LOOK[key] ?? FALLBACK;
}

export const LOOKED_KEYS: readonly string[] = Object.keys(LOOK);

/** Плитка строки РАЗДЕЛА в блоке «Доступ» — по разделу приложения. */
const SECTION_LOOK: Record<string, RightLook> = {
  calendar: { icon: CalendarDays, tile: SETTINGS_TILE.blue },
  record: { icon: ClipboardList, tile: SETTINGS_TILE.teal },
  finance: { icon: Wallet, tile: SETTINGS_TILE.green },
  clients: { icon: Users, tile: SETTINGS_TILE.indigo },
  company: { icon: Building2, tile: SETTINGS_TILE.orange },
};

export function sectionLook(key: string): RightLook {
  return SECTION_LOOK[key] ?? FALLBACK;
}

/** ЗНАЧОК СТУПЕНИ В ШТОРКЕ (владелец 29.09: «не видит, видит, меняет — как-то
 *  по-другому, или значками»). Одна пара «значок + цвет» на смысл во всех
 *  правах: закрыто — перечёркнутый глаз, смотрит — глаз, меняет — карандаш,
 *  правит всё — щит с восклицанием. */
const STEP_LOOK: Partial<Record<AccessLevel, RightLook>> = {
  off: { icon: EyeOff, tile: SETTINGS_TILE.red },
  read: { icon: Eye, tile: SETTINGS_TILE.blue },
  write: { icon: PencilLine, tile: SETTINGS_TILE.green },
  full: { icon: ShieldAlert, tile: SETTINGS_TILE.orange },
  // «Без ограничения» у «Ограничений» (02.10) — бесконечность.
  own: { icon: InfinityIcon, tile: SETTINGS_TILE.blue },
  all: { icon: Users, tile: SETTINGS_TILE.green },
  week: { icon: CalendarClock, tile: SETTINGS_TILE.teal },
  near: { icon: CalendarClock, tile: SETTINGS_TILE.teal },
  month: { icon: CalendarDays, tile: SETTINGS_TILE.teal },
  quarter: { icon: CalendarRange, tile: SETTINGS_TILE.teal },
  half: { icon: CalendarRange, tile: SETTINGS_TILE.teal },
  day: { icon: CalendarDays, tile: SETTINGS_TILE.teal },
};

export function stepLook(level: AccessLevel): RightLook {
  return STEP_LOOK[level] ?? FALLBACK;
}
