import { ChooseRow, IconCircle, SectionCard, icons } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#0b1220';
const SUB = 'rgba(11,18,32,0.74)';
const FAINT = 'rgba(11,18,32,0.64)';
const noop = () => {};

// Экран на канве #f4f6f9.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '4px 0 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Строка «Ждём адрес от клиента» в блоке объектов: кружок со значком ссылки
// отличает её от заведённого адреса, справа — кружок меню «…».
export const AddressRequest = () => (
  <Screen>
    <SectionCard title="Объекты">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '10px 12px 10px 16px', boxSizing: 'border-box' }}>
        <IconCircle icon={icons.Link2} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', fontFamily: SYS }}>
          <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: INK }}>Ждём адрес от клиента</span>
          <span style={{ fontSize: 13, lineHeight: '18px', color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Ссылка отправлена 19 сент · до 26 сент
          </span>
        </div>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            background: 'rgba(11,18,32,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <icons.MoreHorizontal color="rgba(11,18,32,0.86)" size={18} />
        </div>
      </div>
    </SectionCard>
  </Screen>
);

// Двери страницы записи: открытая — кружок в акценте; закрытая (объект ждёт
// клиента) — кружок и глиф гаснут вместе с подписью.
export const BookingDoors = () => (
  <Screen>
    <SectionCard title="Клиент">
      <ChooseRow icon={icons.User} label="Выбрать клиента" hint="Открывает список клиентов" onPress={noop} />
    </SectionCard>
    <SectionCard title="Объект">
      <ChooseRow icon={icons.MapPin} label="Добавить объект" disabled onPress={noop} />
    </SectionCard>
  </Screen>
);

// Кружок в слоте 34pt (центры на одной линии при любом размере) и подпись под ним.
const Labeled = ({ caption, width = 64, children }: { caption: string; width?: number; children: React.ReactNode }) => (
  <div style={{ width, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    <span style={{ fontFamily: SYS, fontSize: 11, lineHeight: '14px', color: FAINT, textAlign: 'center', whiteSpace: 'nowrap' }}>
      {caption}
    </span>
  </div>
);

// Значки дверей блоков: у каждого предмета свой глиф, кружок один.
export const Glyphs = () => (
  <Screen>
    <SectionCard>
      <div style={{ padding: '16px 12px', display: 'flex', justifyContent: 'space-between' }}>
        <Labeled caption="Клиент">
          <IconCircle icon={icons.User} />
        </Labeled>
        <Labeled caption="Объект">
          <IconCircle icon={icons.MapPin} />
        </Labeled>
        <Labeled caption="Услуги">
          <IconCircle icon={icons.Wrench} />
        </Labeled>
        <Labeled caption="Категория">
          <IconCircle icon={icons.Tag} />
        </Labeled>
        <Labeled caption="Ссылка">
          <IconCircle icon={icons.Link2} />
        </Labeled>
      </div>
    </SectionCard>
  </Screen>
);

// Размеры и состояние: 34 — страница, 30 — плотная форма в шторке; погашенный.
export const SizesAndMuted = () => (
  <Screen>
    <SectionCard>
      <div style={{ padding: '16px 12px', display: 'flex', justifyContent: 'space-around' }}>
        <Labeled caption="34 · страница" width={96}>
          <IconCircle icon={icons.MapPin} />
        </Labeled>
        <Labeled caption="30 · шторка" width={96}>
          <IconCircle icon={icons.MapPin} size={30} />
        </Labeled>
        <Labeled caption="Закрыта" width={96}>
          <IconCircle icon={icons.MapPin} muted />
        </Labeled>
      </div>
    </SectionCard>
  </Screen>
);
