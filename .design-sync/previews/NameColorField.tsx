import { useState } from 'react';
import { FieldRow, NameColorField, SectionCard, icons } from '@babun/ui';

// Тело шторки: поля формы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
// Страница: карточки сами отступают от краёв на 16.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Необязательная приписка к имени — кнопкой у подписи, а не под полем.
const AddDescription = () => (
  <span
    role="button"
    style={{ paddingBottom: 6, paddingLeft: 12, fontSize: 14, fontWeight: 500, color: '#2c5be0', cursor: 'pointer' }}
  >
    ＋ Описание
  </span>
);

// Форма услуги: плитка вида слева (цвет + значок), имя справа, «＋ Описание»
// у подписи. Тап по плитке открывает шторку «Вид».
export const ServiceName = () => {
  const [name, setName] = useState('Чистка кондиционера');
  const [color, setColor] = useState('#1290CB');
  const [icon, setIcon] = useState<string | null>('fan');
  return (
    <SheetBody>
      <NameColorField
        label="Название"
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon ?? undefined}
        onIconChange={setIcon}
        labelAction={<AddDescription />}
      />
    </SheetBody>
  );
};

// Категория финансов: имя, цвет и значок — одна строка.
export const CategoryWithIcon = () => {
  const [name, setName] = useState('Топливо');
  const [color, setColor] = useState('#D97A12');
  const [icon, setIcon] = useState<string | null>('car');
  return (
    <SheetBody>
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon ?? undefined}
        onIconChange={setIcon}
      />
    </SheetBody>
  );
};

// Метка дня: значка у сущности нет — плитка несёт только цвет, в шторке нет
// переключателя «Значок · Цвет».
export const DayLabelColorOnly = () => {
  const [name, setName] = useState('Лимасол');
  const [color, setColor] = useState('#6B45FB');
  return (
    <SheetBody>
      <NameColorField name={name} onNameChange={setName} color={color} onColorChange={setColor} />
    </SheetBody>
  );
};

// Настройки календаря: строка карточки без рамки и ярлыка — имя правится там,
// где написано, жирнее обычного поля.
export const CalendarNameInCard = () => {
  const [name, setName] = useState('Команда 1');
  const [color, setColor] = useState('#3276FB');
  return (
    <Phone>
      <SectionCard>
        <NameColorField bare label={null} name={name} onNameChange={setName} color={color} onColorChange={setColor} />
      </SectionCard>
    </Phone>
  );
};

// Карточка мастера: имя вровень со строками ниже (60), без своего значка —
// запасной глиф человека; заполненное имя отмечено галкой.
export const MasterCard = () => {
  const [name, setName] = useState('Андрей Ковалёв');
  const [color, setColor] = useState('#8385FC');
  return (
    <Phone>
      <SectionCard padded={false}>
        <NameColorField
          bare
          minHeight={60}
          label={null}
          name={name}
          onNameChange={setName}
          color={color}
          onColorChange={setColor}
          fallback={icons.UserRound}
          placeholder="Имя"
          autoCapitalize="words"
          trailing={name.trim() ? <icons.Check color="#087a52" size={18} strokeWidth={2.5} /> : null}
        />
        <FieldRow stacked hideLabel separated label="Почта" placeholder="Почта" value="andrey@airfix.cy" keyboardType="email-address" autoCapitalize="none" onSave={noop} />
        <FieldRow stacked hideLabel separated tabular label="Телефон" placeholder="Телефон" value="+357 99 123456" keyboardType="phone-pad" onSave={noop} />
      </SectionCard>
    </Phone>
  );
};

// Карточка реквизитов: у набора, которым подписывают чек и инвойс, с 21.09
// есть свой вид — до этого он был единственной сущностью продукта без него, и
// в списке две фирмы различались только чтением имени. Своего значка ещё нет,
// поэтому плитка несёт запасной глиф здания; подсказка называет поле —
// имя внутри продукта, а не то, что печатается на бумаге.
export const RequisitesName = () => {
  const [name, setName] = useState('AirFix LTD');
  const [color, setColor] = useState('#1290CB');
  const [icon, setIcon] = useState<string | null>(null);
  return (
    <SheetBody>
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon ?? undefined}
        onIconChange={setIcon}
        fallback={icons.Building2}
        autoCapitalize="words"
        placeholder="Как называть этот набор внутри"
      />
    </SheetBody>
  );
};

// Новая категория: имя ещё не набрано, цвет уже подставлен следующим свободным.
export const NewEmpty = () => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#159EFC');
  const [icon, setIcon] = useState<string | null>(null);
  return (
    <SheetBody>
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon ?? undefined}
        onIconChange={setIcon}
      />
    </SheetBody>
  );
};
