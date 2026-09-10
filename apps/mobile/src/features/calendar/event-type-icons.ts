import {
  Bell,
  Book,
  Briefcase,
  Calendar,
  Car,
  Coffee,
  Dumbbell,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Moon,
  Music,
  Navigation,
  Phone,
  Plane,
  ShoppingBag,
  Star,
  Stethoscope,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import type { PersonalEventTypeIcon } from "@babun/shared/local/personal-event-types";
import type { IconPreset } from "@/components/ui/icon-set";

// ЗНАЧКИ ТИПОВ СОБЫТИЙ — ОДИН СПИСОК НА ПРОДУКТ. Карта жила внутри экрана
// Кабинет → «Типы событий», и форма события знать её не могла: в её плитке
// стоял один и тот же Tag на все типы, отчего «Обед» и «Отпуск» выглядели
// одинаково. Теперь тот же значок, что выбран в справочнике, стоит и в форме.

/** Глиф значка. Именно `LucideIcon`, а не свой `ComponentType`: тот же тип
 *  ждёт общий `IconPicker`, и своя подпись рассыпала бы пресеты. */
export type EventTypeIconCmp = LucideIcon;

/** Полный набор иконок модели `PersonalEventTypeIcon` (веб-паритет пикера). */
export const EVENT_TYPE_ICONS: Record<PersonalEventTypeIcon, EventTypeIconCmp> = {
  coffee: Coffee,
  briefcase: Briefcase,
  navigation: Navigation,
  moon: Moon,
  plane: Plane,
  bell: Bell,
  heart: Heart,
  star: Star,
  dumbbell: Dumbbell,
  book: Book,
  music: Music,
  "graduation-cap": GraduationCap,
  stethoscope: Stethoscope,
  car: Car,
  home: Home,
  users: Users,
  phone: Phone,
  "shopping-bag": ShoppingBag,
  gift: Gift,
  calendar: Calendar,
  tag: Tag,
};

/** Ключи в порядке объявления — сетка выбора значка в Кабинете. */
export const EVENT_TYPE_ICON_KEYS = Object.keys(
  EVENT_TYPE_ICONS,
) as PersonalEventTypeIcon[];

/** Значок типа; незнакомое имя (старая строка из базы) читается как «метка». */
export function eventTypeIcon(icon: string | null | undefined): EventTypeIconCmp {
  return EVENT_TYPE_ICONS[(icon ?? "tag") as PersonalEventTypeIcon] ?? Tag;
}

/** Тот же набор для общего `IconPicker`: слаг, русское имя для озвучки, глиф.
 *  Свой у типов событий потому, что слаги хранятся в базе (`icon`) и не
 *  совпадают со слагами общих сорока значков. */
export const EVENT_TYPE_ICON_PRESETS: IconPreset[] = (
  [
    ["coffee", "Кофе"],
    ["briefcase", "Портфель"],
    ["navigation", "Навигация"],
    ["moon", "Луна"],
    ["plane", "Самолёт"],
    ["bell", "Колокольчик"],
    ["heart", "Сердце"],
    ["star", "Звезда"],
    ["dumbbell", "Гантель"],
    ["book", "Книга"],
    ["music", "Музыка"],
    ["graduation-cap", "Учёба"],
    ["stethoscope", "Врач"],
    ["car", "Машина"],
    ["home", "Дом"],
    ["users", "Люди"],
    ["phone", "Телефон"],
    ["shopping-bag", "Покупки"],
    ["gift", "Подарок"],
    ["calendar", "Календарь"],
    ["tag", "Метка"],
  ] as const
).map(([value, label]) => ({
  value,
  label,
  icon: EVENT_TYPE_ICONS[value],
}));
