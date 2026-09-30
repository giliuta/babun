import { Divider, RowGroup, SectionCard, SwitchRow } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Настройки вида календаря: смыслов ровно два — тумблер. Нажимается вся строка.
export const CalendarView = () => (
  <Phone>
    <SectionCard>
      <SwitchRow label="Показывать доход и расход" value onChange={noop} />
    </SectionCard>
    <SectionCard>
      <SwitchRow label="Скрывать отменённые" value={false} onChange={noop} />
    </SectionCard>
  </Phone>
);

// Пояснение под подписью говорит последствие, а не механику.
export const WithHint = () => (
  <Phone>
    <SectionCard>
      <SwitchRow
        label="Работаем с VAT"
        hint="В каждой операции можно выбрать «Без VAT», «включён» или «плюсом»"
        value
        onChange={noop}
      />
    </SectionCard>
  </Phone>
);

// Закрытый счёт: переключатели видны, но не трогаются.
export const Disabled = () => (
  <Phone>
    <RowGroup title="Команда">
      <SwitchRow
        label="Основной счёт команды"
        hint="Куда по умолчанию попадают деньги. Сейчас это «Касса»."
        value={false}
        disabled
        onChange={noop}
      />
      <Divider inset={16} />
      <SwitchRow
        label="Показывать при оплате заявок"
        hint="Счёт остаётся на «Финансах» и в переводах, но оплату заявок не принимает."
        value={false}
        disabled
        onChange={noop}
      />
    </RowGroup>
  </Phone>
);
