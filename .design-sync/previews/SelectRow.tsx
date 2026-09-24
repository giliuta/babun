import { SelectList, SelectRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390 }}>{children}</div>
);
const noop = () => {};

// Шторка выбора клиента: круглый аватар с буквой, вторая строка — чей человек.
export const Clients = () => (
  <Phone>
    <SelectList>
      <SelectRow title="Екатерина" subtitle="жена · Павел Иванов" hint="+357 96 555777" initial="Екатерина" onPress={noop} />
      <SelectRow
        title="Иван Петров"
        subtitle="жилец · Наталья · Вилла 5"
        hint="+357 97 333444"
        initial="Иван"
        selected
        onPress={noop}
      />
      <SelectRow title="Янис" hint="+357 99 888999" initial="Янис" onPress={noop} />
    </SelectList>
  </Phone>
);

// Справочник со значками и цветом сущности: категории, счета, типы событий.
export const Categories = () => (
  <Phone>
    <SelectList>
      <SelectRow title="Кондиционеры" icon={icons.Fan} color="#2c5be0" value="€180" onPress={noop} />
      <SelectRow title="Бензин" icon={icons.Fuel} color="#9a6400" selected value="€60" onPress={noop} />
      <SelectRow title="Инструменты" icon={icons.Hammer} color="#087a52" onPress={noop} />
    </SelectList>
  </Phone>
);

// Строка есть, но выбрать нельзя (счёт чужой команды).
export const Disabled = () => (
  <Phone>
    <SelectList>
      <SelectRow title="Касса Команды 3" icon={icons.Wallet} color="#66707e" disabled hint="другая команда" onPress={noop} />
    </SelectList>
  </Phone>
);
