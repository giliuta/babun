import {
  ArrowRightLeft,
  Bookmark,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarRange,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  CircleCheck,
  ClipboardList,
  CreditCard,
  Eye,
  EyeOff,
  Globe,
  HandCoins,
  House,
  Landmark,
  MessageSquare,
  Palette,
  Paperclip,
  PenLine,
  PencilLine,
  Phone,
  ReceiptText,
  Shield,
  ShieldAlert,
  Tag,
  Tags,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  Wallet,
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
  "record.color": { icon: Palette, tile: SETTINGS_TILE.blue },
  "record.client": { icon: UserRound, tile: SETTINGS_TILE.blue },
  "record.object": { icon: House, tile: SETTINGS_TILE.green },
  "record.services": { icon: Briefcase, tile: SETTINGS_TILE.blue },
  "record.amount": { icon: ReceiptText, tile: SETTINGS_TILE.green },
  "record.payment": { icon: CreditCard, tile: SETTINGS_TILE.green },
  "record.status": { icon: CircleCheck, tile: SETTINGS_TILE.orange },
  "record.files": { icon: Paperclip, tile: SETTINGS_TILE.indigo },
  "finance.income": { icon: TrendingUp, tile: SETTINGS_TILE.green },
  "finance.expense": { icon: TrendingDown, tile: SETTINGS_TILE.red },
  "finance.operations": { icon: Wallet, tile: SETTINGS_TILE.green },
  "finance.accounts": { icon: Landmark, tile: SETTINGS_TILE.indigo },
  "finance.debts": { icon: HandCoins, tile: SETTINGS_TILE.orange },
  clients: { icon: Users, tile: SETTINGS_TILE.blue },
  "clients.scope": { icon: UserCheck, tile: SETTINGS_TILE.teal },
  "clients.contacts": { icon: Phone, tile: SETTINGS_TILE.green },
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
  own: { icon: UserRound, tile: SETTINGS_TILE.blue },
  all: { icon: Users, tile: SETTINGS_TILE.green },
};

export function stepLook(level: AccessLevel): RightLook {
  return STEP_LOOK[level] ?? FALLBACK;
}
