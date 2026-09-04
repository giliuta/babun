import { Pressable, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ColorDot } from "@/components/ui/picker-fields";
import { durationLabel } from "@/features/services/format";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { AppointmentService } from "@babun/shared/local/appointments";

// ДЕНЬГИ ЗАПИСИ ОДНИМ ЛИСТОМ (владелец 2026-09-04: «когда я открываю „Итого“,
// открывается снизу вверх шторка, где прописаны каждая услуга, количество их,
// и там уже можно редактировать и нажимать „Применить“; там же можно делать
// скидки, выбирать в евро или в процентах»).
//
// До этого «Итого» было полем в строке: сумма правилась прямо в списке, а
// скидки в форме не было вовсе — её ставила только программа лояльности, и
// снять её было нечем. Считать деньги в узкой строке между услугами и
// предоплатой неудобно: не видно, из чего сумма сложилась.
//
// ЛИСТ ОТВЕЧАЕТ НА ОДИН ВОПРОС — «ИЗ ЧЕГО ЭТИ ДЕНЬГИ»: услуги с количеством,
// скидка, и итог, который при желании перебивается рукой. Всё остальное
// (предоплата, способ оплаты) живёт своей секцией на странице: это уже НЕ про
// цену работы, а про полученные деньги.

const SIDE = 20;

export type DiscountKind = "none" | "fixed" | "percent";

export function TotalSheet({
  visible,
  onClose,
  lines,
  nameFor,
  colorFor,
  onQtyChange,
  servicesTotal,
  discountKind,
  discountValue,
  discountAmount,
  discountReason,
  onDiscountKindChange,
  onDiscountValueChange,
  total,
  customTotal,
  totalDraft,
  onTotalChange,
  onResetTotal,
}: {
  visible: boolean;
  onClose: () => void;
  lines: readonly AppointmentService[];
  /** Имя строки — снимок записи, а не сегодняшний прайс. */
  nameFor: (line: AppointmentService) => string;
  colorFor: (line: AppointmentService) => string | null;
  onQtyChange: (serviceId: string, qty: number) => void;
  servicesTotal: number;
  discountKind: DiscountKind;
  /** Сырой текст поля скидки — разбор живёт у формы. */
  discountValue: string;
  discountAmount: number;
  /** «Постоянный», «VIP» — причина от программы лояльности. */
  discountReason: string | null;
  onDiscountKindChange: (kind: DiscountKind) => void;
  onDiscountValueChange: (value: string) => void;
  total: number;
  customTotal: boolean;
  totalDraft: string;
  onTotalChange: (value: string) => void;
  onResetTotal: () => void;
}) {
  const t = useThemeColors();
  const discounted = discountKind !== "none";
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Итого"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={0.8}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: SIDE, paddingBottom: 12, gap: 16 }}>
        {lines.length > 0 ? (
          <View style={{ gap: 8 }}>
            {lines.map((line) => (
              <ServiceLine
                key={line.serviceId}
                line={line}
                name={nameFor(line)}
                color={colorFor(line)}
                onQtyChange={onQtyChange}
              />
            ))}
          </View>
        ) : (
          <EmptyState title="Услуги ещё не выбраны" />
        )}

        {/* СКИДКА — ТРЕМЯ КЛАВИШАМИ, КАК НАЛОГ В ОПЕРАЦИИ: сначала ЧЕМ
            считать, потом сколько. «Без скидки» стоит первой, потому что это
            обычный день работы, а не исключение. */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.2,
              color: t.sub,
              textTransform: "uppercase",
            }}
          >
            Скидка
          </Text>
          <SegmentedControl<DiscountKind>
            options={[
              { value: "none", label: "Без скидки" },
              { value: "fixed", label: "€" },
              { value: "percent", label: "%" },
            ]}
            value={discountKind}
            onChange={(next) => {
              haptics.tap();
              onDiscountKindChange(next);
            }}
          />
          {discounted ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 52,
                paddingHorizontal: 14,
                borderRadius: t.radius.input,
                backgroundColor: t.rowFill,
              }}
            >
              <Text style={{ flex: 1, fontSize: 15, color: t.sub }}>
                {discountKind === "percent" ? "Процент" : "Сумма"}
              </Text>
              <TextInput
                keyboardAppearance="light"
                value={discountValue}
                onChangeText={onDiscountValueChange}
                selectTextOnFocus
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={t.placeholder}
                accessibilityLabel={
                  discountKind === "percent" ? "Процент скидки" : "Сумма скидки"
                }
                style={{
                  minWidth: 64,
                  minHeight: 44,
                  textAlign: "right",
                  fontSize: 17,
                  fontWeight: "700",
                  color: t.ink,
                  fontVariant: ["tabular-nums"],
                }}
              />
              <Text style={{ fontSize: 17, fontWeight: "600", color: t.sub }}>
                {discountKind === "percent" ? "%" : "€"}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ИЗ ЧЕГО СЛОЖИЛАСЬ СУММА — три строки, читаются сверху вниз. */}
        <View style={{ gap: 8 }}>
          <SumRow label="Услуги" value={formatEURExact(servicesTotal)} />
          {discountAmount > 0 ? (
            <SumRow
              label={`Скидка${discountReason ? ` · ${discountReason}` : ""}`}
              value={`−${formatEURExact(discountAmount)}`}
              color={t.success}
            />
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 56,
              paddingHorizontal: 14,
              borderRadius: t.radius.input,
              backgroundColor: t.rowFill,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
              Итого
            </Text>
            {customTotal ? (
              <Pressable
                onPress={() => {
                  haptics.tap();
                  onResetTotal();
                }}
                accessibilityRole="button"
                accessibilityLabel="Вернуть сумму по услугам"
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 6,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  По услугам
                </Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            {/* СУММУ ПЕРЕБИВАЮТ РУКОЙ ЧАЩЕ, ЧЕМ БЕРУТ ИЗ ПРАЙСА (по базе
                2026-08-30 — 20 записей из 30), поэтому поле остаётся полем и
                здесь, рядом с тем, из чего оно сложилось. */}
            <TextInput
              keyboardAppearance="light"
              value={customTotal ? totalDraft : String(Number(total.toFixed(2)))}
              onChangeText={onTotalChange}
              selectTextOnFocus
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={t.placeholder}
              accessibilityLabel="Итоговая сумма записи"
              style={{
                minWidth: 64,
                minHeight: 44,
                textAlign: "right",
                fontSize: 20,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            />
            <Text style={{ fontSize: 17, fontWeight: "600", color: t.sub }}>€</Text>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

function SumRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: t.sub }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: color ?? t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ServiceLine({
  line,
  name,
  color,
  onQtyChange,
}: {
  line: AppointmentService;
  name: string;
  color: string | null;
  onQtyChange: (serviceId: string, qty: number) => void;
}) {
  const t = useThemeColors();
  const unit = line.unit ? ` ${line.unit}` : "";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 56,
        paddingHorizontal: 14,
        borderRadius: t.radius.input,
        backgroundColor: t.rowFill,
      }}
    >
      <ColorDot value={color} size={10} />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {name}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub }}>
          {formatEURExact(line.pricePerUnit)}
          {unit ? ` за${unit}` : ""} · {durationLabel(line.duration)}
        </Text>
      </View>
      <StepButton
        icon="minus"
        label={`Убавить: ${name}`}
        onPress={() => onQtyChange(line.serviceId, line.quantity - 1)}
      />
      <Text
        style={{
          minWidth: 22,
          textAlign: "center",
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {line.quantity}
      </Text>
      <StepButton
        icon="plus"
        label={`Добавить: ${name}`}
        onPress={() => onQtyChange(line.serviceId, line.quantity + 1)}
      />
      <Text
        style={{
          minWidth: 58,
          textAlign: "right",
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatEURExact(line.totalPrice)}
      </Text>
    </View>
  );
}

// Круг 30pt с зоной касания 44pt: в листе, где считают деньги, промах по
// «минусу» стоит дороже, чем лишние пиксели.
//
// ЗНАКИ — ТЕКСТОМ, А НЕ ИКОНКАМИ. Продуктовая политика запрещает `Plus` из
// lucide во всём приложении (`ui-policy-contract`): плюс-иконка означала
// «создать» и уводила от `AddRow`. Здесь это не создание, а арифметика — и
// набирается она теми же знаками, что человек видит на клавиатуре.
function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: "minus" | "plus";
  label: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      hitSlop={7}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.pressed : t.fill,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{ fontSize: 18, fontWeight: "600", color: t.ink, lineHeight: 22 }}
      >
        {icon === "minus" ? "−" : "+"}
      </Text>
    </Pressable>
  );
}
