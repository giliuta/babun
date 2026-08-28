import { Fragment } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { durationLabel } from "./format";
import type { ServiceTierDraft } from "./economics";

// ЧЕТЫРЕ БЛОКА ОДНОЙ ЛЕСЕНКИ: КОЛИЧЕСТВО · ЦЕНА · РАСХОД · ВРЕМЯ.
//
// Владелец 2026-08-27: «первый блок — сетка, это количество; второй блок —
// цена за услугу, отдельный единый блок, могу добавлять ещё варианты; третий
// блок — расход за единицу; четвёртый — время, два барабана, часы и минуты».
//
// ЧТО ЭТО НА САМОМ ДЕЛЕ. Количество, цена, расход и время — не четыре разные
// настройки, а ЧЕТЫРЕ СТОЛБЦА ОДНОЙ ТАБЛИЦЫ: у ступени «от 3 штук» есть своя
// цена, свой расход и своё время. Прежний блок показывал её строками (одно
// количество — одна строка), этот показывает столбцами (один вопрос — один
// блок). Данные те же самые, `ServiceTierDraft` не менялся.
//
// ЧЕСТНОЕ ПРЕДУПРЕЖДЕНИЕ, ЗАПИСАННОЕ ЗДЕСЬ НАРОЧНО. Строчная раскладка —
// пятая редакция, и до неё владелец забраковал четыре, включая «четыре
// залитые плиты» (25 августа: «не полноценный какой-то здоровый блок и под
// каждое всё три блока огромное — нет, одна маленькая аккуратная»). Разница
// в том, что там четыре плиты приходились НА КАЖДОЕ КОЛИЧЕСТВО, а здесь их
// четыре на всю услугу. Но плата за столбцы известна заранее: одна ступень
// занимает четыре строки вместо одной, и три ступени — двенадцать строк
// против трёх.
//
// СТУПЕНИ ЗАВОДЯТСЯ ТОЛЬКО В ПЕРВОМ БЛОКЕ. Три остальных получают строку
// сами: иначе четыре «плюса» позволили бы завести цену для количества,
// которого нет, и таблица разъехалась бы по столбцам.
//
// РАСКЛАДКА СТРОКИ — КАНОН: подпись слева, значение справа (LOCKED
// 2026-08-27). Значения встают в столбец и читаются сверху вниз одним
// движением — ради этого блоки и разделены.

const ROW_H = 52;

export interface LadderStep {
  /** `null` — базовая строка (количество 1): её нельзя ни убрать, ни
   *  переименовать, она и есть сама услуга. */
  tier: ServiceTierDraft | null;
  qtyLabel: string;
  price: string;
  cost: string;
  duration: string;
}

function Row({
  label,
  children,
  onDelete,
}: {
  label: string;
  children: React.ReactNode;
  onDelete?: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ minHeight: ROW_H, paddingHorizontal: 16, gap: 10 }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{ flex: 1, fontSize: 16, color: t.ink }}
      >
        {label}
      </Text>
      {children}
      {onDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Убрать количество ${label}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, paddingLeft: 4 })}
        >
          <Trash2 color={t.faint} size={16} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function NumberCell({
  value,
  onChange,
  placeholder,
  prefix,
  accessibilityLabel,
  width = 96,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  accessibilityLabel: string;
  width?: number;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center" style={{ gap: 2 }}>
      {prefix ? (
        <Text style={{ fontSize: 16, color: t.sub }}>{prefix}</Text>
      ) : null}
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
          minWidth: width,
          textAlign: "right",
          fontSize: 16,
          fontWeight: "600",
          color: t.ink,
          fontVariant: ["tabular-nums"],
          paddingVertical: 8,
        }}
      />
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
  /** Какая строка времени раскрыта барабаном. `null` — все закрыты. */
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

  const head = (text: string) => (
    <Text
      maxFontSizeMultiplier={1.2}
      style={{
        paddingHorizontal: GUTTER + 4,
        paddingTop: 18,
        paddingBottom: 6,
        fontSize: 13,
        fontWeight: "600",
        letterSpacing: 0.2,
        color: t.sub,
      }}
    >
      {text}
    </Text>
  );

  return (
    <View>
      {head("Количество")}
      <SectionCard>
        {steps.map((s) => (
          <Fragment key={idOf(s)}>
            {s.tier ? (
              <Row label="от" onDelete={() => confirmThen(
                `Убрать количество «${s.qtyLabel}»?`,
                { confirmLabel: "Убрать", destructive: true },
                () => onRemove(idOf(s)),
              )}>
                <NumberCell
                  value={s.tier.minQuantity}
                  onChange={(v) => onQtyChange(idOf(s), v)}
                  accessibilityLabel="Количество, от"
                  width={64}
                />
                {unit ? (
                  <Text style={{ fontSize: 15, color: t.sub }}>{unit}</Text>
                ) : null}
              </Row>
            ) : (
              // Базовая строка не правится: количество 1 — это сама услуга.
              <Row label={unit ? `1 ${unit}` : "1"}>
                <Text style={{ fontSize: 15, color: t.faint }}>по умолчанию</Text>
              </Row>
            )}
          </Fragment>
        ))}
        {/* Текстом, без «+»: канон — действия создания подписаны словом. */}
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Добавить количество"
          style={({ pressed }) => ({
            minHeight: ROW_H,
            justifyContent: "center",
            paddingHorizontal: 16,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>
            Добавить количество
          </Text>
        </Pressable>
      </SectionCard>

      {head("Цена")}
      <SectionCard>
        {steps.map((s) => (
          <Row key={idOf(s)} label={s.qtyLabel}>
            <NumberCell
              value={s.price}
              onChange={(v) => onPriceChange(idOf(s), v)}
              placeholder="0"
              prefix={currencySymbol}
              accessibilityLabel={`Цена, ${s.qtyLabel}`}
            />
          </Row>
        ))}
      </SectionCard>

      {head("Расход")}
      <SectionCard>
        {steps.map((s) => (
          <Row key={idOf(s)} label={s.qtyLabel}>
            <NumberCell
              value={s.cost}
              onChange={(v) => onCostChange(idOf(s), v)}
              placeholder="0"
              prefix={currencySymbol}
              accessibilityLabel={`Расход, ${s.qtyLabel}`}
            />
          </Row>
        ))}
      </SectionCard>

      {head("Время")}
      <SectionCard>
        {steps.map((s) => {
          const id = idOf(s);
          const minutes = Math.max(0, Number(s.duration) || 0);
          const open = openTimeId === id;
          return (
            <Fragment key={id}>
              <Row label={s.qtyLabel}>
                <Pressable
                  onPress={() => onOpenTime(open ? null : id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`Время, ${s.qtyLabel}`}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: open ? t.accent : t.ink,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {durationLabel(minutes)}
                  </Text>
                </Pressable>
              </Row>
              {/* ДВА БАРАБАНА, ЧАСЫ И МИНУТЫ — прямо под своей строкой.
                  Половины коммитятся ПОРОЗНЬ и каждая считает от предыдущего
                  состояния: колонка знает соседнее значение только по пропу,
                  и два коммита в одном батче унесли бы устаревшую половину. */}
              {open ? (
                <View style={{ alignItems: "center", paddingBottom: 8 }}>
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
                    labelPrefix={`Время, ${s.qtyLabel}`}
                  />
                </View>
              ) : null}
            </Fragment>
          );
        })}
      </SectionCard>
    </View>
  );
}
