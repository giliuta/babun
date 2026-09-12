import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Check, PartyPopper, XCircle } from "lucide-react-native";
import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GUTTER } from "@/components/ui/tokens";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { chooseOption } from "@/lib/choose";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, humanDay } from "@/features/appointments/helpers";
import { useQueryClient } from "@tanstack/react-query";
import { randomUuid } from "@babun/shared/sync";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useClients } from "@/features/clients/queries";
import { useRecordPayment } from "@/features/appointments/payment-mutations";
import {
  paymentAccountsQuery,
  type PaymentAccountOption,
} from "@/features/appointments/payment-accounts";
import { useTenantId } from "@/lib/tenant";
import {
  unclosedAppointments,
  unclosedTotal,
} from "@babun/shared/local/selectors/unclosed";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { daysBetweenYmd } from "./accounts-sections";

// «Незакрытые дни» — port of web /dashboard/unclosed: past days whose
// work visits are still «Запланирован». The dispatcher works through the
// list with two quick actions per row: «Выполнена» closes the visit
// successfully, «Не состоялась» records the real reason (chips + free text)
// so the audit trail stays honest. Reachable by direct route; the
// cabinet menu entry is added separately.

const CANCEL_REASON_PRESETS = [
  "Клиент не пришёл",
  "Клиент отменил",
  "Перенесли на другой день",
  "Не смогли дозвониться",
  "Адрес недоступен",
] as const;

export function UnclosedScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const { data: appts = [], isLoading, error } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: calendarSettings } = useCalendarSettings();
  const update = useUpdateAppointment();
  const record = useRecordPayment();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const readBusinessToday = useCallback(
    () =>
      formatYMD(
        calendarSettings?.timezone
          ? getCurrentTimeInZone(calendarSettings.timezone)
          : getCurrentCyprusTime(),
      ),
    [calendarSettings?.timezone],
  );
  const [todayKey, setTodayKey] = useState(() =>
    formatYMD(getCurrentCyprusTime()),
  );
  useFocusEffect(
    useCallback(() => {
      setTodayKey(readBusinessToday());
    }, [readBusinessToday]),
  );

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientNameOf = (a: Appointment): string =>
    (a.client_id && nameById.get(a.client_id)) || a.comment?.trim() || "—";

  // Формула жила копией в трёх экранах — теперь она одна на продукт.
  const unclosed = useMemo(
    () => unclosedAppointments(appts, todayKey),
    [appts, todayKey],
  );
  const totalAtRisk = useMemo(() => unclosedTotal(unclosed), [unclosed]);

  /** Закрыть визит без денег — долг, если он есть, остаётся долгом. */
  const closeVisitOnly = (apt: Appointment, message: string) => {
    update.mutate(
      { id: apt.id, patch: { status: "completed" } },
      {
        onSuccess: () => {
          haptics.success();
          toast(message);
        },
        onError: (e) => notify("Ошибка", (e as Error).message),
      },
    );
  };

  // ДЕНЬГИ ЗДЕСЬ ИДУТ ТЕМ ЖЕ ПУТЁМ, ЧТО В БЛОКЕ ОПЛАТЫ ЗАПИСИ — одной RPC
  // `record_appointment_payment`, которая сама пишет леджер, зеркала, проводку
  // и закрывает визит (`closeVisit`).
  //
  // Было: «Выполнена» патчила статус, а потом ВТОРЫМ запросом патчились
  // `payments`/`paid_amount`/`payment_status` через `buildDebtPaidPatch`. Три
  // беды в одном месте. Первая: СЧЁТ НЕ СПРАШИВАЛСЯ вовсе — спрашивался
  // «способ», а на какой именно счёт легли деньги, решал серверный резолвер;
  // у команды с двумя кассами он угадывал. Вторая: у заявки, по которой уже
  // был платёж, сторож `protect_paid_appointment_finance` такой патч ОТБИВАЕТ
  // («сначала отмените оплату»), и человек получал закрытый визит плюс отказ
  // по деньгам — ровно то половинчатое состояние, которого канон не допускает.
  // Третья: платёж без `request_id` не идемпотентен, повтор по потерянному
  // ответу задваивал бы деньги.
  //
  // Поэтому спрашиваем СНАЧАЛА и одним вопросом: на какой счёт. Строки —
  // сами счета команды, их именами, как плитки блока оплаты. Закрыть лист =
  // прежняя кнопка «Долг — позже»: визит закрывается, долг остаётся.
  const handleComplete = (apt: Appointment) => {
    const debt = getDebtAmount(apt);
    if (debt <= 0) {
      closeVisitOnly(apt, "Закрыто как «Выполнено»");
      return;
    }
    void (async () => {
      let accounts: PaymentAccountOption[] = [];
      try {
        accounts = await qc.fetchQuery(
          paymentAccountsQuery(tenantId, apt.team_id),
        );
      } catch (e) {
        notify("Не удалось загрузить счета", (e as Error).message);
        return;
      }
      if (accounts.length === 0) {
        // Положить деньги некуда — закрываем визит и говорим, куда идти.
        closeVisitOnly(
          apt,
          "Закрыто как «Выполнено». Счёта для приёма денег нет — заведите его в «Счетах»",
        );
        return;
      }
      const index = await chooseOption(
        `Клиент оплатил ${formatEUR(debt)}?`,
        accounts.map((a) => ({ label: a.name })),
        {
          message:
            "Выберите счёт, на который легли деньги. Закройте лист — визит"
            + " закроется, а долг останется.",
        },
      );
      if (index === null) {
        closeVisitOnly(apt, "Закрыто как «Выполнено», долг остался");
        return;
      }
      const account = accounts[index];
      record.mutate(
        {
          appointmentId: apt.id,
          accountId: account.id,
          amount: debt,
          requestId: randomUuid(),
          kind: "settlement",
          closeVisit: true,
        },
        {
          onSuccess: () => {
            haptics.success();
            toast(`Оплата ${formatEUR(debt)} · ${account.name}`);
          },
          onError: (e) => notify("Ошибка", (e as Error).message),
        },
      );
    })();
  };

  const handleConfirmCancel = (apt: Appointment, reason: string) => {
    const final = reason.trim() || "Не указана";
    update.mutate(
      { id: apt.id, patch: { status: "cancelled", cancel_reason: final } },
      {
        onSuccess: () => {
          toast("Визит отменён");
          setCancelTarget(null);
        },
        onError: (e) => notify("Ошибка", (e as Error).message),
      },
    );
  };

  return (
    <Screen edges={["top"]}>
      {/* Счётчик — конвенцией продукта: «Счета · 3», «Операции · 12». */}
      <ScreenHeader
        title={`Не закрыто${unclosed.length > 0 ? ` · ${unclosed.length}` : ""}`}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={unclosed}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 10 }}
          ListHeaderComponent={
            unclosed.length > 0 && totalAtRisk > 0 ? (
              <Card
                style={{
                  marginBottom: 4,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <Text className="text-[13px]" style={{ color: t.sub }}>
                  Не подтверждено:
                </Text>
                <Text
                  className="text-[15px] font-semibold"
                  style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
                >
                  {unclosed.length}{" "}
                  {countWordRu(unclosed.length, "запись", "записи", "записей")} на{" "}
                  {formatEUR(totalAtRisk)}
                </Text>
              </Card>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={<PartyPopper color={t.success} size={32} />}
              title="Всё разобрано!"
              subtitle="Ни одной незакрытой записи. Здесь появляются визиты прошедших дней со статусом «Запланирован»."
            />
          }
          renderItem={({ item }) => (
            <UnclosedCard
              apt={item}
              todayKey={todayKey}
              clientName={clientNameOf(item)}
              busy={update.isPending}
              onComplete={() => handleComplete(item)}
              onCancel={() => setCancelTarget(item)}
              onOpenClient={() => {
                if (!item.client_id) return;
                router.push(`/clients/${item.client_id}`);
              }}
            />
          )}
        />
      )}

      <CancelReasonSheet
        apt={cancelTarget}
        clientName={cancelTarget ? clientNameOf(cancelTarget) : ""}
        busy={update.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          if (cancelTarget) handleConfirmCancel(cancelTarget, reason);
        }}
      />
    </Screen>
  );
}

function UnclosedCard({
  apt,
  todayKey,
  clientName,
  busy,
  onComplete,
  onCancel,
  onOpenClient,
}: {
  apt: Appointment;
  todayKey: string;
  clientName: string;
  busy: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onOpenClient: () => void;
}) {
  const t = useThemeColors();
  // `?? 0` — нечитаемая дата не повод пугать «N дней назад»: бейдж просто
  // не показывается.
  const days = daysBetweenYmd(apt.date, todayKey) ?? 0;
  const amount = apt.total_amount ?? 0;
  return (
    <Card>
      <Pressable
        onPress={onOpenClient}
        disabled={!apt.client_id}
        accessibilityRole="button"
        accessibilityLabel={`${clientName}, открыть карточку клиента`}
        className="px-4 pb-2 pt-3 active:opacity-70"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text
              className="text-[15px] font-semibold"
              style={{ color: t.ink }}
              numberOfLines={1}
            >
              {clientName}
            </Text>
            <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
              {humanDay(apt.date)} · {apt.time_start}
              {days > 0 ? (
                <Text style={{ color: t.warning, fontWeight: "500" }}>
                  {"  ·  "}
                  {days} {countWordRu(days, "день", "дня", "дней")} назад
                </Text>
              ) : null}
            </Text>
          </View>
          {amount > 0 ? (
            <Text
              className="text-[13px] font-semibold"
              style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
            >
              {formatEUR(amount)}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View
        className="flex-row"
        style={{ borderTopWidth: 1, borderTopColor: t.separator }}
      >
        <Pressable
          onPress={onComplete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Запись выполнена"
          className="flex-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
          style={{ height: 44, opacity: busy ? 0.5 : 1 }}
        >
          <Check color={t.accent} size={16} strokeWidth={2.2} />
          <Text className="text-[13px] font-medium" style={{ color: t.accent }}>
            Выполнена
          </Text>
        </Pressable>
        <View className="w-px" style={{ backgroundColor: t.separator }} />
        <Pressable
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Запись не состоялась"
          className="flex-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
          style={{ height: 44, opacity: busy ? 0.5 : 1 }}
        >
          <XCircle color={t.danger} size={16} strokeWidth={2.2} />
          <Text className="text-[13px] font-medium" style={{ color: t.danger }}>
            Не состоялась
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

// Cancel-reason sheet (web v593): chip picker + «Другое…» free-text so
// the dispatcher records the REAL reason, not a hard-coded default.
// Канонический BottomSheet: title пропом (шапка целиком тянет лист),
// кнопки в footer (он один платит нижний безопасный отступ).
function CancelReasonSheet({
  apt,
  clientName,
  busy,
  onClose,
  onConfirm,
}: {
  apt: Appointment | null;
  clientName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useThemeColors();
  const [picked, setPicked] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  // Сброс по визиту: подтверждение (onConfirm) закрывает шит МИМО onClose,
  // и стейл-причина прошлого клиента иначе доехала бы до следующего.
  useEffect(() => {
    setPicked(null);
    setCustomText("");
  }, [apt?.id]);
  const visible = !!apt;
  const isCustom = picked === "__custom__";
  const reasonToSubmit = isCustom ? customText.trim() : picked ?? "";
  const canSubmit = reasonToSubmit.length > 0 && !busy;

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Отменить визит"
      avoidKeyboard
      // ВНИЗУ ЛИСТА РОВНО ОДНА КНОПКА (канон анатомии листа): выход — скрим и
      // свайп, как у всех листов продукта. Здесь стояли две, и обе были
      // нарисованы руками: 44pt, радиус 999 литералом, кегль 15 — третья
      // геометрия «главного действия» в продукте. Заливка красная потому, что
      // действие разрушительное, а не для украшения.
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Отменить визит"
            variant="filled"
            tone="danger"
            disabled={!canSubmit}
            onPress={() => onConfirm(reasonToSubmit)}
          />
        </View>
      }
    >
      <View className="px-5 pb-4">
        {apt ? (
          <Text className="text-center text-[13px]" style={{ color: t.sub }}>
            {clientName} · {humanDay(apt.date)} · {apt.time_start}
          </Text>
        ) : null}

        <Text
          className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.sub }}
        >
          Причина
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {[...CANCEL_REASON_PRESETS, "__custom__"].map((r) => (
            <Chip
              key={r}
              label={r === "__custom__" ? "Другое…" : r}
              radio
              selected={picked === r}
              onPress={() => setPicked(r)}
            />
          ))}
        </View>
        {isCustom ? (
          <TextInput
            value={customText}
            onChangeText={setCustomText}
            autoFocus
            placeholder="Опишите причину"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            accessibilityLabel="Причина отмены"
            className="mt-3 px-3.5 text-[15px]"
            style={{
              height: 44,
              borderRadius: t.radius.input,
              backgroundColor: t.fill,
              color: t.ink,
            }}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
