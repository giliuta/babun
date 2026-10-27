import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { COLOR_SITUATIONS } from "@/features/appointments/record-color";
import {
  BLOCK_FILL,
  blockSolid,
  fillRgba,
} from "@/components/ui/color-contrast";
import type { ThemeColors } from "@/theme/colors";
import { EventRow } from "./EventRow";
import { agendaMoney } from "./agenda-money";

const DEBT_SITUATION = COLOR_SITUATIONS.find((s) => s.id === "unpaid")?.label;

export function AgendaRow({
  apt,
  clientName,
  serviceSummary,
  onPress,
  onLongPress,
  showAmounts,
  offLabel,
  hue,
  situation,
  overdue,
  t,
}: {
  apt: Appointment;
  clientName: string;
  serviceSummary: string;
  onPress: () => void;
  onLongPress?: () => void;
  showAmounts: boolean;
  /** Чужая метка этой работы — стоит рядом со статусом. */
  offLabel: { name: string; color: string } | null;
  /** Цвет записи — тот же, что красит блок в сетке. */
  hue: string;
  /** Чего не хватает записи, словом. Единственный нецветовой канал ситуации:
   *  ΔE заливок «нет объекта» и «нет услуг» при дейтеранопии — 4.1, и лента
   *  служит сетке легендой. */
  situation: string | null;
  /** Работа не закрыта: время прошло, статус остался «запланирована».
   *  В сетке это кант вдвое толще; здесь — слово. */
  overdue: boolean;
  t: ThemeColors;
}) {
  const cancelled = apt.status === "cancelled";
  const money = showAmounts
    ? agendaMoney({
        total: apt.total_amount,
        debt: getDebtAmount(apt),
        cancelled,
        afterVisit: apt.status === "completed" || overdue,
      })
    : null;
  // Долг, сказанный суммой справа, слева не повторяется ни словом «Не
  // оплачена», ни ситуацией «Долг».
  const debtSaid = money?.debtSaid ?? false;
  const statusWord =
    overdue && !debtSaid ? "Не оплачена" : cancelled ? "Отменена" : null;
  const shownSituation = debtSaid && situation === DEBT_SITUATION ? null : situation;
  // ЦВЕТ ЗАПИСИ ЗАЛИВАЕТ ВСЮ СТРОКУ, а не квадратик слева. Рецепт тот же, что у блока в сетке: заливка BLOCK_FILL,
  // выполненная тише. Отменённая — в цвете отмены; без него (`hue` пустой)
  // теряет цвет.
  const rowFill = cancelled && !hue
    ? `${t.ink}14`
    : // Тон — тот же, что у плотного блока сетки (`blockSolid`), а не сырой
      // цвет палитры: у бледных цветов сырой и плотный расходились по тону,
      // и одна запись в «Списке» и «Неделе» была разного цвета. Строка
      // остаётся подсвеченной, а не залитой: в ней абзац текста чернилами.
      fillRgba(
        blockSolid(hue),
        apt.status === "completed" ? 0.102 : BLOCK_FILL,
      );

  if (apt.kind === "event" || apt.kind === "personal") {
    return (
      <EventRow
        apt={apt}
        onPress={onPress}
        onLongPress={onLongPress}
        rowFill={rowFill}
        cancelled={cancelled}
        t={t}
      />
    );
  }

  return (
    <Pressable
      onPress={onPress}
      // 350 — единый delayLongPress контекстного меню (WeekView такой же).
      onLongPress={onLongPress}
      delayLongPress={350}
      className="active:opacity-60"
      accessibilityRole="button"
      // Озвучка называет ВСЁ, что напечатано в строке: статус, «не закрыта» и
      // имя дыры видны глазу и обязаны быть слышны.
      accessibilityLabel={`${clientName || apt.comment || "Без клиента"}, ${apt.time_start}–${apt.time_end}${statusWord ? `, ${statusWord.toLowerCase()}` : ""}${shownSituation ? `, ${shownSituation.toLowerCase()}` : ""}${offLabel ? `, метка ${offLabel.name}` : ""}${money ? `, ${money.amount}${money.note ? `, ${money.note}` : ""}` : ""}`}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 64,
        backgroundColor: rowFill,
      }}
    >
      <View style={{ width: 56 }}>
        <Text
          style={{
            fontVariant: ["tabular-nums"],
            fontSize: 14,
            fontWeight: "600",
            color: t.ink,
          }}
        >
          {apt.time_start}
        </Text>
        <Text
          style={{
            fontVariant: ["tabular-nums"],
            marginTop: 2,
            fontSize: 11,
            color: t.faint,
          }}
        >
          {apt.time_end}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          {clientName || apt.comment || "Без клиента"}
        </Text>
        {serviceSummary ? (
          <Text
            numberOfLines={1}
            style={{ marginTop: 2, fontSize: 12, color: t.sub }}
          >
            {serviceSummary}
          </Text>
        ) : null}
        {/* Строка статуса умеет ужиматься: слов в ней стало больше («не
            закрыта», ситуация, чужая метка), и без сжатия она выталкивала
            сумму справа за кромку карточки. Статус не жмётся — он короткий
            и называет главное. */}
        <View
          style={{
            marginTop: 2,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          {/* СТАТУСА СЛОВОМ НЕТ:
              есть отмена и прошедшая неоплаченная работа — «Не оплачена»
              (визит закрывает только оплата). Толщина канта в сетке отвечает
              на «эта ли висит», слово — на «сколько их». */}
          {statusWord ? (
            <Text
              style={{
                fontSize: 11,
                color: overdue ? t.warning : t.faint,
                textDecorationLine: cancelled ? "line-through" : "none",
              }}
            >
              {statusWord}
            </Text>
          ) : null}
          {/* ЧЕГО НЕ ХВАТАЕТ — СЛОВОМ. Цвет один на три ситуации различает их
              слишком слабо для дальтоника (ΔE заливок «нет объекта» и «нет
              услуг» при дейтеранопии — 4.1), а в списке есть место для слова:
              лента служит сетке легендой. */}
          {shownSituation ? (
            <Text
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 11, color: t.body }}
            >
              {statusWord ? "· " : ""}{shownSituation}
            </Text>
          ) : null}
          {/* МЕТКА, ОТЛИЧНАЯ ОТ МЕТКИ ДНЯ: «весь день Лимассол, а эта работа
              в Пафосе» — в сетке это точка в углу блока, здесь имя. */}
          {offLabel ? (
            <>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: offLabel.color,
                }}
              />
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 11, color: offLabel.color }}
              >
                {offLabel.name}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      {money ? (
        <View style={{ alignItems: "flex-end" }}>
          {/* ОТМЕНЁННАЯ — СУММА ЗАЧЁРКНУТА И БЕЗ «К ОПЛАТЕ»: денег по ней
              никто не ждёт. Долг — янтарём, как в финансах и в записи;
              красный в продукте — только «не вышло». Правило слов —
              `agenda-money.ts`. */}
          <Text
            style={{
              fontVariant: ["tabular-nums"],
              fontSize: 14,
              fontWeight: "600",
              color: cancelled ? t.faint : money.amountWarn ? t.warning : t.ink,
              textDecorationLine: cancelled ? "line-through" : "none",
            }}
          >
            {money.amount}
          </Text>
          {money.note ? (
            <Text
              style={{
                fontVariant: ["tabular-nums"],
                marginTop: 2,
                fontSize: 11,
                color: money.noteWarn ? t.warning : t.sub,
              }}
            >
              {money.note}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
