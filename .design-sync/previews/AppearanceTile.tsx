import { AppearanceTile, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);

const Caption = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 8, fontSize: 13, lineHeight: '18px', color: '#5b6678', textAlign: 'center', whiteSpace: 'nowrap' }}>
    {children}
  </div>
);

// Строка справочника (категории финансов): плитка 28 слева, имя 16, вся строка
// залита цветом сущности на 8 % — как в Кабинете → «Категории».
const CATEGORIES = [
  { name: 'Топливо', color: '#D97A12', icon: 'car' },
  { name: 'Инструмент', color: '#6B45FB', icon: 'tools' },
  { name: 'Связь и интернет', color: '#17AAC3', icon: 'phone' },
  { name: 'Аренда склада', color: '#B011C6', icon: 'box' },
];

export const ReferenceRows = () => (
  <Phone>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 16px' }}>
      {CATEGORIES.map((c) => (
        <div
          key={c.name}
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 12,
            borderRadius: 10,
            backgroundColor: `${c.color}14`,
          }}
        >
          <AppearanceTile color={c.color} icon={c.icon} size={28} />
          <span style={{ marginLeft: 12, fontSize: 16, color: '#0b1220' }}>{c.name}</span>
        </div>
      ))}
    </div>
  </Phone>
);

// Что умеет плитка — легендой, как её читают в списках: цвет со значком,
// только цвет (метка дня), только значок (цвета у сущности нет), запасной глиф
// (мастер без своего значка) и пустой вид — тихий ярлычок вместо серой дыры.
const KINDS = [
  { title: 'Цвет и значок', hint: 'категория «Кондиционеры»', tile: <AppearanceTile color="#1290CB" icon="fan" /> },
  { title: 'Только цвет', hint: 'метка дня «Лимасол»', tile: <AppearanceTile color="#6B45FB" /> },
  { title: 'Только значок', hint: 'цвет не выбран', tile: <AppearanceTile icon="tools" /> },
  { title: 'Запасной глиф', hint: 'мастер без своего значка', tile: <AppearanceTile color="#8385FC" fallback={icons.UserRound} /> },
  { title: 'Вид не выбран', hint: 'ни цвета, ни значка', tile: <AppearanceTile /> },
];

export const Kinds = () => (
  <Phone>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 16px' }}>
      {KINDS.map((k) => (
        <div key={k.title} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {k.tile}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#0b1220' }}>{k.title}</span>
            <span style={{ fontSize: 13, color: '#5b6678' }}>{k.hint}</span>
          </div>
        </div>
      ))}
    </div>
  </Phone>
);

// Размеры из продукта: 28 — строка списка и поле имени, 30 — тип события,
// 34 — поле «Вид» (по умолчанию).
export const Sizes = () => (
  <Phone>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, padding: '8px 16px' }}>
      {[28, 30, 34].map((size) => (
        <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <AppearanceTile color="#3276FB" icon="card" size={size} />
          <Caption>{size === 28 ? '28 · строка' : size === 30 ? '30 · тип события' : '34 · поле «Вид»'}</Caption>
        </div>
      ))}
    </div>
  </Phone>
);
