import { NavRow, RowGroup, SectionCard } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Блок «Личное» карточки клиента: ярлык · значение · шеврон. Пустое значение —
// тихой подсказкой; метка печатается своим цветом.
export const ClientPersonal = () => (
  <Phone>
    <SectionCard title="Личное">
      <NavRow label="Метка" value="Лимассол" valueColor="#0D77B8" onPress={noop} />
      <NavRow label="Теги" value="VIP, Постоянный" separated onPress={noop} />
      <NavRow label="День рождения" placeholder="не указан" separated onPress={noop} />
      <NavRow label="Источник" value="Рекомендация" separated onPress={noop} />
      <NavRow label="Кто привёл" value="Наталья" separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Без `onPress` строка — показание, а не дверь: ни шеврона, ни нажатия.
export const Facts = () => (
  <Phone>
    <RowGroup title="Деньги">
      <NavRow label="На счёте" value="€1 050" />
      <NavRow label="Остаток на начало" value="€200" separated />
    </RowGroup>
  </Phone>
);

// Единственная громкая поверхность экрана.
export const Loud = () => (
  <Phone>
    <RowGroup>
      <NavRow label="Записать" loud onPress={noop} />
    </RowGroup>
  </Phone>
);

// Тизер: строка стоит, но пригашена и не нажимается, пока раздела нет.
export const DimmedTeaser = () => (
  <Phone>
    <RowGroup>
      <NavRow label="Инвойсы" value="К оплате €240" onPress={noop} />
      <NavRow label="Чеки" value="Выдано 12" separated onPress={noop} />
      <NavRow label="Договоры" placeholder="Скоро" separated dimmed />
    </RowGroup>
  </Phone>
);

// Ответ, который показывает себя вместо текста значения (`accessory`):
// основные реквизиты подписаны пометкой, у остальных — юр. имя.
const DefaultMark = () => (
  <span
    style={{
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      color: '#2c5be0',
    }}
  >
    основные
  </span>
);

export const RequisitesAccessory = () => (
  <Phone>
    <SectionCard>
      <NavRow label="AirFix LTD" accessory={<DefaultMark />} onPress={noop} />
      <NavRow label="AirFix Cleaning" value="AirFix Cleaning Ltd" separated onPress={noop} />
    </SectionCard>
  </Phone>
);
