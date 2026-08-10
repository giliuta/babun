import { Image, Text, View } from "react-native";
import type { InvoiceDocument } from "./document";

// ЗЕРКАЛО ИНВОЙСА — ТА ЖЕ БУМАГА, ЧТО УЙДЁТ КЛИЕНТУ.
//
// Владелец 2026-08-10: «зеркало инвойса, чтобы можно было сразу редактировать
// и смотреть». Рисуем из той же модели, что и PDF (document.ts): человек видит
// документ, а не «примерно как будет».
//
// Почему это не сплит-экран: на телефоне 402pt половина ширины не вмещает ни
// форму, ни документ. Телефонные редакторы инвойсов (FreshBooks, Invoice
// Simple, Wave) все до одного показывают документ ОТДЕЛЬНЫМ режимом, и кнопка
// отправки живёт именно на нём — человек физически видит то, что отправляет.
//
// Лист рисуем в пропорции А4 по ширине экрана: шрифты мелкие намеренно, это
// документ, а не интерфейс. Читать его будут на PDF, здесь — узнавать.

const PAPER = {
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

export function InvoicePaper({ doc }: { doc: InvoiceDocument }) {
  return (
    <View
      style={{
        backgroundColor: "#ffffff",
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 20,
        borderWidth: 1,
        borderColor: PAPER.border,
        // Тень листа: документ должен читаться как бумага, лежащая на экране.
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.10)",
      }}
    >
      {/* Шапка: кто выставил — слева, что за документ — справа. */}
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          {doc.logoUrl ? (
            <Image
              source={{ uri: doc.logoUrl }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={{ width: 120, height: 40, marginBottom: 8 }}
            />
          ) : null}
          <Text style={{ fontSize: 15, fontWeight: "800", color: PAPER.ink }}>
            {doc.seller.name}
          </Text>
          {doc.seller.lines.map((line) => (
            <Text key={line} style={{ fontSize: 10, color: PAPER.body, marginTop: 1 }}>
              {line}
            </Text>
          ))}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 8, fontWeight: "700", letterSpacing: 1, color: PAPER.muted }}>
            ИНВОЙС
          </Text>
          <Text
            style={{ fontSize: 18, fontWeight: "800", color: PAPER.ink, marginTop: 2 }}
          >
            {doc.number}
          </Text>
          <View
            style={{
              marginTop: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: PAPER.accentFill,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "700", color: PAPER.accent }}>
              {doc.statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <Party title="Получатель" party={doc.client} />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Boxed label="Дата выставления" value={doc.issuedOn} />
        <Boxed label="Оплатить до" value={doc.dueOn} />
      </View>

      {/* Позиции */}
      <View style={{ marginTop: 16 }}>
        <View
          style={{
            flexDirection: "row",
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderBottomColor: "#cbd5e1",
          }}
        >
          <Text style={[headCell, { flex: 1 }]}>Позиция</Text>
          <Text style={[headCell, { width: 42, textAlign: "right" }]}>Кол-во</Text>
          <Text style={[headCell, { width: 66, textAlign: "right" }]}>Цена</Text>
          <Text style={[headCell, { width: 74, textAlign: "right" }]}>Сумма</Text>
        </View>
        {doc.lines.length === 0 ? (
          <Text style={{ fontSize: 11, color: PAPER.faint, paddingVertical: 10 }}>
            Позиции пока не заполнены.
          </Text>
        ) : (
          doc.lines.map((line, index) => (
            <View
              key={`${line.title}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: PAPER.line,
              }}
            >
              <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", color: PAPER.ink }}>
                {line.title || "Без названия"}
              </Text>
              <Text style={[cell, { width: 42 }]}>{line.qty}</Text>
              <Text style={[cell, { width: 66 }]}>{line.unitPrice}</Text>
              <Text style={[cell, { width: 74, fontWeight: "700", color: PAPER.ink }]}>
                {line.total}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Итоги — прижаты вправо, как на бумаге. */}
      <View style={{ alignItems: "flex-end", marginTop: 14 }}>
        <View
          style={{
            minWidth: 210,
            padding: 12,
            borderRadius: 12,
            backgroundColor: PAPER.fill,
          }}
        >
          {doc.totals.map((total, index) => (
            <View
              key={`${total.label}-${index}`}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 14,
                paddingVertical: 3,
                marginTop: total.grand ? 6 : 0,
                paddingTop: total.grand ? 8 : 3,
                borderTopWidth: total.grand ? 1 : 0,
                borderTopColor: "#d9e0e9",
              }}
            >
              <Text
                style={{
                  fontSize: total.grand ? 13 : 11,
                  fontWeight: total.grand ? "800" : "400",
                  color: total.grand ? PAPER.ink : PAPER.body,
                  flexShrink: 1,
                }}
              >
                {total.label}
              </Text>
              <Text
                style={{
                  fontSize: total.grand ? 13 : 11,
                  fontWeight: total.grand ? "800" : "700",
                  color: PAPER.ink,
                }}
              >
                {total.value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {doc.payTo.length > 0 ? (
        <Section title="Реквизиты для оплаты">
          {doc.payTo.map((line) => (
            <Text key={line} style={{ fontSize: 11, color: PAPER.body, marginTop: 1 }}>
              {line}
            </Text>
          ))}
          <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 4 }}>
            В назначении платежа укажите {doc.number}.
          </Text>
        </Section>
      ) : null}

      {doc.settlement.length > 0 ? (
        <Section title="Оплата">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Boxed label="Статус" value={doc.statusLabel} />
            {doc.settlement.map((metric) => (
              <Boxed key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </View>
          {doc.payments.map((payment, index) => (
            <View
              key={`${payment.date}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                paddingVertical: 7,
                borderBottomWidth: 1,
                borderBottomColor: PAPER.line,
              }}
            >
              <Text style={{ width: 76, fontSize: 11, color: PAPER.body }}>{payment.date}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: PAPER.ink }}>{payment.title}</Text>
                {payment.details ? (
                  <Text style={{ fontSize: 9, color: PAPER.muted, marginTop: 1 }}>
                    {payment.details}
                  </Text>
                ) : null}
              </View>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  color: payment.refund ? PAPER.red : PAPER.green,
                }}
              >
                {payment.amount}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      {doc.notes ? (
        <Section title="Комментарий">
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderLeftWidth: 3,
              borderLeftColor: "#9db4e2",
              borderRadius: 8,
              backgroundColor: PAPER.fill,
            }}
          >
            <Text style={{ fontSize: 11, color: "#334155" }}>{doc.notes}</Text>
          </View>
        </Section>
      ) : null}

      <Text
        style={{
          marginTop: 18,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: PAPER.border,
          fontSize: 9,
          color: PAPER.faint,
        }}
      >
        {doc.footer}
      </Text>
    </View>
  );
}

function Party({ title, party }: { title: string; party: InvoiceDocument["client"] }) {
  return (
    <View
      style={{
        marginTop: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: PAPER.border,
        borderRadius: 12,
      }}
    >
      <Text style={{ fontSize: 8, fontWeight: "700", letterSpacing: 0.8, color: PAPER.muted }}>
        {title.toUpperCase()}
      </Text>
      <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginTop: 5 }}>
        {party.name}
      </Text>
      {party.lines.map((line) => (
        <Text key={line} style={{ fontSize: 11, color: PAPER.body, marginTop: 1 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Boxed({ label, value }: { label: string; value: string }) {
  return (
    <View
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
      <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: PAPER.ink, marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const headCell = {
  fontSize: 8,
  fontWeight: "700" as const,
  letterSpacing: 0.4,
  color: PAPER.muted,
  textTransform: "uppercase" as const,
};

const cell = {
  fontSize: 11,
  color: PAPER.body,
  textAlign: "right" as const,
};
