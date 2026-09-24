import { useState } from 'react';
import { Chip, FieldLabel, TimeWheelPair, icons } from '@babun/ui';

// Тело шторки: поля формы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 12px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// «Новый счёт»: подпись вопроса над чипами команд — тот же ярлык, что у
// текстовых полей формы (13/600, описывающие чернила, без капса).
export const AboveTeamChips = () => {
  const [team, setTeam] = useState('t1');
  return (
    <SheetBody>
      <FieldLabel text="Чей счёт" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="Команда 1" color="#3276FB" radio selected={team === 't1'} onPress={() => setTeam('t1')} />
        <Chip label="Команда 2" color="#D97A12" radio selected={team === 't2'} onPress={() => setTeam('t2')} />
      </div>
    </SheetBody>
  );
};

// Длительность словами — как `durationLabel` в услугах: «15 мин», «1 ч 30 мин».
const durationLabel = (total: number) => {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
};

// Необязательный параметр услуги: подпись несёт значение, справа — крестик,
// который убирает параметр целиком; под подписью барабан.
export const WithRemoveAction = () => {
  const [minutes, setMinutes] = useState(15);
  return (
    <SheetBody>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <FieldLabel text={`Перерыв после услуги · ${durationLabel(minutes)}`} />
        <span role="button" aria-label="Убрать перерыв после услуги" style={{ paddingBottom: 6, cursor: 'pointer', display: 'flex' }}>
          <icons.X color="rgba(11,18,32,0.64)" size={16} strokeWidth={2} />
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <TimeWheelPair
          hour={Math.floor(minutes / 60)}
          minute={minutes % 60}
          onChangeHour={(h) => setMinutes(h * 60 + (minutes % 60))}
          onChangeMinute={(m) => setMinutes(Math.floor(minutes / 60) * 60 + m)}
          labelPrefix="Перерыв после услуги"
        />
      </div>
    </SheetBody>
  );
};
