import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MapPin } from "lucide-react-native";
import type {
  Appointment,
  AppointmentStatus,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useMaster } from "@/features/reference/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";

// Визиты мастера (порт web masters/[id]/schedule/page.tsx — это ВИЗИТЫ, не
// рабочие часы). Записи, где appointment.master_id === id, разложены по бакетам
// Сегодня / Завтра / На этой неделе / Позже / Прошлое. Тап по строке уводит на
// календарь на дату записи (/(dashboard)?date=…, тот же путь, что VisitsBlock
// карточки клиента). Данные — общий кэш useAppointments, ничего не хранится.

interface Bucket {
  key: string;
  title: string;
  items: Appointment[];
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "запланировано",
  in_progress: "в работе",
  completed: "закрыто",
  cancelled: "отменено",
};

export default function MasterVisitsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useThemeColors();
  const router = useRouter();
  const { data: master, isLoading } = useMaster(id);
  const { data: appointments = [] } = useAppointments();
  const { data: clients = [] } = useClients();

  const STATUS_TONE: Record<AppointmentStatus, string> = {
    scheduled: t.accent,
    in_progress: t.warning,
    completed: t.success,
    cancelled: t.danger,
  };

  const buckets = useMemo<Bucket[]>(() => {
    if (!master) return [];
    const mine = appointments.filter((a) => a.master_id === master.id);
    if (mine.length === 0) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeekEnd = new Date(today);
    nextWeekEnd.setDate(today.getDate() + 7);

    const todayKey = formatISODate(today);
    const tomorrowKey = formatISODate(tomorrow);

    const past: Appointment[] = [];
    const todays: Appointment[] = [];
    const tomorrows: Appointment[] = [];
    const thisWeek: Appointment[] = [];
    const later: Appointment[] = [];

    for (const a of mine) {
      const d = parseISODate(a.date);
      if (a.date === todayKey) {
        todays.push(a);
      } else if (a.date === tomorrowKey) {
        tomorrows.push(a);
      } else if (d < today) {
        past.push(a);
      } else if (d <= nextWeekEnd) {
        thisWeek.push(a);
      } else {
        later.push(a);
      }
    }

    const byTimeAsc = (a: Appointment, b: Appointment) =>
      a.date === b.date
        ? a.time_start.localeCompare(b.time_start)
        : a.date.localeCompare(b.date);
    const byTimeDesc = (a: Appointment, b: Appointment) =>
      a.date === b.date
        ? b.time_start.localeCompare(a.time_start)
        : b.date.localeCompare(a.date);

    const out: Bucket[] = [];
    if (todays.length > 0) {
      out.push({ key: "today", title: "Сегодня", items: todays.sort(byTimeAsc) });
    }
    if (tomorrows.length > 0) {
      out.push({
        key: "tomorrow",
        title: "Завтра",
        items: tomorrows.sort(byTimeAsc),
      });
    }
    if (thisWeek.length > 0) {
      out.push({
        key: "week",
        title: "На этой неделе",
        items: thisWeek.sort(byTimeAsc),
      });
    }
    if (later.length > 0) {
      out.push({ key: "later", title: "Позже", items: later.sort(byTimeAsc) });
    }
    if (past.length > 0) {
      out.push({
        key: "past",
        title: "Прошлое",
        items: past.sort(byTimeDesc).slice(0, 30),
      });
    }
    return out;
  }, [master, appointments]);

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Визиты" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (!master) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Визиты" />
        <EmptyState fill title="Мастер не найден" />
      </Screen>
    );
  }

  const clientName = (a: Appointment): string => {
    if (a.client_id) {
      const c = clients.find((x) => x.id === a.client_id);
      if (c) return c.full_name;
    }
    return a.comment || "Без клиента";
  };

  const openInCalendar = (a: Appointment) => {
    // teamId — календарь переключается на команду записи, иначе визит
    // чужой команды открывал бы пустой день активной команды.
    router.push(
      `/?date=${encodeURIComponent(a.date)}${
        a.team_id ? `&teamId=${encodeURIComponent(a.team_id)}` : ""
      }`,
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Визиты" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {buckets.length === 0 ? (
          <View className="mx-3 mt-3">
            <Card>
              <View className="items-center px-4 py-8">
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: t.ink,
                    marginBottom: 4,
                  }}
                >
                  Визитов пока нет
                </Text>
                <Text
                  style={{ fontSize: 12, color: t.faint, textAlign: "center" }}
                >
                  Сюда попадают только записи, назначенные лично на этого
                  мастера.
                </Text>
              </View>
            </Card>
          </View>
        ) : null}

        {buckets.map((b) => (
          <View key={b.key} className="mx-3 mt-4">
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: t.faint,
                marginBottom: 6,
                marginLeft: 4,
              }}
            >
              {b.title}
            </Text>
            <Card>
              {b.items.map((a, i) => {
                const address = a.address?.trim();
                return (
                  <View key={a.id}>
                    {i > 0 ? <Divider inset={68} /> : null}
                    <Pressable
                      onPress={() => openInCalendar(a)}
                      accessibilityRole="button"
                      accessibilityLabel={`${clientName(a)}, ${a.date} ${a.time_start}`}
                      className="flex-row items-start gap-3 px-4 py-3 active:opacity-70"
                      style={{ minHeight: 56 }}
                    >
                      <View
                        className="items-center pt-0.5"
                        style={{ width: 48 }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: t.faint,
                            textTransform: "uppercase",
                          }}
                        >
                          {formatDateShort(a.date)}
                        </Text>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "700",
                            color: t.ink,
                            marginTop: 1,
                          }}
                        >
                          {a.time_start}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text
                          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
                          numberOfLines={1}
                        >
                          {clientName(a)}
                        </Text>
                        {address ? (
                          <View className="mt-0.5 flex-row items-center gap-1">
                            <MapPin
                              color={t.sub}
                              size={11}
                              strokeWidth={2}
                            />
                            <Text
                              style={{ fontSize: 12, color: t.sub, flex: 1 }}
                              numberOfLines={1}
                            >
                              {address}
                            </Text>
                          </View>
                        ) : null}
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            textTransform: "uppercase",
                            letterSpacing: 0.3,
                            color: STATUS_TONE[a.status],
                            marginTop: 2,
                          }}
                        >
                          {STATUS_LABEL[a.status]}
                        </Text>
                      </View>
                      {a.total_amount > 0 ? (
                        <Text
                          style={{
                            fontSize: 13,
                            color: t.sub,
                            paddingTop: 2,
                          }}
                        >
                          {formatEUR(a.total_amount)}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Строим локальную дату из «YYYY-MM-DD» покомпонентно — new Date(iso) парсит ISO
// как UTC-полночь и в минусовых зонах смещает день назад, ломая бакеты.
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const out = new Date(y || 1970, (m || 1) - 1, d || 1);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  const month = dt
    .toLocaleDateString("ru-RU", { month: "short" })
    .replace(".", "");
  return `${d} ${month}`;
}
