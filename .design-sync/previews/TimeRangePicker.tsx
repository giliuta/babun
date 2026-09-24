import { useState } from 'react';
import { TimeRangePicker } from '@babun/ui';

// Тело шторки: поля 20, как у шторки времени записи и часов календаря.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 20px 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

type HM = { hour: number; minute: number };

// Пара границ как состояние экрана: каждая половина правится своим патчем.
function useRange(start: HM, end: HM) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  return {
    start: s,
    end: e,
    onChangeStart: (patch: { hour?: number; minute?: number }) => setS((prev) => ({ ...prev, ...patch })),
    onChangeEnd: (patch: { hour?: number; minute?: number }) => setE((prev) => ({ ...prev, ...patch })),
  };
}

// Время записи: сегмент показывает обе границы визита, барабан крутит одну.
// Запись кончается часом суток — 24:00 у неё не бывает.
export const VisitTime = () => {
  const range = useRange({ hour: 10, minute: 0 }, { hour: 12, minute: 0 });
  return (
    <SheetBody>
      <TimeRangePicker {...range} allowEndOfDay={false} />
    </SheetBody>
  );
};

// Часы календаря: окно дня может доходить до конца суток — 24:00.
export const CalendarWindow = () => {
  const range = useRange({ hour: 7, minute: 0 }, { hour: 24, minute: 0 });
  return (
    <SheetBody>
      <TimeRangePicker {...range} />
    </SheetBody>
  );
};

// График команды: половины принадлежат перерыву, ярлыки — свои.
export const BreakLabels = () => {
  const range = useRange({ hour: 13, minute: 0 }, { hour: 14, minute: 0 });
  return (
    <SheetBody>
      <TimeRangePicker {...range} labels={{ start: 'Перерыв с', end: 'Перерыв до' }} allowEndOfDay={false} />
    </SheetBody>
  );
};

// Время операции — момент, а не отрезок: сегмента нет, барабаны те же.
export const SingleSide = () => {
  const range = useRange({ hour: 14, minute: 35 }, { hour: 14, minute: 35 });
  return (
    <SheetBody>
      <TimeRangePicker {...range} singleSide />
    </SheetBody>
  );
};
