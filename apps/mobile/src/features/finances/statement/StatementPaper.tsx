import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { headCell, numCell, PAPER, TotalRow } from "@/features/documents/ReceiptPaperParts";
import type { StatementDocument } from "./statement-document";

// ЗЕРКАЛО ВЫПИСКИ — ТА ЖЕ БУМАГА, ЧТО УЙДЁТ В PDF (`statement-pdf.ts`).
// Чернила и кирпичи — общие с чеком (`ReceiptPaperParts.tsx`): одна бумага на
// продукт. Порядок и состав строк ОБЯЗАНЫ совпадать с PDF; следит
// `statement-paper-contract.test.ts` рядом.

const SUM_W = 72;
const BALANCE_W = 72;

export function StatementPaper({ doc }: { doc: StatementDocument }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: PAPER.border,
        boxShadow: t.cardShadow,
        paddingHorizontal: 26,
        paddingTop: 26,
        paddingBottom: 22,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: "700",
          letterSpacing: 1.1,
          color: PAPER.muted,
          textTransform: "uppercase",
        }}
      >
        Выписка по счёту
      </Text>
      <Text style={{ marginTop: 3, fontSize: 21, fontWeight: "800", letterSpacing: -0.3, color: PAPER.ink }}>
        {doc.accountName}
      </Text>
      {doc.teamName ? (
        <Text style={{ marginTop: 2, fontSize: 10.5, color: PAPER.muted }}>{doc.teamName}</Text>
      ) : null}

      <View style={{ marginTop: 14 }}>
        <PaperRow label="Период" value={doc.period} />
        <PaperRow label="Остаток на начало" value={doc.opening} />
      </View>

      {doc.days.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <View
            style={{
              flexDirection: "row",
              paddingBottom: 5,
              borderBottomWidth: 1,
              borderBottomColor: PAPER.ruleStrong,
            }}
          >
            <Text style={[headCell, { flex: 1 }]}>Операция</Text>
            <Text style={[headCell, { width: SUM_W, textAlign: "right" }]}>Сумма</Text>
            <Text style={[headCell, { width: BALANCE_W, textAlign: "right" }]}>Остаток</Text>
          </View>
          {doc.days.map((day) => (
            <View key={day.date}>
              <Text
                style={{
                  paddingTop: 10,
                  paddingBottom: 4,
                  borderBottomWidth: 1,
                  borderBottomColor: PAPER.line,
                  fontSize: 9.5,
                  fontWeight: "700",
                  color: PAPER.muted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {day.date}
              </Text>
              {day.rows.map((row, index) => (
                <View
                  key={`${day.date}-${index}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: PAPER.line,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontSize: 10.5, fontWeight: "600", color: PAPER.ink }}>{row.title}</Text>
                    {row.detail ? (
                      <Text style={{ marginTop: 1, fontSize: 9.5, color: PAPER.muted }}>{row.detail}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      numCell,
                      { width: SUM_W, fontWeight: "700", color: PAPER.ink, fontVariant: ["tabular-nums"] },
                    ]}
                  >
                    {row.amount}
                  </Text>
                  <Text style={[numCell, { width: BALANCE_W, fontVariant: ["tabular-nums"] }]}>
                    {row.balance}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ marginTop: 14, fontSize: 11, color: PAPER.muted }}>Операций не было</Text>
      )}

      <View
        style={{
          marginTop: 16,
          marginBottom: 4,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
          backgroundColor: PAPER.fill,
        }}
      >
        <TotalRow label="Поступило" value={doc.income} />
        <TotalRow label="Списано" value={doc.expense} />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 8,
            paddingTop: 10,
            borderTopWidth: 1,
            borderStyle: "dashed",
            borderTopColor: PAPER.ruleDashed,
          }}
        >
          <Text style={{ fontSize: 11, color: PAPER.muted }}>Остаток на конец</Text>
          <Text style={{ fontSize: 22, fontWeight: "800", color: PAPER.ink, fontVariant: ["tabular-nums"] }}>
            {doc.closing}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** «Период · 12.09.2026 — 03.10.2026»: подпись слева, значение справа. */
function PaperRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 7,
        borderBottomWidth: 1,
        borderBottomColor: PAPER.line,
      }}
    >
      <Text style={{ fontSize: 12, color: PAPER.muted }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: "600", color: PAPER.ink, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}
