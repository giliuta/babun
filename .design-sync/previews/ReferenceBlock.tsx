import { ReferenceBlock, icons } from '@babun/ui';

// Форма на канве #f4f6f9 (тело листа операции и страница записи — канва,
// блоки — белые карточки на ней).
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '6px 0 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Лист операции: выбранная категория — та же строка, что в шторке выбора:
// квадратная плитка цветом категории и подсветка строки.
export const CategoryChosen = () => (
  <Screen>
    <ReferenceBlock
      dense
      title="Категория"
      emptyIcon={icons.Tag}
      emptyLabel="Выбрать категорию"
      emptyHint="Открывает список категорий"
      value={{ name: 'Топливо', color: '#FF9500', Icon: icons.Fuel }}
      onPress={noop}
    />
  </Screen>
);

// Категория ещё не выбрана — строка-дверь «Выбрать …» (плотная, в листе).
export const CategoryEmpty = () => (
  <Screen>
    <ReferenceBlock
      dense
      title="Категория"
      emptyIcon={icons.Tag}
      emptyLabel="Выбрать категорию"
      emptyHint="Открывает список категорий"
      value={null}
      onPress={noop}
    />
  </Screen>
);

// Страница события: блок «Тип события» дышит вместе с соседями по странице.
export const EventType = () => (
  <Screen>
    <ReferenceBlock
      title="Тип события"
      emptyIcon={icons.Tag}
      emptyLabel="Выбрать тип события"
      emptyHint="Открывает список типов событий"
      value={{ name: 'Встреча', color: '#007AFF', Icon: icons.Briefcase }}
      onPress={noop}
    />
  </Screen>
);

// Форма объекта на странице: тип ещё не выбран — дверь в полный рост
// (кружок 34, больше воздуха, чем у плотной формы в листе).
export const ObjectType = () => (
  <Screen>
    <ReferenceBlock
      title="Тип объекта"
      emptyIcon={icons.Tag}
      emptyLabel="Выбрать тип объекта"
      emptyHint="Открывает список типов объектов"
      value={null}
      onPress={noop}
    />
  </Screen>
);
