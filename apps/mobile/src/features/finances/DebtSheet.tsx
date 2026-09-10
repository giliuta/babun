import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Tag } from "lucide-react-native";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import { DEBT_DIRECTION_LABEL } from "@babun/shared/local/finance/debt";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ActionRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { iconPreset } from "@/components/ui/icon-set";
import { GUTTER } from "@/components/ui/tokens";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import { ClientPicker } from "@/features/appointments/BookingPickers";
import { CategoryBlock } from "./CategoryBlock";
import { DebtWhoBlock } from "./DebtWhoBlock";
import { useRouter } from "expo-router";
import { formatHM } from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useDebtDraft } from "./use-debt-draft";

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

export function DebtSheet({
  visible,
  debt,
  teamId,
  teamName,
  initialDirection = "incoming",
  paid = 0,
  onPay,
  onClose,
  onReopen,
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
  /** Открыть лист заново после похода за новым клиентом: карточка клиента —
   *  отдельный маршрут, а под открытым окном `Modal` его не видно, поэтому
   *  лист на это время уезжает и возвращается с готовым клиентом. */
  onReopen?: () => void;
}) {
  const th = useThemeColors();
  const router = useRouter();
  const {
    isEdit,
    direction,
    setDirection,
    counterparty,
    setCounterparty,
    setClientId,
    client,
    amount,
    setAmount,
    date,
    setDate,
    time,
    setTime,
    categoryId,
    setCategoryId,
    category,
    cats,
    note,
    setNote,
    busy,
    clients,
    statsById,
    recentIds,
    remainder,
    canSave,
    reason,
    save,
    destroy,
    leaveForClient,
    runAfterExit,
  } = useDebtDraft({
    visible,
    debt,
    initialDirection,
    teamId,
    paid,
    onClose,
    onReopen,
  });

  const [whenOpen, setWhenOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      onExited={runAfterExit}
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
      <View style={{ backgroundColor: th.canvas, paddingBottom: 16 }}>
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

        {/* 2. КОГДА — ТОТ ЖЕ БЛОК, ЧТО В ДОХОДЕ (владелец 2026-09-10: «время
            должно быть такое же, как в доходе»). Строка печатала только день,
            потому что у долга не было часа в базе; час завела миграция
            20260910020000, и блок стал тем же — «день · час», полоса недель и
            одни барабаны. */}
        <WhenRow
          date={date}
          timeStart={time ?? formatHM(new Date())}
          onPress={() => {
            // Час подставляем в момент открытия, а не в рендере: иначе барабан
            // родился бы со значением первого кадра и застыл на нём.
            if (time == null) setTime(formatHM(new Date()));
            setWhenOpen(true);
            haptics.tap();
          }}
        />

        {/* 3. КЛИЕНТ — СВОЙ БЛОК, ТОТ ЖЕ, ЧТО В ЗАПИСИ (владелец 2026-09-10:
            «блок с выбором клиента сделай такой же, как в записи»). Он стоял
            склеенным с категорией и суммой в одной карточке — ради компактности,
            — и от блока записи остался только внутренний вид строки. Блок это
            не строка: у него своя шапка и свои границы, и человек узнаёт его
            по ним раньше, чем читает.

            ЗАКОН: «блок клиента», «блок объекта», «блок услуги», «блок оплаты»
            означают ИМЕННО блоки записи, а не что-то похожее на них. */}
        <SectionCard title="Клиент">
          <DebtWhoBlock
            client={client}
            stats={client ? statsById.get(client.id) : undefined}
            counterparty={counterparty}
            onOpenPicker={() => {
              setClientOpen(true);
              haptics.tap();
            }}
          />
        </SectionCard>

        {/* 4. КАТЕГОРИЯ — СВОЙ БЛОК, ТОТ ЖЕ ВЕЗДЕ (владелец 2026-09-10:
            «категории сверху, как написано „клиент“; ниже — выбор самой
            категории»). Строка «Категория … Выбрать» с серым значением справа
            была полем формы, а не блоком выбора: предмет прятался в хвосте
            строки, хотя это второй вопрос долга после того, чей он. */}
        <CategoryBlock
          category={category}
          onPress={() => {
            setCategoryOpen(true);
            haptics.tap();
          }}
        />

        {/* 5. СКОЛЬКО — своим блоком: сумма это ответ, ради которого лист и
            открывают. */}
        <SectionCard>
          <View className="flex-row items-center px-4 py-1.5">
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

        {/* ЗАМЕТКА НАЗЫВАЕТ СЕБЯ, А НЕ ОБЪЯСНЯЕТ (владелец 2026-09-10: «в
            заметках напиши „заметка долга“; как объяснение не надо — это
            „например, обещал…“»). Тот же закон, что у заметки клиента и
            заметки объекта в записи, и та же причина, что была 2026-07-27:
            инструкция в поле читается как уже введённый текст и объясняет то,
            что и так понятно из имени поля.

            ШАПКА ОСТАЁТСЯ. Я снёс её заодно, решив, что «ЗАМЕТКА» сверху и
            «Заметка долга» в поле — одно слово дважды; владелец в ту же минуту
            поправил: «я тебе не говорил убирать сверху „заметка“, главное вот
            это вот остаётся». Шапка называет БЛОК, подсказка — поле. */}
        <SectionCard title="Заметка">
          <InlineNoteField
            note={{
              draft: note,
              setDraft: setNote,
              onFocus: () => {},
              onBlur: () => {},
            }}
            placeholder="Заметка долга"
            accessibilityLabel="Заметка долга"
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
        timeStart={time ?? formatHM(new Date())}
        timeEnd={time ?? formatHM(new Date())}
        allDay={false}
        allowAllDay={false}
        singleTime
        onCommit={(next) => {
          setDate(next.date);
          setTime(next.timeStart);
        }}
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

      {/* ТОТ ЖЕ ВЫБОР КЛИЕНТА, ЧТО В ЗАПИСИ — со вводной о каждом и недавними
          первыми. «Создать клиента» внутри него уходит на карточку нового
          клиента отдельным маршрутом, а маршрут под открытым окном `Modal` не
          виден: поэтому лист долга на это время уезжает и возвращается сам,
          когда клиент заведён (см. `wentForClient`). Набранное переживает
          поход — `keepDraft` запрещает пересев. */}
      <ClientPicker
        visible={clientOpen}
        onClose={() => setClientOpen(false)}
        onCreate={(prefill) => {
          // Уходим МЫ, а не лист выбора: под открытым окном шторки долга
          // маршрут карточки не виден. Сперва уезжаем сами, потом пуш.
          setClientOpen(false);
          leaveForClient(prefill);
        }}
        clients={clients as Client[]}
        recentIds={recentIds}
        statsById={statsById}
        onPick={(picked) => {
          setClientId(picked.id);
          setCounterparty(picked.full_name || "");
          setClientOpen(false);
        }}
      />
    </BottomSheet>
  );
}
