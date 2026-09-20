import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import type { ReceiptDocument } from "./receipt-document";
import { headCell, numCell, PAPER, totalsAbove, TotalRow } from "./ReceiptPaperParts";

// ЗЕРКАЛО ЧЕКА — ТА ЖЕ БУМАГА, ЧТО УЖЕ УШЛА В PDF.
//
// Владелец 2026-09-20: «давай сделаем, чтобы визуал был точно такой же, как в
// PDF — то есть оно открывает один в один зеркало PDF, который мы
// сгенерировали». Тот же приём, что и у инвойса
// (`invoices/InvoicePaper.tsx` — прочитай его шапку, если нужна причина «а
// почему не WebView»): один документ (`receipt-document.ts`), два рендера —
// HTML для PDF (`receipt-pdf.ts`) и эта React Native вёрстка для экрана.
// Порядок и состав строк здесь ОБЯЗАНЫ совпадать с `receipt-pdf.ts`; следит
// `receipt-paper-contract.test.ts` рядом.
//
// ВЫДАННЫЙ ЧЕК НЕ РЕДАКТИРУЕТСЯ: он снимок момента выдачи. Без пропа `edit`
// этот файл — чистое чтение модели, и таким его видят лента документов, лист
// в «Файлах» записи и превью.
//
// БУДУЩИЙ ЧЕК ЗДЕСЬ НЕ СОБИРАЮТ. Утром 2026-09-20 бумага умела отвечать на
// тап (зоны, слова-приглашения), вечером владелец решил иначе — «копируй то,
// что мы уже создали», — и составитель стал блоками записи
// (`ReceiptComposer.tsx`). Мёртвые зоны снесены тем же заходом, а не оставлены
// «на всякий случай»: код, который выглядит готовой дорогой, уводит следующего
// на третью форму чека.
//
// Чернила бумаги и мелкие блоки — в `ReceiptPaperParts.tsx` рядом.

const QTY_W = 34;
const PRICE_W = 58;
const SUM_W = 64;

export function ReceiptPaper({ doc }: { doc: ReceiptDocument }) {
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
      {/* Компания — тем же порядком, что в PDF: имя, затем адрес строками. */}
      <Text style={{ fontSize: 15, fontWeight: "800", color: PAPER.ink }}>
        {doc.seller.name}
      </Text>
      {doc.seller.lines.map((line) => (
        <Text key={line} style={{ marginTop: 2, fontSize: 10.5, color: PAPER.muted }}>
          {line}
        </Text>
      ))}

      <Text
        style={{
          marginTop: 18,
          fontSize: 9,
          fontWeight: "700",
          letterSpacing: 1.1,
          color: PAPER.muted,
          textTransform: "uppercase",
        }}
      >
        Чек
      </Text>
      <Text
        style={{
          marginTop: 3,
          marginBottom: 16,
          fontSize: 21,
          fontWeight: "800",
          letterSpacing: -0.3,
          color: PAPER.ink,
        }}
      >
        {doc.number}
      </Text>

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
        <Text style={{ fontSize: 12, color: PAPER.muted }}>Дата</Text>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: PAPER.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {doc.issuedOn}
        </Text>
      </View>

      {/* Перечень услуг — ровно та же таблица, что в PDF: имя строкой слева,
          три узкие числовые колонки справа. */}
      {doc.lines.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <View
            style={{
              flexDirection: "row",
              paddingBottom: 5,
              borderBottomWidth: 1,
              borderBottomColor: PAPER.ruleStrong,
            }}
          >
            <Text style={[headCell, { flex: 1 }]}>Услуга</Text>
            <Text style={[headCell, { width: QTY_W, textAlign: "right" }]}>Кол-во</Text>
            <Text style={[headCell, { width: PRICE_W, textAlign: "right" }]}>Цена</Text>
            <Text style={[headCell, { width: SUM_W, textAlign: "right" }]}>Сумма</Text>
          </View>
          {doc.lines.map((line, index) => (
            <View
              key={`${line.name}-${index}`}
              style={{
                  flexDirection: "row",
                alignItems: "flex-start",
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: PAPER.line,
              }}
            >
              <Text style={{ flex: 1, paddingRight: 8, fontSize: 10.5, fontWeight: "600", color: PAPER.ink }}>
                {line.name}
              </Text>
              <Text style={[numCell, { width: QTY_W, fontVariant: ["tabular-nums"] }]}>
                {line.qty}
              </Text>
              <Text style={[numCell, { width: PRICE_W, fontVariant: ["tabular-nums"] }]}>
                {line.unitPrice}
              </Text>
              <Text
                style={[
                  numCell,
                  { width: SUM_W, fontWeight: "700", color: PAPER.ink, fontVariant: ["tabular-nums"] },
                ]}
              >
                {line.sum}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

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
        {doc.linesTotal ? <TotalRow label="Итого работ" value={doc.linesTotal} /> : null}
        {doc.discount ? <TotalRow label={doc.discount.label} value={doc.discount.value} /> : null}
        {doc.vat ? <TotalRow label={doc.vat.label} value={doc.vat.value} /> : null}
        {/* «Получено» подчёркнуто линией сверху ТОЛЬКО когда над ним уже есть
            другие итоги — то же условие, что в `receipt-pdf.ts`
            (`with-totals-above`), проверенное здесь же, а не заранее: порядок
            чтения полей модели в этом файле обязан идти тем же чередом, что
            и печать (стережёт `receipt-paper-contract.test.ts`). */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: totalsAbove(doc) ? 8 : 0,
            paddingTop: totalsAbove(doc) ? 10 : 0,
            borderTopWidth: totalsAbove(doc) ? 1 : 0,
            borderStyle: "dashed",
            borderTopColor: PAPER.ruleDashed,
          }}
        >
          <Text style={{ fontSize: 11, color: PAPER.muted }}>Получено</Text>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "800",
              color: PAPER.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {doc.amount}
          </Text>
        </View>
      </View>

      {/* Штамп — ТОЛЬКО когда чек погашен. Слово печатает модель
          (`doc.voidLabel`), не эта вёрстка: второго места придумать текст
          «Аннулирован» в продукте нет. */}
      {doc.voidLabel ? (
        <Text
          style={{
            marginTop: 20,
            paddingTop: 14,
            borderTopWidth: 1,
            borderStyle: "dashed",
            borderTopColor: PAPER.ruleStrong,
            textAlign: "center",
            fontSize: 12,
            fontWeight: "700",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: PAPER.red,
          }}
        >
          {doc.voidLabel}
        </Text>
      ) : null}
    </View>
  );
}
