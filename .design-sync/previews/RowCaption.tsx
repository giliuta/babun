import { ActionRow, NavRow, RowCaption, RowGroup, SectionCard } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Под группой — почему строки не правятся. Тихо, размером, а не серостью.
export const AccountFrozen = () => (
  <Phone>
    <RowGroup title="Деньги">
      <NavRow label="На счёте" value="€1 050" />
      <NavRow label="Остаток на начало" value="€200" separated />
    </RowGroup>
    <RowCaption text="Остаток на начало и команду счёта с операциями изменить нельзя — история и остаток должны сходиться. Разницу закройте обычной операцией." />
  </Phone>
);

// «Скоро / мешает» — янтарём: закрыть счёт с деньгами нельзя.
export const Warning = () => (
  <Phone>
    <RowGroup title="Закрытие счёта">
      <ActionRow label="Закрыть счёт" tone="danger" onPress={noop} />
    </RowGroup>
    <RowCaption
      tone="warning"
      text="Сейчас на счёте €410 — сначала переведите остаток на другой счёт или спишите операцией."
    />
  </Phone>
);

// Красным — то, что нельзя пропустить глазами: клиент в чёрном списке.
export const Danger = () => (
  <Phone>
    <SectionCard title="Личное">
      <NavRow label="Метка" value="Лимассол" valueColor="#0D77B8" onPress={noop} />
      <NavRow label="Теги" value="Проблемный" separated onPress={noop} />
    </SectionCard>
    <RowCaption tone="danger" text="Клиент в чёрном списке." />
  </Phone>
);

// Пустой список говорит словами, без кнопки: подпись на месте группы.
export const EmptyList = () => (
  <Phone>
    <RowCaption text="Открытых счетов нет" />
    <RowGroup>
      <NavRow label="Закрытые счета" value="2" onPress={noop} />
    </RowGroup>
  </Phone>
);
