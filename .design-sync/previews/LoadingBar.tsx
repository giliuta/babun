import { Divider, LoadingBar, ScreenHeader, SectionCard, SettingsRow, icons } from '@babun/ui';

// Полоса живёт СРАЗУ под шапкой экрана: данные уже на экране, работа идёт в
// фоне, и ни одна строка не сдвигается. Двухпунктовая дорожка с бегущим
// кобальтовым отрезком.
const Page = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 20 }}>{children}</div>
);
// «Назад» в дизайне — только своим обработчиком: без него шапка зовёт роутер,
// которого в пакете дизайна нет.
const noop = () => {};

// «О приложении»: проверяем обновление — полоса под шапкой, строка говорит «Проверяем…».
export const UnderHeader = () => (
  <Page>
    <ScreenHeader title="О приложении" onBack={noop} />
    <LoadingBar visible />
    <SectionCard>
      <SettingsRow tile="neutral" icon={icons.Info} title="Версия" sub="1.8.2 · сборка 214" />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={icons.Download} title="Обновление" sub="Проверяем…" />
    </SectionCard>
  </Page>
);

// Компания переключается: полоса идёт, а чужие цифры под ней пригашены.
export const StaleContent = () => (
  <Page>
    <ScreenHeader title="Счета" onBack={noop} />
    <LoadingBar visible />
    <div style={{ opacity: 0.4 }}>
      <SectionCard>
        <SettingsRow tile="#087a52" icon={icons.Wallet} title="Касса" sub="Команда 1" value="€640" />
        <Divider inset={56} />
        <SettingsRow tile="#2c5be0" icon={icons.CreditCard} title="Revolut" sub="Команда 1" value="€1 250" />
      </SectionCard>
    </div>
  </Page>
);
