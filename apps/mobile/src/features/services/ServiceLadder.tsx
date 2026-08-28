import { Fragment } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { durationLabel } from "./format";
import type { ServiceTierDraft } from "./economics";

// ЛЕСЕНКА УСЛУГИ — ТАБЛИЦА В ЧЕТЫРЕ КОЛОНКИ.
//
// Владелец 2026-08-27: «первая колонка — количество, и там я записываю 1, 2,
// 3, 4 вниз; вторая колонка — цена за штуку; третья — расход; четвёртая —
// время». То есть КОЛОНКИ РЯДОМ, а не блоки друг под другом: строка читается
// поперёк — «две штуки стоят €90, съедают €12 и занимают 1 ч 40».
//
// Первая редакция этого захода сложила те же данные четырьмя блоками
// (количество отдельно, цена отдельно…). Читалось это неверно: чтобы узнать
// цену двух штук, глаз шёл во второй блок и там отсчитывал вторую строку —
// то есть человек сам сшивал таблицу, которую разложили.
//
// АРИФМЕТИКА ШИРИН (346pt внутри карточки на экране 402):
//   46 + 6 + 100(flex) + 6 + 88 + 6 + 94 = 346
// Количество узкое — там одна-две цифры. Цена тянется: у неё бывают
// четырёхзначные суммы и знак валюты. Время шире расхода: «1 ч 40» длиннее
// любой суммы расхода, а переносить его нельзя.
//
// ЧИСЛА ПОДПИСЫВАЮТ СЕБЯ САМИ, шапка стоит ОДИН раз сверху — не в каждой
// строке. Это прямое требование прежней редакции блока (2026-08-25: подписи
// занимали в два с половиной раза больше места, чем числа под ними), и
// колонки его не отменяют, а исполняют буквально: подпись у колонки одна.

const ROW_H = 52;

const W_QTY = 46;
const W_COST = 88;
const W_TIME = 94;
const GAP = 6;

export interface LadderStep {
  /** `null` — базовая строка (количество 1): её нельзя убрать, она и есть
   *  сама услуга. */
  tier: ServiceTierDraft | null;
  qty: string;
  price: string;
  cost: string;
  duration: string;
}

function Cell({
  value,
  onChange,
  width,
  suffix,
  align = "right",
  accessibilityLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number;
  /** Знак валюты. Стоит СПРАВА ОТ ЧИСЛА, а не слева от ячейки: слева он
   *  прижимался к соседней колонке и читался её частью — строка начиналась
   *  «1 €», хотя единица это количество, а евро уже цена. */
  suffix?: string;
  align?: "right" | "center";
  accessibilityLabel: string;
  placeholder?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ width, flex: width ? undefined : 1, gap: 2 }}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        keyboardType="decimal-pad"
        accessibilityLabel={accessibilityLabel}
        selectionColor={t.accent}
        keyboardAppearance="light"
        style={{
          flex: 1,
          textAlign: align,
          fontSize: 16,
          fontWeight: "600",
          color: t.ink,
          fontVariant: ["tabular-nums"],
          paddingVertical: 8,
        }}
      />
      {suffix ? (
        <Text style={{ fontSize: 14, color: t.sub }}>{suffix}</Text>
      ) : null}
    </View>
  );
}

export function ServiceLadder({
  steps,
  currencySymbol,
  unit,
  openTimeId,
  onOpenTime,
  onQtyChange,
  onPriceChange,
  onCostChange,
  onDurationChange,
  onAdd,
  onRemove,
}: {
  steps: LadderStep[];
  currencySymbol: string;
  unit: string | null;
  /** Какая строка раскрыта барабаном времени. `null` — все закрыты. */
  openTimeId: string | null;
  onOpenTime: (id: string | null) => void;
  onQtyChange: (id: string, v: string) => void;
  onPriceChange: (id: string, v: string) => void;
  onCostChange: (id: string, v: string) => void;
  onDurationChange: (id: string, minutes: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useThemeColors();
  const idOf = (s: LadderStep) => s.tier?.id ?? "base";

  const headCell = (text: string, width?: number) => (
    <Text
      maxFontSizeMultiplier={1.2}
      numberOfLines={1}
      style={{
        width,
        flex: width ? undefined : 1,
        textAlign: "right",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
      }}
    >
      {text}
    </Text>
  );

  return (
    <SectionCard>
      {/* ШАПКА ОДИН РАЗ. Она и есть единственные подписи в блоке. */}
      <View
        className="flex-row items-center"
        style={{
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 6,
          gap: GAP,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            width: W_QTY,
            textAlign: "center",
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {unit ?? "Кол"}
        </Text>
        {headCell("Цена")}
        {headCell("Расход", W_COST)}
        {headCell("Время", W_TIME)}
      </View>

      {steps.map((s) => {
        const id = idOf(s);
        const minutes = Math.max(0, Number(s.duration) || 0);
        const open = openTimeId === id;
        return (
          <Fragment key={id}>
            <View
              className="flex-row items-center"
              style={{
                minHeight: ROW_H,
                paddingHorizontal: 12,
                gap: GAP,
                borderTopWidth: 1,
                borderTopColor: t.separator,
              }}
            >
              {/* КОЛИЧЕСТВО. Первая строка — сама услуга, её единица не
                  правится: «1» это не ступень, а точка отсчёта. */}
              {s.tier ? (
                <Cell
                  value={s.qty}
                  onChange={(v) => onQtyChange(id, v)}
                  width={W_QTY}
                  align="center"
                  accessibilityLabel="Количество"
                />
              ) : (
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{
                    width: W_QTY,
                    textAlign: "center",
                    fontSize: 16,
                    fontWeight: "600",
                    color: t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  1
                </Text>
              )}

              <Cell
                value={s.price}
                onChange={(v) => onPriceChange(id, v)}
                suffix={currencySymbol}
                placeholder="0"
                accessibilityLabel={`Цена за ${s.qty}`}
              />
              <Cell
                value={s.cost}
                onChange={(v) => onCostChange(id, v)}
                width={W_COST}
                suffix={currencySymbol}
                placeholder="0"
                accessibilityLabel={`Расход за ${s.qty}`}
              />

              {/* ВРЕМЯ — НЕ ПОЛЕ ВВОДА, А ДВЕРЬ К БАРАБАНАМ: «1 ч 40» с
                  клавиатуры не набирается, а «100 минут» человек не считает. */}
              <Pressable
                onPress={() => onOpenTime(open ? null : id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Время за ${s.qty}`}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: W_TIME,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{
                    textAlign: "right",
                    fontSize: 16,
                    fontWeight: "600",
                    color: open ? t.accent : t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {durationLabel(minutes)}
                </Text>
              </Pressable>

              {s.tier ? (
                <Pressable
                  onPress={() =>
                    confirmThen(
                      `Убрать количество «${s.qty}»?`,
                      { confirmLabel: "Убрать", destructive: true },
                      () => onRemove(id),
                    )
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Убрать количество ${s.qty}`}
                  style={({ pressed }) => ({
                    paddingLeft: 4,
                    opacity: pressed ? 0.4 : 1,
                  })}
                >
                  <Trash2 color={t.faint} size={15} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>

            {/* ДВА БАРАБАНА — ЧАСЫ И МИНУТЫ — под своей строкой, во всю ширину.
                Половины коммитятся ПОРОЗНЬ и каждая считает от предыдущего
                состояния: колонка знает соседнее значение только по пропу, и
                два коммита в одном батче унесли бы устаревшую половину. */}
            {open ? (
              <View
                style={{
                  alignItems: "center",
                  paddingBottom: 8,
                  backgroundColor: t.canvas,
                }}
              >
                <TimeWheelPair
                  hour={Math.floor(minutes / 60)}
                  minute={minutes % 60}
                  onChangeHour={(next) =>
                    onDurationChange(id, String(next * 60 + (minutes % 60)))
                  }
                  onChangeMinute={(next) =>
                    onDurationChange(
                      id,
                      String(Math.floor(minutes / 60) * 60 + next),
                    )
                  }
                  labelPrefix={`Время за ${s.qty}`}
                />
              </View>
            ) : null}
          </Fragment>
        );
      })}

      {/* Текстом, без «+»: канон — действия создания подписаны словом. */}
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="Добавить количество"
        style={({ pressed }) => ({
          minHeight: ROW_H,
          justifyContent: "center",
          paddingHorizontal: 12,
          borderTopWidth: 1,
          borderTopColor: t.separator,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>
          Добавить количество
        </Text>
      </Pressable>
    </SectionCard>
  );
}
