import { useState } from 'react';
import { DateTimeInput } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// Веб-двойник нативного пикера: браузерный <input type="date|time"> с тем же
// контрактом пропов (value/mode/minuteInterval/minimumDate/maximumDate/onChange).
// Вид самого выбора (формат даты, календарь, часы) задаёт браузер.
const SheetBody = ({ children, side = 16 }: { children: React.ReactNode; side?: number }) => (
  <div style={{ width: 390, padding: `8px ${side}px 12px`, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {children}
  </div>
);

const TODAY = new Date(2026, 8, 21);
const longDate = (d: Date) =>
  d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

// Строка на подложке, как в шторке оплаты инвойса: слева что это и значение
// словами, справа сам ввод.
const InputRow = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div
    style={{
      minHeight: 52,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderRadius: 10,
      backgroundColor: '#eef1f5',
      fontFamily: SYS,
    }}
  >
    <div style={{ flex: 1, paddingRight: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#0b1220' }}>{title}</div>
      <div style={{ marginTop: 2, fontSize: 12, color: 'rgba(11,18,32,0.74)' }}>{sub}</div>
    </div>
    {children}
  </div>
);

// ЭТОТ БЛОК ЖИВЁТ ТОЛЬКО СТРОКОЙ. Выбор даты в шторке — три барабана
// («день · месяц · год», `DateWheelSheet`), и на вебе тоже: поле браузера
// оттуда ушло. Осталось то, что правдой и было: ввод в хвосте строки, где
// значение — не текст и тап по нему открывает не клавиатуру, а сам выбор.

// Шторка «Оплата инвойса»: дата платежа в строке, будущее закрыто
// (maximumDate = сегодня).
export const PaymentDate = () => {
  const [date, setDate] = useState(TODAY);
  return (
    <SheetBody>
      <InputRow title="Дата платежа" sub={longDate(date)}>
        <DateTimeInput
          value={date}
          mode="date"
          maximumDate={TODAY}
          accessibilityLabel="Дата платежа"
          onChange={(_, next) => next && setDate(next)}
        />
      </InputRow>
    </SheetBody>
  );
};

// Дату и время продукт спрашивает двумя строками: mode="date" и mode="time"
// (шаг минут — пятиминутка, как у барабанов).
export const DateAndTimeRows = () => {
  const [at, setAt] = useState(new Date(2026, 8, 21, 14, 35));
  return (
    <SheetBody>
      <InputRow title="Дата операции" sub={longDate(at)}>
        <DateTimeInput value={at} mode="date" maximumDate={TODAY} accessibilityLabel="Дата операции" onChange={(_, next) => next && setAt(next)} />
      </InputRow>
      <InputRow title="Время" sub="шаг 5 минут">
        <DateTimeInput value={at} mode="time" minuteInterval={5} accessibilityLabel="Время операции" onChange={(_, next) => next && setAt(next)} />
      </InputRow>
    </SheetBody>
  );
};

// Выключенный ввод: платёж уже проведён, дата видна, но не правится.
export const Disabled = () => (
  <SheetBody>
    <InputRow title="Дата платежа" sub="Платёж проведён">
      <DateTimeInput value={new Date(2026, 8, 12)} mode="date" disabled accessibilityLabel="Дата платежа" />
    </InputRow>
  </SheetBody>
);
