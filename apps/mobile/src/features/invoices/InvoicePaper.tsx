import { Image, Text, View } from "react-native";
import type { InvoiceDocument } from "./document";
import { invoicePaperZones, type InvoicePaperHandlerFlags } from "./invoice-paper-zones";
import {
  Boxed,
  Invite,
  PAPER,
  Party,
  PressableZone,
  Section,
  cell,
  headCell,
} from "./InvoicePaperHotspots";

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
//
// ПЕРВЫЙ ЗАХОД ЗЕРКАЛА-СОСТАВИТЕЛЯ (владелец 2026-09-20): «добавляем инвойс —
// открывается стандартный инвойс, кликаем на логотип — логотип добавился,
// кликаем на адрес — адрес добавился, кликаем на клиента — добавился клиент».
// Зоны бумаги зовут тапом готовые шторки составителя — коллбэками пропами,
// сама бумага о шторках не знает. Пустое место печатает короткое приглашение
// акцентным цветом вместо пустоты; какая зона нажимается и что приглашать —
// решает чистая функция `invoicePaperZones` (тестируется отдельно, без
// рендера дерева — в продукте нет RN-компонентных тестов). Без обработчика
// зона остаётся обычным текстом: бумага обязана уметь быть просто бумагой —
// она понадобится такой на экране уже выставленного документа.

export interface InvoicePaperHandlers {
  /** Тап по логотипу — реквизиты компании (`LogoRow` уже умеет загрузку). */
  onPressLogo?: () => void;
  /** Тап по продавцу (юр. имя/адрес/VAT/IBAN — одна зона) — тоже туда:
   *  это данные компании на все будущие документы, не поле этого счёта. */
  onPressSeller?: () => void;
  onPressClient?: () => void;
  /** `"issued"` приходит, только пока документ ещё черновик — у выставленного
   *  дата выставления заморожена (см. `invoicePaperZones`). */
  onPressDate?: (field: "issued" | "due") => void;
  onPressLine?: (index: number) => void;
  onPressTax?: () => void;
  onPressNote?: () => void;
}

export function InvoicePaper({
  doc,
  onPressLogo,
  onPressSeller,
  onPressClient,
  onPressDate,
  onPressLine,
  onPressTax,
  onPressNote,
}: { doc: InvoiceDocument } & InvoicePaperHandlers) {
  const flags: InvoicePaperHandlerFlags = {
    hasLogo: !!onPressLogo,
    hasSeller: !!onPressSeller,
    hasClient: !!onPressClient,
    hasDate: !!onPressDate,
    hasNote: !!onPressNote,
  };
  const zones = invoicePaperZones(doc, flags);

  return (
    <View
      style={{
        backgroundColor: "#ffffff",
        borderRadius: 10,
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
          <PressableZone
            onPress={zones.logo.interactive ? onPressLogo : undefined}
            accessibilityLabel={doc.logoUrl ? "Заменить логотип" : "Добавить логотип"}
          >
            {doc.logoUrl ? (
              <Image
                source={{ uri: doc.logoUrl }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
                style={{ width: 120, height: 40, marginBottom: 8 }}
              />
            ) : zones.logo.invite ? (
              <Invite label={zones.logo.invite} style={{ marginBottom: 8 }} />
            ) : null}
          </PressableZone>
          <PressableZone
            onPress={zones.seller.interactive ? onPressSeller : undefined}
            accessibilityLabel="Реквизиты компании"
          >
            <Text style={{ fontSize: 15, fontWeight: "800", color: PAPER.ink }}>
              {doc.seller.name}
            </Text>
            {zones.seller.invite ? (
              <Invite label={zones.seller.invite} style={{ marginTop: 1 }} />
            ) : (
              doc.seller.lines.map((line) => (
                <Text key={line} style={{ fontSize: 10, color: PAPER.body, marginTop: 1 }}>
                  {line}
                </Text>
              ))
            )}
          </PressableZone>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 8, fontWeight: "700", letterSpacing: 1, color: PAPER.muted }}>
            {doc.dict.invoice}
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

      <Party
        title={doc.dict.recipient}
        party={doc.client}
        invite={zones.client.invite}
        onPress={zones.client.interactive ? onPressClient : undefined}
      />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Boxed
          label={doc.dict.issuedOn}
          value={doc.issuedOn}
          invite={zones.issuedOn.invite}
          onPress={zones.issuedOn.interactive ? () => onPressDate?.("issued") : undefined}
        />
        <Boxed
          label={doc.dict.dueOn}
          value={doc.dueOn}
          invite={zones.dueOn.invite}
          onPress={zones.dueOn.interactive ? () => onPressDate?.("due") : undefined}
        />
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
          <Text style={[headCell, { flex: 1 }]}>{doc.dict.lineTitle}</Text>
          <Text style={[headCell, { width: 62, textAlign: "right" }]}>{doc.dict.qty}</Text>
          <Text style={[headCell, { width: 66, textAlign: "right" }]}>{doc.dict.price}</Text>
          <Text style={[headCell, { width: 74, textAlign: "right" }]}>{doc.dict.amount}</Text>
        </View>
        {doc.lines.length === 0 ? (
          <Text style={{ fontSize: 11, color: PAPER.faint, paddingVertical: 10 }}>
            {doc.dict.linesEmpty}
          </Text>
        ) : (
          doc.lines.map((line, index) => (
            <PressableZone
              key={`${line.title}-${index}`}
              onPress={onPressLine ? () => onPressLine(index) : undefined}
              accessibilityLabel={`${line.title || doc.dict.untitled} — изменить`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: PAPER.line,
              }}
            >
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: PAPER.ink }}>
                  {line.title || doc.dict.untitled}
                </Text>
                {/* ЧТО ВХОДИТ В РАБОТУ — второй строкой, приглушённо. Тот же
                    приём, что у подробностей платежа ниже, и та же пара с
                    `pdf.ts`: оба рендера правятся вместе. */}
                {line.description ? (
                  <Text
                    style={{
                      fontSize: 10,
                      lineHeight: 14,
                      color: PAPER.faint,
                      marginTop: 2,
                    }}
                  >
                    {line.description}
                  </Text>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                // Колонка выросла с 42 до 62: с 2026-08-25 она печатает не
                // голое число, а «4 м» — единицу, которую раньше вписывали
                // руками в название позиции.
                style={[cell, { width: 62 }]}
              >
                {line.qty}
              </Text>
              <Text style={[cell, { width: 66 }]}>{line.unitPrice}</Text>
              <Text style={[cell, { width: 74, fontWeight: "700", color: PAPER.ink }]}>
                {line.total}
              </Text>
            </PressableZone>
          ))
        )}
      </View>

      {/* Итоги — прижаты вправо, как на бумаге. Налог правится тем же тапом. */}
      <View style={{ alignItems: "flex-end", marginTop: 14 }}>
        <PressableZone
          onPress={onPressTax}
          accessibilityLabel="Налог и итоги — изменить"
          style={{
            minWidth: 210,
            padding: 12,
            borderRadius: 10,
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
        </PressableZone>
      </View>

      {doc.payTo.length > 0 ? (
        <Section title={doc.dict.payTo}>
          {doc.payTo.map((line) => (
            <Text key={line} style={{ fontSize: 11, color: PAPER.body, marginTop: 1 }}>
              {line}
            </Text>
          ))}
          <Text style={{ fontSize: 10, color: PAPER.muted, marginTop: 4 }}>
            {doc.dict.paymentPurpose(doc.number)}
          </Text>
        </Section>
      ) : null}

      {doc.settlement.length > 0 ? (
        <Section title={doc.dict.payment}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Boxed label={doc.dict.status} value={doc.statusLabel} />
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
        <Section title={doc.dict.notes}>
          <PressableZone
            onPress={onPressNote}
            accessibilityLabel="Комментарий — изменить"
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderLeftWidth: 3,
              borderLeftColor: "#9db4e2",
              borderRadius: 10,
              backgroundColor: PAPER.fill,
            }}
          >
            <Text style={{ fontSize: 11, color: "#334155" }}>{doc.notes}</Text>
          </PressableZone>
        </Section>
      ) : zones.note.invite ? (
        // Пустой комментарий не рисуем в отдельной секции с заголовком
        // «Комментарий»: заголовок и приглашение сказали бы одно и то же
        // слово дважды подряд. Приглашение — просто акцентная строка.
        <PressableZone
          onPress={onPressNote}
          accessibilityLabel="Добавить комментарий"
          style={{ marginTop: 18 }}
        >
          <Invite label={zones.note.invite} />
        </PressableZone>
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

