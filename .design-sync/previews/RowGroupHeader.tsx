import { Divider, NavRow, RowGroupBody, RowGroupHeader, SettingsRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Шапка отдельным куском над списком счетов команды (страница «Счета»):
// капс-подпись тише строк, которые она называет.
export const AccountsTeam = () => (
  <Phone>
    <RowGroupHeader title="Команда 1" />
    <RowGroupBody>
      <SettingsRow icon={icons.Banknote} tile="#15A84F" title="Касса" sub="Основной счёт" value="€640" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow icon={icons.CreditCard} tile="#0D77B8" title="Revolut" sub="Карта команды" value="€410" onPress={noop} />
    </RowGroupBody>
  </Phone>
);

// Разрез по командам: риска цветом команды и подытог справа, цифры
// моноширинные — подытоги стоят столбиком.
export const Subtotals = () => (
  <Phone>
    <div style={{ marginTop: 12 }}>
      <RowGroupHeader title="Команда 1" accent="#3276FB" value="€1 050" />
      <RowGroupBody>
        <NavRow label="Павел Иванов" value="€600" onPress={noop} />
        <NavRow label="Наталья · Вилла 5" value="€450" separated onPress={noop} />
      </RowGroupBody>
    </div>
    <div style={{ marginTop: 12 }}>
      <RowGroupHeader title="Команда 2" accent="#15A84F" value="€380" />
      <RowGroupBody>
        <NavRow label="Иван Петров · Вилла 5" value="€380" onPress={noop} />
      </RowGroupBody>
    </div>
  </Phone>
);
