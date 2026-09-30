import { ChooseRow, Halo, SectionCard, SectionEyebrow, SettingsRow, icons } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const BODY = 'rgba(11,18,32,0.86)';
const noop = () => {};

// ОДИН Halo НА ЯЧЕЙКУ: градиент внутри него носит постоянный id, и на вебе
// второй Halo на той же странице ссылался бы на градиент первого.

type Identity = {
  /** Цвет записи. */
  hue: string;
  /** Подмес цвета в канву на 22 % — подложка шапки. */
  headerBg: string;
  /** Тот же цвет на 36 % — нижний шов шапки. */
  headerBorder: string;
  /** rgb для заливки страницы под шапкой. */
  rgb: string;
};

const BLUE: Identity = { hue: '#3276FB', headerBg: '#c9daf9', headerBorder: '#aec8fa', rgb: '50,118,251' };
const ORANGE: Identity = { hue: '#FF9500', headerBg: '#f6e1c2', headerBorder: '#f8d39f', rgb: '255,149,0' };

// Шапка страницы записи: подложка цветом записи, сверху Halo того же цвета,
// «Отмена» · заголовок · образец цвета. Страница под шапкой подсвечена тем же
// цветом и гаснет книзу.
const BookingPage = ({ id, title, children }: { id: Identity; title: string; children: React.ReactNode }) => (
  <div
    style={{
      width: 390,
      paddingBottom: 24,
      display: 'flex',
      flexDirection: 'column',
      background: `linear-gradient(180deg, rgba(${id.rgb},0.20) 0px, rgba(${id.rgb},0.077) 300px, rgba(${id.rgb},0) 560px), #f4f6f9`,
      fontFamily: SYS,
    }}
  >
    <div style={{ position: 'relative', background: id.headerBg, borderBottom: `1px solid ${id.headerBorder}` }}>
      <Halo color={id.hue} intensity={0.16} />
      <div style={{ position: 'relative', height: 48, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
        <span style={{ minWidth: 72, fontSize: 16, lineHeight: '21px', color: BODY }}>Отмена</span>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 16, lineHeight: '21px', fontWeight: 600, color: INK }}>{title}</span>
        <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end', paddingRight: 6 }}>
          <div
            style={{
              width: 28,
              height: 28,
              boxSizing: 'border-box',
              borderRadius: 10,
              background: id.hue,
              border: '2px solid #ffffff',
              boxShadow: `0px 1px 4px ${id.hue}66`,
            }}
          />
        </div>
      </div>
    </div>
    <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column' }}>{children}</div>
  </div>
);

// Новая запись команды «Команда 1»: шапка светится синим цветом записи.
export const BookingHeader = () => (
  <BookingPage id={BLUE} title="Новая запись">
    <SectionCard title="Клиент">
      <ChooseRow icon={icons.User} label="Выбрать клиента" hint="Открывает список клиентов" onPress={noop} />
    </SectionCard>
    <SectionCard title="Объект">
      <ChooseRow icon={icons.MapPin} label="Добавить объект" disabled onPress={noop} />
    </SectionCard>
  </BookingPage>
);

// У записи нет объекта — цвет ситуации (оранжевый) красит шапку, образец и
// подсветку страницы.
export const MissingObject = () => (
  <BookingPage id={ORANGE} title="Запись">
    <SectionCard title="Объект">
      <ChooseRow icon={icons.MapPin} label="Выбрать объект" hint="Открывает объекты клиента" onPress={noop} />
    </SectionCard>
  </BookingPage>
);

// Цвет по умолчанию — кобальтовое свечение сверху (8–12 %): единственный
// декоративный свет «Halo Cobalt», первым ребёнком экрана на канве.
export const DefaultBloom = () => (
  <div style={{ width: 390, position: 'relative', background: '#f4f6f9', paddingBottom: 24, fontFamily: SYS }}>
    <Halo />
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 4px', fontSize: 34, lineHeight: '40px', fontWeight: 800, letterSpacing: -0.6, color: INK }}>
        Кабинет
      </div>
      <SectionEyebrow>Аккаунт</SectionEyebrow>
      <SectionCard>
        <SettingsRow tile="neutral" icon={icons.Shield} title="Вход и безопасность" sub="Пароль, устройства, удаление аккаунта" onPress={noop} />
      </SectionCard>
    </div>
  </div>
);
