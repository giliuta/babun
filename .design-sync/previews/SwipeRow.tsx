import {
  AddRow,
  Divider,
  ReorderList,
  RowGroup,
  SectionCard,
  SectionEyebrow,
  SettingsRow,
  SwipeRow,
  ValueRow,
  icons,
} from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column', background: '#f4f6f9', paddingBottom: 16 }}>
    {children}
  </div>
);
const noop = () => {};

// Строка в покое: кнопки кромок лежат ПОД ней и видны только на смахивании.
// Правая кромка — разрушительное («Убрать»), тап по строке — правка.
// Так выглядят перерывы дня в графике команды.
export const Breaks = () => (
  <Phone>
    <SectionEyebrow>Перерывы</SectionEyebrow>
    <SectionCard>
      <SwipeRow
        label="Убрать"
        color="#c9372c"
        icon={icons.Trash2}
        accessibilityLabel="Убрать перерыв 13:00 – 14:00"
        onAction={noop}
      >
        <ValueRow label="Перерыв" value="13:00 – 14:00" longPressLabel="Убрать перерыв" onPress={noop} onLongPress={noop} />
      </SwipeRow>
      <Divider inset={16} />
      <SwipeRow
        label="Убрать"
        color="#c9372c"
        icon={icons.Trash2}
        accessibilityLabel="Убрать перерыв 17:30 – 17:45"
        onAction={noop}
      >
        <ValueRow label="Перерыв" value="17:30 – 17:45" longPressLabel="Убрать перерыв" onPress={noop} onLongPress={noop} />
      </SwipeRow>
      <AddRow label="Добавить перерыв" separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Только левая кромка — состояние строки: закрытый счёт «Открыть» снова.
// Удалить его нельзя (на нём история), поэтому правой кромки нет вовсе.
export const ClosedAccounts = () => (
  <Phone>
    <RowGroup footer="Закрытый счёт не входит ни в один итог и не предлагается при приёме денег. История операций у него сохраняется.">
      <SwipeRow
        leading={{
          label: 'Открыть',
          color: '#087a52',
          icon: icons.RotateCcw,
          accessibilityLabel: 'Открыть счёт Касса Команды 2 снова',
          onAction: noop,
        }}
      >
        <SettingsRow
          icon={icons.Banknote}
          tile="#15A84F"
          title="Касса Команды 2"
          sub="Команда 2"
          value="Закрыт"
          valueColor="rgba(11,18,32,0.64)"
          onPress={noop}
        />
      </SwipeRow>
      <Divider inset={48} />
      <SwipeRow
        leading={{
          label: 'Открыть',
          color: '#087a52',
          icon: icons.RotateCcw,
          accessibilityLabel: 'Открыть счёт Revolut Димы снова',
          onAction: noop,
        }}
      >
        <SettingsRow
          icon={icons.CreditCard}
          tile="#3276FB"
          title="Revolut Димы"
          sub="Команда 1"
          value="€40"
          valueColor="#955f00"
          onPress={noop}
        />
      </SwipeRow>
    </RowGroup>
  </Phone>
);

// Обе кромки в справочнике: справа «Удалить», слева «Скрыть» (у скрытой —
// «Показать», и сама строка тише живых). Строка залита цветом сущности на 8 %,
// ручка перетаскивания едет вместе с ней. Так устроены теги клиентов.
const TAGS = [
  { id: 'regular', name: 'Постоянный', color: '#3276FB', icon: 'star', hidden: false },
  { id: 'agency', name: 'Управляющая компания', color: '#FDAA1B', icon: 'office', hidden: false },
  { id: 'season', name: 'Сезонный', color: '#1BC1B1', icon: 'sun', hidden: true },
];

export const Tags = () => (
  <Phone>
    <div style={{ margin: '16px 16px 0', display: 'flex', flexDirection: 'column' }}>
      <ReorderList items={TAGS} rowHeight={60} spaced handleInside labelFor={(tag) => tag.name} onReorder={noop}>
        {(tag, _index, handle) => (
          <SwipeRow
            label="Удалить"
            color="#c9372c"
            icon={icons.Trash2}
            accessibilityLabel={`Удалить тег ${tag.name}`}
            onAction={noop}
            leading={{
              label: tag.hidden ? 'Показать' : 'Скрыть',
              color: tag.hidden ? '#087a52' : '#955f00',
              icon: tag.hidden ? icons.RotateCcw : icons.EyeOff,
              onAction: noop,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                background: `${tag.color}14`,
                opacity: tag.hidden ? 0.45 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <SettingsRow appearance={{ color: tag.color, icon: tag.icon }} title={tag.name} />
              </div>
              {handle}
            </div>
          </SwipeRow>
        )}
      </ReorderList>
    </div>
  </Phone>
);
