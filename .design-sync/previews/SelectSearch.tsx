import { SelectList, SelectRow, SelectSearch } from '@babun/ui';

// Поиск стоит в шторке выбора над списком и сам держит поле 16 по краям.
const Sheet = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', background: '#ffffff', paddingTop: 8 }}>
    {children}
  </div>
);
const noop = () => {};

// Шторка только открылась: подсказка называет, что искать.
export const Empty = () => (
  <Sheet>
    <SelectSearch
      value=""
      onChange={noop}
      onClear={noop}
      placeholder="Имя или телефон"
      accessibilityLabel="Поиск клиента"
      autoCapitalize="words"
    />
  </Sheet>
);

// Набрано — справа появляется крестик «Очистить поиск».
export const Typed = () => (
  <Sheet>
    <SelectSearch
      value="чистка"
      onChange={noop}
      onClear={noop}
      placeholder="Название услуги"
      accessibilityLabel="Поиск услуги"
    />
  </Sheet>
);

// Поиск над списком: номер набирают цифрами, строки отвечают сразу.
export const WithResults = () => (
  <Sheet>
    <SelectSearch
      value="+357 99"
      onChange={noop}
      onClear={noop}
      placeholder="Имя или телефон"
      accessibilityLabel="Поиск клиента"
      autoCapitalize="words"
    />
    <SelectList>
      <SelectRow title="Павел Иванов" subtitle="4 визита · визит 12 сент." hint="+357 99 111222" initial="Павел" onPress={noop} />
      <SelectRow title="Янис" hint="+357 99 888999" initial="Янис" onPress={noop} />
    </SelectList>
  </Sheet>
);
