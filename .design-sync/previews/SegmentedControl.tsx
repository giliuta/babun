import { useState } from 'react';
import { SectionCard, SegmentedControl } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const SUB = 'rgba(11,18,32,0.74)';
const FAINT = 'rgba(11,18,32,0.64)';
const noop = () => {};

// Лист (шторка) — белая поверхность, сегмент стоит на гуттере 16.
const Sheet = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, boxSizing: 'border-box', background: '#ffffff', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Экран на канве #f4f6f9.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '4px 0 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Первая строка листа операции: вид операции, подпись выбранного в цвете смысла.
export const OperationType = () => {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  return (
    <Sheet>
      <SegmentedControl
        options={[
          { value: 'expense', label: 'Расход', color: '#c9372c' },
          { value: 'income', label: 'Доход', color: '#087a52' },
        ]}
        value={type}
        onChange={setType}
      />
    </Sheet>
  );
};

// Направление долга: «Мне должны» янтарём, «Я должен» красным.
export const DebtDirection = () => {
  const [dir, setDir] = useState<'incoming' | 'outgoing'>('incoming');
  return (
    <Sheet>
      <SegmentedControl
        options={[
          { value: 'incoming', label: 'Мне должны', color: '#955f00' },
          { value: 'outgoing', label: 'Я должен', color: '#c9372c' },
        ]}
        value={dir}
        onChange={setDir}
      />
    </Sheet>
  );
};

// Способ оплаты инвойса — четыре нейтральных положения.
export const PaymentMethod = () => {
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('card');
  return (
    <Sheet>
      <div
        style={{
          marginBottom: 8,
          fontFamily: SYS,
          fontSize: 12,
          lineHeight: '16px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: FAINT,
        }}
      >
        Способ оплаты
      </div>
      <SegmentedControl
        options={[
          { value: 'cash', label: 'Наличные' },
          { value: 'card', label: 'Карта' },
          { value: 'transfer', label: 'Банк' },
          { value: 'other', label: 'Другое' },
        ]}
        value={method}
        onChange={setMethod}
      />
    </Sheet>
  );
};

// Права мастера: название блока, фраза-последствие и сегмент положений.
export const AccessLevel = () => {
  const [level, setLevel] = useState<'off' | 'read' | 'write'>('read');
  const sentence = {
    off: 'Деньги этого календаря закрыты',
    read: 'Видит доходы и расходы календаря',
    write: 'Заводит операции и правит свои расходы',
  }[level];
  return (
    <Screen>
      <SectionCard title="Финансы">
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontFamily: SYS, fontSize: 15, lineHeight: '20px', fontWeight: 600, color: INK }}>Операции</div>
          <div style={{ marginTop: 2, marginBottom: 10, fontFamily: SYS, fontSize: 15, lineHeight: '20px', color: SUB }}>{sentence}</div>
          <SegmentedControl
            options={[
              { value: 'off', label: 'Скрыт' },
              { value: 'read', label: 'Смотрит' },
              { value: 'write', label: 'Меняет' },
            ]}
            value={level}
            onChange={setLevel}
          />
        </div>
      </SectionCard>
    </Screen>
  );
};

// Фильтр списка инвойсов прямо на канве экрана.
export const InvoiceFilter = () => {
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('open');
  return (
    <Screen>
      <div style={{ padding: '8px 12px 0', display: 'flex', flexDirection: 'column' }}>
        <SegmentedControl
          options={[
            { value: 'all', label: 'Все' },
            { value: 'open', label: 'К оплате' },
            { value: 'paid', label: 'Оплачены' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
    </Screen>
  );
};

// Заперт: у сохранённой операции вид уже не меняют — невыбранное гаснет.
export const Locked = () => (
  <Sheet>
    <SegmentedControl
      options={[
        { value: 'expense', label: 'Расход', color: '#c9372c' },
        { value: 'income', label: 'Доход', color: '#087a52' },
      ]}
      value="income"
      disabled
      onChange={noop}
    />
  </Sheet>
);
