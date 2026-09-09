import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronRight, Tag, UserRound } from "lucide-react-native";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import {
  debtRemainderCents,
  DEBT_DIRECTION_LABEL,
} from "@babun/shared/local/finance/debt";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ActionRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { iconPreset } from "@/components/ui/icon-set";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import { ClientPicker } from "@/features/appointments/BookingPickers";
import { useClients } from "@/features/clients/queries";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "expo-router";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useIsOnline } from "@babun/shared/sync";
import { useThemeColors } from "@/theme/colors";
import { useFinanceCategories } from "./queries";
import { useDeleteDebt, useInsertDebt, useUpdateDebt } from "./debts-queries";

// ФОРМА ДОЛГА — ТЕ ЖЕ БЛОКИ, ЧТО У ОПЕРАЦИИ (владелец 2026-09-10: «почему,
// когда я нажимаю „Добавить долг“, открывается форма записи? Там должна
// открываться такая менюшка, только, наверно, другие категории»).
//
// Раньше кнопка уводила в создание ЗАПИСИ: отдельной сущности долга не
// существовало, и «Вася должен мне €100» без визита записать было негде.
//
// Чего здесь НЕТ и не должно быть — СЧЁТА и способа оплаты. Долг не деньги:
// в момент его появления со счёта ничего не уходит и ничего не приходит.
// Счёт спросят в момент ПЛАТЕЖА по долгу — это уже обычная операция.

const OFFLINE = "Долг записывается только онлайн: нет сети";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function DebtSheet({
  visible,
  debt,
  teamId,
  teamName,
  initialDirection = "incoming",
  paid = 0,
  onPay,
  onClose,
}: {
  visible: boolean;
  /** Правка заведённого долга. `null` — новый. */
  debt?: Debt | null;
  teamId?: string | null;
  teamName?: string;
  initialDirection?: DebtDirection;
  /** Сколько по этому долгу уже отдали — Σ привязанных операций. */
  paid?: number;
  /** Записать оплату: долг сам по себе не деньги, движением денег становится
   *  обычная операция журнала со связью `debt_id`. */
  onPay?: (payment: {
    debtId: string;
    counterparty: string;
    amount: number;
    clientId: string | null;
    direction: DebtDirection;
  }) => void;
  onClose: () => void;
}) {
  const th = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const isEdit = !!debt;

  const [direction, setDirection] = useState<DebtDirection>(initialDirection);
  const [counterparty, setCounterparty] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [whenOpen, setWhenOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Отложенное до полного ухода листа: см. `destroy`. */
  const afterExit = useRef<(() => void) | null>(null);

  const clients = useClients().data ?? [];
  const categoriesQuery = useFinanceCategories();
  const insert = useInsertDebt();
  const update = useUpdateDebt();
  const remove = useDeleteDebt();

  // Шторка остаётся смонтированной между открытиями: без пересева она
  // показала бы прошлый долг поверх нового (закон формы операции).
  useEffect(() => {
    if (!visible) return;
    setDirection(debt?.direction ?? initialDirection);
    setCounterparty(debt?.counterparty ?? "");
    setClientId(debt?.client_id ?? null);
    setAmount(debt ? String(debt.amount) : "");
    setDate(debt?.occurred_on ?? todayYmd());
    setCategoryId(debt?.category_id ?? null);
    setNote(debt?.note ?? "");
    setBusy(false);
  }, [visible, debt, initialDirection]);

  // Категории долгов НЕ смешиваются с доходными и расходными (владелец
  // 2026-09-10): в списке поставщиков и займов «Бензину» делать нечего.
  const cats = useMemo(
    () =>
      (categoriesQuery.data ?? []).filter((c) => c.type === "debt" && !c.hidden),
    [categoriesQuery.data],
  );
  const category = cats.find((c) => c.id === categoryId);

  // Остаток по СОХРАНЁННОМУ долгу, а не по тому, что сейчас в поле: платят по
  // тому, что записано, и правка суммы в поле до сохранения не меняет долга.
  const remainder = debt ? debtRemainderCents(debt.amount, paid) / 100 : 0;

  const cents = parseMoneyInputToCents(amount);
  const named = counterparty.trim().length > 0;
  const canSave = online && !busy && named && cents != null && cents > 0;

  const reason = !online
    ? { text: OFFLINE, error: true }
    : !named
      ? { text: "Укажите, кто должен", error: false }
      : cents == null || cents <= 0
        ? { text: "Введите сумму долга", error: false }
        : null;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = {
        direction,
        counterparty: counterparty.trim(),
        amount: (cents as number) / 100,
        occurred_on: date,
        client_id: clientId,
        category_id: categoryId,
        note: note.trim() || null,
        team_id: teamId ?? null,
        business_today: todayYmd(),
      };
      if (isEdit && debt) {
        await update.mutateAsync({ id: debt.id, patch: payload });
      } else {
        await insert.mutateAsync(payload);
      }
      haptics.success();
      toast(isEdit ? "Долг сохранён" : "Долг записан");
      onClose();
    } catch (e) {
      notify("Не удалось сохранить", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // УДАЛЕНИЕ ДОЛГА НЕ ТРОГАЕТ ДЕНЬГИ. Платежи по нему остаются на счёте и в
  // прибыли — они случились; связь просто снимается. Об этом и предупреждаем:
  // «удалить долг» человек читает как «стереть всё, что с ним связано».
  //
  // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29): вопрос рисует
  // хост приложения, а лист — отдельное окно `Modal`, и открытый в тот же кадр
  // вопрос получает от iOS «already presenting». Кнопка молчала — проверено на
  // симуляторе 2026-09-10, ровно как это уже было у «Удалить операцию».
  // Сперва уезжаем, спрашиваем по `onExited`.
  const destroy = () => {
    if (!debt) return;
    const target = debt;
    afterExit.current = () => {
      confirmThen(
        "Удалить долг?",
        {
          message:
            "Платежи по нему останутся в журнале и на счёте — они уже случились. Пропадёт только сам долг.",
          confirmLabel: "Удалить",
          destructive: true,
        },
        async () => {
          try {
            await remove.mutateAsync(target.id);
            haptics.success();
            toast("Долг удалён");
          } catch (e) {
            notify("Не удалось удалить", (e as Error).message);
          }
        },
      );
    };
    onClose();
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      title={isEdit ? "Долг" : "Новый долг"}
      subtitle={teamName ?? "Компания"}
      scroll
      avoidKeyboard
      maxHeightRatio={0.86}
      footer={
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {reason ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: reason.error ? th.danger : th.sub,
              }}
            >
              {reason.text}
            </Text>
          ) : null}
          <Button
            label={isEdit ? "Сохранить" : "Записать долг"}
            onPress={save}
            disabled={!canSave}
            loading={busy}
          />
        </View>
      }
    >
      <View style={{ backgroundColor: th.canvas, paddingBottom: 24 }}>
        {/* 1. НАПРАВЛЕНИЕ — ПЕРВЫМ ВОПРОСОМ (владелец 2026-09-10: «там две
            ступени: я должен или мне должны, я могу между ними выбирать»).
            Одна сущность на оба случая: форма и арифметика у них одна,
            разное только направление. */}
        <SegmentedControl
          options={[
            {
              value: "incoming",
              label: DEBT_DIRECTION_LABEL.incoming,
              color: th.warning,
            },
            {
              value: "outgoing",
              label: DEBT_DIRECTION_LABEL.outgoing,
              color: th.danger,
            },
          ]}
          value={direction}
          onChange={(next) => setDirection(next as DebtDirection)}
          style={{ marginHorizontal: GUTTER, marginTop: 12 }}
        />

        {/* 2. КОГДА — та же строка и та же полоса недель, что у записи и у
            операции. Часа у долга нет: он возник в день, и в базе у него
            только дата. */}
        <WhenRow date={date} timeStart="" dateOnly onPress={() => {
          setWhenOpen(true);
          haptics.tap();
        }} />

        {/* 3. КТО · ЗА ЧТО · СКОЛЬКО — одной карточкой, как «категория и
            сумма» у операции (владелец 2026-09-10: «форма слишком большая,
            давит»). */}
        <SectionCard>
          <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5">
            <Text className="text-base" style={{ color: th.ink }}>
              Кто
            </Text>
            <TextInput
              value={counterparty}
              onChangeText={(next) => {
                setCounterparty(next);
                // Имя правят руками — связь с карточкой клиента больше не
                // верна: «Петров» мог стать «Петров-сосед», и это другой
                // человек. Молча оставленный client_id повесил бы чужой долг
                // на карточку клиента.
                setClientId(null);
              }}
              placeholder={direction === "incoming" ? "Клиент или имя" : "Поставщик, магазин"}
              placeholderTextColor={th.placeholder}
              selectionColor={th.accent}
              keyboardAppearance="light"
              maxFontSizeMultiplier={1.2}
              accessibilityLabel="Кто должен"
              // Первый вопрос к долгу — чей он. Клавиатура открывается на нём
              // сразу: у операции так же ведёт себя сумма, ради которой лист и
              // открывают. Здесь ради имени.
              autoFocus={!isEdit}
              maxLength={120}
              className="flex-1 text-base"
              style={{ color: th.ink, textAlign: "right" }}
            />
            {/* Ярлык к справочнику, а не второй способ ввести имя: выбранный
                клиент связывает долг с карточкой, свободное имя — нет. */}
            <Pressable
              onPress={() => {
                setClientOpen(true);
                haptics.tap();
              }}
              accessibilityRole="button"
              accessibilityLabel="Выбрать из клиентов"
              hitSlop={8}
              className="active:opacity-60"
            >
              <UserRound
                color={clientId ? th.accent : th.chevron}
                size={ICON.sm}
                strokeWidth={2.2}
              />
            </Pressable>
          </View>

          <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />

          <Pressable
            onPress={() => setCategoryOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Категория: ${category?.name ?? "не выбрана"}`}
            className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5"
            style={({ pressed }) => ({
              backgroundColor: pressed ? th.pressed : "transparent",
            })}
          >
            <Text className="text-base" style={{ color: th.ink }}>
              Категория
            </Text>
            <View className="ml-auto flex-row items-center gap-1.5">
              <Text
                className="text-base"
                style={{ color: category ? th.ink : th.faint }}
                numberOfLines={1}
              >
                {category?.name ?? "Выбрать"}
              </Text>
              <ChevronRight color={th.chevron} size={17} strokeWidth={2.2} />
            </View>
          </Pressable>

          <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />

          <View className="flex-row items-center px-4 py-2.5">
            <TextInput
              value={amount}
              accessibilityLabel="Сумма долга"
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={th.placeholder}
              selectionColor={th.accent}
              keyboardAppearance="light"
              maxFontSizeMultiplier={1.2}
              className="flex-1 text-3xl font-bold"
              style={{
                // Цвет долга — янтарь, когда должны нам, и красный, когда
                // должны мы: те же два цвета, что у строк в списке.
                color: direction === "incoming" ? th.warning : th.danger,
                fontVariant: ["tabular-nums"],
              }}
            />
            <Text
              maxFontSizeMultiplier={1.2}
              className="text-3xl font-bold"
              style={{ color: th.faint }}
            >
              €
            </Text>
          </View>
        </SectionCard>

        <SectionCard title="Заметка">
          <InlineNoteField
            note={{
              draft: note,
              setDraft: setNote,
              onFocus: () => {},
              onBlur: () => {},
            }}
            placeholder={
              direction === "incoming"
                ? "Напр. обещал занести в пятницу…"
                : "Напр. кондиционеры, оплата через неделю…"
            }
            accessibilityLabel="Заметка к долгу"
            maxLength={500}
          />
        </SectionCard>

        {isEdit && debt ? (
          <SectionCard title="Ещё">
            {/* ГАСИТСЯ ДОЛГ ОБЫЧНОЙ ОПЕРАЦИЕЙ. Своей кнопки «оплачено» у него
                нет нарочно: она поставила бы галочку, не сдвинув ни одного
                евро, — счёт и прибыль остались бы без денег, которые
                действительно пришли или ушли. */}
            {remainder > 0 && onPay ? (
              <ActionRow
                label={`Записать оплату · ${formatEUR(remainder)}`}
                onPress={() =>
                  onPay({
                    debtId: debt.id,
                    counterparty: debt.counterparty,
                    amount: remainder,
                    clientId: debt.client_id,
                    direction: debt.direction,
                  })
                }
              />
            ) : null}
            <ActionRow
              separated={remainder > 0 && !!onPay}
              tone="danger"
              label="Удалить долг"
              dimmed={busy}
              onPress={destroy}
            />
          </SectionCard>
        ) : null}
      </View>

      <WhenSheet
        open={whenOpen}
        onClose={() => setWhenOpen(false)}
        date={date}
        timeStart="12:00"
        timeEnd="12:00"
        allDay={false}
        allowAllDay={false}
        dateOnly
        onCommit={(next) => setDate(next.date)}
      />

      <PickerSheet
        visible={categoryOpen}
        title="Категория долга"
        items={cats.map((c) => ({
          id: c.id,
          label: c.name,
          icon: iconPreset(c.icon) ?? c.icon ?? Tag,
          color: c.color ?? th.accent,
          onPress: () => setCategoryId(c.id),
        }))}
        selectedId={categoryId}
        onSettings={() => router.push("/cabinet/categories")}
        settingsLabel="Категории долгов"
        onClose={() => setCategoryOpen(false)}
      />

      <ClientPicker
        visible={clientOpen}
        onClose={() => setClientOpen(false)}
        clients={clients as Client[]}
        recentIds={[]}
        onPick={(client) => {
          setClientId(client.id);
          setCounterparty(client.full_name || "");
          setClientOpen(false);
        }}
      />
    </BottomSheet>
  );
}
