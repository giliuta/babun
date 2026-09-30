import { DateWheelSheet } from '@babun/ui';

const noop = () => {};

// Дата из строки страницы: лист снизу, выбор даты, «Применить». Значение
// применяется кнопкой, а не на каждый поворот. Необязательную дату можно
// убрать — красная строка под кнопкой. На вебе вместо барабана — системный
// выбор даты браузера.
export const Birthday = () => (
  <DateWheelSheet
    visible
    title="День рождения"
    value="1987-03-14"
    seed="1990-01-01"
    clearLabel="Убрать дату"
    onApply={noop}
    onClear={noop}
    onClose={noop}
  />
);

// Обязательная дата: убрать нечего, под кнопкой пусто.
export const SpecialDay = () => (
  <DateWheelSheet visible title="Дата особого дня" value="2026-12-31" onApply={noop} onClose={noop} />
);
