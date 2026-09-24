import { OptionSheet } from '@babun/ui';

const noop = () => {};

// Одиночный выбор с галочкой: вторая строка говорит, чем вариант отличается.
// Тап применяет и закрывает — кнопки нет. «Как у компании» стоит последним и
// показывает, ЧТО именно унаследуется. Так выбирают режим VAT команды.
export const VatMode = () => (
  <OptionSheet
    visible
    title="Режим VAT"
    options={[
      { value: 'inclusive', label: 'VAT включён в цену', hint: 'Цена уже содержит налог' },
      { value: 'exclusive', label: 'VAT плюсом к цене', hint: 'Налог добавляется сверху цены' },
      { value: 'off', label: 'Без VAT', hint: 'Клавиш VAT в операциях команды нет' },
      { value: 'inherit', label: 'Как у компании', hint: 'VAT включён в цену' },
    ]}
    value="exclusive"
    onPick={noop}
    onClose={noop}
  />
);

// Короткие варианты без второй строки: буфер после записи в графике команды.
export const WithoutHints = () => (
  <OptionSheet
    visible
    title="Буфер после записи"
    options={[
      { value: '0', label: 'Нет' },
      { value: '5', label: '5 мин' },
      { value: '10', label: '10 мин' },
      { value: '15', label: '15 мин' },
      { value: '30', label: '30 мин' },
      { value: '60', label: '1 час' },
    ]}
    value="15"
    onPick={noop}
    onClose={noop}
  />
);
