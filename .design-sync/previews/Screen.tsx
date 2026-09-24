import {
  Divider,
  EmptyState,
  GradientButton,
  Screen,
  ScreenHeader,
  SectionCard,
  SectionEyebrow,
  SettingsRow,
  Spinner,
  icons,
} from '@babun/ui';

// Экран — канва (#f4f6f9) во всю высоту телефона и безопасные отступы; всё
// остальное кладут внутрь: шапка, блоки, футер с главным действием.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, height: 640, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
// Футер страницы: главное действие внизу во всю ширину, поля 20 / 8 / 10.
const Footer = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 20px 10px' }}>{children}</div>
);
const noop = () => {};

// Страница настроек: шапка с «назад», блоки на канве, капс-заголовки групп.
export const CompanyPage = () => (
  <Phone>
    <Screen>
      <ScreenHeader title="AirFix LTD" onBack={noop} />
      <SectionCard>
        <SettingsRow tile="neutral" icon={icons.ShieldCheck} title="Роль" sub="Владелец" />
      </SectionCard>
      <SectionEyebrow>Календари</SectionEyebrow>
      <SectionCard>
        <SettingsRow swatch="#3276FB" title="Команда 1" sub="Полный доступ" />
        <Divider inset={56} />
        <SettingsRow swatch="#15A84F" title="Команда 2" sub="Полный доступ" />
      </SectionCard>
      <SectionEyebrow>Тариф</SectionEyebrow>
      <SectionCard>
        <SettingsRow tile="neutral" icon={icons.BadgeCheck} title="Тариф" sub="Бета без ограничений" />
      </SectionCard>
    </Screen>
  </Phone>
);

// Пустой справочник: слова по центру, а главное действие — там же, где у
// полного списка, в футере.
export const EmptyWithFooter = () => (
  <Phone>
    <Screen>
      <ScreenHeader title="Метки" subtitle="Команда 1" onBack={noop} />
      <EmptyState fill icon={<icons.Bookmark color="#2c5be0" size={28} />} title="Меток пока нет" />
      <Footer>
        <GradientButton label="Добавить метку" onPress={noop} />
      </Footer>
    </Screen>
  </Phone>
);

// `className` центрирует содержимое: экран проверки доступа до первой строки данных.
export const CenteredLoading = () => (
  <Phone>
    <Screen className="items-center justify-center">
      <Spinner size={28} label="Загрузка карточки клиента" />
    </Screen>
  </Phone>
);
