import { Text, View } from "react-native";
import { PAPER } from "@/lib/paper/palette";

// КИРПИЧИ БУМАГИ ЧЕКА: чернила и строка итога.

//
// Палитра — не тема экрана, а «бумажные» чернила (`lib/paper/palette.ts`),
// одни у чека, инвойса и обоих PDF — так документ читается как бумага, а не
// как ещё одна карточка приложения. Радиус и тень при этом берутся из общих токенов
// (`t.radius.card`, `t.cardShadow`), а не числом — то немногое, чем этот
// рендер РАЗУМНО отличается от печатного HTML.

export { PAPER };

export const headCell = {
  fontSize: 8.5,
  fontWeight: "700" as const,
  letterSpacing: 0.5,
  color: PAPER.muted,
  textTransform: "uppercase" as const,
};

export const numCell = {
  fontSize: 10.5,
  color: PAPER.muted,
  textAlign: "right" as const,
};

/** Зона бумаги. Без обработчика — прозрачна: отдаёт детей как есть, не заводя
 *  ни `Pressable`, ни роли кнопки. Выданный чек от этого остаётся ровно той
 *  вёрсткой, что была до составителя. */
export function TotalRow({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  /** Акцент — знак, что строку можно тапнуть; у выданного чека его нет. */
  tint?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 3,
      }}
    >
      <Text style={{ fontSize: 11, color: tint ?? PAPER.muted, fontWeight: tint ? "600" : "400" }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: PAPER.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}


/** Есть ли над «Получено» хоть одна строка — от этого зависит черта.
 *
 *  Живёт ЗДЕСЬ, а не в теле бумаги, намеренно: посчитанный заранее флаг читал
 *  бы `doc.linesTotal` раньше, чем бумага доходит до перечня, и
 *  `receipt-paper-contract.test.ts` справедливо ловил бы это как расхождение
 *  порядка печати с PDF. Черта — не поле документа, и ей нечего делать в
 *  очереди его полей.
 *
 */
export function totalsAbove(doc: {
  linesTotal: string | null;
  discount: unknown | null;
  vat: unknown | null;
}): boolean {
  return !!doc.linesTotal || !!doc.discount || !!doc.vat;
}
