import { SectionEyebrow, ValueOptionList, icons } from '@babun/ui';

// Список вариантов — второй шаг денежного листа (откуда / куда / на какой
// счёт) и тело шторки выбора значения. Ширина — во весь телефон.
const Sheet = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', background: '#ffffff', paddingTop: 8, paddingBottom: 8 }}>
    {children}
  </div>
);
const noop = () => {};

// Перевод, шаг «Откуда»: счёт узнаётся значком и цветом, остаток справа
// моноширинными цифрами. Повторный тап выбор не снимает — без счёта перевода нет.
export const TransferFrom = () => (
  <Sheet>
    <SectionEyebrow>Команда 1</SectionEyebrow>
    <ValueOptionList
      options={[
        { id: 'cash', label: 'Касса', value: '€640', color: '#15A84F', icon: icons.Banknote },
        { id: 'revolut', label: 'Revolut', value: '€1 250', color: '#3276FB', icon: icons.CreditCard },
        { id: 'boc', label: 'Bank of Cyprus', value: '€3 480,50', color: '#0D77B8', icon: icons.Landmark },
      ]}
      selectedId="revolut"
      clearable={false}
      onPick={noop}
    />
  </Sheet>
);

// Категория расхода: только цвет, без значка — строка рисует цветной квадрат
// с кружком. Вторая строка — чем вариант отличается.
export const Categories = () => (
  <Sheet>
    <ValueOptionList
      options={[
        { id: 'fuel', label: 'Топливо', hint: 'Бензин, дизель', color: '#FF9500' },
        { id: 'supplies', label: 'Материалы', hint: 'Фреон, фильтры, трубки', color: '#5856D6' },
        { id: 'rent', label: 'Аренда', color: '#A2845E' },
        { id: 'bank', label: 'Комиссия банка', color: '#8E8E93' },
      ]}
      selectedId="supplies"
      onPick={noop}
    />
  </Sheet>
);

// Приём оплаты по карте: счёт другой команды погашен, а правило под
// списком объясняет почему — исчезнувшая строка читалась бы как «счёт пропал».
export const WithDisabled = () => (
  <Sheet>
    {/* Поле 12 даёт сам денежный лист; правило под списком встаёт на 16. */}
    <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column' }}>
    <ValueOptionList
      options={[
        { id: 'revolut', label: 'Revolut', value: '€1 250' },
        { id: 'boc', label: 'Bank of Cyprus', value: '€3 480,50' },
        { id: 'revolut2', label: 'Revolut Команды 2', value: '€410', disabled: true },
      ]}
      selectedId="revolut"
      clearable={false}
      footer="Счета другой команды принимают оплату только её записей."
      onPick={noop}
    />
    </div>
  </Sheet>
);

// Справочник пуст — слова вместо списка.
export const Empty = () => (
  <Sheet>
    <ValueOptionList options={[]} emptyLabel="Категорий пока нет" onPick={noop} />
  </Sheet>
);
