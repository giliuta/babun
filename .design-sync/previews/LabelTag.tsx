import { LabelTag } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const FAINT = 'rgba(11,18,32,0.64)';
const ACCENT = '#2c5be0';
const DANGER = '#c9372c';

// МЕТКА ДНЯ — ПРОИЗВОЛЬНОЕ СЛОВО, которым бизнес помечает день в календаре:
// маршрут, вид работ, куда едут, кто выходит. Город — лишь один из способов
// ею воспользоваться, а не смысл поля: в метке стоит что угодно.
const TRIP = { name: 'Лимассол', color: '#1290CB' }; // маршрут дня
const INSTALL = { name: 'Монтаж', color: '#15A84F' }; // вид работ
const SERVICE = { name: 'Обслуживание', color: '#DF510F' };
const DEPOT = { name: 'Склад', color: '#B011C6' }; // день на базе, без выездов

type Day = {
  dow: string;
  date: number;
  label?: { name: string; color: string };
  off?: boolean;
  weekend?: boolean;
  today?: boolean;
  count?: number;
};

// Ячейка недельной шапки: ДН, крупное число, слот корешка фиксированной высоты
// (под числом до четырёх букв метки), в углу — число записей.
const DateCellSm = ({ d }: { d: Day }) => {
  const tone = d.today ? ACCENT : d.weekend ? DANGER : undefined;
  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3px 0' }}>
      <span style={{ height: 13, fontSize: 10, lineHeight: '13px', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: tone ?? FAINT }}>
        {d.dow}
      </span>
      <span style={{ height: 27, fontSize: 22, lineHeight: '27px', fontWeight: 700, color: tone ?? INK, fontVariantNumeric: 'tabular-nums' }}>
        {d.date}
      </span>
      <div style={{ height: 15, display: 'flex', alignItems: 'center' }}>
        {d.off ? <LabelTag color={DANGER} text="Вых" /> : d.label ? <LabelTag color={d.label.color} text={d.label.name.slice(0, 4)} /> : null}
      </div>
      {d.count ? (
        <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 10, lineHeight: '12px', fontWeight: 600, color: d.today ? ACCENT : FAINT, fontVariantNumeric: 'tabular-nums' }}>
          {d.count}
        </span>
      ) : null}
    </div>
  );
};

// Шапка недели календаря: метка дня корешком под числом, выходной — красным
// словом на месте метки. Слева пустая колонка часов (48).
export const WeekHeader = () => (
  <div style={{ width: 390, display: 'flex', background: '#ffffff', borderBottom: '1px solid rgba(11,18,32,0.10)', fontFamily: SYS }}>
    <div style={{ width: 48 }} />
    <div style={{ flex: 1, height: 64, display: 'flex' }}>
      <DateCellSm d={{ dow: 'пн', date: 21, label: TRIP, today: true, count: 3 }} />
      <DateCellSm d={{ dow: 'вт', date: 22, label: TRIP, count: 2 }} />
      <DateCellSm d={{ dow: 'ср', date: 23, label: INSTALL, count: 4 }} />
      <DateCellSm d={{ dow: 'чт', date: 24 }} />
      <DateCellSm d={{ dow: 'пт', date: 25, label: DEPOT, count: 1 }} />
      <DateCellSm d={{ dow: 'сб', date: 26, off: true, weekend: true }} />
      <DateCellSm d={{ dow: 'вс', date: 27, off: true, weekend: true }} />
    </div>
  </div>
);

const DateCellLg = ({ dow, date, tone, children }: { dow: string; date: number; tone?: string; children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', background: '#ffffff', borderBottom: '1px solid rgba(11,18,32,0.10)', fontFamily: SYS }}>
    <div style={{ width: 48 }} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3px 0 5px' }}>
      <span style={{ height: 14, fontSize: 11, lineHeight: '14px', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: tone ?? FAINT }}>
        {dow}
      </span>
      <span style={{ height: 28, fontSize: 24, lineHeight: '28px', fontWeight: 700, color: tone ?? INK, fontVariantNumeric: 'tabular-nums' }}>
        {date}
      </span>
      <div style={{ height: 16, display: 'flex', alignItems: 'center' }}>{children}</div>
    </div>
  </div>
);

// Шапка дня: то же устройство крупнее, корешок с полным словом метки —
// маршрут, вид работ или что угодно ещё. Сегодня — кобальтом; у выходного на
// месте метки красное «Выходной».
export const DayHeader = () => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <DateCellLg dow="пн" date={21} tone={ACCENT}>
      <LabelTag color={TRIP.color} text={TRIP.name} lg />
    </DateCellLg>
    <DateCellLg dow="ср" date={23}>
      <LabelTag color={SERVICE.color} text={SERVICE.name} lg />
    </DateCellLg>
    <DateCellLg dow="сб" date={26} tone={DANGER}>
      <LabelTag color={DANGER} text="Выходной" lg />
    </DateCellLg>
  </div>
);

// Два размера: `lg` — слово метки целиком (шапка дня), обычный — первые
// четыре буквы под числом недели. Выходной — тем же корешком, красным.
export const Sizes = () => (
  <div style={{ width: 390, boxSizing: 'border-box', background: '#ffffff', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <LabelTag color={TRIP.color} text={TRIP.name} lg />
      <LabelTag color={INSTALL.color} text={INSTALL.name} lg />
      <LabelTag color={SERVICE.color} text={SERVICE.name} lg />
      <LabelTag color={DANGER} text="Выходной" lg />
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <LabelTag color={TRIP.color} text="Лима" />
      <LabelTag color={INSTALL.color} text="Монт" />
      <LabelTag color={SERVICE.color} text="Обсл" />
      <LabelTag color={DANGER} text="Вых" />
    </div>
  </div>
);

// Бледные цвета меток: форму держит контур, буквы остаются чернилами —
// корешок виден на белой шапке при любой светлоте цвета. Слова здесь такие
// же произвольные, как у любой метки дня.
export const PaleHues = () => (
  <div style={{ width: 390, boxSizing: 'border-box', background: '#ffffff', padding: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
    <LabelTag color="#D5A7FD" text="Стажёр" lg />
    <LabelTag color="#B9CB1B" text={DEPOT.name} lg />
    <LabelTag color="#FD98AC" text="Обучение" lg />
    <LabelTag color="#72BFFD" text="Ремонт" lg />
    <LabelTag color="#FDAA1B" text="Приёмка" lg />
  </div>
);
