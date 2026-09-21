import type { ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { InvoiceDocument } from "./document";

// ЗОНЫ БУМАГИ, ВЫНЕСЕННЫЕ ИЗ InvoicePaper.tsx РАДИ 400 СТРОК (AGENTS.md).
//
// Три штуки живут здесь: цвета бумаги (`PAPER` — раньше лежали в
// `InvoicePaper.tsx`, теперь общие для обоих файлов), generic-обёртка
// `PressableZone` (Pressable, если коллбэка нет — просто View: «бумага
// обязана уметь быть просто бумагой») и два блока, которые сами решают, что
// печатать вместо пустоты — приглашение акцентным цветом или настоящее
// значение. Что именно решает эта развилка — чистая функция
// `invoicePaperZones` (`invoice-paper-zones.ts`), эти компоненты только рисуют
// её ответ.

export const PAPER = {
  ink: "#111827",
  body: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e8edf3",
  border: "#e2e8f0",
  fill: "#f6f8fb",
  accent: "#3157a4",
  accentFill: "#eef3ff",
  green: "#16794b",
  red: "#b42318",
};

/** Приглашение — короткое слово акцентным цветом, без иконок и рамок: бумага
 *  не должна превратиться в форму. `style` — только отступ, под то место,
 *  куда приглашение встаёт вместо настоящего значения. */
export function Invite({ label, style }: { label: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontSize: 12, fontWeight: "700", color: PAPER.accent }, style]}>
      {label}
    </Text>
  );
}

/** Зона бумаги. Без `onPress` — обычный View: неинтерактивная бумага (лист
 *  выставленного документа без коллбэков) не должна выглядеть нажимаемой. */
export function PressableZone({
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      style={({ pressed }) => [style, onPress && pressed ? { opacity: 0.6 } : null]}
    >
      {children}
    </Pressable>
  );
}

/** Плашка «подпись сверху, значение снизу» — даты и метрики оплаты. */
export function Boxed({
  label,
  value,
  invite,
  onPress,
}: {
  label: string;
  value: string;
  /** Есть слово — печатаем его вместо `value` (пусто и это можно тронуть). */
  invite?: string | null;
  onPress?: () => void;
}) {
  return (
    <PressableZone
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        flex: 1,
        paddingHorizontal: 11,
        paddingVertical: 9,
        borderWidth: 1,
        borderColor: PAPER.border,
        borderRadius: 10,
      }}
    >
      <Text style={{ fontSize: 9, color: PAPER.muted }}>{label}</Text>
      {invite ? (
        <Invite label={invite} style={{ marginTop: 2 }} />
      ) : (
        <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginTop: 2 }}>
          {value}
        </Text>
      )}
    </PressableZone>
  );
}

/** Карточка стороны документа — сегодня только получатель (продавец рисуется
 *  в шапке своей вёрсткой, у него есть ещё и логотип). */
export function Party({
  title,
  party,
  invite,
  onPress,
}: {
  title: string;
  party: InvoiceDocument["client"];
  invite?: string | null;
  onPress?: () => void;
}) {
  return (
    <PressableZone
      onPress={onPress}
      accessibilityLabel={title}
      style={{
        marginTop: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: PAPER.border,
        borderRadius: 10,
      }}
    >
      <Text style={{ fontSize: 8, fontWeight: "700", letterSpacing: 0.8, color: PAPER.muted }}>
        {title.toUpperCase()}
      </Text>
      {invite ? (
        <Invite label={invite} style={{ marginTop: 5 }} />
      ) : (
        <>
          <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginTop: 5 }}>
            {party.name}
          </Text>
          {party.lines.map((line) => (
            <Text key={line} style={{ fontSize: 11, color: PAPER.body, marginTop: 1 }}>
              {line}
            </Text>
          ))}
        </>
      )}
    </PressableZone>
  );
}

/** Подпись раздела (реквизиты для оплаты, оплата, комментарий) — заголовок
 *  сверху, тело ниже. Не хотспот сама по себе: нажимается то, что внутри. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export const headCell = {
  fontSize: 8,
  fontWeight: "700" as const,
  letterSpacing: 0.4,
  color: PAPER.muted,
  textTransform: "uppercase" as const,
};

export const cell = {
  fontSize: 11,
  color: PAPER.body,
  textAlign: "right" as const,
};
