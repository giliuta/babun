import { useState } from 'react';
import { AppearanceTile, Field, SectionCard, icons } from '@babun/ui';

// Страница: карточки сами отступают от краёв на 16.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
// Тело шторки: поля формы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// Пустое поле показывает подсказку-образец, заполненное — значение.
export const ContactsWithPlaceholders = () => {
  const [phone, setPhone] = useState('+357 25 123456');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  return (
    <Phone>
      <SectionCard title="Контакты" padded>
        <Field label="Телефон" value={phone} onChangeText={setPhone} placeholder="+357…" keyboardType="phone-pad" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="info@…" keyboardType="email-address" />
        <Field label="WhatsApp" value={whatsapp} onChangeText={setWhatsapp} placeholder="+357…" keyboardType="phone-pad" />
      </SectionCard>
    </Phone>
  );
};

// Позиция инвойса: цена и количество — два поля в ряд, состав — многострочным.
export const InvoiceLine = () => {
  const [title, setTitle] = useState('Чистка кондиционера');
  const [price, setPrice] = useState('50');
  const [qty, setQty] = useState('2');
  const [description, setDescription] = useState('Мойка фильтров и испарителя, чистка дренажа, проверка давления');
  return (
    <SheetBody>
      <Field label="Название" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Field label="Цена за одну, €" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Field label="Количество, шт" value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
        </div>
      </div>
      <Field label="Что входит" value={description} onChangeText={setDescription} multiline />
    </SheetBody>
  );
};

// «Пригласить мастера»: плитка слева внутри рамки — строка одним блоком.
export const WithLeadingTile = () => {
  const [name, setName] = useState('Андрей Ковалёв');
  const [email, setEmail] = useState('andrey@airfix.cy');
  const [phone, setPhone] = useState('+357 99 123456');
  return (
    <SheetBody>
      <Field label="Имя" leading={<AppearanceTile fallback={icons.UserRound} size={28} />} value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Почта" leading={<AppearanceTile fallback={icons.Mail} size={28} />} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Телефон" leading={<AppearanceTile fallback={icons.Phone} size={28} />} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    </SheetBody>
  );
};

// Карточка реквизитов: `Field` держит то, ЧТО ПЕЧАТАЕТСЯ НА БУМАГЕ. Имени
// набора здесь нет — его вместе с видом правит `NameColorField` строкой выше:
// обычным полем имя сущности в продукте больше не спрашивают.
export const RequisitesPaper = () => {
  const [legal, setLegal] = useState('AirFix LTD');
  const [address, setAddress] = useState('Agiou Tychona 5, 4521 Limassol, Cyprus');
  const [vat, setVat] = useState('CY10123456X');
  const [iban, setIban] = useState('CY17 0020 0128 0000 0012 0052 7600');
  return (
    <SheetBody>
      <Field
        label="Юридическое имя"
        value={legal}
        onChangeText={setLegal}
        autoCapitalize="words"
        placeholder="Как печатать на документе"
      />
      <Field label="Юридический адрес" value={address} onChangeText={setAddress} multiline />
      <Field label="VAT номер" value={vat} onChangeText={setVat} autoCapitalize="characters" />
      <Field label="IBAN" value={iban} onChangeText={setIban} autoCapitalize="characters" />
    </SheetBody>
  );
};

// Ответ при самом поле — хвост внутри рамки («за шт.» у цены).
export const WithTrailing = () => {
  const [price, setPrice] = useState('50');
  return (
    <SheetBody>
      <Field
        label="Цена, €"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        trailing={<span style={{ fontSize: 15, color: '#66707e' }}>за шт.</span>}
      />
    </SheetBody>
  );
};

// Смена пароля: ошибка — красной строкой под полем.
export const WithError = () => {
  const [pwd, setPwd] = useState('limassol2026');
  const [confirm, setConfirm] = useState('limassol2025');
  return (
    <SheetBody>
      <Field label="Новый пароль" value={pwd} onChangeText={setPwd} placeholder="Минимум 8 символов" secureTextEntry />
      <Field
        label="Подтвердите новый пароль"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Повторите новый пароль"
        secureTextEntry
        error="Пароли не совпадают"
      />
    </SheetBody>
  );
};
