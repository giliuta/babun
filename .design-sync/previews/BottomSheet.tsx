import {
  BottomSheet,
  Button,
  NameColorField,
  SelectList,
  SelectRow,
  SelectSearch,
  icons,
} from '@babun/ui';

const noop = () => {};

// Каноническая шторка выбора: шапка пропом → поиск → строки 52pt → одна
// кнопка в футере вне прокрутки. Потолок — полэкрана, дальше список
// прокручивается внутри. Так устроен выбор клиента в записи.
export const ClientPicker = () => (
  <BottomSheet
    visible
    onClose={noop}
    title="Клиент"
    padded={false}
    scroll
    avoidKeyboard
    maxHeightRatio={0.5}
    footer={
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
        <Button label="Создать клиента" onPress={noop} />
      </div>
    }
  >
    <SelectSearch
      value=""
      onChange={noop}
      placeholder="Имя или телефон"
      accessibilityLabel="Поиск клиента"
      autoCapitalize="words"
    />
    <SelectList>
      <SelectRow title="Павел Иванов" subtitle="4 визита · визит 12 сент." hint="+357 99 111222" initial="Павел" onPress={noop} />
      <SelectRow title="Екатерина" subtitle="жена · Павел Иванов" hint="+357 96 555777" initial="Екатерина" onPress={noop} />
      <SelectRow title="Иван Петров" subtitle="жилец · Наталья · Вилла 5" hint="+357 97 333444" initial="Иван" onPress={noop} />
      <SelectRow title="Наталья" subtitle="2 визита · визит 3 сент." hint="+357 99 222333" initial="Наталья" onPress={noop} />
      <SelectRow title="Янис" hint="+357 99 888999" initial="Янис" onPress={noop} />
    </SelectList>
  </BottomSheet>
);

// Шапка с подзаголовком и значком справа: метка дня. Подзаголовок — чей это
// лист (дата), ползунки — дверь в библиотеку меток. Одиночный выбор
// закрывает лист тапом, кнопки в футере нет.
export const DayLabel = () => (
  <BottomSheet
    visible
    onClose={noop}
    title="Метка"
    subtitle="Вт, 23 сентября"
    headerAction={<icons.Settings2 color="rgba(11,18,32,0.74)" size={18} strokeWidth={2} />}
    padded={false}
    scroll
    maxHeightRatio={0.5}
  >
    <SelectList>
      <SelectRow icon={icons.Bookmark} title="Лимассол" color="#3276FB" selected onPress={noop} />
      <SelectRow icon={icons.Bookmark} title="Пафос" color="#15A84F" onPress={noop} />
      <SelectRow icon={icons.Bookmark} title="Ларнака" color="#FDAA1B" onPress={noop} />
      <SelectRow icon={icons.Bookmark} title="Греция" color="#8385FC" onPress={noop} />
    </SelectList>
  </BottomSheet>
);

// Лист-форма: тело с боковыми полями листа (`padded` по умолчанию), одна
// кнопка в футере вне прокрутки. Так заводят метку в её справочнике.
export const Editor = () => (
  <BottomSheet visible onClose={noop} title="Новая метка" avoidKeyboard footer={<Button label="Создать" onPress={noop} />}>
    <NameColorField label="Название" name="Ларнака" onNameChange={noop} color="#FDAA1B" onColorChange={noop} />
    <div style={{ height: 16 }} />
  </BottomSheet>
);
