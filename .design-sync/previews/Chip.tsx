import { useState } from 'react';
import { Chip, RowGroup, SectionCard } from '@babun/ui';

const SYS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const SUB = 'rgba(11,18,32,0.74)';
const FAINT = 'rgba(11,18,32,0.64)';

// Экран на канве #f4f6f9: чипы живут в белых блоках формы или прямо на канве.
const Screen = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', padding: '4px 0 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Ряд пилюль с переносом: зазор 8, как `flex-row flex-wrap gap-2`.
const Wrap = ({ children, padding = 12 }: { children: React.ReactNode; padding?: number | string }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding }}>{children}</div>
);

// VAT операции — три клавиши, одна нажата; под ними последствие в евро.
export const VatMode = () => {
  const [mode, setMode] = useState('inclusive');
  return (
    <Screen>
      <SectionCard title="VAT">
        <Wrap>
          <Chip label="Без VAT" radio selected={mode === 'none'} onPress={() => setMode('none')} />
          <Chip label="VAT включён" radio selected={mode === 'inclusive'} onPress={() => setMode('inclusive')} />
          <Chip label="Плюс VAT" radio selected={mode === 'exclusive'} onPress={() => setMode('exclusive')} />
        </Wrap>
        <div style={{ padding: '0 16px 12px', fontFamily: SYS, fontSize: 13, lineHeight: '18px', color: SUB, fontVariantNumeric: 'tabular-nums' }}>
          Из них налог €23,95 · вам остаётся €126,05
        </div>
      </SectionCard>
    </Screen>
  );
};

// Чей счёт: пилюли команд, выбранная залита цветом своей команды.
export const TeamChips = () => {
  const [team, setTeam] = useState('k1');
  return (
    <Screen>
      <RowGroup title="Команда">
        <Wrap padding="12px 16px">
          <Chip label="Команда 1" color="#3276FB" radio selected={team === 'k1'} onPress={() => setTeam('k1')} />
          <Chip label="Команда 2" color="#15A84F" radio selected={team === 'k2'} onPress={() => setTeam('k2')} />
          <Chip label="Команда 3" color="#DF510F" radio selected={team === 'k3'} onPress={() => setTeam('k3')} />
        </Wrap>
      </RowGroup>
    </Screen>
  );
};

// Мастер в листе команды — `tint`: выбранный тонируется, остальные на заливке.
export const MasterTint = () => {
  const [master, setMaster] = useState<string | null>('sergey');
  const pick = (id: string) => setMaster(master === id ? null : id);
  return (
    <Screen>
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontFamily: SYS, fontSize: 12, lineHeight: '16px', fontWeight: 700, letterSpacing: 0.4, color: FAINT }}>
          МАСТЕР
        </div>
        <Wrap padding="8px 0 0">
          <Chip label="Андрей Коваль" variant="tint" radio selected={master === 'andrey'} onPress={() => pick('andrey')} />
          <Chip label="Сергей" variant="tint" radio selected={master === 'sergey'} onPress={() => pick('sergey')} />
          <Chip label="Михаил" variant="tint" radio selected={master === 'mikhail'} onPress={() => pick('mikhail')} />
        </Wrap>
      </div>
    </Screen>
  );
};

// Фильтры чатов на канве: счётчик в пилюле, «Без ответа» тонирован янтарём
// даже в покое, цвет выбранной — цвет канала. Ряд прокручивается вбок.
export const ChatFilters = () => {
  const [filter, setFilter] = useState('all');
  return (
    <Screen>
      <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, padding: '8px 28px 8px 16px', overflow: 'hidden' }}>
        <Chip label="Все" count={12} radio color="#2c5be0" selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip
          label="Без ответа"
          count={3}
          radio
          color="#955f00"
          idleColor={filter === 'wait' ? undefined : '#955f00'}
          selected={filter === 'wait'}
          onPress={() => setFilter('wait')}
        />
        <Chip label="WhatsApp" count={7} radio color="#075e54" selected={filter === 'wa'} onPress={() => setFilter('wa')} />
        <Chip label="Telegram" count={2} radio color="#0b6e99" selected={filter === 'tg'} onPress={() => setFilter('tg')} />
      </div>
    </Screen>
  );
};

// Статус у бригады: следующий шаг открыт, назад нельзя — такой чип погашен.
export const CrewStatus = () => (
  <Screen>
    <SectionCard title="Статус">
      <Wrap>
        <Chip label="Запланировано" radio disabled dimmed onPress={() => {}} />
        <Chip label="В работе" radio selected onPress={() => {}} />
        <Chip label="Выполнено" radio onPress={() => {}} />
      </Wrap>
    </SectionCard>
  </Screen>
);

// «Автоматически» над палитрой цвета записи: образец действующего цвета
// кружком прямо на пилюле (кант затемнён до читаемого).
export const AutoColor = () => (
  <Screen>
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 16px' }}>
      <Chip
        label="Автоматически"
        variant="tint"
        radio
        selected
        color="#285ec9"
        icon={
          <span
            style={{
              display: 'block',
              width: 10,
              height: 10,
              borderRadius: 5,
              boxSizing: 'border-box',
              background: '#3276FB',
              border: '1px solid #285ec9',
            }}
          />
        }
        onPress={() => {}}
      />
    </div>
  </Screen>
);
