import { Badge, icons } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const SUB = 'rgba(11,18,32,0.74)';

// Экран на канве приложения: белые строки и пилюли лежат на #f4f6f9.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Ряд пилюль с воздухом по гуттеру 16.
const Pills = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
    {children}
  </div>
);

type Invoice = {
  number: string;
  badge: React.ReactNode;
  line: string;
  total: string;
  rest?: string;
};

// Строка списка «Инвойсы»: номер + статус, ниже клиент и дата, справа сумма.
const InvoiceRow = ({ inv, first }: { inv: Invoice; first?: boolean }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      minHeight: 72,
      padding: '12px 16px',
      boxSizing: 'border-box',
      background: '#ffffff',
      borderTop: first ? 'none' : '1px solid rgba(11,18,32,0.20)',
      fontFamily: SYS,
    }}
  >
    <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600, color: INK }}>{inv.number}</span>
        {inv.badge}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 13,
          lineHeight: '18px',
          color: SUB,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {inv.line}
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
        {inv.total}
      </span>
      {inv.rest ? (
        <span style={{ marginTop: 2, fontSize: 12, lineHeight: '16px', color: '#955f00', fontVariantNumeric: 'tabular-nums' }}>
          {inv.rest}
        </span>
      ) : null}
    </div>
    <div style={{ marginLeft: 8, display: 'flex' }}>
      <icons.ChevronRight color="rgba(11,18,32,0.50)" size={18} />
    </div>
  </div>
);

// Список инвойсов — главный дом пилюли: статус стоит рядом с номером.
export const InvoiceList = () => (
  <Screen>
    <InvoiceRow
      first
      inv={{
        number: 'INV-015',
        badge: <Badge label="Оплачен" variant="success" />,
        line: 'Павел Иванов · 21 сентября 2026 г.',
        total: '€178,50',
      }}
    />
    <InvoiceRow
      inv={{
        number: 'INV-014',
        badge: <Badge label="Частично оплачен" variant="brand" />,
        line: 'Наталья · 18 сентября 2026 г.',
        total: '€240',
        rest: 'Остаток €120',
      }}
    />
    <InvoiceRow
      inv={{
        number: 'INV-012',
        badge: <Badge label="Просрочен" variant="warning" />,
        line: 'Иван Петров · 2 сентября 2026 г.',
        total: '€95',
      }}
    />
    <InvoiceRow
      inv={{
        number: 'INV-016',
        badge: <Badge label="Кредит-нота" variant="neutral" />,
        line: 'Сторно INV-011 · Янис · 19 сентября 2026 г.',
        total: '€60',
      }}
    />
  </Screen>
);

// Все статусы инвойса: «Просрочен» тем же спокойным янтарём, что «Выставлен» —
// неоплаченный документ не красят в красный.
export const InvoiceStatuses = () => (
  <Screen>
    <Pills>
      <Badge label="Выставлен" variant="warning" />
      <Badge label="Частично оплачен" variant="brand" />
      <Badge label="Просрочен" variant="warning" />
      <Badge label="Оплачен" variant="success" />
      <Badge label="Аннулирован" variant="neutral" />
      <Badge label="Отменён" variant="neutral" />
    </Pills>
  </Screen>
);

// Оплата записи: свои варианты пилюли на каждое состояние денег.
export const PaymentStatuses = () => (
  <Screen>
    <Pills>
      <Badge label="Оплачено" variant="paid" />
      <Badge label="Оплачено частично" variant="partial" />
      <Badge label="Не оплачено" variant="unpaid" />
      <Badge label="Возврат" variant="refunded" />
    </Pills>
  </Screen>
);

// Смысловые тона: акцент, приход, внимание, долг, нейтраль.
export const Tones = () => (
  <Screen>
    <Pills>
      <Badge label="Новый клиент" variant="brand" />
      <Badge label="Приход" variant="success" />
      <Badge label="Ждёт оплаты" variant="warning" />
      <Badge label="Долг €80" variant="danger" />
      <Badge label="Черновик" variant="neutral" />
    </Pills>
  </Screen>
);

// Свой цвет (тег клиента): тинт цветом тега, буквы — читаемый тон того же цвета,
// даже у бледного лаймового.
export const TagColors = () => (
  <Screen>
    <Pills>
      <Badge label="VIP" color="#E8145D" />
      <Badge label="Постоянный" color="#15A84F" />
      <Badge label="По рекомендации" color="#6B45FB" />
      <Badge label="Сложный доступ" color="#DF510F" />
      <Badge label="Сезонный" color="#B9CB1B" />
    </Pills>
  </Screen>
);
