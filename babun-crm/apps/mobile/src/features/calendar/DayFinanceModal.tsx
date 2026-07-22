import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { computeDayFinance } from "@babun/shared/local/finance/day-summary";
import type { DayExtra, DayExtraKind } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { generateId } from "@babun/shared/local/masters";
import { ICON } from "@/components/ui/tokens";
import { parseYMD } from "@/features/appointments/helpers";
import {
  useDayExtras,
  useFinanceServices,
  useSetDayExtras,
} from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// Разбор финансов дня по тапу на футер Доход/Расход (запрос владельца
// 2026-07-13; веб-аналог DayFinanceModal): те же цифры, что в футере и
// месяце — общий computeDayFinance (extras уже внутри earned/spent),
// расхождение невозможно. Центрированная карточка в языке
// CityPickerModal + веб-паритетный редактор ручных операций: сегменты
// Доход/Расход/Ожидается, действия добавления открывают инлайн-форму,
// ✕ у строки удаляет; «Ожидается» — записи дня с долгом, тап открывает
// запись (отметить оплату) через onEditAppointment.
type Segment = "income" | "expense" | "pending";

export function DayFinanceModal({
  dateYmd,
  appointments,
  teamId,
  onClose,
  onEditAppointment,
}: {
  /** День разбора (null = закрыто). */
  dateYmd: string | null;
  /** Записи этого дня, уже отфильтрованные по команде. */
  appointments: Appointment[];
  teamId: string | null;
  onClose: () => void;
  /** Открыть запись из «Ожидается» — чтобы отметить оплату. */
  onEditAppointment?: (a: Appointment) => void;
}) {
  const t = useThemeColors();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const setExtras = useSetDayExtras();

  const [segment, setSegment] = useState<Segment>("income");
  const [addKind, setAddKind] = useState<DayExtraKind | null>(null);

  // Каждое открытие начинается с «Дохода» и закрытой формы.
  useEffect(() => {
    if (dateYmd != null) {
      setSegment("income");
      setAddKind(null);
    }
  }, [dateYmd]);

  const extras = dateYmd ? getDayExtras(extrasMap, teamId, dateYmd) : [];
  const totals = useMemo(
    () => computeDayFinance(appointments, services, extras),
    // extras — производная extrasMap+dateYmd; сами зависимости стабильнее.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, services, extrasMap, teamId, dateYmd],
  );

  const manualIncome = extras.filter((e) => e.kind === "income");
  const manualExpense = extras.filter((e) => e.kind === "expense");

  // «Ожидается» — неоплаченный остаток по не-отменённым записям дня.
  const pendingAppts = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== "cancelled" && getDebtAmount(a) > 0)
        .sort((a, b) => a.time_start.localeCompare(b.time_start)),
    [appointments],
  );

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    (a.client_id ? nameById.get(a.client_id) : null) ||
    a.comment?.trim() ||
    "Без имени";

  // Autosave как на вебе: каждое добавление/удаление сразу пишет весь
  // список дня (оптимистичный кэш внутри useSetDayExtras).
  const commit = (next: DayExtra[]) => {
    if (!teamId || !dateYmd) return;
    setExtras.mutate({ teamId, dateKey: dateYmd, extras: next });
  };

  const dateLabel = dateYmd
    ? (() => {
        const s = parseYMD(dateYmd).toLocaleDateString("ru-RU", {
          weekday: "short",
          day: "numeric",
          month: "long",
        });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";

  const methods: { label: string; v: number }[] = [
    { label: "Наличные", v: totals.byMethod.cash },
    { label: "Карта", v: totals.byMethod.card },
    { label: "Перевод", v: totals.byMethod.transfer },
    { label: "Другое", v: totals.byMethod.other },
  ].filter((m) => m.v > 0);

  const segments: { key: Segment; label: string; color: string }[] = [
    { key: "income", label: "Доход", color: t.success },
    { key: "expense", label: "Расход", color: t.danger },
    { key: "pending", label: "Ожидается", color: t.warning },
  ];

  return (
    <Modal
      visible={dateYmd != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 items-center justify-center p-4"
        style={{ backgroundColor: t.scrim }}
      >
        {/* Скрим закрывает по тапу, но невидим для VoiceOver — озвученный
            выход из модалки только через кнопку «Закрыть» в шапке. */}
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessible={false}
        />
        <View
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 20,
            overflow: "hidden",
            paddingBottom: 12,
            backgroundColor: t.canvas,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            className="px-4 pb-3 pt-4"
            style={{
              backgroundColor: t.surface,
              borderBottomWidth: 1,
              borderBottomColor: t.separator,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>
              Финансы дня
            </Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.sub }}>
              {dateLabel}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть финансы дня"
              className="absolute right-2 top-2 h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: t.pressed }}
            >
              <X color={t.sub} size={ICON.sm} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 460 }}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View
              className="mx-3 mt-3 overflow-hidden rounded-[14px]"
              style={{ backgroundColor: t.surface }}
            >
              <Row label="Запланировано" v={totals.planned} color={t.sub} t={t} />
              <Sep t={t} />
              <Row label="Заработано" v={totals.earned} color={t.success} t={t} />
              <Sep t={t} />
              <Row label="Расход" v={totals.spent} color={t.danger} t={t} />
              <Sep t={t} />
              <Row
                label="Прибыль"
                v={totals.profit}
                color={totals.profit < 0 ? t.danger : t.accent}
                bold
                t={t}
              />
            </View>

            {methods.length > 0 ? (
              <>
                <SectionTitle t={t}>По способам оплаты</SectionTitle>
                <View
                  className="mx-3 overflow-hidden rounded-[14px]"
                  style={{ backgroundColor: t.surface }}
                >
                  {methods.map((m, i) => (
                    <View key={m.label}>
                      {i > 0 ? <Sep t={t} /> : null}
                      <Row label={m.label} v={m.v} color={t.ink} t={t} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* Ручные операции + долги дня (веб-паритет: сегменты
                Доход/Расход/Ожид. в DayFinanceModal веба). */}
            <View
              className="mx-3 mt-3 flex-row rounded-[12px] p-1"
              style={{ backgroundColor: t.fill }}
            >
              {segments.map((s) => {
                const active = segment === s.key;
                return (
                  <Pressable
                    key={s.key}
                    onPress={() => {
                      setSegment(s.key);
                      setAddKind(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Показать: ${s.label}`}
                    accessibilityState={{ selected: active }}
                    className="min-h-11 flex-1 items-center justify-center rounded-[9px]"
                    style={active ? { backgroundColor: t.surface } : undefined}
                  >
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: active ? s.color : t.sub,
                      }}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {segment !== "pending" ? (
              <ExtrasSection
                kind={segment}
                items={segment === "income" ? manualIncome : manualExpense}
                allExtras={extras}
                // Без команды сохранять некуда (ключ карты — teamId:date).
                canEdit={!!teamId}
                adding={addKind === segment}
                onStartAdd={() => setAddKind(segment)}
                onCancelAdd={() => setAddKind(null)}
                onCommit={commit}
                t={t}
              />
            ) : (
              <View
                className="mx-3 mt-2 overflow-hidden rounded-[14px]"
                style={{ backgroundColor: t.surface }}
              >
                {pendingAppts.length === 0 ? (
                  <EmptyHint text="Нет неоплаченных записей" t={t} />
                ) : (
                  pendingAppts.map((a, i) => (
                    <View key={a.id}>
                      {i > 0 ? <Sep t={t} /> : null}
                      <Pressable
                        disabled={!onEditAppointment}
                        onPress={() => {
                          // Закрываем разбор, чтобы форма записи была видна.
                          onClose();
                          onEditAppointment?.(a);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${clientName(a)}, долг ${formatEUR(getDebtAmount(a))} — открыть запись`}
                        accessibilityState={{ disabled: !onEditAppointment }}
                        className="flex-row items-center px-4 py-3"
                        style={({ pressed }) => [
                          { minHeight: 44 },
                          pressed ? { backgroundColor: t.pressed } : undefined,
                        ]}
                      >
                        <Text
                          className="tabular-nums"
                          maxFontSizeMultiplier={1.3}
                          style={{ fontSize: 13, color: t.sub }}
                        >
                          {a.time_start}
                        </Text>
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          className="mx-2 flex-1"
                          style={{ fontSize: 15, color: t.ink }}
                        >
                          {clientName(a)}
                        </Text>
                        <Text
                          className="tabular-nums"
                          maxFontSizeMultiplier={1.3}
                          style={{
                            fontSize: 15,
                            fontWeight: "600",
                            color: t.warning,
                          }}
                        >
                          {formatEUR(getDebtAmount(a))}
                        </Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Список ручных операций одного вида с переходом в инлайн-форму.
function ExtrasSection({
  kind,
  items,
  allExtras,
  canEdit,
  adding,
  onStartAdd,
  onCancelAdd,
  onCommit,
  t,
}: {
  kind: DayExtraKind;
  items: DayExtra[];
  allExtras: DayExtra[];
  canEdit: boolean;
  adding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onCommit: (next: DayExtra[]) => void;
  t: ThemeColors;
}) {
  const isIncome = kind === "income";
  const tone = isIncome ? t.success : t.danger;

  return (
    <>
      <View
        className="mx-3 mt-2 overflow-hidden rounded-[14px]"
        style={{ backgroundColor: t.surface }}
      >
        {items.length === 0 && !adding ? (
          <EmptyHint text="Нет ручных операций" t={t} />
        ) : (
          items.map((e, i) => (
            <View key={e.id}>
              {i > 0 ? <Sep t={t} /> : null}
              <View className="flex-row items-center px-4 py-3">
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  className="flex-1"
                  style={{ fontSize: 15, color: t.ink }}
                >
                  {e.name}
                </Text>
                <Text
                  className="tabular-nums"
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 15, fontWeight: "600", color: tone }}
                >
                  {isIncome ? "" : "−"}
                  {formatEUR(e.amount)}
                </Text>
                {canEdit ? (
                  <Pressable
                    onPress={() =>
                      onCommit(allExtras.filter((x) => x.id !== e.id))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Удалить «${e.name}»`}
                    className="ml-2 h-11 w-11 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.pressed }}
                  >
                    <X color={t.faint} size={ICON.xs} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>

      {canEdit ? (
        adding ? (
          <AddExtraForm
            kind={kind}
            onCancel={onCancelAdd}
            onAdd={(entry) => {
              onCommit([...allExtras, entry]);
              onCancelAdd();
            }}
            t={t}
          />
        ) : (
          <Pressable
            onPress={onStartAdd}
            accessibilityRole="button"
            accessibilityLabel={isIncome ? "Добавить доход" : "Добавить расход"}
            className="mx-3 mt-2 min-h-11 items-center justify-center rounded-[14px]"
            style={({ pressed }) => ({
              backgroundColor: pressed ? t.pressed : t.surface,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: tone }}>
              {isIncome ? "Добавить доход" : "Добавить расход"}
            </Text>
          </Pressable>
        )
      ) : null}
    </>
  );
}

// Инлайн-форма «название + сумма» (веб-минимум без чипов/чека).
function AddExtraForm({
  kind,
  onCancel,
  onAdd,
  t,
}: {
  kind: DayExtraKind;
  onCancel: () => void;
  onAdd: (entry: DayExtra) => void;
  t: ThemeColors;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const isIncome = kind === "income";
  // Запятая как десятичный разделитель — на RU-клавиатуре её печатает
  // сам decimal-pad (тот же парс, что в веб-форме).
  const parsed = parseFloat(amount.replace(",", "."));
  const canSave = name.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;

  const save = () => {
    if (!canSave) return;
    onAdd({
      id: generateId("xtra"), // тот же префикс, что генерирует веб
      name: name.trim(),
      amount: parsed,
      kind,
    });
  };

  const inputStyle = {
    height: 44,
    borderRadius: t.radius.input,
    paddingHorizontal: 12,
    fontSize: 15,
    color: t.ink,
    backgroundColor: t.fill,
  } as const;

  return (
    <View
      className="mx-3 mt-2 rounded-[14px] p-3"
      style={{ backgroundColor: t.surface }}
    >
      <View className="flex-row" style={{ gap: 8 }}>
                  <TextInput
                    keyboardAppearance="light"
                    accessibilityLabel={isIncome ? "Название дохода" : "Название расхода"}
          value={name}
          onChangeText={setName}
          placeholder={isIncome ? "Например, чаевые" : "Например, заправка"}
          placeholderTextColor={t.placeholder}
          autoFocus
          className="flex-1"
          style={inputStyle}
        />
                  <TextInput
                    keyboardAppearance="light"
                    accessibilityLabel="Сумма"
          value={amount}
          onChangeText={setAmount}
          placeholder="0,00"
          placeholderTextColor={t.placeholder}
          keyboardType="decimal-pad"
          className="tabular-nums"
          style={{ ...inputStyle, width: 88, textAlign: "right" }}
        />
      </View>
      <View className="mt-2 flex-row" style={{ gap: 8 }}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Отменить добавление операции"
          className="min-h-11 flex-1 items-center justify-center rounded-[12px]"
        >
          <Text style={{ fontSize: 14, fontWeight: "500", color: t.sub }}>
            Отмена
          </Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Сохранить операцию"
          accessibilityState={{ disabled: !canSave }}
          className="min-h-11 flex-1 items-center justify-center rounded-[12px]"
          style={{
            backgroundColor: canSave
              ? isIncome
                ? t.success
                : t.danger
              : t.disabledFill,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: canSave ? t.onAccent : t.sub,
            }}
          >
            Сохранить
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({ children, t }: { children: string; t: ThemeColors }) {
  return (
    <Text
      className="px-6 pb-1 pt-3"
      style={{
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

function EmptyHint({ text, t }: { text: string; t: ThemeColors }) {
  return (
    <Text
      className="px-4 py-3 text-center"
      style={{ fontSize: 13, color: t.faint }}
    >
      {text}
    </Text>
  );
}

function Row({
  label,
  v,
  color,
  bold,
  t,
}: {
  label: string;
  v: number;
  color: string;
  bold?: boolean;
  t: { ink: string };
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3">
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: bold ? "600" : "400", color: t.ink }}
      >
        {label}
      </Text>
      <Text
        className="tabular-nums"
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: "600", color }}
      >
        {formatEUR(v)}
      </Text>
    </View>
  );
}

function Sep({ t }: { t: { separator: string } }) {
  return (
    <View style={{ height: 1, marginLeft: 16, backgroundColor: t.separator }} />
  );
}
