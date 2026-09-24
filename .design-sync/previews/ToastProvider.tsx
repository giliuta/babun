import { NavRow, NoticeBar, ScreenHeader, SectionCard, ToastProvider } from '@babun/ui';

// Провайдер ставится ОДИН раз, в корне приложения, и сам ничего не рисует,
// пока тоста нет. Показанный тост — это `NoticeBar` во всю ширину, вплотную
// к верху экрана, поверх шапки. Вызов `toast()` в пакет дизайна не входит,
// поэтому тост в ячейках ниже нарисован ровно там и так, как он встаёт.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      width: 390,
      height: 300,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      background: '#f4f6f9',
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);
const Toast = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>{children}</div>
);
const noop = () => {};

// Экран под провайдером — правка инвойса.
const InvoicePage = () => (
  <>
    <ScreenHeader title="Новый инвойс" onBack={noop} />
    <SectionCard title="Клиент">
      <NavRow label="Павел Иванов" value="Вилла 5" onPress={noop} />
    </SectionCard>
    <SectionCard title="Услуги">
      <NavRow label="Чистка кондиционера" value="€50" onPress={noop} />
      <NavRow separated label="Заправка фреоном R32" value="€80" onPress={noop} />
    </SectionCard>
  </>
);

// Провайдер оборачивает дерево; тоста нет — экран виден как есть.
export const WrapsApp = () => (
  <ToastProvider>
    <Phone>
      <InvoicePage />
    </Phone>
  </ToastProvider>
);

// Тост с отменой: позицию убрали из инвойса, «Вернуть» кладёт список обратно.
// С кнопкой тост живёт 5 секунд и ловит тап только по ней.
export const ToastWithUndo = () => (
  <ToastProvider>
    <Phone>
      <InvoicePage />
      <Toast>
        <NoticeBar tone="info" message="«Замена фильтра» убрана" action={{ label: 'Вернуть', onPress: noop }} />
      </Toast>
    </Phone>
  </ToastProvider>
);

// Тост ошибки — то же место и та же форма, другой цвет, без кнопки.
export const ErrorToast = () => (
  <ToastProvider>
    <Phone>
      <InvoicePage />
      <Toast>
        <NoticeBar tone="error" message="Не удалось удалить" />
      </Toast>
    </Phone>
  </ToastProvider>
);
