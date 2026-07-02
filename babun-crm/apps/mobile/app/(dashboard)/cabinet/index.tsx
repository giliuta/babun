import { useMemo, type ComponentType } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Boxes,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  CircleUser,
  Gift,
  Landmark,
  MapPin,
  MessageSquareText,
  Package,
  Receipt,
  RotateCw,
  Tag,
  Tags,
  Scissors,
  Users,
  Wallet,
  Wrench,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { TYPE } from "@/components/ui/tokens";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useSession } from "@/providers/SessionProvider";
import { formatYMD } from "@/features/appointments/helpers";
import { useAppointments } from "@/features/calendar/queries";

type IconType = ComponentType<{ color?: string; size?: number }>;

function MenuRow({
  icon: Icon,
  label,
  href,
  badge,
}: {
  icon: IconType;
  label: string;
  href?: Href;
  /** Счётчик справа (например, незакрытые дни); 0/undefined — скрыт. */
  badge?: number;
}) {
  const router = useRouter();
  const t = useThemeColors();
  const disabled = !href;
  return (
    <Pressable
      onPress={() => href && router.push(href)}
      disabled={disabled}
      className="flex-row items-center px-4 py-3.5"
      style={({ pressed }) => ({
        backgroundColor: pressed && !disabled ? t.pressed : "transparent",
      })}
    >
      <View
        style={{
          height: 32,
          width: 32,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          backgroundColor: t.dark ? "rgba(90,134,255,0.16)" : "rgba(44,91,224,0.10)",
        }}
      >
        <Icon color={t.accent} size={18} />
      </View>
      <Text style={{ marginLeft: 12, flex: 1, fontSize: 16, color: t.ink }}>{label}</Text>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            marginRight: 6,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            backgroundColor: t.warning,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <ChevronRight color={t.chevron} size={18} />
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

export default function CabinetHome() {
  const { session } = useSession();
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
        <GroupLabel>Смена</GroupLabel>
        <SectionCard>
          <MenuRow icon={CalendarCheck2} label="Закрыть день" href="/cabinet/close-day" />
          <Divider inset={56} />
          {/* Веб: /dashboard/unclosed («Не закрыто») живёт рядом с закрытием
              дня. Экран делает соседний агент — роут уже зарезервирован. */}
          <MenuRow
            icon={CalendarX2}
            label="Незакрытые дни"
            href={"/cabinet/unclosed" as Href}
            badge={unclosedCount}
          />
          <Divider inset={56} />
          <MenuRow icon={Package} label="Склад" href="/cabinet/inventory" />
          <Divider inset={56} />
          <MenuRow icon={RotateCw} label="Повторяющиеся ТО" href="/cabinet/recurring" />
        </SectionCard>

        <GroupLabel>Справочники</GroupLabel>
        <SectionCard>
          <MenuRow icon={Scissors} label="Услуги" href="/cabinet/services" />
          <Divider inset={56} />
          <MenuRow icon={Users} label="Команды" href="/cabinet/teams" />
          <Divider inset={56} />
          <MenuRow icon={Wrench} label="Мастера" href="/cabinet/masters" />
          <Divider inset={56} />
          <MenuRow icon={MapPin} label="Города" href="/cabinet/cities" />
        </SectionCard>

        <GroupLabel>Настройки</GroupLabel>
        <SectionCard>
          <MenuRow icon={Wallet} label="Категории" href="/cabinet/categories" />
          <Divider inset={56} />
          <MenuRow icon={Landmark} label="Счета" href="/cabinet/accounts" />
          <Divider inset={56} />
          <MenuRow icon={Receipt} label="Шаблоны" href="/cabinet/templates" />
          <Divider inset={56} />
          <MenuRow icon={Building2} label="Бизнес" href="/cabinet/business" />
          <Divider inset={56} />
          <MenuRow icon={CalendarClock} label="Календарь" href="/cabinet/calendar" />
          <Divider inset={56} />
          {/* Веб: Настройки → Календарь → Метки (личные метки календаря). */}
          <MenuRow icon={Tag} label="Метки" href={"/cabinet/labels" as Href} />
          <Divider inset={56} />
          {/* Веб: группа «Записи» держит SMS-шаблоны рядом с календарём. */}
          <MenuRow
            icon={MessageSquareText}
            label="SMS-шаблоны"
            href={"/cabinet/sms-templates" as Href}
          />
          <Divider inset={56} />
          <MenuRow icon={Gift} label="Лояльность" href="/cabinet/loyalty" />
          <Divider inset={56} />
          <MenuRow icon={Tags} label="Типы событий" href="/cabinet/event-types" />
          <Divider inset={56} />
          <MenuRow icon={Boxes} label="Типы объектов" href="/cabinet/object-types" />
        </SectionCard>

        <GroupLabel>Аккаунт</GroupLabel>
        <SectionCard>
          <MenuRow
            icon={CircleUser}
            label={session?.user.email ?? "Аккаунт"}
            href="/cabinet/account"
          />
        </SectionCard>

        <View className="mx-3 mt-5">
          <Button
            label="Выйти"
            variant="secondary"
            tone="danger"
            // Wipes tenant-scoped MMKV + query cache once signOut succeeds,
            // so the next account on this device never sees this tenant's
            // data (and a failed signOut never destroys it).
            onPress={() => void signOutAndWipe()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
