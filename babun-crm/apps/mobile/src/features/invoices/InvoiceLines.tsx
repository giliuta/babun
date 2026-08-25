import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, Search, Trash2 } from "lucide-react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldLabel } from "@/components/ui/Field";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { durationLabel } from "@/features/services/format";
import type { Service } from "@/features/services/queries";
import { formatInvoiceMoney, parseDecimal, parseMoneyAmount } from "./format";
import type { EditableInvoiceLine } from "./InvoiceLineEditor";

// ПОЗИЦИЯ — КАРТОЧКА, А НЕ АНКЕТА (владелец 2026-08-25, по прокликанному
// мокапу). Раньше каждая строка счёта разворачивалась формой из четырёх полей:
// три позиции — двенадцать полей на экране, и документ читался как заявка на
// кредит. Теперь строка говорит то же самое одной строкой — «Чистка · €50 за
// одну · 3 · €150», — а править её открывают тапом.
//
// ЧТО ГДЕ ПРАВЯТ:
//   • количество — степпером прямо на карточке: это самое частое движение,
//     и лист ради «плюс один» открывать незачем;
//   • всё остальное — в листе позиции: название, цена, единица, что входит,
//     порядок и «Убрать»;
//   • новая позиция приходит ИЗ КАТАЛОГА с поиском, а не пустым полем: пустая
//     строка заставляет вспоминать и название, и цену.
//
// ДЕНЬГИ ЖИВУТ СЫРОЙ СТРОКОЙ, пока поле в фокусе: `EditableInvoiceLine.qty` и
// `unitPrice` — строки, и никто не переписывает их на каждое нажатие. Число из
// них достают на выходе из поля. Именно переписывание значения на каждый
// символ и роняет каретку в конец строки.

export function InvoiceLines({
  lines,
  currency,
  services,
  onChange,
  onAdd,
  onRemove,
  onReorder,
}: {
  lines: EditableInvoiceLine[];
  currency: string;
  /** Каталог услуг команды — из него выбирают новую позицию. */
  services: Service[];
  onChange: (line: EditableInvoiceLine) => void;
  /** `null` — «своя строка»: в счёт попадает не только то, что лежит в
   *  справочнике (доплата, материал, разовая работа). */
  onAdd: (service: Service | null) => void;
  onRemove: (line: EditableInvoiceLine) => void;
  onReorder: (id: string, delta: -1 | 1) => void;
}) {
  const t = useThemeColors();
  const [editing, setEditing] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const openLine = lines.find((line) => line.id === editing) ?? null;
  const openIndex = openLine ? lines.indexOf(openLine) : -1;

  return (
    <>
      <View style={{ gap: 8 }}>
        {lines.map((line) => {
          const qty = parseDecimal(line.qty) ?? 0;
          const price = parseMoneyAmount(line.unitPrice) ?? 0;
          const title = line.title.trim();
          return (
            <SwipeRow
              key={line.id}
              label="Убрать"
              color={t.danger}
              icon={Trash2}
              accessibilityLabel={`Убрать позицию ${title || "без названия"}`}
              onAction={() => onRemove(line)}
            >
              <Pressable
                onPress={() => setEditing(line.id)}
                accessibilityRole="button"
                accessibilityLabel={`${title || "Позиция"} — изменить`}
                className="flex-row items-center gap-3 px-3 py-3 active:opacity-70"
                style={{
                  backgroundColor: t.surface,
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                    style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                  >
                    {title || "Без названия"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                    style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                  >
                    {`${formatInvoiceMoney(price, currency)} за одну${
                      line.unit ? ` · ${line.unit}` : ""
                    }${line.description?.trim() ? ` · ${line.description.trim()}` : ""}`}
                  </Text>
                </View>
                <Stepper
                  qty={qty}
                  unit={line.unit}
                  onDec={() =>
                    qty <= 1
                      ? onRemove(line)
                      : onChange({ ...line, qty: String(qty - 1) })
                  }
                  onInc={() => onChange({ ...line, qty: String(qty + 1) })}
                />
                <Text
                  className="tabular-nums"
                  maxFontSizeMultiplier={1.2}
                  style={{
                    minWidth: 74,
                    textAlign: "right",
                    fontSize: 15,
                    fontWeight: "700",
                    color: t.ink,
                  }}
                >
                  {formatInvoiceMoney(qty * price, currency)}
                </Text>
              </Pressable>
            </SwipeRow>
          );
        })}

        <Pressable
          onPress={() => setCatalogOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Добавить позицию"
          className="items-center py-3 active:opacity-60"
          style={{
            backgroundColor: t.surface,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
          }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
          >
            ＋ Добавить позицию
          </Text>
        </Pressable>
      </View>

      <LineSheet
        line={openLine}
        currency={currency}
        first={openIndex === 0}
        last={openIndex === lines.length - 1}
        onChange={onChange}
        onReorder={onReorder}
        onRemove={(line) => {
          setEditing(null);
          onRemove(line);
        }}
        onClose={() => setEditing(null)}
      />

      <CatalogSheet
        visible={catalogOpen}
        services={services}
        currency={currency}
        onPick={(service) => {
          onAdd(service);
          setCatalogOpen(false);
        }}
        onClose={() => setCatalogOpen(false)}
      />
    </>
  );
}

/** Степпер количества — то же движение, что в записи: минус на единице
 *  убирает позицию, второй кнопки «удалить» рядом не заводим. */
function Stepper({
  qty,
  unit,
  onDec,
  onInc,
}: {
  qty: number;
  unit?: string | null;
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
        backgroundColor: t.fill,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
      }}
      accessibilityLabel={`Количество: ${qty}${unit ? ` ${unit}` : ""}`}
    >
      {btn("down", onDec)}
      <Text
        numberOfLines={1}
        className="tabular-nums"
        maxFontSizeMultiplier={1.2}
        style={{
          minWidth: 22,
          textAlign: "center",
          fontSize: 14,
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

/** Лист позиции. Рисуется на открытие и во время ввода не пересобирается —
 *  значения лежат в строках родителя, поэтому каретка стоит на месте. */
function LineSheet({
  line,
  currency,
  first,
  last,
  onChange,
  onReorder,
  onRemove,
  onClose,
}: {
  line: EditableInvoiceLine | null;
  currency: string;
  first: boolean;
  last: boolean;
  onChange: (line: EditableInvoiceLine) => void;
  onReorder: (id: string, delta: -1 | 1) => void;
  onRemove: (line: EditableInvoiceLine) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  // Лист держится в дереве всегда и закрытым лишь гасится пропом `visible`:
  // иначе анимация ухода обрывалась бы на первом кадре. Содержимое при этом
  // рисуется только когда позиция есть — рисовать поля «ничьей» строки нечем.
  const qty = parseDecimal(line?.qty ?? "") ?? 0;
  const price = parseMoneyAmount(line?.unitPrice ?? "") ?? 0;

  return (
    <BottomSheet
      visible={!!line}
      onClose={onClose}
      title={line?.title.trim() || "Позиция"}
      avoidKeyboard
      scroll
    >
      {line ? (
        <>
          <Field
            label="Название"
            value={line.title}
            onChangeText={(value) => onChange({ ...line, title: value })}
            autoCapitalize="sentences"
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                label={`Цена за одну, ${currency === "EUR" ? "€" : currency}`}
                value={line.unitPrice}
                onChangeText={(value) => onChange({ ...line, unitPrice: value })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={line.unit ? `Количество, ${line.unit}` : "Количество"}
                value={line.qty}
                onChangeText={(value) => onChange({ ...line, qty: value })}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Field
            label="Что входит"
            value={line.description ?? ""}
            onChangeText={(value) => onChange({ ...line, description: value })}
            multiline
          />

          {/* Итог позиции — то же число, что стоит на карточке и уедет в
              бумагу клиента. */}
          <View className="mb-4 flex-row items-baseline justify-between px-1">
            <Text style={{ fontSize: 13, color: t.sub }}>Сумма позиции</Text>
            <Text
              className="tabular-nums"
              style={{ fontSize: 17, fontWeight: "700", color: t.ink }}
            >
              {formatInvoiceMoney(qty * price, currency)}
            </Text>
          </View>

          <FieldLabel text="Порядок в документе" />
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            <Pressable
              onPress={() => onReorder(line.id, -1)}
              disabled={first}
              accessibilityRole="button"
              accessibilityLabel="Поднять позицию выше"
              className="flex-1 items-center justify-center active:opacity-60"
              style={{
                minHeight: 44,
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: t.fill,
                opacity: first ? 0.4 : 1,
              }}
            >
              <ChevronUp color={t.ink} size={ICON.sm} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              onPress={() => onReorder(line.id, 1)}
              disabled={last}
              accessibilityRole="button"
              accessibilityLabel="Опустить позицию ниже"
              className="flex-1 items-center justify-center active:opacity-60"
              style={{
                minHeight: 44,
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: t.fill,
                opacity: last ? 0.4 : 1,
              }}
            >
              <ChevronDown color={t.ink} size={ICON.sm} strokeWidth={2.2} />
            </Pressable>
          </View>

          <Button
            label="Убрать позицию"
            variant="secondary"
            tone="danger"
            onPress={() => onRemove(line)}
          />
        </>
      ) : null}
    </BottomSheet>
  );
}

/** Каталог: позиция заводится ВЫБОРОМ из прайса. Своя строка тоже нужна —
 *  в счёт попадает не только то, что лежит в справочнике. */
function CatalogSheet({
  visible,
  services,
  currency,
  onPick,
  onClose,
}: {
  visible: boolean;
  services: Service[];
  currency: string;
  onPick: (service: Service | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [query, setQuery] = useState("");
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? services.filter((s) => s.name.toLowerCase().includes(q))
      : services;
  }, [query, services]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Услуги"
      avoidKeyboard
      scroll
    >
      <View
        className="mb-3 flex-row items-center gap-2 px-3"
        style={{
          height: 44,
          backgroundColor: t.fill,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
        }}
      >
        <Search color={t.placeholder} size={ICON.sm} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Название услуги"
          placeholderTextColor={t.placeholder}
          accessibilityLabel="Поиск услуги"
          selectionColor={t.accent}
          keyboardAppearance="light"
          style={{ flex: 1, fontSize: 16, color: t.ink }}
        />
      </View>

      {found.length === 0 ? (
        <EmptyState
          title={query.trim() ? "Услуги не найдены" : "Прайс пуст"}
          subtitle={
            query.trim()
              ? "Измените запрос или добавьте свою строку."
              : "Добавьте свою строку — она уйдёт только в этот счёт."
          }
        />
      ) : (
        <View
          className="mb-3 overflow-hidden"
          style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
        >
          {found.map((service, index) => (
            <Pressable
              key={service.id}
              onPress={() => onPick(service)}
              accessibilityRole="button"
              accessibilityLabel={`${service.name}, ${formatInvoiceMoney(
                Number(service.price),
                currency,
              )}`}
              className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
              style={
                index > 0
                  ? { borderTopWidth: 1, borderTopColor: t.separator }
                  : undefined
              }
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {service.name}
                </Text>
                <Text style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
                  {durationLabel(service.duration_minutes)}
                  {service.unit ? ` · ${service.unit}` : ""}
                </Text>
              </View>
              <Text
                className="tabular-nums"
                style={{ fontSize: 15, fontWeight: "700", color: t.ink }}
              >
                {formatInvoiceMoney(Number(service.price), currency)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Button
        label="Своя строка"
        variant="secondary"
        onPress={() => onPick(null)}
      />
    </BottomSheet>
  );
}
