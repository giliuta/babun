import { ActionRow, RowGroup, SectionCard } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Блок «Ещё» в листе операции: действия над ЭТОЙ операцией списком, акцентом.
// Удаление — последней строкой того же списка, красным (красной кнопки в шапке
// листа нет).
export const ActionsBlock = () => (
  <Phone>
    <SectionCard title="Ещё">
      <ActionRow label="Открыть клиента" onPress={noop} />
      <ActionRow label="Выставить инвойс" separated onPress={noop} />
      <ActionRow label="Выписать чек" separated onPress={noop} />
      <ActionRow label="Удалить операцию" tone="danger" separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Одно разрушительное действие отдельной карточкой — конец Кабинета.
export const SignOut = () => (
  <Phone>
    <SectionCard>
      <ActionRow label="Выйти из аккаунта" tone="danger" onPress={noop} />
    </SectionCard>
  </Phone>
);

// Подпись над карточкой — `RowGroup`: так живёт увольнение на экране человека.
export const CompanyAccess = () => (
  <Phone>
    <RowGroup title="Доступ к компании">
      <ActionRow label="Убрать из компании" tone="danger" onPress={noop} />
    </RowGroup>
  </Phone>
);

// Лист долга, пока идёт сохранение: удаление пригашено и не нажимается,
// оплата остаётся живой.
export const Dimmed = () => (
  <Phone>
    <SectionCard title="Ещё" dense>
      <ActionRow label="Записать оплату · €120" onPress={noop} />
      <ActionRow label="Удалить долг" tone="danger" separated dimmed onPress={noop} />
    </SectionCard>
  </Phone>
);
