import {
  Pressable,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { AlertTriangle, ChevronRight } from "lucide-react-native";

import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { durationLabel } from "@/lib/service-format";
import { Card } from "@/components/ui/Card";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

// СТЕППЕРА СО СТРЕЛКАМИ НЕТ. Количество услуги набирают ТАПАМИ по строке в
// списке услуг, а сама запись печатает его оттиском «×3» (`QtyBadge`).

// ИТОГ — СТРОКА-ДВЕРЬ В ЛИСТ ДЕНЕГ: «Итого» открывает снизу вверх шторку, где
// прописаны каждая услуга, их количество, правка и скидки.
//
// Поле суммы прямо в строке не годится: сумму правили бы между списком услуг и
// предоплатой, а из чего она сложилась — видно не было бы, и скидку поставить
// было бы нечем. Поле живёт в листе вместе с услугами и скидкой; здесь
// строка того же диалекта, что клиент, объект и время.
export function TotalRow({
  total,
  custom,
  discountAmount,
  onPress,
}: {
  total: number;
  /** Сумму перебили рукой — «Итого» перестало следовать за услугами. */
  custom: boolean;
  discountAmount: number;
  /** Нет — «Итого» только читается: без шеврона и без шторки (STORY-084). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const note =
    discountAmount > 0
      ? `Скидка −${formatEURExact(discountAmount)}`
      : custom
        ? "Сумма вписана рукой"
        : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={`Итого ${formatEURExact(total)}${note ? `, ${note}` : ""}`}
      accessibilityHint={
        onPress ? "Открывает услуги, количество и скидку" : undefined
      }
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          Итого
        </Text>
        {note ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontSize: 17,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatEURExact(total)}
      </Text>
      {onPress ? <ChevronRight color={t.chevron} size={ICON.sm} /> : null}
    </Pressable>
  );
}

export function WhenRow({
  date,
  timeStart,
  timeEnd,
  duration,
  allDay,
  warning,
  onPress,
  until,
  dateLabel,
}: {
  date: string;
  /** СРОК ДОКУМЕНТА ВМЕСТО ВРЕМЕНИ (инвойс). Та же плашка: день · «до 29 сентября» · пилюля
   *  «7 дней». Без `timeStart` — только у документа со сроком. */
  until?: { text: string; pill?: string | null };
  /** Как напечатать день вместо «вт, 22 сентября» — у инвойса числами, как
   *  даты периода в «Финансах». */
  dateLabel?: string;
  /** Время. НЕТ — плашка печатает ОДИН ДЕНЬ: у чека деньги приняты в такой-то
   *  день, а не в 18:43. Плашка при этом та же самая. */
  timeStart?: string;
  /** Конец и длительность есть у ЗАПИСИ — она занимает отрезок. У операции
   *  время одно: деньги случились в момент, а не длились полтора часа. Без
   *  них строка печатает «день · время» (блок времени в
   *  операции — такой же, как в записи). */
  timeEnd?: string;
  duration?: number;
  allDay?: boolean;
  warning?: string | null;
  /** Нет — та же плашка, только для чтения: время записи человеку не
   *  меняется (STORY-084, одна страница записи для всех). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  return (
    <View className="mx-4 mt-2">
      <Card style={{ flexDirection: "row", alignItems: "stretch" }}>
        {/* У ВРЕМЕНИ НЕТ СВОЕГО ЦВЕТА. Цветной
            корешок называет ЧЕЙ выезд; час дня ничей, и полоска рядом с ним
            только притворялась значащей. */}
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: pressed && onPress ? t.pressed : "transparent",
          })}
          accessibilityRole={onPress ? "button" : "text"}
          accessibilityLabel={
            timeStart
              ? `Дата и время: ${humanDay(date)}, ${
                  allDay
                    ? "весь день"
                    : timeEnd
                      ? `с ${timeStart} до ${timeEnd}, ${durationLabel(duration ?? 0)}`
                      : timeStart
                }`
              : until
                ? `Даты: ${humanDay(date)}, ${until.text}${until.pill ? `, ${until.pill}` : ""}`
                : `Дата: ${humanDay(date)}`
          }
          accessibilityHint={
            !onPress
              ? undefined
              : timeStart
                ? "Открывает выбор даты и времени"
                : until
                  ? "Открывает выбор дат"
                  : "Открывает выбор даты"
          }
        >
          {/* ОДНОЙ СТРОКОЙ: ДЕНЬ · ВРЕМЯ · ДЛИТЕЛЬНОСТЬ. Дата надстрочной подписью
              12-м кеглем читалась бы как служебная пометка, хотя это первое,
              что спрашивают о записи. Три величины идут слева направо
              в порядке вопроса «когда»: какой день, во сколько, насколько.
              Время держит вес: его ищут глазами. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {dateLabel ?? humanDay(date)}
            </Text>
            {timeStart || (until && until.text) ? (
              <Text style={{ fontSize: 15, color: t.separator }}>·</Text>
            ) : null}
            {until && !timeStart ? (
              <>
                {until.text ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 16, fontWeight: "700", color: t.ink }}
                  >
                    {until.text}
                  </Text>
                ) : null}
                {until.pill ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: t.radius.pill,
                      backgroundColor: t.fill,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 13, color: t.sub }}
                    >
                      {until.pill}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
            {!timeStart ? null : allDay ? (
              <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
                весь день
              </Text>
            ) : (
              <>
                {/* НАЧАЛО И КОНЕЦ, ПОТОМ ДЛИТЕЛЬНОСТЬ (11:00 – 11:30 и длительность). Одно число отвечало
                    только на «во сколько приезжать»; пара отвечает и на «когда
                    освободимся», а длительность остаётся третьей величиной —
                    её считают услуги. */}
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {timeEnd ? `${timeStart} – ${timeEnd}` : timeStart}
                </Text>
                {/* ДЛИТЕЛЬНОСТЬ — ТИХОЙ ПИЛЮЛЕЙ: третья величина в строке
                    спорила с первыми двумя одинаковым весом, а она СЛЕДСТВИЕ
                    начала и конца. Серая подложка отделяет её от времени лучше
                    точки и делает строку ритмичной, а не сплошной. */}
                {timeEnd ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: t.radius.pill,
                      backgroundColor: t.fill,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 13, color: t.sub }}
                    >
                      {durationLabel(duration ?? 0)}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </Pressable>
      </Card>

      {warning ? (
        <View
          className="mt-2 flex-row items-center gap-2 rounded-[10px] px-3 py-2.5"
          style={{
            backgroundColor: `${t.warning}14`,
            borderWidth: 1,
            borderColor: `${t.warning}33`,
          }}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          <AlertTriangle color={t.warning} size={ICON.sm} />
          <Text
            style={{
              fontSize: 13,
              fontWeight: "500",
              color: t.warning,
              flex: 1,
            }}
          >
            {warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
