import { ActionRow, Button, ChoiceSheetHost, RowGroup } from '@babun/ui';

const noop = () => {};

// ХОСТ НЕВИДИМ: он стоит один раз в корне приложения вокруг всего дерева и
// показывает нижний лист, когда обработчик зовёт `chooseOption()` /
// `confirmThen()`. Здесь он обёрнут вокруг того, откуда такой вопрос приходит.

// Действия инвойса: одна красная кнопка на отказ. Что именно произойдёт —
// кредит-нота или аннулирование — хост спросит листом со списком ответов и
// «Отменой» под ними.
export const InvoiceActions = () => (
  <ChoiceSheetHost>
    <div style={{ width: 390, background: '#f4f6f9', padding: '20px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <Button label="Принять оплату" onPress={noop} />
      <Button label="Редактировать" variant="secondary" onPress={noop} />
      <Button label="Отменить инвойс" variant="secondary" tone="danger" onPress={noop} />
      <Button label="Поделиться PDF" variant="secondary" onPress={noop} />
    </div>
  </ChoiceSheetHost>
);

// Подтверждение одного действия: хост покажет вопрос и две кнопки в ряд —
// «Отмена» слева, красное «Убрать» справа.
export const ConfirmSource = () => (
  <ChoiceSheetHost>
    <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 16, display: 'flex', flexDirection: 'column' }}>
      <RowGroup title="Доступ к компании">
        <ActionRow label="Убрать из компании" tone="danger" onPress={noop} />
      </RowGroup>
    </div>
  </ChoiceSheetHost>
);
