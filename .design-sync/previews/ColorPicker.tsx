import { useState } from 'react';
import { Chip, ColorPicker, SegmentedControl } from '@babun/ui';

// Тело шторки: решётка стоит с полями 16 (GUTTER), как в шторке «Вид».
const SheetBody = ({ children, side = 16 }: { children: React.ReactNode; side?: number }) => (
  <div style={{ width: 390, padding: `8px ${side}px 12px`, display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Цвет команды и его затемнённый кант: пилюля красит кантом рамку и тинт
// (сырой пигмент на бледном цвете исчез бы), а кружок остаётся сырым — в нём
// цвет ВЫБИРАЮТ.
const TEAM = '#3276FB';
const TEAM_EDGE = '#1F4FD8';

// Образец действующего цвета — не отдельный блок, а собственный `icon`-узел
// чипа: кружок 10 с волосяным кантом того же цвета, ровно как его рисует лист
// «Цвет записи».
const ColorSample = ({ value, edge }: { value: string; edge: string }) => (
  <div
    style={{
      width: 10,
      height: 10,
      borderRadius: 5,
      boxSizing: 'border-box',
      background: value,
      border: `1px solid ${edge}`,
    }}
  />
);

// Вкладка «Цвет» шторки «Вид»: сорок цветов общей палитры, выбранный — галка
// внутри плитки тоном, который читается на её заливке.
export const AppearanceSheetColor = () => {
  const [color, setColor] = useState('#1290CB');
  return (
    <SheetBody>
      <SegmentedControl
        options={[
          { value: 'icon', label: 'Значок' },
          { value: 'color', label: 'Цвет' },
        ]}
        value="color"
        onChange={noop}
        style={{ marginBottom: 12 }}
      />
      <ColorPicker value={color} onChange={setColor} />
    </SheetBody>
  );
};

// «Цвет записи»: над решёткой — компактная «Автоматически» с образцом цвета,
// который действует сейчас (цвет команды). Пока выбран автомат, в решётке галки нет.
export const RecordColorAuto = () => {
  const [color, setColor] = useState<string | null>(null);
  return (
    <SheetBody side={20}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Chip
          label="Автоматически"
          radio
          variant="tint"
          color={TEAM_EDGE}
          icon={<ColorSample value={TEAM} edge={TEAM_EDGE} />}
          selected={color == null}
          onPress={() => setColor(null)}
        />
      </div>
      <ColorPicker value={color ?? undefined} onChange={setColor} />
    </SheetBody>
  );
};

// Цвет из прежней палитры (типы событий с iOS-синим #007AFF): решётка
// дописывает его последней плиткой «свой», чтобы выбор не выглядел потерянным.
export const OwnColorOutsidePalette = () => {
  const [color, setColor] = useState('#007AFF');
  return (
    <SheetBody>
      <ColorPicker value={color} onChange={setColor} />
    </SheetBody>
  );
};

export const Disabled = () => (
  <SheetBody>
    <ColorPicker value="#1290CB" onChange={noop} disabled />
  </SheetBody>
);
