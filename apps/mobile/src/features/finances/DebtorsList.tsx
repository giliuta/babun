import { useMemo, type ReactElement } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { renderDebtSms, useSmsTemplates } from "@/features/settings/sms-templates";
import { humanDay } from "@/features/appointments/helpers";
import { PanelHeader } from "./PanelHeader";

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
// debt-шаблон её не подставляет). Тап по строке открывает САМУ ЗАПИСЬ —
// долг по канону владельца закрывается в ней, а не в карточке клиента;
// карточка осталась второй дверью на long-press.
export function DebtorsList({
  appointments,
  clients,
  teamId,
  fromDate,
  toDate,
  todayYmd,
  invoicedAppointmentIds,
  onOpenDocuments,
  refreshControl,
}: {
  appointments: Appointment[];
  clients: Client[];
  teamId: string | null;
  fromDate: string;
  toDate: string;
  /** Сегодня по времени бизнеса — граница «уже прошло». */
  todayYmd: string;
  /** Работы, на которые уже выставлен живой счёт. Их деньги ждут в
   *  «Документах», и здесь их считать нельзя — иначе одна и та же сотня евро
   *  сидит в двух местах сразу. Набор приходит СВЕРХУ, тот же самый, каким
   *  считает плитка: своя копия правила разъехалась бы на первой же правке. */
  invoicedAppointmentIds: ReadonlySet<string>;
  /** Открыть «Документы» — единственная дорога к деньгам, которые ушли отсюда
   *  под счёт. Без неё пустой экран прячет их молча. */
  onOpenDocuments: () => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: smsTemplates = [] } = useSmsTemplates();
  const rows = useMemo(
    () =>
      appointments
        .filter(
          (a) =>
            // ТОТ ЖЕ НАБОР, ЧТО В ПЛИТКЕ «ДОЛГИ»: завершённые визиты без
            // оплаты плюс прошедшие записи, по которым команда не
            // отчиталась, МИНУС те, на которые выставлен счёт. Иначе список
            // под цифрой не сходится с самой цифрой — и владелец перестаёт
            // верить обеим.
            a.status !== "cancelled" &&
            (a.status === "completed" || a.date < todayYmd) &&
            a.date >= fromDate &&
            a.date <= toDate &&
            (!teamId || a.team_id === teamId) &&
            !invoicedAppointmentIds.has(a.id),
        )
        .map((a) => {
          const client = a.client_id
            ? clients.find((x) => x.id === a.client_id)
            : undefined;
          return {
            id: a.id,
            teamId: a.team_id,
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
    [
      appointments,
      clients,
      teamId,
      fromDate,
      toDate,
      todayYmd,
      invoicedAppointmentIds,
    ],
  );

  // Деньги не пропали — они переехали в «Документы». Говорим об этом ТОЛЬКО
  // когда действительно что-то унесли счётом: иначе подсказка про инвойсы
  // висела бы у каждого, кто просто никому ничего не должен.
  const movedToInvoices = useMemo(
    () =>
      invoicedAppointmentIds.size > 0 &&
      appointments.some(
        (a) =>
          invoicedAppointmentIds.has(a.id) &&
          a.date >= fromDate &&
          a.date <= toDate &&
          (!teamId || a.team_id === teamId),
      ),
    [appointments, fromDate, invoicedAppointmentIds, teamId, toDate],
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
    // Без catch тап молчал бы на устройстве, где Сообщений нет (iPad):
    // openURL реджектится, и человек не понимает, нажалась ли кнопка.
    Linking.openURL(`sms:${digits}${sep}body=${body}`).catch(() =>
      Alert.alert(
        "Не удалось открыть Сообщения",
        "На этом устройстве нельзя отправить SMS.",
      ),
    );
  };

  // Долг закрывается В САМОЙ ЗАПИСИ (канон владельца) — тап ведёт туда тем же
  // адресом с «дорогой назад», каким ленту операций водит openAppointment:
  // календарь встаёт на день и команду записи, закрытие возвращает в финансы.
  const openAppointment = (r: (typeof rows)[number]) => {
    router.push(
      (`/(dashboard)?appointmentId=${r.id}&date=${r.date}` +
        (r.teamId ? `&teamId=${r.teamId}` : "") +
        "&from=finances") as Href,
    );
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={refreshControl}
    >
      {/* Эйбрау — тот же, что у ленты операций: панель обязана называть себя,
          иначе список должников читается как продолжение сводки. Тело
          начинается сразу под ним — воздух между именем панели и её строками
          один на все шесть. */}
      <PanelHeader title={`Долги · ${rows.length}`} />
      {rows.length === 0 ? (
        // Пустое состояние — общее на все панели экрана: своя тихая строчка
        // внутри карточки выглядела как «карточка сломалась».
        <EmptyState
          title="Нет должников за период"
          subtitle={
            movedToInvoices
              ? "Работы, на которые выставлен счёт, ждут оплату в «Документах»"
              : undefined
          }
          action={
            movedToInvoices
              ? { label: "Открыть документы", onPress: onOpenDocuments }
              : undefined
          }
        />
      ) : (
        <Card style={{ marginHorizontal: GUTTER }}>
          {rows.map((r, i) => (
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
                onPress={() => openAppointment(r)}
                onLongPress={
                  r.clientId
                    ? () => router.push(`/clients/${r.clientId}`)
                    : undefined
                }
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, долг ${formatEUR(r.owed)}, открыть запись`}
                accessibilityHint={
                  r.clientId
                    ? "Долгое нажатие открывает карточку клиента"
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
                  className="text-[15px] font-bold"
                  style={{ color: t.warning, fontVariant: ["tabular-nums"] }}
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
                    // `1a` — тот же 10-% тинт акцента, что у выбранных чипов:
                    // литерал rgba отвязал бы кнопку от бренда при смене accent.
                    backgroundColor: t.accent + "1a",
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
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
