import { Divider, NavRow, RowGroupBody, RowGroupHeader, SettingsRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Белое тело карточки без подписи — факты чека в его листе. Сверху
// стеклянная кромка, тень — та же, что у Card.
export const ReceiptFacts = () => (
  <Phone>
    <RowGroupBody>
      <NavRow label="Выдан" value="пн, 21 сентября" />
      <NavRow label="Счёт" value="Касса" separated />
      <NavRow label="Запись" value="пт, 18 сентября, 10:00" separated onPress={noop} />
      <NavRow label="Инвойс" value="Открыть" separated onPress={noop} />
    </RowGroupBody>
  </Phone>
);

// Карточка из кусков: в SectionList шапка, строки и хвост приезжают разными
// слотами. `first`/`last` скругляют её один раз сверху и один раз снизу.
export const SplitPieces = () => (
  <Phone>
    <RowGroupHeader title="Команда 1" />
    <RowGroupBody last={false}>
      <SettingsRow icon={icons.Banknote} tile="#15A84F" title="Касса" sub="Основной счёт" value="€640" onPress={noop} />
    </RowGroupBody>
    <RowGroupBody first={false} last={false}>
      <Divider inset={56} />
      <SettingsRow icon={icons.CreditCard} tile="#0D77B8" title="Revolut" sub="Карта команды" value="€410" onPress={noop} />
    </RowGroupBody>
    <RowGroupBody first={false}>
      <Divider inset={56} />
      <SettingsRow icon={icons.PiggyBank} tile="#965CFC" title="Копилка" sub="На ремонт машины" value="€0" valueQuiet onPress={noop} />
    </RowGroupBody>
  </Phone>
);
