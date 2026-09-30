import { Divider, RowGroup, SectionCard, SectionEyebrow, SettingsRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Настройки клиентов: цветная плитка — навигационный якорь, подпись под
// названием — ТЕКУЩЕЕ значение настройки.
export const ClientsSettings = () => (
  <Phone>
    <SectionCard>
      <SettingsRow
        tile="#2c5be0"
        icon={icons.Eye}
        title="Что показывать на карточке"
        sub="Имя · телефон · долг · посл. запись"
        onPress={noop}
      />
      <Divider inset={56} />
      <SettingsRow
        tile="#1F7A44"
        icon={icons.MessageCircle}
        title="Способы связи"
        sub="Звонок · WhatsApp · Telegram"
        onPress={noop}
      />
      <Divider inset={56} />
      <SettingsRow
        tile="#8E44AD"
        icon={icons.Tags}
        title="Теги клиентов"
        sub="Создано: 4"
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);

// Нейтральная плитка — голый глиф чернилами, без диска (Кабинет, пояс, валюта).
export const NeutralGlyph = () => (
  <Phone>
    <SectionEyebrow>Аккаунт</SectionEyebrow>
    <SectionCard>
      <SettingsRow
        tile="neutral"
        icon={icons.Shield}
        title="Вход и безопасность"
        sub="Пароль, устройства, удаление аккаунта"
        onPress={noop}
      />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={icons.Info} title="О приложении" sub="1.0.0 · сборка 212" onPress={noop} />
    </SectionCard>
  </Phone>
);

// Состояние, которое просит действия: подпись янтарём (`subColor`), число
// справа своим цветом (`valueColor`).
export const PhoneStatus = () => (
  <Phone>
    <SectionEyebrow>Этот телефон</SectionEyebrow>
    <SectionCard>
      <SettingsRow
        tile="#FF9500"
        icon={icons.Bell}
        title="Уведомления"
        sub="Выключены · 3 напоминания"
        subColor="#955f00"
        onPress={noop}
      />
      <Divider inset={48} />
      <SettingsRow
        tile="neutral"
        icon={icons.RefreshCw}
        title="Синхронизация"
        sub="Ждут отправки"
        value="2"
        valueColor="#955f00"
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);

// Деньги справа: остаток — число, ради которого строку читают. Закрытый счёт
// с остатком — янтарём, пустой — тихим словом.
export const ClosedAccounts = () => (
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

// Цвет календаря вместо плитки (`swatch`) — миниатюра блока записи. Без
// `onPress` строка — заглушка: без шеврона и без нажатия. Права у человека в
// каждом календаре свои.
export const TeamCalendars = () => (
  <Phone>
    <SectionEyebrow>Календари</SectionEyebrow>
    <SectionCard>
      <SettingsRow swatch="#3276FB" title="Команда 1" sub="Просмотр · запись · клиенты · телефоны" />
      <Divider inset={56} />
      <SettingsRow swatch="#15A84F" title="Команда 2" sub="Просмотр" />
    </SectionCard>
  </Phone>
);
