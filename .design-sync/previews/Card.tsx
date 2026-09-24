import { Card, Divider, SectionEyebrow, icons } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const SUB = 'rgba(11,18,32,0.74)';
const FAINT = 'rgba(11,18,32,0.64)';

// Экран на канве #f4f6f9 с полями 12 (mx-3), как страницы мастера: белая
// карточка читается только на канве — на белом её тень теряется. Поля
// снимаются (`side={0}`), когда подпись группы стоит на канве своей базовой
// линией: у `SectionEyebrow` она уже своя, 20.
const Screen = ({
  children,
  side = 12,
  top = 12,
}: {
  children: React.ReactNode;
  side?: number;
  top?: number;
}) => (
  <div
    style={{
      width: 390,
      boxSizing: 'border-box',
      background: '#f4f6f9',
      padding: `${top}px ${side}px 16px`,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: SYS,
    }}
  >
    {children}
  </div>
);

// Крупная карточка выручки мастера: тонированная подложка внутри белой карточки.
export const RevenueCard = () => (
  <Screen>
    <Card>
      <div style={{ padding: 16, background: 'rgba(44,91,224,0.08)', borderRadius: 10 }}>
        <div style={{ fontSize: 11, lineHeight: '14px', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: SUB }}>
          Выручка
        </div>
        <div style={{ marginTop: 4, fontSize: 34, lineHeight: '41px', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
          €1 240
        </div>
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: '16px', color: SUB }}>
          средний чек · <span style={{ fontWeight: 700, color: INK }}>€62</span>
        </div>
      </div>
    </Card>
  </Screen>
);

const Stat = ({ value, label, warning }: { value: string; label: string; warning?: boolean }) => (
  <div style={{ width: '48.5%' }}>
    <Card>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 22, lineHeight: '27px', fontWeight: 700, color: warning ? '#955f00' : INK, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, lineHeight: '14px', color: FAINT, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </div>
      </div>
    </Card>
  </div>
);

// Сетка чисел 2×2 — четыре карточки в ряд по две; низкое закрытие янтарём.
export const StatGrid = () => (
  <Screen>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
      <Stat value="48" label="Всего визитов" />
      <Stat value="31" label="Закрыто" />
      <Stat value="3" label="Отменено" />
      <Stat value="65%" label="Закрытие" warning />
    </div>
  </Screen>
);

type Visit = { date: string; time: string; client: string; address: string; status: string; tone: string; total?: string };

const VisitRow = ({ v }: { v: Visit }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', minHeight: 56, boxSizing: 'border-box' }}>
    <div style={{ width: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
      <span style={{ fontSize: 11, lineHeight: '14px', color: FAINT, textTransform: 'uppercase' }}>{v.date}</span>
      <span style={{ marginTop: 1, fontSize: 14, lineHeight: '18px', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
        {v.time}
      </span>
    </div>
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, color: INK }}>{v.client}</span>
      <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <icons.MapPin color={SUB} size={11} strokeWidth={2} />
        <span style={{ fontSize: 12, lineHeight: '16px', color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.address}
        </span>
      </div>
      <span style={{ marginTop: 2, fontSize: 11, lineHeight: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: v.tone }}>
        {v.status}
      </span>
    </div>
    {v.total ? <span style={{ paddingTop: 2, fontSize: 13, lineHeight: '18px', color: SUB }}>{v.total}</span> : null}
  </div>
);

// Лента визитов мастера: подпись группы над карточкой, строки через шов с
// отступом 68. Капс-подпись на канве — `SectionEyebrow`, единственный дом
// этого рецепта; поля карточке даёт своя обёртка, чтобы подпись встала на
// свою базовую линию (20), а карточка — на свою (12).
export const VisitsCard = () => (
  <Screen side={0} top={0}>
    <SectionEyebrow>Сегодня</SectionEyebrow>
    <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column' }}>
      <Card>
        <VisitRow
          v={{ date: '21 сент', time: '09:00', client: 'Павел Иванов', address: 'Вилла 5, Agiou Tychona 5, Limassol', status: 'закрыто', tone: '#087a52', total: '€150' }}
        />
        <Divider inset={68} />
        <VisitRow
          v={{ date: '21 сент', time: '11:30', client: 'Наталья', address: 'Makariou III 12, Limassol', status: 'в работе', tone: '#955f00', total: '€80' }}
        />
        <Divider inset={68} />
        <VisitRow
          v={{ date: '21 сент', time: '15:00', client: 'Иван Петров', address: 'Офис, Limassol Marina', status: 'запланировано', tone: '#2c5be0', total: '€50' }}
        />
      </Card>
    </div>
  </Screen>
);

// Пустая карточка — только слова, без кнопки внутри.
export const EmptyCard = () => (
  <Screen>
    <Card>
      <div style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ marginBottom: 4, fontSize: 15, lineHeight: '20px', fontWeight: 700, color: INK }}>Визитов пока нет</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: FAINT, textAlign: 'center' }}>
          Сюда попадают только записи, назначенные лично на этого мастера.
        </span>
      </div>
    </Card>
  </Screen>
);
