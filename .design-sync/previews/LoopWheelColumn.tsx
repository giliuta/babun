import { useState } from 'react';
import { LoopWheelColumn } from '@babun/ui';

const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    {children}
  </div>
);

const ITEM_H = 40;
const pad2 = (n: number) => String(n).padStart(2, '0');

// Порядок барабана валют: ходовые в голове, остальные по алфавиту. Лента
// закольцована, поэтому над «Евро» стоит хвост алфавита.
const CURRENCIES = [
  ['Евро', '€', 'EUR'],
  ['Доллар США', '$', 'USD'],
  ['Фунт стерлингов', '£', 'GBP'],
  ['Швейцарский франк', 'CHF', 'CHF'],
  ['Польский злотый', 'zł', 'PLN'],
  ['Гривна', '₴', 'UAH'],
  ['Российский рубль', '₽', 'RUB'],
  ['Турецкая лира', '₺', 'TRY'],
  ['Дирхам ОАЭ', 'د.إ', 'AED'],
  ['Новый израильский шекель', '₪', 'ILS'],
  ['Австралийский доллар', 'A$', 'AUD'],
  ['Азербайджанский манат', '₼', 'AZN'],
  ['Албанский лек', 'L', 'ALL'],
  ['Южноафриканский рэнд', 'R', 'ZAR'],
  ['Южнокорейская вона', '₩', 'KRW'],
  ['Южносуданский фунт', 'SSP', 'SSP'],
  ['Ямайский доллар', 'J$', 'JMD'],
  ['Японская иена', '¥', 'JPY'],
] as const;

// Строка барабана: имя слева, символ и код справа; активная — крупнее и чернее.
const currencyRow = (index: number, active: boolean) => {
  const [name, symbol, code] = CURRENCIES[index] ?? CURRENCIES[0];
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', boxSizing: 'border-box' }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontSize: active ? 17 : 15,
          fontWeight: active ? 600 : 400,
          letterSpacing: -0.2,
          color: active ? '#0b1220' : 'rgba(11,18,32,0.62)',
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontSize: active ? 14 : 13,
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'rgba(11,18,32,0.74)' : 'rgba(11,18,32,0.64)',
        }}
      >
        {`${symbol} · ${code}`}
      </span>
    </div>
  );
};

// Шторка «Валюта»: барабан на семь строк, под срезом — скруглённая полоса
// цвета подложки на одной строке, а не на всём барабане.
export const CurrencyWheel = () => {
  const [idx, setIdx] = useState(0);
  const rows = 7;
  return (
    <SheetBody>
      <div style={{ position: 'relative', height: ITEM_H * rows, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: ((rows - 1) / 2) * ITEM_H,
            height: ITEM_H,
            borderRadius: 10,
            backgroundColor: '#f4f6f9',
          }}
        />
        <LoopWheelColumn
          items={CURRENCIES.map(([name, symbol, code]) => `${name}, ${symbol}, ${code}`)}
          value={idx}
          onChange={setIdx}
          accessibilityLabel="Валюта"
          width={358}
          rows={rows}
          renderItem={(_label, active, i) => currencyRow(i, active)}
        />
      </div>
    </SheetBody>
  );
};

// Линии среза вокруг центральной строки — так колонка стоит в барабане времени.
const Lines = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative' }}>
    {children}
    <div style={{ position: 'absolute', left: 2, right: 2, top: ITEM_H, height: 1, backgroundColor: 'rgba(11,18,32,0.12)', pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', left: 2, right: 2, top: ITEM_H * 2 - 1, height: 1, backgroundColor: 'rgba(11,18,32,0.12)', pointerEvents: 'none' }} />
  </div>
);

// Подпись под колонкой — тихий кегль продукта.
const Caption = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 8, fontSize: 13, lineHeight: '18px', color: '#5b6678', textAlign: 'center' }}>{children}</div>
);

const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad2(i * 5));

// Колонка часов: один цикл 00…23, после 23 снова 00 — граница смены
// ставится одним движением в любую сторону.
export const HourColumn = () => {
  const [hour, setHour] = useState(10);
  return (
    <SheetBody>
      <Lines>
        <LoopWheelColumn items={HOURS} value={hour} onChange={setHour} accessibilityLabel="Время записи, часы" />
      </Lines>
      <Caption>часы · после 23 снова 00</Caption>
    </SheetBody>
  );
};

// Колонка минут пятиминутками; активная цифра амбером — «вне рабочих часов».
export const OffHoursMinutes = () => {
  const [idx, setIdx] = useState(6);
  return (
    <SheetBody>
      <Lines>
        <LoopWheelColumn
          items={MINUTES}
          value={idx}
          onChange={setIdx}
          accessibilityLabel="Время записи, минуты"
          activeColor="#955f00"
          accessibilityValueSuffix=", вне рабочих часов"
        />
      </Lines>
      <Caption>минуты по 5 · вне рабочих часов</Caption>
    </SheetBody>
  );
};
