import { Divider, SectionCard, SectionEyebrow, SettingsRow, icons } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';

// Экран на канве #f4f6f9 — белые карточки со швами между строками.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '4px 0 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Строка «ярлык — значение» документа (как на странице инвойса).
const InfoRow = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
      padding: '12px 16px',
      boxSizing: 'border-box',
      fontFamily: SYS,
    }}
  >
    <span style={{ fontSize: 16, lineHeight: '22px', color: INK }}>{label}</span>
    <span
      style={{
        marginLeft: 12,
        fontSize: strong ? 18 : 16,
        lineHeight: strong ? '24px' : '22px',
        fontWeight: strong ? 700 : 400,
        color: INK,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </span>
  </div>
);

// Шов начинается там, где начинается текст строки: после цветной плитки — 56.
export const TileRows = () => (
  <Screen>
    <SectionEyebrow>Справочники</SectionEyebrow>
    <SectionCard>
      <SettingsRow tile="#0E7C86" icon={icons.House} title="Типы объектов" sub="Вилла, дом, квартира, офис" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow tile="#8E44AD" icon={icons.Tags} title="Теги клиентов" sub="VIP, Постоянный, По рекомендации" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow tile="#1F7A44" icon={icons.MessageCircle} title="Способы связи" sub="WhatsApp, Telegram, звонок" onPress={noop} />
    </SectionCard>
  </Screen>
);

// Текстовые строки без плитки — шов с отступом гуттера 16.
export const InvoiceDocument = () => (
  <Screen>
    <SectionCard title="Документ">
      <InfoRow label="Выставлен" value="21 сентября 2026 г." />
      <Divider inset={16} />
      <InfoRow label="Оплатить до" value="5 октября 2026 г." />
      <Divider inset={16} />
      <InfoRow label="Валюта" value="EUR" />
    </SectionCard>
  </Screen>
);

// `strong` — черта подведения итога: над суммой к оплате, плотнее обычного шва.
export const SumLine = () => (
  <Screen>
    <SectionCard title="Итого">
      <InfoRow label="Без VAT" value="€150" />
      <Divider inset={16} />
      <InfoRow label="VAT 19%" value="€28,50" />
      <Divider inset={16} strong />
      <InfoRow label="К оплате" value="€178,50" strong />
    </SectionCard>
  </Screen>
);
