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
  BookUser,
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
  RefreshCw,
  RotateCw,
  Briefcase,
  Shield,
  Star,
  Tag,
  Tags,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { TYPE } from "@/components/ui/tokens";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors } from "@/theme/colors";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useSession } from "@/providers/SessionProvider";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
import { ROLE_LABELS, type UserRole } from "@/features/settings/role-policy";
import { formatYMD } from "@/features/appointments/helpers";
import { useAppointments } from "@/features/calendar/queries";
import { unclosedAppointments } from "@babun/shared/local/selectors/unclosed";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useQueueDepth } from "@babun/shared/sync";

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

// Палитра icon-тайлов — веб-токены --tile-* (apps/web globals.css),
// один к одному, как в iOS Settings: цвет различает пункты, не несёт
// смысловой нагрузки.
// Личные события включены в единую страницу /book; их типы и метки должны
// оставаться настраиваемыми из кабинета, а не жить скрытым deep link.
const PERSONAL_CALENDAR_ENABLED = true;

const TILE = {
  blue: "#2F6FD6",
  green: "#2E7D32",
  yellow: "#9A6400",
  orange: "#B45309",
  purple: "#8E44AD",
  mint: "#087A52",
  cyan: "#007A99",
  indigo: "#4B55C7",
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
          borderRadius: t.radius.card,
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
            borderRadius: t.radius.card,
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

// Герой-карта аккаунта (веб AccountHero): градиент accent→indigo→purple
// 135°, кольцо-аватар с инициалами компании, имя + email. Тап ведёт в
// «Личную информацию» — карту с именем компании естественно тыкают,
// чтобы это имя поменять.
function AccountHero({ role }: { role: UserRole | null | undefined }) {
  const t = useThemeColors();
  const router = useRouter();
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
    <Pressable
      onPress={() => router.push("/cabinet/business")}
      accessibilityRole="button"
      accessibilityLabel={`${name}, открыть личную информацию`}
      className="mx-3 mt-2 overflow-hidden rounded-[10px]"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* 135° как в вебе: var(--accent) → --system-indigo 60% → --system-purple */}
          <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accent} />
            <Stop offset="0.6" stopColor="#5E5CE6" />
            <Stop offset="1" stopColor="#9B3DCB" />
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
            borderRadius: t.radius.card,
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
          {email || role ? (
            <Text
              style={{ marginTop: 2, fontSize: 12, color: "#fff" }}
              numberOfLines={1}
            >
              {role ? ROLE_LABELS[role] : ""}
              {role && email ? " · " : ""}
              {email}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function CabinetHome() {
  const t = useThemeColors();
  const { data: role } = useCurrentRole();
  const owner = role === "owner";
  const dispatcher = role === "dispatcher";
  const master = role === "master";
  const syncDepth = useQueueDepth();
  const { data: calendarSettings } = useCalendarSettings();
  const todayKey = formatYMD(
    calendarSettings?.timezone
      ? getCurrentTimeInZone(calendarSettings.timezone)
      : getCurrentCyprusTime(),
  );
  // Бейдж «Незакрытые дни» — тот же фильтр, что и в unclosed.tsx, но хабу
  // нужен только count; useAppointments — локальный кэш, тяжёлого нет.
  const { data: appts = [] } = useAppointments();
  const unclosedCount = useMemo(
    () => unclosedAppointments(appts, todayKey).length,
    [appts, todayKey],
  );

  return (
    <Screen>
      <View className="px-4 pb-1 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Кабинет</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <AccountHero role={role} />

        {owner || dispatcher || master ? (
          <>
            <SectionEyebrow>Смена</SectionEyebrow>
            <SectionCard>
              {owner ? (
                <>
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
                </>
              ) : null}
              {owner || dispatcher ? (
                <MenuRow
                  icon={CalendarX2}
                  tone={TILE.orange}
                  title="Незакрытые дни"
                  desc="Прошедшие записи без итога"
                  href={"/cabinet/unclosed" as Href}
                  badge={unclosedCount}
                />
              ) : null}
              {owner || dispatcher ? <Divider inset={58} /> : null}
              <MenuRow
                icon={Package}
                tone={TILE.yellow}
                title="Склад"
                desc={owner ? "Материалы и остатки" : "Материалы · только просмотр"}
                href="/cabinet/inventory"
              />
            </SectionCard>
          </>
        ) : null}

        {/* Веб-группа «Личный кабинет» — те же строки, что в веб-меню;
            «Счёт компании» на мобиле живёт внутри «Личной информации»
            (business.tsx, секция «Реквизиты для счетов»). */}
        <SectionEyebrow>Личный кабинет</SectionEyebrow>
        <SectionCard>
          <MenuRow
            icon={IdCard}
            tone={TILE.blue}
            title="Личная информация"
            desc={owner ? "Бизнес, контакты, реквизиты" : "Профиль компании · только чтение"}
            href="/cabinet/business"
          />
          {owner ? (
            <>
              <Divider inset={58} />
              <MenuRow
                icon={Receipt}
                tone={TILE.yellow}
                title="Шаблоны транзакций"
                desc="Аренда, ЗП, чаевые — в один тап"
                href="/cabinet/templates"
              />
            </>
          ) : null}
          <Divider inset={58} />
          <MenuRow
            icon={Shield}
            tone={TILE.orange}
            title="Вход и безопасность"
            desc="Пароль, аккаунт, удаление"
            href="/cabinet/account"
          />
        </SectionCard>

        <SectionEyebrow>Записи</SectionEyebrow>
        <SectionCard>
          <MenuRow
            icon={CalendarClock}
            tone={TILE.orange}
            title={owner ? "Настройки календаря" : "Рабочий календарь"}
            desc={owner ? "Часы, шаг сетки, буфер, часовой пояс" : "График и назначенные заявки"}
            href={owner ? "/calendar" : "/"}
          />
          {dispatcher ? (
            <>
              <Divider inset={58} />
              <MenuRow
                icon={BookUser}
                tone={TILE.indigo}
                title="Клиенты"
                desc="Поиск, карточки и новые обращения"
                href={"/clients" as Href}
              />
              <Divider inset={58} />
              <MenuRow
                icon={MessageSquareText}
                tone={TILE.green}
                title="Шаблоны SMS"
                desc="Рабочие тексты для клиентов"
                href={"/cabinet/sms-templates" as Href}
              />
              <Divider inset={58} />
              <MenuRow
                icon={RotateCw}
                tone={TILE.mint}
                title="Повторяющиеся ТО"
                desc="Серии регулярных записей"
                href="/cabinet/recurring"
              />
            </>
          ) : null}
          {owner ? (
            <>
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
            </>
          ) : null}
          {/* Типы применяются на /book; метки используются в календаре. */}
          {owner && PERSONAL_CALENDAR_ENABLED ? (
            <>
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
            </>
          ) : null}
        </SectionCard>

        {owner ? (
          <>
            <SectionEyebrow>Справочники</SectionEyebrow>
            <SectionCard>
          {/* Настройки списка клиентов — тот же экран, что за шестерёнкой
              на вкладке Клиенты (правило: меню настроек живёт в Кабинете). */}
          <MenuRow
            icon={BookUser}
            tone={TILE.indigo}
            title="Клиенты"
            desc="Что показывать, сортировка, импорт"
            href={"/clients/settings" as Href}
          />
          <Divider inset={58} />
          <MenuRow
            icon={Briefcase}
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
            desc="Кассы и счета команд"
            href="/accounts"
          />
            </SectionCard>

            <SectionEyebrow>Компания</SectionEyebrow>
            <SectionCard>
              <MenuRow
                icon={UserCog}
                tone={TILE.green}
                title="Доступ в CRM"
                desc="Владелец, диспетчер, бригадир / мастер"
                href={"/cabinet/team-access" as Href}
              />
              <Divider inset={58} />
          <MenuRow
            icon={Users}
            tone={TILE.orange}
            title="Команды"
            desc="Команды: состав, цвет, расписание"
            href="/cabinet/teams"
          />
          <Divider inset={58} />
          <MenuRow
            icon={Wrench}
            tone={TILE.indigo}
            title="Мастера"
            desc="Сотрудники и их команды"
            href="/cabinet/masters"
          />
            </SectionCard>
          </>
        ) : null}

        {owner || dispatcher ? (
          <>
            <SectionEyebrow>Приложение</SectionEyebrow>
            <SectionCard>
              <MenuRow
                icon={RefreshCw}
                tone={TILE.blue}
                title="Синхронизация"
                desc={
                  syncDepth > 0
                    ? "Ожидающие и отклонённые изменения"
                    : "Все изменения переданы на сервер"
                }
                href={"/cabinet/sync" as Href}
                badge={syncDepth}
              />
            </SectionCard>
          </>
        ) : null}

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
