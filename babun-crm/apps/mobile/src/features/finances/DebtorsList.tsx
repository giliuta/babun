import { useMemo } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";
import { renderDebtSms, useSmsTemplates } from "@/features/settings/sms-templates";
import { humanDay } from "@/features/appointments/helpers";

// «Долги» panel — port of the web DebtorsList
// (apps/web/src/components/finance/DebtorsList.tsx): completed-but-unpaid
// appointments for the active team in the period, client + outstanding sum.
// The outstanding sum comes from the shared getDebtAmount (prepaid +
// payments[]) — the authoritative per-visit balance. payment_status /
// paid_amount now round-trip through the repository (W4), but the
// payments[] ledger stays the source of truth for the owed figure.
//
// Цепочка «должник → напомнить»: у строки есть labeled-кнопка «Напомнить»
// (SMS с суммой; дата визита — только в зашитом фолбэке, кастомный
// debt-шаблон её не подставляет), тап по строке открывает карточку клиента.
export function DebtorsList({
  appointments,
  clients,
  teamId,
  fromDate,
  toDate,
}: {
  appointments: Appointment[];
  clients: Client[];
  teamId: string | null;
  fromDate: string;
  toDate: string;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: smsTemplates = [] } = useSmsTemplates();
  const rows = useMemo(
    () =>
      appointments
        .filter(
          (a) =>
            a.status === "completed" &&
            a.date >= fromDate &&
            a.date <= toDate &&
            (!teamId || a.team_id === teamId),
        )
        .map((a) => {
          const client = a.client_id
            ? clients.find((x) => x.id === a.client_id)
            : undefined;
          return {
            id: a.id,
            clientId: client?.id ?? null,
            phone: client?.phone?.trim() || null,
            name:
              client?.full_name || a.comment?.trim() || "Без имени",
            // [Имя] в шаблоне — только реальное имя клиента (не comment /
            // «Без имени»); пусто, если запись без клиента.
            firstName: (client?.full_name || "").trim().split(/\s+/)[0] ?? "",
            owed: getDebtAmount(a),
            date: a.date,
          };
        })
        .filter((r) => r.owed > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [appointments, clients, teamId, fromDate, toDate],
  );

  // SMS-напоминание: сумма подставляется всегда; дата визита — только в
  // зашитом фолбэке debtReminderSms. Кастомный debt-шаблон поддерживает
  // лишь [Имя]/[Сумма] (см. renderDebtSms) — дата визита в него не идёт.
  // Диспетчер только жмёт «Отправить» в Сообщениях (iOS: «&body=»,
  // Android: «?body=») и при желании дописывает текст.
  const remind = (r: (typeof rows)[number]) => {
    if (!r.phone) return;
    const digits = r.phone.replace(/[^\d+]/g, "");
    const [, mm, dd] = r.date.split("-");
    const body = encodeURIComponent(
      renderDebtSms(smsTemplates, {
        amount: formatEUR(r.owed),
        name: r.firstName,
        visitDate: `${dd}.${mm}`,
      }),
    );
    const sep = Platform.OS === "ios" ? "&" : "?";
    Linking.openURL(`sms:${digits}${sep}body=${body}`);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <Card style={{ marginHorizontal: 12, marginTop: 8 }}>
        {rows.length === 0 ? (
          <Text
            className="px-4 py-6 text-center text-xs"
            style={{ color: t.faint }}
          >
            Нет должников за период
          </Text>
        ) : (
          rows.map((r, i) => (
            <View
              key={r.id}
              className="min-h-11 flex-row items-stretch"
              style={
                i > 0
                  ? { borderTopWidth: 1, borderTopColor: t.separator }
                  : undefined
              }
            >
              <Pressable
                onPress={r.clientId ? () => router.push(`/clients/${r.clientId}`) : undefined}
                disabled={!r.clientId}
                accessible={!!r.clientId}
                accessibilityRole={r.clientId ? "button" : undefined}
                accessibilityLabel={
                  r.clientId
                    ? `${r.name}, долг ${formatEUR(r.owed)}, открыть карточку клиента`
                    : undefined
                }
                className="min-h-11 min-w-0 flex-1 flex-row items-center gap-3 py-2 pl-4 active:opacity-70"
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-[15px] font-medium"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {r.name}
                  </Text>
                  <Text className="text-xs" style={{ color: t.faint }}>
                    {humanDay(r.date)}
                  </Text>
                </View>
                <Text
                  className="text-[15px] font-bold tabular-nums"
                  style={{ color: t.warning }}
                >
                  {formatEUR(r.owed)}
                </Text>
              </Pressable>
              {r.phone ? (
                <Pressable
                  onPress={() => remind(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`Напомнить ${r.name} об оплате по SMS`}
                  className="min-h-11 justify-center rounded-full px-3 active:opacity-60"
                  style={{
                    backgroundColor: "rgba(44,91,224,0.10)",
                    marginHorizontal: 8,
                  }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: t.accent }}
                  >
                    Напомнить
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}
