import { GradientButton, ScreenHeader, Spinner } from '@babun/ui';

// Спиннер — кобальтовая дуга на своей дорожке. Показываем его там, где он
// живёт в приложении: посреди свободного места экрана, в слоте шапки, в кнопке.
const noop = () => {};

// Список ещё грузится: спиннер по центру свободной области экрана (канва).
export const ListLoading = () => (
  <div
    style={{
      width: 390,
      height: 260,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f4f6f9',
    }}
  >
    <Spinner size={30} label="Загрузка клиентов" />
  </div>
);

// Слот действия шапки: пока собирается PDF, вместо значка «Поделиться» крутится спиннер.
export const InHeaderSlot = () => (
  <div style={{ width: 390, background: '#f4f6f9' }}>
    <ScreenHeader
      title="INV-2026-007"
      onBack={noop}
      right={
        <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={18} label="Готовим PDF" />
        </div>
      }
    />
  </div>
);

// В залитой кнопке спиннер белый (onAccent) и стоит у ведущего края — подпись
// не уезжает. Футер во всю ширину: flex-колонка, иначе кнопка сжалась бы по слову.
export const InsideButton = () => (
  <div
    style={{
      width: 390,
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 20px 10px',
      boxSizing: 'border-box',
      background: '#f4f6f9',
    }}
  >
    <GradientButton label="Выписать чек" loading onPress={noop} />
  </div>
);

// Кегли, которые живут в продукте: 18 — слот и кнопка, 24 — по умолчанию,
// 28 — экран загрузки, 30 — список.
export const Sizes = () => (
  <div
    style={{
      width: 390,
      height: 96,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 40,
      background: '#ffffff',
    }}
  >
    <Spinner size={18} />
    <Spinner />
    <Spinner size={28} />
    <Spinner size={30} />
  </div>
);
