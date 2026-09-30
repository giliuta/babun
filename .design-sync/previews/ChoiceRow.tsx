import { ChoiceRow, FieldRow, RowGroup } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Запасной набор, когда бизнес не завёл своих меток места (три слова).
const DEFAULT_LABELS = ['Дом', 'Квартира', 'Офис'] as const;

// ЛЕНТА ЖИВЁТ В ПРОДУКТЕ РОВНО ОДИН РАЗ — на публичной странице по ссылке
// «Куда приехать мастеру?». Её заполняет САМ КЛИЕНТ, а не сотрудник: адрес
// строкой, под ним одним тапом — чем это место является. Тип объекта внутри
// приложения сюда не относится: его выбирают шторкой из справочника.
//
// Ярлыка у строки нет: вопрос ясен по месту, и второй капс под капсом группы
// читался бы как раздел внутри самого себя. Шестерёнки нет тем более —
// справочник меток принадлежит бизнесу, а страницу открывает его клиент.
export const AddressLabel = () => (
  <Phone>
    <RowGroup>
      <FieldRow
        label="Адрес"
        hideLabel
        big
        stacked
        multiline
        live
        value="Agiou Tychona 5, Limassol"
        placeholder="Улица и дом или ссылка на карту"
        onSave={noop}
      />
      <ChoiceRow separated options={DEFAULT_LABELS} value="Дом" onSelect={noop} />
    </RowGroup>
  </Phone>
);

// Метки приходят с сервера списком самого бизнеса, и он бывает длиннее трёх
// запасных слов: лента переносится на вторую строку. Перенос идёт с
// rowGap 14 — у чипа вертикальный hitSlop 6, и при меньшем зазоре тап по
// нижней кромке попадал бы в чип строкой ниже.
export const OwnLabels = () => (
  <Phone>
    <RowGroup>
      <ChoiceRow
        options={['Дом', 'Квартира', 'Офис', 'Склад', 'Магазин', 'Ресторан']}
        value="Склад"
        onSelect={noop}
      />
    </RowGroup>
  </Phone>
);
