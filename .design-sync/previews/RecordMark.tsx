import { Divider, RecordMark, SectionCard, SectionEyebrow, SettingsRow } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const BODY = 'rgba(11,18,32,0.86)';
const FAINT = 'rgba(11,18,32,0.64)';
const noop = () => {};

// Экран на канве #f4f6f9 — как страница «Запись» в настройках.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 16, display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Две строки блока календаря: имя жирным, время моноширинно.
const BlockText = ({ name, time, cancelled }: { name: string; time: string; cancelled?: boolean }) => (
  <div style={{ display: 'flex', flexDirection: 'column', fontFamily: SYS }}>
    <span
      style={{
        fontSize: 13,
        lineHeight: '17px',
        fontWeight: 700,
        color: INK,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textDecoration: cancelled ? 'line-through' : 'none',
      }}
    >
      {name}
    </span>
    <span style={{ fontSize: 13, lineHeight: '17px', fontWeight: 500, color: BODY, fontVariantNumeric: 'tabular-nums' }}>{time}</span>
  </div>
);

// «Как выглядит» — образец в натуральную величину: та же заливка 18 %, тот же
// кант и радиус, что у блока в сетке календаря.
export const BlockSample = () => (
  <Screen>
    <SectionEyebrow>Как выглядит</SectionEyebrow>
    <div style={{ margin: '0 16px', display: 'flex', flexDirection: 'column' }}>
      <RecordMark hue="#005BD3" full size={62}>
        <BlockText name="Клиент" time="11:30 – 13:00" />
      </RecordMark>
    </div>
  </Screen>
);

// Строки настроек «Чего не хватает»: цвет ситуации — миниатюрой блока 28pt,
// имя цвета словом в подписи. «Не красить» — пустой волосяной контур.
export const SettingsSwatches = () => (
  <Screen>
    <SectionEyebrow>Чего не хватает</SectionEyebrow>
    <SectionCard>
      <SettingsRow swatch={null} title="Нет клиента" sub="Не красить" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow swatch="#D97A12" title="Нет объекта" sub="Медный" onPress={noop} />
      <Divider inset={56} />
      <SettingsRow swatch="#FDAA1B" title="Нет услуг" sub="Янтарный" onPress={noop} />
    </SectionCard>
  </Screen>
);

const Swatch = ({ hue, caption, cancelled }: { hue: string | null; caption: string; cancelled?: boolean }) => (
  <div style={{ width: 78, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <RecordMark hue={hue} cancelled={cancelled} />
    <span style={{ fontFamily: SYS, fontSize: 11, lineHeight: '14px', color: FAINT, textAlign: 'center' }}>{caption}</span>
  </div>
);

// Знак 28pt по палитре: светлые цвета получают затемнённый кант (не ниже
// 3 : 1), отменённая запись теряет цвет и рвёт контур пунктиром.
export const Hues = () => (
  <Screen>
    <SectionCard>
      <div style={{ padding: '16px 8px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 }}>
        <Swatch hue="#3276FB" caption="Синий" />
        <Swatch hue="#15A84F" caption="Изумрудный" />
        <Swatch hue="#DF510F" caption="Морковный" />
        <Swatch hue="#965CFC" caption="Фиалковый" />
        <Swatch hue="#72BFFD" caption="Небесный" />
        <Swatch hue="#FDAA1B" caption="Янтарный" />
        <Swatch hue={null} caption="Не красить" />
        <Swatch hue="#3276FB" caption="Отменена" cancelled />
      </div>
    </SectionCard>
  </Screen>
);

// Обычная и отменённая запись одного цвета рядом: отменённая — серая заливка,
// пунктирный кант, имя зачёркнуто.
export const Cancelled = () => (
  <Screen>
    <div style={{ margin: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <RecordMark hue="#15A84F" full size={62}>
        <BlockText name="Павел Иванов" time="09:00 – 10:30" />
      </RecordMark>
      <RecordMark hue="#15A84F" cancelled full size={62}>
        <BlockText name="Наталья" time="11:30 – 13:00" cancelled />
      </RecordMark>
    </div>
  </Screen>
);
