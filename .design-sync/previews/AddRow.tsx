import { AddRow, SectionCard, SectionEyebrow, ValueRow } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Под списком: дописать ещё одну строку того же рода. Линия сверху отделяет
// команду от данных (`separated`), шеврон — дверь, а не «＋».
export const BreaksList = () => (
  <Phone>
    <SectionEyebrow>Перерывы</SectionEyebrow>
    <SectionCard>
      <ValueRow label="Перерыв" value="13:00 – 14:00" onPress={noop} />
      <AddRow label="Добавить перерыв" separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Блок, в котором ещё пусто: строка одна, линии нет (реквизиты клиента).
export const OnlyRow = () => (
  <Phone>
    <SectionCard title="Реквизиты">
      <AddRow label="Добавить" onPress={noop} />
    </SectionCard>
  </Phone>
);

// Форма в шторке: блоки плотнее, строка 46 вместо 52 (файл операции).
export const CompactInSheet = () => (
  <Phone>
    <SectionCard title="Файл" dense>
      <AddRow label="Добавить" compact onPress={noop} />
    </SectionCard>
  </Phone>
);

// Нельзя сейчас: идёт сохранение или нет права менять операцию.
export const Disabled = () => (
  <Phone>
    <SectionCard title="Файл" dense>
      <AddRow label="Добавить" compact disabled onPress={noop} />
    </SectionCard>
  </Phone>
);
