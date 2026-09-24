import { Divider, NavRow, RowGroup, SettingsRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// История клиента: капс-подпись НАД карточкой, группы идут друг за другом.
export const History = () => (
  <Phone>
    <RowGroup title="Впереди">
      <NavRow label="28 сен · 10:00" value="Установка · €250" valueColor="rgba(11,18,32,0.74)" onPress={noop} />
    </RowGroup>
    <RowGroup title="2026">
      <NavRow label="14 апр · 09:30" value="Заправка фреоном · €80" valueColor="rgba(11,18,32,0.74)" onPress={noop} />
      <NavRow label="2 мар · 11:00" value="Диагностика · долг €30" valueColor="#955f00" separated onPress={noop} />
    </RowGroup>
  </Phone>
);

// Безымянная группа: строки говорят сами за себя.
export const Nameless = () => (
  <Phone>
    <RowGroup>
      <NavRow label="Записать" onPress={noop} />
      <NavRow label="Чат" separated onPress={noop} />
    </RowGroup>
  </Phone>
);

// Финансовая секция: риска цветом команды, подытог справа, пояснение под
// карточкой.
export const Subtotal = () => (
  <Phone>
    <RowGroup
      title="Команда 1"
      accent="#3276FB"
      value="€1 050"
      footer="Наличными €640 · На картах €410"
    >
      <NavRow label="Павел Иванов" value="€600" onPress={noop} />
      <NavRow label="Наталья · Вилла 5" value="€450" separated onPress={noop} />
    </RowGroup>
  </Phone>
);

// Пояснение под списком без заголовка — закрытые счета.
export const WithFooter = () => (
  <Phone>
    <RowGroup footer="Закрытый счёт не входит ни в один итог и не предлагается при приёме денег. История операций у него сохраняется.">
      <SettingsRow
        icon={icons.Banknote}
        tile="#DF510F"
        title="Касса Команды 2"
        sub="Команда 2"
        value="€410"
        valueColor="#955f00"
        onPress={noop}
      />
      <Divider inset={48} />
      <SettingsRow
        icon={icons.CreditCard}
        title="Revolut Юры"
        sub="Без команды"
        value="Закрыт"
        valueColor="rgba(11,18,32,0.64)"
        onPress={noop}
      />
    </RowGroup>
  </Phone>
);
