import { Button, GradientButton } from '@babun/ui';

// Главное действие экрана — ВСЕГДА в футере, во всю ширину: `View` с полями
// 20 / 8 / 10 на канве страницы. Пуст список или полон — кнопка на том же месте.
const Footer = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      width: 390,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '8px 20px 10px',
      boxSizing: 'border-box',
      background: '#f4f6f9',
    }}
  >
    {children}
  </div>
);
const noop = () => {};

// Футер списка клиентов — образец для всех страниц-списков.
export const CreateClient = () => (
  <Footer>
    <GradientButton label="Создать клиента" onPress={noop} />
  </Footer>
);

// Ещё нельзя: форма записи без клиента. Кнопка на месте, но серая и без тени.
export const Disabled = () => (
  <Footer>
    <GradientButton label="Создать запись" disabled onPress={noop} />
  </Footer>
);

// Идёт работа: спиннер у ведущего края, подпись не исчезает.
export const Loading = () => (
  <Footer>
    <GradientButton label="Принять приглашение" loading onPress={noop} />
  </Footer>
);

// Пара в футере листа чека: главная плита и под ней кнопка второго вида.
export const WithSecondary = () => (
  <Footer>
    <GradientButton label="Поделиться PDF" onPress={noop} />
    <Button label="Поделиться текстом" variant="secondary" onPress={noop} />
  </Footer>
);
