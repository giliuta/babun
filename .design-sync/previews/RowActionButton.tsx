import { FieldRow, RowActionButton, RowGroup, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Шапка карточки клиента: у номера в хвосте — звонок. Тап звонит, удержание
// открывает способы связи. Кружок 32, акцентом.
export const CallButton = () => (
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
        trailing={
          <RowActionButton
            icon={icons.Phone}
            color="#2c5be0"
            label="Позвонить · основной"
            hint="Удерживайте, чтобы выбрать способ связи"
            onPress={noop}
            onLongPress={noop}
          />
        }
      />
    </RowGroup>
  </Phone>
);

// Мессенджеры и почта у тех же номеров: кнопка открывает переписку, цвет —
// цвет канала (подложка — он же на 10 %).
export const Messengers = () => (
  <Phone>
    <RowGroup>
      <FieldRow
        label="Telegram"
        stacked
        compact
        autoCapitalize="none"
        value="@pavel_ivanov"
        placeholder="Логин Telegram"
        onSave={noop}
        trailing={<RowActionButton icon={icons.Send} color="#0b6e99" label="Telegram · открыть" onPress={noop} />}
      />
      <FieldRow
        label="WhatsApp"
        stacked
        compact
        separated
        tabular
        keyboardType="phone-pad"
        value="+357 96 555777"
        placeholder="Номер WhatsApp"
        onSave={noop}
        trailing={
          <RowActionButton icon={icons.MessageCircle} color="#075e54" label="WhatsApp · открыть" onPress={noop} />
        }
      />
      <FieldRow
        label="Instagram"
        stacked
        compact
        separated
        autoCapitalize="none"
        value="@pavel.ivanov.cy"
        placeholder="Логин Instagram"
        onSave={noop}
        trailing={<RowActionButton icon={icons.Instagram} color="#b91c5c" label="Instagram · открыть" onPress={noop} />}
      />
      <FieldRow
        label="Почта"
        stacked
        compact
        separated
        keyboardType="email-address"
        autoCapitalize="none"
        value="pavel.ivanov@gmail.com"
        placeholder="Почта"
        onSave={noop}
        trailing={<RowActionButton icon={icons.Mail} color="#5b6678" label="Почта · открыть" onPress={noop} />}
      />
    </RowGroup>
  </Phone>
);
