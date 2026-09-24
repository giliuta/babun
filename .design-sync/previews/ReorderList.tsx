import { ReorderList, SectionEyebrow, SettingsRow, SwipeRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', background: '#f4f6f9', paddingBottom: 16 }}>
    {children}
  </div>
);
// Список стоит с полем страницы 16 — как на всех экранах-справочниках.
const Gutter = ({ children }: { children: React.ReactNode }) => (
  <div style={{ margin: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Строка справочника: залита цветом сущности на 8 %, плитка «Вида» слева,
// ручка из шести точек — внутри строки, справа (`handleInside`).
const TintedRow = ({
  color,
  dimmed,
  handle,
  children,
}: {
  color: string;
  dimmed?: boolean;
  handle: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      background: `${color}14`,
      opacity: dimmed ? 0.45 : 1,
    }}
  >
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    {handle}
  </div>
);

// Прайс команды: каждая услуга — своя карточка с зазором, ручка справа,
// смахивание — «Удалить» справа, «Скрыть» слева. Скрытая услуга стоит тут же,
// только тише живых.
const SERVICES = [
  { id: 'clean', name: 'Чистка кондиционера', sub: '1 ч · цена от количества', price: '€50', color: '#1290CB', icon: 'fan' },
  { id: 'gas', name: 'Заправка фреоном', sub: '45 мин', price: '€70', color: '#159EFC', icon: 'snow' },
  { id: 'check', name: 'Диагностика', sub: '30 мин', price: '€25', color: '#6B45FB', icon: 'temp' },
  { id: 'remove', name: 'Демонтаж', sub: '1 ч 30 мин', price: '€60', color: '#DF510F', icon: 'tools', hidden: true },
];

export const PriceList = () => (
  <Phone>
    <Gutter>
      <ReorderList items={SERVICES} rowHeight={60} spaced handleInside labelFor={(s) => s.name} onReorder={noop}>
        {(s, _index, handle) => (
          <SwipeRow
            label="Удалить"
            color="#c9372c"
            icon={icons.Trash2}
            accessibilityLabel={`Удалить услугу ${s.name} навсегда`}
            onAction={noop}
            leading={{
              label: s.hidden ? 'Показать' : 'Скрыть',
              color: s.hidden ? '#087a52' : '#955f00',
              icon: s.hidden ? icons.RotateCcw : icons.EyeOff,
              onAction: noop,
            }}
          >
            <TintedRow color={s.color} dimmed={s.hidden} handle={handle}>
              <SettingsRow appearance={{ color: s.color, icon: s.icon }} title={s.name} sub={s.sub} value={s.price} />
            </TintedRow>
          </SwipeRow>
        )}
      </ReorderList>
    </Gutter>
  </Phone>
);

// Счета команды: порядок нумеруется внутри своей команды, поэтому у каждой
// группы свой список. Пустая касса печатается тише живых денег.
const ACCOUNTS = [
  { id: 'cash', name: 'Касса', balance: '€640', color: '#15A84F', icon: 'cash' },
  { id: 'revolut', name: 'Revolut', balance: '€1 250', color: '#3276FB', icon: 'card' },
  { id: 'boc', name: 'Bank of Cyprus', balance: '€0', color: '#0D77B8', icon: 'bank', zero: true },
];

export const Accounts = () => (
  <Phone>
    <SectionEyebrow>Команда 1</SectionEyebrow>
    <Gutter>
      <ReorderList items={ACCOUNTS} rowHeight={60} spaced handleInside labelFor={(a) => a.name} onReorder={noop}>
        {(a, _index, handle) => (
          <SwipeRow leading={{ label: 'Скрыть', color: '#955f00', icon: icons.EyeOff, onAction: noop }}>
            <TintedRow color={a.color} handle={handle}>
              <SettingsRow appearance={{ color: a.color, icon: a.icon }} title={a.name} value={a.balance} valueQuiet={a.zero} />
            </TintedRow>
          </SwipeRow>
        )}
      </ReorderList>
    </Gutter>
  </Phone>
);

// Страница-набор «Способы связи»: галка — включённый способ. Выключенные
// падают вниз и ручки не получают: `rangeFor` сводит их место в одну точку,
// двигать их незачем.
const WAYS = [
  { id: 'whatsapp', label: 'WhatsApp', color: '#075e54', icon: icons.MessageCircle, on: true },
  { id: 'telegram', label: 'Telegram', color: '#0b6e99', icon: icons.Send, on: true },
  { id: 'viber', label: 'Viber', color: '#5b2d8e', icon: icons.PhoneCall, on: false },
  { id: 'sms', label: 'SMS', color: '#5b6678', icon: icons.MessageSquare, on: false },
];
const onCount = WAYS.filter((w) => w.on).length;

export const ContactWays = () => (
  <Phone>
    <Gutter>
      <ReorderList
        items={WAYS}
        rowHeight={60}
        spaced
        handleInside
        labelFor={(w) => w.label}
        rangeFor={(index) => (index < onCount ? [0, onCount - 1] : [index, index])}
        onReorder={noop}
      >
        {(w, _index, handle) => (
          // Белую подложку строка кладёт сама: на вебе анимированный стиль
          // строки списка (`backgroundColor: transparent` в покое) перекрывает
          // её поверхность, и без своей заливки строка стоит серой.
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', background: '#ffffff' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <SettingsRow tile={w.color} icon={w.icon} title={w.label} />
            </div>
            {w.on ? <icons.Check color="#2c5be0" size={18} strokeWidth={2.6} /> : null}
            {handle}
          </div>
        )}
      </ReorderList>
    </Gutter>
  </Phone>
);
