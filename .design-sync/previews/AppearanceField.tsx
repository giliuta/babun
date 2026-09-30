import { useState } from 'react';
import { AppearanceField, Field } from '@babun/ui';

// Тело шторки: поля формы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Шторка «Новая позиция» склада: имя — обычным полем, цвет — строкой «Вид»
// с образцом и шевроном; тап открывает шторку с решёткой цветов.
export const InventoryItem = () => {
  const [name, setName] = useState('Манометр R32');
  const [color, setColor] = useState('#1290CB');
  const [notes, setNotes] = useState('Проверен перед сезоном');
  return (
    <SheetBody>
      <Field label="Название" value={name} onChangeText={setName} placeholder="Манометр" />
      <AppearanceField label="Цвет" color={color} onColorChange={setColor} />
      <Field label="Заметки" value={notes} onChangeText={setNotes} placeholder="—" />
    </SheetBody>
  );
};

// Цвет и значок одной плиткой: шторка откроется сразу на вкладке «Значок».
export const ColorAndIcon = () => {
  const [color, setColor] = useState('#3276FB');
  const [icon, setIcon] = useState<string | null>('card');
  return (
    <SheetBody>
      <AppearanceField
        color={color}
        onColorChange={setColor}
        icon={icon ?? undefined}
        onIconChange={setIcon}
      />
    </SheetBody>
  );
};

// Вид ещё не выбран (в приложении так и передают: `color || null`): вместо
// серой дыры в плитке — тихий ярлычок.
export const NotChosen = () => (
  <SheetBody>
    <AppearanceField color={null} onColorChange={noop} onIconChange={noop} />
  </SheetBody>
);

export const Disabled = () => (
  <SheetBody>
    <AppearanceField color="#1290CB" icon="snow" onColorChange={noop} onIconChange={noop} disabled />
  </SheetBody>
);
