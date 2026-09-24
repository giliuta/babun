import { EmptyState, icons } from '@babun/ui';

// Пустое состояние лежит на канве экрана (#f4f6f9), а не в белой карточке:
// это ListEmptyComponent списка или всё тело экрана (`fill`).
const Canvas = ({ children, height = 300 }: { children: React.ReactNode; height?: number }) => (
  <div style={{ width: 390, minHeight: height, display: 'flex', flexDirection: 'column', background: '#f4f6f9' }}>
    {children}
  </div>
);
const noop = () => {};

// Список клиентов пуст: значок и слова. Кнопки внутри нет — «Создать клиента»
// стоит в футере экрана, пуст список или полон.
export const NoClients = () => (
  <Canvas>
    <EmptyState
      icon={<icons.Users color="rgba(11,18,32,0.64)" size={40} strokeWidth={1.5} />}
      title="Пока нет клиентов"
    />
  </Canvas>
);

// Поиск или фильтр ничего не нашёл: заголовок и подсказка, что поправить.
export const NothingFound = () => (
  <Canvas>
    <EmptyState title="Ничего не найдено" subtitle="Измените запрос или сбросьте фильтры" />
  </Canvas>
);

// Во всё тело экрана (`fill`): пустой архив календарей объясняет, что сюда попадает.
export const FillWithSubtitle = () => (
  <Canvas height={420}>
    <EmptyState
      fill
      title="Архив пуст"
      subtitle="Сюда попадают удалённые календари. Отсюда их можно вернуть или удалить навсегда."
    />
  </Canvas>
);

// Загрузка: кобальтовый спиннер и подпись под ним.
export const Loading = () => (
  <Canvas height={420}>
    <EmptyState state="loading" fill title="Открываем компанию" />
  </Canvas>
);

// Ошибка: красный заголовок, причина и единственная кнопка — «Повторить».
// КНОПКА СТОИТ ВНИЗУ, во всю ширину с полем 16, а не по центру пустоты: там
// же, где действие любого экрана. Клетке дана высота телефона — иначе на
// снимке не видно, что «Повторить» прижата к нижнему краю, а слова остались
// по центру.
export const ErrorRetry = () => (
  <Canvas height={560}>
    <EmptyState
      state="error"
      fill
      title="Не удалось загрузить документы"
      subtitle="Проверьте интернет и повторите попытку."
      action={{ label: 'Повторить', onPress: noop }}
    />
  </Canvas>
);
