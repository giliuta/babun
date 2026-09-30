import {
  BabunProvider,
  ChooseRow,
  Divider,
  GradientButton,
  NavRow,
  Screen,
  ScreenHeader,
  SectionCard,
  SectionEyebrow,
  SettingsRow,
  icons,
} from '@babun/ui';

// ОБОЛОЧКА КАЖДОГО ДИЗАЙНА: жесты, безопасные отступы, тосты и шторки выбора —
// то же окружение, что у приложения в корне. Внутри — экран: канва, шапка,
// блоки, футер с одним главным действием.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, height: 640, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const Footer = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 20px 10px' }}>{children}</div>
);
const Spacer = () => <div style={{ flex: 1 }} />;
const noop = () => {};

// Канонический каркас страницы-формы: шапка → блоки → футер.
export const AppShell = () => (
  <Phone>
    <BabunProvider>
      <Screen>
        <ScreenHeader title="Новый инвойс" onBack={noop} />
        <SectionCard title="Клиент">
          <ChooseRow icon={icons.User} label="Выбрать клиента" onPress={noop} />
        </SectionCard>
        <SectionCard title="Услуги">
          <NavRow label="Чистка кондиционера" value="€50" onPress={noop} />
          <NavRow separated label="Заправка фреоном R32" value="€80" onPress={noop} />
        </SectionCard>
        <Spacer />
        <Footer>
          <GradientButton label="Выставить инвойс" onPress={noop} />
        </Footer>
      </Screen>
    </BabunProvider>
  </Phone>
);

// Страница настроек раздела (за шестерёнкой «Клиентов»): группы с
// капс-заголовками над карточками, плитки из общего словаря пигментов.
export const SettingsPage = () => (
  <Phone>
    <BabunProvider>
      <Screen>
        <ScreenHeader title="Настройки клиентов" onBack={noop} />
        <SectionEyebrow>Отображение</SectionEyebrow>
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
            sub="WhatsApp · Telegram · SMS"
            onPress={noop}
          />
          <Divider inset={56} />
          <SettingsRow tile="#2c5be0" icon={icons.Navigation} title="Карты для маршрута" sub="Google Карты" onPress={noop} />
        </SectionCard>
        <SectionEyebrow>Справочники</SectionEyebrow>
        <SectionCard>
          <SettingsRow tile="#0E7C86" icon={icons.Home} title="Типы объектов" sub="Вилла, дом, квартира, офис" onPress={noop} />
          <Divider inset={56} />
          <SettingsRow tile="#8E44AD" icon={icons.Tags} title="Теги клиентов" sub="Создано: 4" onPress={noop} />
        </SectionCard>
      </Screen>
    </BabunProvider>
  </Phone>
);
