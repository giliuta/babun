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
import { ICON_PRESETS, iconPreset, type IconPreset } from "@/components/ui/icon-set";

// ЗНАЧКИ ТИПОВ СОБЫТИЙ — ОДИН СПИСОК НА ПРОДУКТ. Карта жила внутри экрана
// Кабинет → «Типы событий», и форма события знать её не могла: в её плитке
// стоял один и тот же Tag на все типы, отчего «Обед» и «Отпуск» выглядели
// одинаково. Теперь тот же значок, что выбран в справочнике, стоит и в форме.

/** Глиф значка. Именно `LucideIcon`, а не свой `ComponentType`: тот же тип
 *  ждёт общий `IconPicker`, и своя подпись рассыпала бы пресеты. */
export type EventTypeIconCmp = LucideIcon;

/** КАРТА СОВМЕСТИМОСТИ, А НЕ НАБОР ДЛЯ ВЫБОРА (2026-09-10). Выбирают теперь из
 *  общих сорока (`ICON_PRESETS`), но у типов, заведённых раньше, в базе лежат
 *  СВОИ слаги — «coffee», «moon», «dumbbell», «graduation-cap». Здесь они и
 *  живут: без этой карты «Обед» превратился бы в безымянный ярлычок. */
export const EVENT_TYPE_ICONS: Record<string, EventTypeIconCmp> = {
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

/** Значок типа. Сначала общий словарь продукта, затем карта совместимости со
 *  старыми слагами; незнакомое имя читается как «метка». */
export function eventTypeIcon(icon: string | null | undefined): EventTypeIconCmp {
  const slug = icon ?? "tag";
  return iconPreset(slug) ?? EVENT_TYPE_ICONS[slug] ?? Tag;
}

/** Набор для шторки «Вид»: общие СОРОК значков — тот же, что у счёта, категории
 *  и типа объекта (владелец 2026-09-10: «сделать 40 иконок… абсолютно во всех»).
 *  Если у типа уже стоит старый слаг, он ДОПИСЫВАЕТСЯ отдельной плиткой в конец
 *  — иначе решётка открывалась бы с пустым выбором при заполненном значке, ровно
 *  как это было у цвета вне палитры. */
export function eventTypeIconPresets(
  current?: string | null,
): IconPreset[] {
  const slug = (current ?? "").trim();
  if (!slug || ICON_PRESETS.some((preset) => preset.value === slug)) {
    return ICON_PRESETS;
  }
  const legacy = EVENT_TYPE_ICONS[slug];
  if (!legacy) return ICON_PRESETS;
  return [...ICON_PRESETS, { value: slug, label: "Прежний значок", icon: legacy }];
}

