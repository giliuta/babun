import { useState } from 'react';
import { IconPicker, SegmentedControl } from '@babun/ui';

// Тело шторки «Вид»: решётка с полями 16 (GUTTER).
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 12px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Вкладка «Значок» шторки «Вид»: сорок значков общего набора восьмёрками по
// темам (деньги · места · работа · климат · люди). Выбранная плитка залита
// цветом самой сущности; повторный тап снимает значок.
export const AppearanceSheetIcon = () => {
  const [icon, setIcon] = useState<string | null>('fan');
  return (
    <SheetBody>
      <SegmentedControl
        options={[
          { value: 'icon', label: 'Значок' },
          { value: 'color', label: 'Цвет' },
        ]}
        value="icon"
        onChange={noop}
        style={{ marginBottom: 12 }}
      />
      <IconPicker value={icon ?? undefined} onChange={setIcon} tint="#1290CB" />
    </SheetBody>
  );
};

// Цвета у сущности нет — выбранная плитка берёт акцент продукта.
export const DefaultAccentTint = () => {
  const [icon, setIcon] = useState<string | null>('cash');
  return (
    <SheetBody>
      <IconPicker value={icon ?? undefined} onChange={setIcon} />
    </SheetBody>
  );
};

// Значок не обязателен: снятый — ни одна плитка не залита.
export const NoneSelected = () => {
  const [icon, setIcon] = useState<string | null>(null);
  return (
    <SheetBody>
      <IconPicker value={icon ?? undefined} onChange={setIcon} tint="#DF510F" />
    </SheetBody>
  );
};

export const Disabled = () => (
  <SheetBody>
    <IconPicker value="card" onChange={noop} tint="#3276FB" disabled />
  </SheetBody>
);
