import { useState } from 'react';
import { SwitchControl, SwitchRow, RowGroup } from '@babun/ui';

// Голый тумблер — для своих раскладок. В строках настроек бери SwitchRow:
// там жест собирает вся строка, а тумблер только показывает состояние.
const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>{children}</div>
);

export const States = () => (
  <Row>
    <SwitchControl value />
    <SwitchControl value={false} />
    <SwitchControl value disabled />
    <SwitchControl value={false} disabled />
  </Row>
);

export const Interactive = () => {
  const [on, setOn] = useState(true);
  return (
    <Row>
      <SwitchControl value={on} onValueChange={setOn} />
    </Row>
  );
};

export const InSettingsRow = () => {
  const [week, setWeek] = useState(true);
  return (
    <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>
      <RowGroup title="Календарь">
        <SwitchRow label="Показывать выходные" value={week} onChange={setWeek} />
      </RowGroup>
    </div>
  );
};
