import { ChooseRow, NavRow, SectionCard, SelectRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390 }}>{children}</div>
);
const noop = () => {};

// Блок страницы записи/карточки: шапка капсом внутри белой карточки.
// Пустой блок — одна строка-дверь «Добавить …».
export const EmptyWithDoor = () => (
  <Phone>
    <SectionCard title="Объекты">
      <ChooseRow icon={icons.MapPin} label="Добавить объект" onPress={noop} />
    </SectionCard>
  </Phone>
);

// Выбранное значение — та же строка, что в шторке выбора.
export const WithSelection = () => (
  <Phone>
    <SectionCard title="Категория">
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 12px 12px' }}>
        <SelectRow title="Кондиционеры" icon={icons.Fan} color="#2c5be0" selected onPress={noop} />
      </div>
    </SectionCard>
  </Phone>
);

// Команда в правом краю шапки — значком (здесь — настройки списка).
export const WithHeaderAction = () => (
  <Phone>
    <SectionCard title="Тип события" action={{ label: 'Настроить список', icon: icons.Settings2, onPress: noop }}>
      <NavRow label="Выезд на объект" value="60 мин" onPress={noop} />
    </SectionCard>
  </Phone>
);
