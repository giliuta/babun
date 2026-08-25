import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";

import { FieldLabel } from "@/components/ui/Field";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { durationLabel } from "./format";

// ЧАСТИ ЛИСТА УСЛУГИ, КОТОРЫЕ ПОЯВИЛИСЬ ВМЕСТЕ С ТИПАМИ (спека владельца v4).
//
// Здесь живёт то, что не относится к строке количества (она в `ServiceBlocks`):
// переключатель типа, список вариантов, правило «свыше», живой калькулятор и
// сворачиваемые секции.
//
// ПРОГРЕССИВНОЕ РАСКРЫТИЕ — не украшение, а условие того, что лист остаётся
// листом. Буферы, ограничения и себестоимость нужны выездному сервису и не
// нужны салону с тремя услугами; развёрнутые всегда, они превращают форму в
// анкету из пятнадцати полей. Свёрнутая секция при этом ОБЯЗАНА показывать,
// что внутри не пусто, — иначе спрятанное значение однажды выстрелит.

export function ServiceTypeToggle({
  value,
  onChange,
  locked,
}: {
  value: "quantity" | "variant";
  onChange: (next: "quantity" | "variant") => void;
  /** У сохранённой услуги смена типа обнуляет пороги или варианты — спрашиваем. */
  locked?: boolean;
}) {
  const t = useThemeColors();
  const pick = (next: "quantity" | "variant") => {
    if (next === value) return;
    if (!locked) {
      onChange(next);
      return;
    }
    confirmThen(
      "Сменить тип услуги?",
      {
        message: next === "variant"
          ? "Пороги количества будут удалены — у вариантов нет математики."
          : "Варианты будут удалены — у количества своя лестница цен.",
        confirmLabel: "Сменить",
        destructive: true,
      },
      () => onChange(next),
    );
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(
          [
            ["quantity", "Количество"],
            ["variant", "Варианты"],
          ] as const
        ).map(([code, label]) => {
          const active = value === code;
          return (
            <Pressable
              key={code}
              onPress={() => pick(code)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: active ? t.accent : t.fill,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 15,
                  fontWeight: active ? "700" : "500",
                  color: active ? t.onAccent : t.ink,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Пояснение меняется вместе с выбором: тест на тип — имеет ли смысл
          вопрос «сколько стоит одна штука». */}
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
        {value === "quantity"
          ? "Одна работа, повторённая N раз"
          : "Разные объёмы работ, между ними нет пересчёта"}
      </Text>
    </View>
  );
}

export interface VariantDraft {
  id: string;
  name: string;
  price: string;
  duration: string;
}

/** Вариант — строка списка: имя, цена, длительность. Считать нечего, поэтому
 *  ни режимов, ни единиц, ни правила «свыше» здесь нет. */
export function VariantRows({
  variants,
  currencySymbol,
  onChange,
  onAdd,
}: {
  variants: VariantDraft[];
  currencySymbol: string;
  onChange: (next: VariantDraft[]) => void;
  onAdd: () => void;
}) {
  const t = useThemeColors();

  const patch = (id: string, next: Partial<VariantDraft>) =>
    onChange(variants.map((v) => (v.id === id ? { ...v, ...next } : v)));

  const move = (id: string, delta: -1 | 1) => {
    const from = variants.findIndex((v) => v.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= variants.length) return;
    const next = [...variants];
    [next[from], next[to]] = [next[to], next[from]];
    haptics.tap();
    onChange(next);
  };

  const remove = (variant: VariantDraft) => {
    if (variants.length <= 1) {
      notify(
        "Нужен хотя бы один вариант",
        "Услуга с вариантами без единого варианта не продаётся.",
      );
      return;
    }
    onChange(variants.filter((v) => v.id !== variant.id));
  };

  return (
    <View style={{ gap: 8 }}>
      {variants.map((variant, index) => (
        <SwipeRow
          key={variant.id}
          label="Убрать"
          color={t.danger}
          icon={Trash2}
          accessibilityLabel={`Убрать вариант ${variant.name || "без названия"}`}
          onAction={() => remove(variant)}
        >
          <View
            style={{
              backgroundColor: t.surface,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              padding: 12,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* Порядок вариантов — это порядок разговора с клиентом:
                  однокомнатная, двухкомнатная, трёхкомнатная. Перетаскивание
                  внутри листа-модалки не работает, поэтому стрелки. */}
              <Pressable
                onPress={() => move(variant.id, -1)}
                disabled={index === 0}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Поднять вариант выше"
                style={{ opacity: index === 0 ? 0.3 : 1 }}
              >
                <ChevronUp color={t.sub} size={ICON.sm} strokeWidth={2.2} />
              </Pressable>
              <Pressable
                onPress={() => move(variant.id, 1)}
                disabled={index === variants.length - 1}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Опустить вариант ниже"
                style={{ opacity: index === variants.length - 1 ? 0.3 : 1 }}
              >
                <ChevronDown color={t.sub} size={ICON.sm} strokeWidth={2.2} />
              </Pressable>
              <TextInput
                value={variant.name}
                onChangeText={(v) => patch(variant.id, { name: v })}
                placeholder="Название варианта"
                placeholderTextColor={t.placeholder}
                accessibilityLabel="Название варианта"
                selectionColor={t.accent}
                keyboardAppearance="light"
                maxFontSizeMultiplier={1.2}
                style={{
                  flex: 1,
                  padding: 0,
                  fontSize: 16,
                  fontWeight: "600",
                  color: t.ink,
                }}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Money
                symbol={currencySymbol}
                value={variant.price}
                onChangeText={(v) => patch(variant.id, { price: v })}
                label="Цена варианта"
              />
              <Minutes
                value={variant.duration}
                onChangeText={(v) => patch(variant.id, { duration: v })}
              />
            </View>
          </View>
        </SwipeRow>
      ))}
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="Добавить вариант"
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          paddingVertical: 6,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
        >
          ＋ Добавить вариант
        </Text>
      </Pressable>
    </View>
  );
}

function Money({
  symbol,
  value,
  onChangeText,
  label,
}: {
  symbol: string;
  value: string;
  onChangeText: (v: string) => void;
  label: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        minHeight: 40,
        backgroundColor: t.fill,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: "500", color: t.sub }}>
        {symbol}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        placeholder="—"
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        selectionColor={t.accent}
        keyboardAppearance="light"
        maxFontSizeMultiplier={1.2}
        className="tabular-nums"
        style={{ flex: 1, padding: 0, fontSize: 16, fontWeight: "600", color: t.ink }}
      />
    </View>
  );
}

/** Минуты чипами: они покрывают почти всё, а «···» уводит в ручной ввод.
 *  Барабан здесь не ставим — в списке из пяти вариантов он съел бы экран. */
function Minutes({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  const t = useThemeColors();
  const [manual, setManual] = useState(false);
  const minutes = Number(value.trim()) || 0;
  const presets = [30, 45, 60, 90, 120];

  if (manual) {
    return (
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 10,
          minHeight: 40,
          backgroundColor: t.fill,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          selectTextOnFocus
          autoFocus
          onBlur={() => setManual(false)}
          accessibilityLabel="Длительность в минутах"
          selectionColor={t.accent}
          keyboardAppearance="light"
          maxFontSizeMultiplier={1.2}
          className="tabular-nums"
          style={{ flex: 1, padding: 0, fontSize: 16, fontWeight: "600", color: t.ink }}
        />
        <Text style={{ fontSize: 15, color: t.sub }}>мин</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        const next = presets.find((p) => p > minutes) ?? presets[0];
        haptics.tap();
        onChangeText(String(next));
      }}
      onLongPress={() => setManual(true)}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={`Длительность: ${durationLabel(minutes)}. Долгое нажатие — ввести своё`}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 40,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.fill,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        className="tabular-nums"
        style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
      >
        {minutes > 0 ? durationLabel(minutes) : "—"}
      </Text>
    </Pressable>
  );
}

/** Секция, свёрнутая по умолчанию. Индикатор говорит, что внутри не дефолт. */
export function CollapsibleSection({
  title,
  summary,
  marked,
  children,
}: {
  title: string;
  /** Что внутри, одной строкой — видно, не разворачивая. */
  summary: string;
  /** Внутри не-дефолтные значения: свёрнутое не должно прятать настроенное. */
  marked?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: open ? 10 : 0 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}: ${summary}`}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, color: marked ? t.accent : t.sub, marginTop: 1 }}
          >
            {summary}
          </Text>
        </View>
        {open ? (
          <ChevronUp color={t.chevron} size={ICON.sm} strokeWidth={2.2} />
        ) : (
          <ChevronDown color={t.chevron} size={ICON.sm} strokeWidth={2.2} />
        )}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/**
 * ЖИВОЙ КАЛЬКУЛЯТОР. Владелец видит, что получится, ДО сохранения, а не
 * узнаёт от бригады на объекте. Показывает и работу, и слот с буферами —
 * именно слот уходит в календарь и именно он решает, сколько визитов влезет
 * в день.
 */
export function PriceCalculator({
  qty,
  unit,
  onQtyChange,
  price,
  work,
  slot,
  savings,
  currencySymbol,
}: {
  qty: number;
  unit: string | null;
  onQtyChange: (next: number) => void;
  price: string;
  work: number;
  slot: number;
  savings: string | null;
  currencySymbol: string;
}) {
  const t = useThemeColors();
  const step = (delta: number) => {
    const next = Math.max(1, qty + delta);
    haptics.tap();
    onQtyChange(next);
  };
  return (
    <View
      style={{
        backgroundColor: t.fill,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Stepper qty={qty} unit={unit} onDec={() => step(-1)} onInc={() => step(1)} />
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text
            maxFontSizeMultiplier={1.2}
            className="tabular-nums"
            style={{ fontSize: 20, fontWeight: "700", color: t.ink }}
          >
            {`${currencySymbol}${price}`}
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
          >
            {`работа ${durationLabel(work)} · слот ${durationLabel(slot)}`}
          </Text>
        </View>
      </View>
      {savings ? (
        // Экономия — внутренняя информация для бригады: показываем всегда,
        // клиент этот экран не видит.
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 13, fontWeight: "600", color: t.success }}
        >
          {`выгода ${currencySymbol}${savings}`}
        </Text>
      ) : null}
    </View>
  );
}

function Stepper({
  qty,
  unit,
  onDec,
  onInc,
}: {
  qty: number;
  unit: string | null;
  onDec: () => void;
  onInc: () => void;
}) {
  const t = useThemeColors();
  const btn = (dir: "down" | "up", onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={dir === "up" ? "Больше" : "Меньше"}
      className="h-11 w-10 items-center justify-center active:opacity-60"
    >
      {dir === "up" ? (
        <ChevronUp color={t.accent} size={16} strokeWidth={2.4} />
      ) : (
        <ChevronDown color={t.accent} size={16} strokeWidth={2.4} />
      )}
    </Pressable>
  );
  return (
    <View
      className="flex-row items-center"
      style={{
        backgroundColor: t.surface,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
      }}
    >
      {btn("down", onDec)}
      <Text
        maxFontSizeMultiplier={1.2}
        className="tabular-nums"
        style={{
          minWidth: 34,
          textAlign: "center",
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
        }}
      >
        {unit ? `${qty} ${unit}` : qty}
      </Text>
      {btn("up", onInc)}
    </View>
  );
}

/** Правило за последним порогом — словами, а не «и далее». */
export function OverflowRule({
  fromQty,
  unit,
  price,
  duration,
  currencySymbol,
  onPriceChange,
  onDurationChange,
}: {
  fromQty: number;
  unit: string | null;
  price: string;
  duration: string;
  currencySymbol: string;
  onPriceChange: (v: string) => void;
  onDurationChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <FieldLabel
        text={`Свыше ${fromQty}${unit ? ` ${unit}` : ""} — за каждую следующую`}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Money
          symbol={`+${currencySymbol}`}
          value={price}
          onChangeText={onPriceChange}
          label="Цена за каждую следующую"
        />
        <Minutes value={duration} onChangeText={onDurationChange} />
      </View>
    </View>
  );
}

/** Числовое поле для свёрнутых секций: минуты, люди, пределы количества.
 *  Своей рамки не имеет — оно живёт внутри уже названной секции. */
export function NumberField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: 12, fontWeight: "500", color: t.sub }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        selectTextOnFocus
        placeholder={placeholder ?? "0"}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        selectionColor={t.accent}
        keyboardAppearance="light"
        maxFontSizeMultiplier={1.2}
        className="tabular-nums"
        style={{
          minHeight: 40,
          paddingHorizontal: 10,
          backgroundColor: t.fill,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
          fontSize: 16,
          fontWeight: "600",
          color: t.ink,
        }}
      />
    </View>
  );
}
