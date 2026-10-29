import { Image, Text, View } from "react-native";
import type { DocumentParty, InvoiceDocument } from "@/lib/paper/document";
import { PAPER } from "@/lib/paper/palette";

// БУМАГА ИНВОЙСА — ТА ЖЕ, ЧТО УЙДЁТ КЛИЕНТУ.
//
// Рисуем из той же модели, что и PDF (`document.ts` → `pdf.ts`): человек видит
// документ, а не «примерно как будет». Контракт-тест держит оба рендера в
// одном порядке блоков.
//
// ВИД — КАК У НАСТОЯЩЕГО ИНВОЙСА AIRFIX #103:
//   • шапка: логотип слева, справа крупно INVOICE, номер и даты коротко;
//   • две колонки сторон: FROM и BILL TO, адрес строками;
//   • таблица в рамке с серой шапкой, валюта в названиях колонок;
//   • итоги столбиком справа, итог в рамке;
//   • внизу одним блоком «Notes & payment instructions» и номер документа.
// Карточек дат, плашки «Оплата» со статусом и длинного подвала нет: на бумаге
// их не бывает, и они делают документ похожим на экран приложения.
//
// Тап-зон у бумаги нет: правят блоки формы, а бумага показывает итог.

// Цвета бумаги — общие чернила документов (`lib/paper/palette.ts`): белый
// лист всегда, и тот же, что у чека и PDF.

const COL = { qty: 44, price: 74, amount: 84 } as const;

export function InvoicePaper({ doc }: { doc: InvoiceDocument }) {
  // СТАТУСА НА БУМАГЕ НЕТ: «Draft» под датой клиенту ничего не скажет. Бумага
  // уходит клиенту и в министерство; «черновик», «оплачен»,
  // «просрочен» — состояние в приложении, а не часть документа. Превью
  // печатается ровно той бумагой, какой документ выйдет.
  return (
    <View
      style={{
        backgroundColor: PAPER.white,
        borderRadius: 6,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 16,
        borderWidth: 1,
        borderColor: PAPER.line,
        // Тень листа: документ должен читаться как бумага, лежащая на экране.
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.10)",
      }}
    >
      {/* Шапка: логотип слева, что за документ — справа. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          {doc.logoUrl ? (
            <Image
              source={{ uri: doc.logoUrl }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={{ width: 64, height: 64 }}
            />
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: PAPER.ink, letterSpacing: 0.3 }}>
            {doc.title}
          </Text>
          <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 4 }}>{doc.number}</Text>
          {doc.reference ? (
            <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 1 }}>{doc.reference}</Text>
          ) : null}
          <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 1 }}>
            {doc.dict.issuedShort(doc.issuedShort)}
          </Text>
          {doc.dueShort ? (
            <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 1 }}>
              {doc.dict.dueShort(doc.dueShort)}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Стороны: кто выставил и кому. */}
      <View style={{ flexDirection: "row", gap: 16, marginTop: 14 }}>
        <PartyColumn title={doc.dict.seller} party={doc.seller} />
        <PartyColumn title={doc.dict.recipient} party={doc.client} />
      </View>

      {/* Позиции — таблицей в рамке. */}
      <View
        style={{
          marginTop: 18,
          borderWidth: 1,
          borderColor: PAPER.line,
        }}
      >
        <View style={{ flexDirection: "row", backgroundColor: PAPER.fill }}>
          <Text style={[head, { flex: 1, textAlign: "left" }]}>{doc.dict.lineTitle}</Text>
          <Text style={[head, { width: COL.qty }]}>{doc.dict.qty}</Text>
          <Text style={[head, { width: COL.price }]}>
            {doc.dict.price}, {doc.currency}
          </Text>
          <Text style={[head, { width: COL.amount }]}>
            {doc.dict.amount}, {doc.currency}
          </Text>
        </View>
        {doc.lines.length === 0 ? (
          <Text style={{ fontSize: 10, color: PAPER.muted, padding: 8 }}>
            {doc.dict.linesEmpty}
          </Text>
        ) : (
          doc.lines.map((line, index) => (
            <View
              key={`${line.title}-${index}`}
              style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: PAPER.line }}
            >
              <View style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 7 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: PAPER.ink }}>
                  {line.title || doc.dict.untitled}
                </Text>
                {line.description ? (
                  <Text style={{ fontSize: 9, lineHeight: 13, color: PAPER.muted, marginTop: 2 }}>
                    {line.description}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[cell, { width: COL.qty }]}>
                {line.qty}
              </Text>
              <Text style={[cell, { width: COL.price }]}>{line.unitPrice}</Text>
              <Text style={[cell, { width: COL.amount }]}>{line.total}</Text>
            </View>
          ))
        )}
      </View>

      {/* Итоги — столбиком справа под колонкой сумм, без клеток: строки
          тонкие, в рамке только итог (компактно). */}
      <View style={{ alignItems: "flex-end", marginTop: 6 }}>
        {doc.totals.map((total, index) => (
          <View
            key={`${total.label}-${index}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: total.grand ? 6 : 0,
            }}
          >
            <Text
              style={{
                fontSize: total.grand ? 12 : 10,
                fontWeight: total.grand ? "700" : "400",
                color: total.grand ? PAPER.ink : PAPER.body,
                textAlign: "right",
                paddingVertical: total.grand ? 6 : 2,
                paddingHorizontal: 8,
              }}
            >
              {total.label}
            </Text>
            <Text
              // Сумма — одной строкой: «€36,000.0 / 0» на двух строках читалась
              // как две цифры. Не влезла — шрифт ужимается, а не переносится.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                width: COL.amount,
                fontSize: total.grand ? 12 : 10,
                fontWeight: total.grand ? "700" : "600",
                color: PAPER.ink,
                textAlign: "right",
                paddingVertical: total.grand ? 6 : 2,
                paddingHorizontal: 8,
                borderWidth: total.grand ? 1 : 0,
                borderColor: PAPER.line,
              }}
            >
              {total.value}
            </Text>
          </View>
        ))}
      </View>

      {doc.payTo.length > 0 || doc.notes ? (
        <View style={{ marginTop: 16 }}>
          <Text style={eyebrow}>{doc.dict.notesTitle}</Text>
          {[...doc.payTo, ...(doc.notes ? [doc.notes] : [])].map((line, index) => (
            <Text key={`${line}-${index}`} style={{ fontSize: 10, color: PAPER.body, marginTop: 3 }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {/* История оплат — только у документа, по которому уже платили; под
          ней — «Получено · К оплате». */}
      {doc.payments.length > 0 || doc.settlement.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <Text style={eyebrow}>{doc.dict.payment}</Text>
          {doc.payments.map((payment, index) => (
            <View
              key={`${payment.date}-${index}`}
              style={{
                flexDirection: "row",
                paddingVertical: 5,
                borderBottomWidth: 1,
                borderBottomColor: PAPER.line,
              }}
            >
              <Text style={{ width: 72, fontSize: 10, color: PAPER.body }}>{payment.date}</Text>
              <Text style={{ flex: 1, fontSize: 10, color: PAPER.ink }}>
                {payment.title}
                {payment.details ? ` · ${payment.details}` : ""}
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color: payment.refund ? PAPER.red : PAPER.green,
                }}
              >
                {payment.amount}
              </Text>
            </View>
          ))}
          {doc.settlement.map((row) => (
            <View key={row.label} style={{ flexDirection: "row", paddingVertical: 5 }}>
              <Text style={{ flex: 1, fontSize: 10, color: PAPER.body }}>{row.label}</Text>
              <Text style={{ fontSize: 10, fontWeight: "700", color: PAPER.ink }}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={{ marginTop: 20, fontSize: 8, color: PAPER.muted, textAlign: "right" }}>
        {doc.footer}
      </Text>
    </View>
  );
}

function PartyColumn({ title, party }: { title: string; party: DocumentParty }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={eyebrow}>{title}</Text>
      <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginTop: 4 }}>
        {party.name}
      </Text>
      {party.lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={{ fontSize: 10, color: PAPER.body, marginTop: 2 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const eyebrow = {
  fontSize: 8,
  fontWeight: "700" as const,
  letterSpacing: 0.6,
  textTransform: "uppercase" as const,
  color: PAPER.body,
};

const head = {
  fontSize: 9,
  fontWeight: "600" as const,
  color: PAPER.ink,
  textAlign: "right" as const,
  paddingHorizontal: 8,
  paddingVertical: 7,
};

const cell = {
  fontSize: 10,
  color: PAPER.body,
  textAlign: "right" as const,
  paddingHorizontal: 8,
  paddingVertical: 7,
};
