import { useState } from 'react';
import { ScopeChips } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// Экран телефона: лента сверху, под ней канва #f4f6f9 — видно белую полосу
// ленты и её шов (или его отсутствие на канве).
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 40, display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

const TEAMS = [
  { id: 'k1', name: 'Команда 1', color: '#3276FB' },
  { id: 'k2', name: 'Команда 2', color: '#15A84F' },
  { id: 'k3', name: 'Команда 3', color: '#DF510F' },
];

// Лента календарей под шапкой календаря: выбранная команда залита своим
// цветом, остальные монохромны с точкой цвета.
export const CalendarStrip = () => {
  const [active, setActive] = useState('k1');
  return (
    <Screen>
      <ScopeChips items={TEAMS} activeId={active} onSelect={setActive} />
    </Screen>
  );
};

// Календари другой компании — обводкой: тап по ним уводит в ту компанию.
export const ForeignCompany = () => {
  const [active, setActive] = useState('yd');
  return (
    <Screen>
      <ScopeChips
        items={[
          { id: 'yd', name: 'Y&D', color: '#965CFC' },
          { id: '@giliuta:k1', name: 'Команда 1', color: '#3276FB', outline: true },
          { id: '@giliuta:k2', name: 'Команда 2', color: '#15A84F', outline: true },
        ]}
        activeId={active}
        onSelect={setActive}
      />
    </Screen>
  );
};

// Настройки календаря: справа приколото «Добавить» — кнопка вне прокрутки,
// отбитая волосяной чертой; последний чип уходит под край ленты.
export const WithAddAction = () => {
  const [active, setActive] = useState('k1');
  return (
    <Screen>
      <ScopeChips
        items={TEAMS}
        activeId={active}
        onSelect={setActive}
        trailing={
          <div style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{ fontFamily: SYS, fontSize: 15, lineHeight: '20px', fontWeight: 600, color: '#2c5be0' }}>Добавить</span>
          </div>
        }
      />
    </Screen>
  );
};

// Экран счетов: шапка стоит на канве, и лента тоже — без белой полосы и шва.
export const OnCanvas = () => {
  const [active, setActive] = useState('k2');
  return (
    <Screen>
      <ScopeChips items={TEAMS} activeId={active} onCanvas onSelect={setActive} />
    </Screen>
  );
};

// Календарей больше, чем влезает: лента прокручивается, последний чип
// выглядывает из-за края.
export const ManyCalendars = () => {
  const [active, setActive] = useState('k1');
  return (
    <Screen>
      <ScopeChips
        items={[
          ...TEAMS,
          { id: 'paf', name: 'Пафос выезды', color: '#1290CB' },
          { id: 'office', name: 'Офис', color: '#E8145D' },
        ]}
        activeId={active}
        onSelect={setActive}
      />
    </Screen>
  );
};
