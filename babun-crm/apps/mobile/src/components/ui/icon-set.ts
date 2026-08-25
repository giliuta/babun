// СОРОК ЗНАЧКОВ — общий словарь на весь продукт (владелец 2026-08-17: «также
// разработаем блок с иконками, которые нам в будущем могут понадобиться»).
// Рисует их `IconPicker`; читают — экраны, где значок уже выбран (счета).
//
// Порядок задаёт картинку так же, как в палитре: сетка идёт в ВОСЕМЬ столбцов,
// поэтому каждая восьмёрка ниже — тематический ряд (деньги · места · работа ·
// климат · люди). Переставлять внутри восьмёрок можно, выкидывать — нет:
// значение (`value`) лежит в базе тенанта (`accounts.icon`), и пропавший слаг
// превращает выбранный значок в «не выбран».
//
// ПЕРВЫЕ ПЯТНАДЦАТЬ СЛАГОВ — ИСТОРИЧЕСКИЕ (бывший ACCOUNT_ICONS счетов): cash,
// card, bank, safe, piggy, wallet, handcoins, receipts, case, office, store,
// car, tools, phone, gift. Все на месте, миграции не нужно.
import {
  Banknote,
  Briefcase,
  Building2,
  Calendar,
  Car,
  Clock,
  Coffee,
  CreditCard,
  Droplet,
  Fan,
  Flame,
  Gift,
  Globe,
  Hammer,
  HandCoins,
  Heart,
  House,
  Key,
  Landmark,
  Leaf,
  MapPin,
  Package,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Smartphone,
  Snowflake,
  Star,
  Store,
  Sun,
  Thermometer,
  TreePalm,
  Truck,
  Users,
  Vault,
  Wallet,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react-native";

export interface IconPreset {
  /** Короткий слаг — он и хранится в базе, а не сам глиф. */
  value: string;
  /** Русское имя для озвучки: VoiceOver читал «Значок handcoins». */
  label: string;
  icon: LucideIcon;
}

export const ICON_PRESETS: IconPreset[] = [
  // деньги
  { value: "cash", label: "Касса", icon: Banknote },
  { value: "card", label: "Карта", icon: CreditCard },
  { value: "bank", label: "Банк", icon: Landmark },
  { value: "safe", label: "Сейф", icon: Vault },
  { value: "piggy", label: "Копилка", icon: PiggyBank },
  { value: "wallet", label: "Кошелёк", icon: Wallet },
  { value: "handcoins", label: "Наличные в руки", icon: HandCoins },
  { value: "receipts", label: "Чеки", icon: Receipt },
  // места
  { value: "case", label: "Портфель", icon: Briefcase },
  { value: "office", label: "Офис", icon: Building2 },
  { value: "store", label: "Магазин", icon: Store },
  { value: "home", label: "Дом", icon: House },
  { value: "pin", label: "Точка на карте", icon: MapPin },
  { value: "globe", label: "Мир", icon: Globe },
  { value: "plane", label: "Самолёт", icon: Plane },
  { value: "palm", label: "Пальма", icon: TreePalm },
  // работа
  { value: "car", label: "Машина", icon: Car },
  { value: "truck", label: "Грузовик", icon: Truck },
  { value: "tools", label: "Инструмент", icon: Wrench },
  { value: "hammer", label: "Молоток", icon: Hammer },
  { value: "bolt", label: "Электрика", icon: Zap },
  { value: "plug", label: "Розетка", icon: Plug },
  { value: "box", label: "Коробка", icon: Package },
  { value: "key", label: "Ключ", icon: Key },
  // климат
  { value: "fan", label: "Вентилятор", icon: Fan },
  { value: "snow", label: "Холод", icon: Snowflake },
  { value: "flame", label: "Тепло", icon: Flame },
  { value: "temp", label: "Градусник", icon: Thermometer },
  { value: "drop", label: "Вода", icon: Droplet },
  { value: "wind", label: "Ветер", icon: Wind },
  { value: "sun", label: "Солнце", icon: Sun },
  { value: "leaf", label: "Лист", icon: Leaf },
  // люди и жизнь
  { value: "people", label: "Люди", icon: Users },
  { value: "phone", label: "Телефон", icon: Smartphone },
  { value: "calendar", label: "Календарь", icon: Calendar },
  { value: "clock", label: "Часы", icon: Clock },
  { value: "star", label: "Звезда", icon: Star },
  { value: "heart", label: "Сердце", icon: Heart },
  { value: "gift", label: "Подарок", icon: Gift },
  { value: "coffee", label: "Кофе", icon: Coffee },
];

/** Глиф по слагу. Старые значения-эмодзи из веб-мастера слагами не являются и
 *  потому ведут себя как «не выбран» — выдумывать по ним значок нечестно. */
export function iconPreset(value: string | null | undefined): LucideIcon | null {
  if (!value) return null;
  return ICON_PRESETS.find((i) => i.value === value)?.icon ?? null;
}

/** Русское имя выбранного значка — для строки-значения в настройках. */
export function iconPresetLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ICON_PRESETS.find((i) => i.value === value)?.label ?? null;
}
