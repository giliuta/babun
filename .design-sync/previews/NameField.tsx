import { useState } from 'react';
import { NameField } from '@babun/ui';

// Тело шторки: поля формы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Необязательная приписка к имени — кнопкой у подписи, а не под полем.
const AddDescription = () => (
  <span
    role="button"
    style={{ paddingBottom: 6, paddingLeft: 12, fontSize: 14, fontWeight: 500, color: '#2c5be0', cursor: 'pointer' }}
  >
    ＋ Описание
  </span>
);

// Имя услуги в её форме: та же рамка, что у поля с цветом, и «＋ Описание»
// справа от подписи на одной с ней строке.
export const WithDescriptionAction = () => {
  const [name, setName] = useState('Заправка фреоном R32');
  return (
    <SheetBody>
      <NameField name={name} onNameChange={setName} labelAction={<AddDescription />} />
    </SheetBody>
  );
};

// Своя подпись, без команды у ярлыка.
export const Plain = () => {
  const [name, setName] = useState('Мойка внешнего блока');
  return (
    <SheetBody>
      <NameField label="Название позиции" name={name} onNameChange={setName} />
    </SheetBody>
  );
};

// Новая сущность: поле пустое, подпись называет, что вводить.
export const Empty = () => {
  const [name, setName] = useState('');
  return (
    <SheetBody>
      <NameField name={name} onNameChange={setName} labelAction={<AddDescription />} />
    </SheetBody>
  );
};
