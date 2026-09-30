import { FieldRow, RowGroup, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390 }}>{children}</div>
);
const noop = () => {};

// Шапка карточки клиента: имя и номер одной плотной ячейкой, без подписей.
export const ClientIdentity = () => (
  <Phone>
    <RowGroup>
      <FieldRow
        label="Имя"
        hideLabel
        compact
        big
        stacked
        value="Павел Иванов"
        placeholder="Имя или компания"
        onSave={noop}
      />
      <FieldRow
        label=""
        hideLabel
        compact
        big
        stacked
        tabular
        keyboardType="phone-pad"
        value="+357 99 111222"
        placeholder="Телефон"
        onSave={noop}
      />
    </RowGroup>
  </Phone>
);

// Ярлык слева, значение справа — короткие значения настроек. Длинный текст
// (адрес, юр. имя) идёт в `stacked`: в браузере поле справа наезжало бы на ярлык.
export const LabeledRows = () => (
  <Phone>
    <RowGroup title="Нумерация инвойсов">
      <FieldRow label="Префикс" value="INV" placeholder="Префикс" onSave={noop} />
      <FieldRow label="Следующий номер" separated tabular keyboardType="decimal-pad" value="015" placeholder="Номер" onSave={noop} />
      <FieldRow label="Ставка VAT, %" separated tabular keyboardType="decimal-pad" value="19" placeholder="Ставка" onSave={noop} />
    </RowGroup>
  </Phone>
);

// Ярлык сверху мелким капсом, значение слева — так набирают длинный текст.
export const Stacked = () => (
  <Phone>
    <RowGroup>
      <FieldRow
        label="Почта"
        stacked
        keyboardType="email-address"
        autoCapitalize="none"
        value="pavel.ivanov@gmail.com"
        placeholder="Почта"
        onSave={noop}
      />
      <FieldRow label="Город" stacked separated value="Limassol" placeholder="Город" onSave={noop} />
    </RowGroup>
  </Phone>
);

// Хвост строки — своя кнопка (здесь — открыть переписку).
export const WithTrailing = () => (
  <Phone>
    <RowGroup>
      <FieldRow
        label="Telegram"
        stacked
        autoCapitalize="none"
        value="@pavel_ivanov"
        placeholder="Логин Telegram"
        onSave={noop}
        trailing={<icons.Send color="#2c5be0" size={18} />}
      />
    </RowGroup>
  </Phone>
);
