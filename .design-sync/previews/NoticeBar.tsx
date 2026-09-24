import { NoticeBar } from '@babun/ui';

// Плашка всегда во всю ширину и вплотную к верху: без скругления и тени, тон
// меняет только цвет. Ширина телефона — чтобы видеть, где встаёт кнопка.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390 }}>{children}</div>
);
const noop = () => {};

// Эталон формы (LOCKED): тап по прошедшему времени в календаре. Это вопрос,
// а не авария — отвечают одним тапом по кнопке.
export const WarnWithAction = () => (
  <Phone>
    <NoticeBar tone="warn" message="Это время уже прошло" action={{ label: 'Записать', onPress: noop }} />
  </Phone>
);

// Сделано — и можно передумать: клиента убрали в архив.
export const SuccessWithUndo = () => (
  <Phone>
    <NoticeBar tone="success" message="Клиент в архиве" action={{ label: 'Отменить', onPress: noop }} />
  </Phone>
);

// Обычное сообщение чернилами: позицию убрали из инвойса, «Вернуть» кладёт её
// обратно. Текст — одна строка: длинное сообщение рядом с кнопкой обрезается.
export const InfoWithAction = () => (
  <Phone>
    <NoticeBar tone="info" message="«Замена фильтра» убрана" action={{ label: 'Вернуть', onPress: noop }} />
  </Phone>
);

// Не вышло, поправить нечем — только слова, без кнопки.
export const ErrorMessage = () => (
  <Phone>
    <NoticeBar tone="error" message="Номер без кода страны" />
  </Phone>
);
