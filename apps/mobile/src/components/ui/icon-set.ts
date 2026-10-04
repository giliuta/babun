// ЗНАЧКИ — общий словарь на весь продукт (владелец 2026-08-17: «также
// разработаем блок с иконками, которые нам в будущем могут понадобиться»).
// Было сорок; 03.10 владелец попросил больше — «чтоб под офис был значок
// офиса, под дом — дома»: добавлены ещё пять восьмёрок (здания · жильё и
// отдых · внутри · техника и стройка · разное), всего восемьдесят.
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
  AirVent,
  Banknote,
  Bath,
  Bed,
  Briefcase,
  Building,
  Building2,
  Calendar,
  Car,
  Caravan,
  Castle,
  Cctv,
  Church,
  Clock,
  Coffee,
  Construction,
  CookingPot,
  CreditCard,
  DoorOpen,
  Drill,
  Droplet,
  Dumbbell,
  Factory,
  Fan,
  Fence,
  Flame,
  Gauge,
  Gift,
  Globe,
  Hammer,
  HandCoins,
  HardHat,
  Heart,
  Heater,
  Hospital,
  Hotel,
  House,
  Key,
  Landmark,
  Leaf,
  Lightbulb,
  Lock,
  MapPin,
  Mountain,
  Package,
  PaintRoller,
  PawPrint,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Refrigerator,
  Sailboat,
  School,
  ShieldCheck,
  ShoppingBag,
  ShowerHead,
  Smartphone,
  Snowflake,
  Sofa,
  Star,
  Store,
  Sun,
  Tent,
  Thermometer,
  TreePalm,
  Trees,
  Truck,
  Tv,
  Users,
  Utensils,
  Vault,
  Wallet,
  Warehouse,
  WashingMachine,
  Waves,
  Wifi,
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
  // здания (03.10)
  { value: "building", label: "Многоэтажка", icon: Building },
  { value: "hotel", label: "Отель", icon: Hotel },
  { value: "factory", label: "Завод", icon: Factory },
  { value: "warehouse", label: "Склад", icon: Warehouse },
  { value: "school", label: "Школа", icon: School },
  { value: "hospital", label: "Больница", icon: Hospital },
  { value: "church", label: "Храм", icon: Church },
  { value: "castle", label: "Замок", icon: Castle },
  // жильё и отдых
  { value: "tent", label: "Палатка", icon: Tent },
  { value: "caravan", label: "Дом на колёсах", icon: Caravan },
  { value: "fence", label: "Участок", icon: Fence },
  { value: "door", label: "Дверь", icon: DoorOpen },
  { value: "pool", label: "Бассейн", icon: Waves },
  { value: "mountain", label: "Горы", icon: Mountain },
  { value: "trees", label: "Сад", icon: Trees },
  { value: "boat", label: "Яхта", icon: Sailboat },
  // внутри
  { value: "bed", label: "Спальня", icon: Bed },
  { value: "sofa", label: "Гостиная", icon: Sofa },
  { value: "bath", label: "Ванная", icon: Bath },
  { value: "shower", label: "Душ", icon: ShowerHead },
  { value: "cooking", label: "Кухня", icon: CookingPot },
  { value: "fridge", label: "Холодильник", icon: Refrigerator },
  { value: "washer", label: "Стиральная машина", icon: WashingMachine },
  { value: "tv", label: "Телевизор", icon: Tv },
  // техника и стройка
  { value: "vent", label: "Кондиционер", icon: AirVent },
  { value: "heater", label: "Обогреватель", icon: Heater },
  { value: "bulb", label: "Свет", icon: Lightbulb },
  { value: "construction", label: "Стройка", icon: Construction },
  { value: "helmet", label: "Каска", icon: HardHat },
  { value: "drill", label: "Дрель", icon: Drill },
  { value: "paint", label: "Покраска", icon: PaintRoller },
  { value: "gauge", label: "Манометр", icon: Gauge },
  // разное
  { value: "cctv", label: "Камера", icon: Cctv },
  { value: "wifi", label: "Интернет", icon: Wifi },
  { value: "shield", label: "Охрана", icon: ShieldCheck },
  { value: "lock", label: "Замок двери", icon: Lock },
  { value: "food", label: "Ресторан", icon: Utensils },
  { value: "gym", label: "Спортзал", icon: Dumbbell },
  { value: "shopping", label: "Покупки", icon: ShoppingBag },
  { value: "paw", label: "Питомцы", icon: PawPrint },
];

/** Глиф по слагу. Старые значения-эмодзи из веб-мастера слагами не являются и
 *  потому ведут себя как «не выбран» — выдумывать по ним значок нечестно. */
export function iconPreset(value: string | null | undefined): LucideIcon | null {
  if (!value) return null;
  return ICON_PRESETS.find((i) => i.value === value)?.icon ?? null;
}
