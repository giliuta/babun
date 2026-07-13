// Кабинет — корневое меню приложения в языке веб-«Настроек»
// (apps/web/src/app/dashboard/settings/page.tsx, v316 iOS-26 redesign):
// герой-карта аккаунта с градиентом и инициалами → группы строк с
// цветными icon-тайлами (палитра --tile-* из web globals.css), у каждой
// строки название + серое описание → красная карта «Выйти из аккаунта»
// → футер «Babun · vX.Y.Z».
//
// Отличие от веба по содержимому (осознанное): мобильный Кабинет —
// единственный хаб приложения, поэтому сверху остаётся мобильная группа
// «Смена» (Сводка / Закрыть день / Незакрытые / Склад), которой в веб-
// настройках нет (в вебе это раздел «Аналитика» сайдбара). Веб-пункты
// без мобильного экрана (Тариф и оплата, Автоматические SMS, Онлайн
// запись, Интеграции) не рисуем — мёртвых строк в меню быть не должно.

import { useMemo, type ComponentType } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  BarChart3,
  Boxes,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  IdCard,
  Landmark,
  LogOut,
  MapPin,
  MessageSquareText,
  Package,
  Receipt,
  RotateCw,
  Scissors,
  Shield,
  Star,
  Tag,
  Tags,
  Users,
  Wallet,
  Wrench,
} from "lucide-react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";
import { Screen } from "@/components/ui/Screen";
import { TYPE } from "@/components/ui/tokens";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors } from "@/theme/colors";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useSession } from "@/providers/SessionProvider";
import { useTenant } from "@/features/settings/tenant";
import { formatYMD } from "@/features/appointments/helpers";
import { useAppointments } from "@/features/calendar/queries";

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

// Палитра icon-тайлов — веб-токены --tile-* (apps/web globals.css),
// один к одному, как в iOS Settings: цвет различает пункты, не несёт
// смысловой нагрузки.
const TILE = {
  blue: "#3E88F7",
  green: "#4CAF50",
  yellow: "#F4C430",
  orange: "#F59E0B",
  purple: "#9B59B6",
  mint: "#10B981",
  cyan: "#3EB8E5",
  indigo: "#5E72E4",
} as const;

// Строка меню — анатомия веб-ряда: тайл 30, заголовок 15 medium,
// описание 12 secondary, chevron. Бейдж-счётчик — мобильное дополнение
// (веб-настройки счётчиков не носят, но «Незакрытые дни» без него слепнут).
function MenuRow({
  icon: Icon,
  tone,
  title,
  desc,
  href,
  badge,
}: {
  icon: IconType;
  tone: string;
  title: string;
  desc: string;
  href: Href;
  badge?: number;
}) {
  const router = useRouter();
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[58px] flex-row items-center gap-3 px-4 py-2.5"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        style={{
          height: 30,
          width: 30,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          backgroundColor: tone,
        }}
      >
        <Icon color="#fff" size={18} strokeWidth={2.2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text style={{ fontSize: 15, fontWeight: "500", color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ marginTop: 1, fontSize: 12, color: t.sub }} numberOfLines={1}>
          {desc}
        </Text>
      </View>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            backgroundColor: t.warning,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>{badge}</Text>
        </View>
      ) : null}
      <ChevronRight color={t.chevron} size={16} />
    </Pressable>
  );
}

function GroupLabel({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      // Caption tier (DS §2: 11/700/+0.6 uppercase) — matches SectionHeader.
      style={{
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 4,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
      }}
    >
      {children}
    </Text>
  );
}

// Герой-карта аккаунта (веб AccountHero): градиент accent→indigo→purple
// 135°, кольцо-аватар с инициалами компании, имя + email. Display-only —
// поля редактируются в «Личной информации» одним тапом ниже.
function AccountHero() {
  const t = useThemeColors();
  const { session } = useSession();
  const { data: tenant } = useTenant();

  const name = (tenant?.name as string | undefined)?.trim() || "Babun";
  const email = session?.user.email ?? "";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "B";

  return (
    <View className="mx-3 mt-2 overflow-hidden rounded-[20px]">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* 135° как в вебе: var(--accent) → --system-indigo 60% → --system-purple */}
          <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accent} />
            <Stop offset="0.6" stopColor="#5E5CE6" />
            <Stop offset="1" stopColor="#AF52DE" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero)" />
      </Svg>
      <View className="flex-row items-center gap-3 px-4 py-4">
        <View
          style={{
            height: 56,
            width: 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 28,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.7)",
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#fff" }}>{initials}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text style={{ fontSize: 17, fontWeight: "600", color: "#fff" }} numberOfLines={1}>
            {name}
          </Text>
          {email ? (
            <Text
              style={{ marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.85)" }}
              numberOfLines={1}
            >
              {email}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function CabinetHome() {
  const t = useThemeColors();
  // Бейдж «Незакрытые дни» — тот же фильтр, что и в unclosed.tsx, но хабу
  // нужен только count; useAppointments — локальный кэш, тяжёлого нет.
  const { data: appts = [] } = useAppointments();
  const unclosedCount = useMemo(() => {
    const todayKey = formatYMD(new Date());
    return appts.filter(
      (a) =>
        (a.kind === undefined || a.kind === "work") &&
        a.status === "scheduled" &&
        a.date < todayKey,
    ).length;
  }, [appts]);

  return (
    <Screen>
      <View className="px-4 pb-1 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Кабинет</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <AccountHero />

        <GroupLabel>Смена</GroupLabel>
        <SectionCard>
          {/* Веб: АНАЛИТИКА → Сводка (KPI + топы за период). */}
          <MenuRow
            icon={BarChart3}
            tone={TILE.indigo}
            title="Сводка"
            desc="KPI и топы за период"
            href={"/cabinet/insights" as Href}
          />
          <Divider inset={58} />
          <MenuRow
            icon={CalendarCheck2}
            tone={TILE.green}
            title="Закрыть день"
            desc="Сверка записей и оплат за день"
            href="/cabinet/close-day"
          />
          <Divider inset={58} />
          <MenuRow
            icon={CalendarX2}
            tone={TILE.orange}
            title="Незакрытые дни"
            desc="Прошедшие записи без итога"
            href={"/cabinet/unclosed" as Href}
            badge={unclosedCount}
          />
          <Divider inset={58} />
          <MenuRow
            icon={Package}
            tone={TILE.yellow}
            title="Склад"
            desc="Материалы и остатки"
            href="/cabinet/inventory"
          />
        </SectionCard>

        {/* Веб-группа «Личный кабинет» — те же строки, что в веб-меню;
            «Счёт компании» на мобиле живёт внутри «Личной информации»
            (business.tsx, секция «Реквизиты для счетов»). */}
        <GroupLabel>Личный кабинет</GroupLabel>
        <SectionCard>
          <MenuRow
            icon={IdCard}
            tone={TILE.blue}
            title="Личная информация"
            desc="Бизнес, контакты, реквизиты"
            href="/cabinet/business"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Receipt}
            tone={TILE.yellow}
            title="Шаблоны транзакций"
            desc="Аренда, ЗП, чаевые — в один тап"
            href="/cabinet/templates"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Shield}
            tone={TILE.orange}
            title="Вход и безопасность"
            desc="Пароль, аккаунт, удаление"
            href="/cabinet/account"
          />
        </SectionCard>

        <GroupLabel>Записи</GroupLabel>
        <SectionCard>
          <MenuRow
            icon={CalendarClock}
            tone={TILE.orange}
            title="Календарь"
            desc="Рабочие часы, шаг сетки"
            href="/cabinet/calendar"
          />
          <Divider inset={58} />
          <MenuRow
            icon={MessageSquareText}
            tone={TILE.green}
            title="Шаблоны SMS"
            desc="Тексты напоминаний и подтверждений"
            href={"/cabinet/sms-templates" as Href}
          />
          <Divider inset={58} />
          <MenuRow
            icon={Star}
            tone={TILE.yellow}
            title="Программа лояльности"
            desc="Скидки постоянным клиентам"
            href="/cabinet/loyalty"
          />
          <Divider inset={58} />
          <MenuRow
            icon={RotateCw}
            tone={TILE.mint}
            title="Повторяющиеся ТО"
            desc="Серии регулярных записей"
            href="/cabinet/recurring"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Tags}
            tone={TILE.purple}
            title="Типы событий"
            desc="Чипы быстрого применения: Обед, Встреча…"
            href="/cabinet/event-types"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Tag}
            tone={TILE.cyan}
            title="Метки"
            desc="Город / тег под датой в календаре"
            href={"/cabinet/labels" as Href}
          />
        </SectionCard>

        <GroupLabel>Справочники</GroupLabel>
        <SectionCard>
          <MenuRow
            icon={Scissors}
            tone={TILE.blue}
            title="Услуги"
            desc="Каталог работ и цены"
            href="/cabinet/services"
          />
          <Divider inset={58} />
          <MenuRow
            icon={MapPin}
            tone={TILE.cyan}
            title="Города"
            desc="Список и активность"
            href="/cabinet/cities"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Boxes}
            tone={TILE.purple}
            title="Типы объектов"
            desc="Метки адресов: офис, дом, склад, кафе"
            href="/cabinet/object-types"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Wallet}
            tone={TILE.green}
            title="Категории"
            desc="Категории доходов и расходов"
            href="/cabinet/categories"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Landmark}
            tone={TILE.mint}
            title="Счета"
            desc="Кассы и счета бригад"
            href="/cabinet/accounts"
          />
        </SectionCard>

        <GroupLabel>Компания</GroupLabel>
        <SectionCard>
          <MenuRow
            icon={Users}
            tone={TILE.orange}
            title="Команды"
            desc="Бригады: состав, цвет, расписание"
            href="/cabinet/teams"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Wrench}
            tone={TILE.indigo}
            title="Мастера"
            desc="Сотрудники и их бригады"
            href="/cabinet/masters"
          />
        </SectionCard>

        {/* Выход — красная карта-строка, как в вебе. Wipes tenant-scoped
            MMKV + query cache once signOut succeeds, so the next account
            on this device never sees this tenant's data. */}
        <SectionCard>
          <Pressable
            onPress={() => void signOutAndWipe()}
            accessibilityRole="button"
            accessibilityLabel="Выйти из аккаунта"
            className="min-h-[52px] flex-row items-center justify-center gap-2 px-4 py-3.5"
            style={({ pressed }) => ({
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <LogOut color={t.danger} size={16} strokeWidth={2.2} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>
              Выйти из аккаунта
            </Text>
          </Pressable>
        </SectionCard>

        <Text
          style={{
            paddingVertical: 12,
            textAlign: "center",
            fontSize: 11,
            color: t.faint,
          }}
        >
          Babun · {DISPLAY_VERSION}
        </Text>
      </ScrollView>
    </Screen>
  );
}
