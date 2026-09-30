import { ChooseRow, SectionCard, SettingsRow, icons } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Пустой блок страницы записи: одна дверь к выбору — кружок со значком
// предмета, слово акцентом, шеврон.
export const ClientDoor = () => (
  <Phone>
    <SectionCard title="Клиент">
      <ChooseRow
        icon={icons.UserRound}
        label="Выбрать клиента"
        hint="Открывает поиск по имени или телефону"
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);

// Та же дверь в форме в шторке (лист долга): плотнее, кружок 30.
export const Compact = () => (
  <Phone>
    <SectionCard title="Клиент" dense>
      <ChooseRow
        icon={icons.UserRound}
        label="Выбрать клиента"
        hint="Открывает поиск по имени или телефону"
        compact
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);

// Дверь стоит на месте, но ещё закрыта: объект — после выбора клиента.
export const Disabled = () => (
  <Phone>
    <SectionCard title="Объект">
      <ChooseRow
        icon={icons.MapPin}
        label="Добавить объект"
        hint="Станет доступно после выбора клиента"
        disabled
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);

// ДВЕРЬ ПОСЛЕДНЕЙ СТРОКОЙ КАРТОЧКИ СПРАВОЧНИКА — так заводят ещё один набор
// реквизитов, как объект у клиента. Пустой список от этого не становится
// тупиком: строка стоит в карточке всегда.
//
// Соседи — строки справочника (`SettingsRow` с видом), а не строки-настройки:
// плитка вида слева, имя набора, под ним чем подписана бумага. «Основные»
// живут в той же подписи — это свойство набора, а не колонка справа.
export const RequisitesList = () => (
  <Phone>
    <SectionCard>
      <SettingsRow
        appearance={{ color: '#1290CB', fallback: icons.Building2 }}
        title="AirFix LTD"
        sub="Основные · AirFix LTD"
        onPress={noop}
      />
      <SettingsRow
        appearance={{ color: '#15A84F', fallback: icons.Building2 }}
        title="AirFix Cleaning"
        sub="AirFix Cleaning Ltd"
        onPress={noop}
      />
      <ChooseRow
        icon={icons.Building2}
        label="Добавить реквизиты"
        hint="Имя на бумаге, адрес, VAT, банк и логотип"
        onPress={noop}
      />
    </SectionCard>
  </Phone>
);
