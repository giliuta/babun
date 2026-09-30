import { Divider, SectionCard, SectionEyebrow, SettingsRow, icons } from '@babun/ui';

// Экран на канве #f4f6f9: подпись группы стоит НА канве над карточкой,
// базовая линия слева 20.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 16, display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Кабинет: «Этот телефон» и «Аккаунт» — две группы строк-дверей.
export const CabinetGroups = () => (
  <Screen>
    <SectionEyebrow>Этот телефон</SectionEyebrow>
    <SectionCard>
      <SettingsRow tile="#FF9500" icon={icons.Bell} title="Уведомления" sub="Разрешены · 3 напоминания" onPress={noop} />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={icons.RefreshCw} title="Синхронизация" sub="Все изменения на сервере" onPress={noop} />
    </SectionCard>
    <SectionEyebrow>Аккаунт</SectionEyebrow>
    <SectionCard>
      <SettingsRow
        tile="neutral"
        icon={icons.Shield}
        title="Вход и безопасность"
        sub="Пароль, устройства, удаление аккаунта"
        onPress={noop}
      />
    </SectionCard>
  </Screen>
);

// Настройки финансов: «Деньги» и «Документы», у каждой строки подпись с
// текущим значением.
export const FinanceSettings = () => (
  <Screen>
    <SectionEyebrow>Деньги</SectionEyebrow>
    <SectionCard>
      <SettingsRow tile="#2c5be0" icon={icons.Wallet} title="Счета" sub="4 счёта · закрытых 1" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow
        tile="#8E44AD"
        icon={icons.Tags}
        title="Категории операций"
        sub="На что уходят и откуда приходят деньги"
        onPress={noop}
      />
      <Divider inset={56} />
      <SettingsRow tile="#0E7C86" icon={icons.Receipt} title="Шаблоны операций" sub="Повторяющиеся расходы в один тап" onPress={noop} />
    </SectionCard>
    <SectionEyebrow>Документы</SectionEyebrow>
    <SectionCard>
      <SettingsRow tile="#C0392B" icon={icons.Percent} title="VAT" sub="VAT включён в цену · 19%" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow
        tile="#2c5be0"
        icon={icons.FileText}
        title="Счета клиентам"
        sub="INV-017 · услуги строками · срок 14 дн."
        onPress={noop}
      />
    </SectionCard>
  </Screen>
);

// Мои компании: приглашения со счётчиком и компании, где человек состоит.
export const MyCompanies = () => (
  <Screen>
    <SectionEyebrow>Мои компании</SectionEyebrow>
    <SectionCard>
      <SettingsRow tile="#1F7A44" icon={icons.Mail} title="Приглашения" sub="Ждут ответа" value="1" valueColor="#c9372c" onPress={noop} />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={icons.Building2} title="AirFix LTD" sub="Сейчас здесь · Владелец · 2 календаря" onPress={noop} />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={icons.Building2} title="Giliuta" sub="Бригадир / мастер · 1 календарь" onPress={noop} />
    </SectionCard>
  </Screen>
);
