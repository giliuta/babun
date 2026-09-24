import { Button } from '@babun/ui';

// Ширина телефона: кнопка в приложении всегда тянется на всю строку футера.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 358, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
);

export const Primary = () => (
  <Phone>
    <Button label="Записать" onPress={() => {}} />
  </Phone>
);

export const Secondary = () => (
  <Phone>
    <Button label="Удалить черновик" variant="secondary" onPress={() => {}} />
  </Phone>
);

export const DangerSecondary = () => (
  <Phone>
    <Button label="Удалить запись" variant="secondary" tone="danger" onPress={() => {}} />
  </Phone>
);

export const FilledSuccess = () => (
  <Phone>
    <Button label="Принять оплату" variant="filled" tone="success" onPress={() => {}} />
  </Phone>
);

export const Loading = () => (
  <Phone>
    <Button label="Готово" loading onPress={() => {}} />
  </Phone>
);

export const Disabled = () => (
  <Phone>
    <Button label="Готово" disabled onPress={() => {}} />
  </Phone>
);
