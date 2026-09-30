import { EmptyState, SelectList, SelectRow, SelectSearch, icons } from '@babun/ui';

// Тело шторки выбора во всю ширину телефона: список сам держит поле 16 и
// зазор 8 между строками — строки стоят отдельными плашками, без волосин.
const Sheet = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', background: '#ffffff', paddingTop: 8 }}>
    {children}
  </div>
);
const noop = () => {};

// Объекты клиента: имя объекта — его тип, вторая строка — куда ехать.
export const Objects = () => (
  <Sheet>
    <SelectList>
      <SelectRow icon={icons.MapPin} title="Вилла 5" subtitle="Agiou Tychona 5, Limassol" selected onPress={noop} />
      <SelectRow icon={icons.MapPin} title="Квартира" subtitle="Makariou III 45, Limassol" onPress={noop} />
      <SelectRow icon={icons.MapPin} title="Офис" subtitle="адрес не указан" onPress={noop} />
    </SelectList>
  </Sheet>
);

// Команда события: «Личное» и команды, у каждой свой цвет — строка залита
// им целиком, выбранная громче своей же краской.
export const Teams = () => (
  <Sheet>
    <SelectList>
      <SelectRow icon={icons.UserRound} title="Личное" color="#2c5be0" onPress={noop} />
      <SelectRow icon={icons.Users} title="Команда 1" color="#3276FB" selected onPress={noop} />
      <SelectRow icon={icons.Users} title="Команда 2" color="#15A84F" onPress={noop} />
      <SelectRow icon={icons.Users} title="Команда 3" color="#DF510F" onPress={noop} />
    </SelectList>
  </Sheet>
);

// Поиск ничего не нашёл: пустое состояние словами, под ним — строка
// создания, повторяющая набранное (так видно, кого именно заведут).
export const WithCreateRow = () => (
  <Sheet>
    <SelectSearch
      value="Андреас"
      onChange={noop}
      onClear={noop}
      placeholder="Имя или телефон"
      accessibilityLabel="Поиск клиента"
    />
    <SelectList>
      <EmptyState title="Клиенты не найдены" />
      <SelectRow icon={icons.UserRound} title="Создать клиента «Андреас»" onPress={noop} />
    </SelectList>
  </Sheet>
);
