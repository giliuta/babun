import { ValuePickerSheet, icons } from '@babun/ui';

const noop = () => {};

// Категория расхода: одно значение из длинного справочника. Строка залита
// цветом категории, выбранная — громче и с галкой. Ползунки в шапке — дверь
// на страницу категорий, когда нужной строки нет.
export const Category = () => (
  <ValuePickerSheet
    visible
    title="Категория"
    options={[
      { id: 'fuel', label: 'Топливо', color: '#FF9500', icon: icons.Fuel },
      { id: 'supplies', label: 'Материалы', hint: 'Фреон, фильтры, трубки', color: '#5856D6', icon: icons.Package },
      { id: 'tools', label: 'Инструмент', color: '#15A84F', icon: icons.Wrench },
      { id: 'vehicle', label: 'Машина и ремонт', color: '#DF510F', icon: icons.Car },
      { id: 'rent', label: 'Аренда', color: '#A2845E', icon: icons.Building2 },
      { id: 'comms', label: 'Связь и интернет', color: '#32ADE6', icon: icons.Smartphone },
    ]}
    selectedId="supplies"
    onPick={noop}
    onSettings={noop}
    settingsLabel="Категории"
    onClose={noop}
  />
);

// Счёт: остаток справа — ради него счёт и выбирают. Моноширинные цифры
// стоят колонкой.
export const WithBalances = () => (
  <ValuePickerSheet
    visible
    title="Счёт"
    options={[
      { id: 'cash', label: 'Касса', value: '€640', color: '#15A84F', icon: icons.Banknote },
      { id: 'revolut', label: 'Revolut', value: '€1 250', color: '#3276FB', icon: icons.CreditCard },
      { id: 'boc', label: 'Bank of Cyprus', value: '€3 480,50', color: '#0D77B8', icon: icons.Landmark },
    ]}
    selectedId="cash"
    onPick={noop}
    onClose={noop}
  />
);
