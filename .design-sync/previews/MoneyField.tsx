import { useState } from 'react';
import { MoneyField } from '@babun/ui';

// Тело шторки: поле суммы с полями 16 (GUTTER) от краёв телефона.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);

// «Новый счёт» — сумма первым вопросом и крупно; символ валюты тенанта стоит
// перед числом, как деньги напечатаны везде в продукте.
export const OpeningBalance = () => {
  const [value, setValue] = useState('1250');
  return (
    <SheetBody>
      <MoneyField label="Сколько сейчас на счёте" value={value} onChangeText={setValue} currency="EUR" allowNegative />
    </SheetBody>
  );
};

// Пустое поле: серый «0» и подпись, что эта сумма значит.
export const EmptyWithHint = () => {
  const [value, setValue] = useState('');
  return (
    <SheetBody>
      <MoneyField
        label="Сколько сейчас на счёте"
        value={value}
        onChangeText={setValue}
        currency="EUR"
        allowNegative
        hint="От неё считается баланс"
      />
    </SheetBody>
  );
};

// Счёт заводят и в долге: минус разрешён полем (allowNegative).
export const InDebt = () => {
  const [value, setValue] = useState('-320');
  return (
    <SheetBody>
      <MoneyField label="Сколько сейчас на счёте" value={value} onChangeText={setValue} currency="EUR" allowNegative />
    </SheetBody>
  );
};

// Возврат по операции: сумма больше остатка — рамка и подпись под полем красные.
export const RefundError = () => {
  const [value, setValue] = useState('250');
  return (
    <SheetBody>
      <MoneyField
        label="Сумма возврата (до €180)"
        value={value}
        onChangeText={setValue}
        currency="EUR"
        error="Не больше €180 и больше нуля"
      />
    </SheetBody>
  );
};

// Символ берётся из валюты тенанта, а не зашит евро: киевский тенант — гривны.
export const HryvniaTenant = () => {
  const [value, setValue] = useState('4800');
  return (
    <SheetBody>
      <MoneyField label="Сколько сейчас на счёте" value={value} onChangeText={setValue} currency="UAH" allowNegative />
    </SheetBody>
  );
};
