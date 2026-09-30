import { ScopeChips, ScreenHeader, icons } from '@babun/ui';

// Шапка своего фона не имеет — она лежит на канве экрана (#f4f6f9). «Назад»
// слева 44pt, заголовок честно по центру, справа слот той же ширины.
const Canvas = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, background: '#f4f6f9', paddingBottom: 12 }}>{children}</div>
);
const noop = () => {};

// Внутренняя страница: «назад» и заголовок 17/600, шов снизу.
export const Default = () => (
  <Canvas>
    <ScreenHeader title="Типы объектов" onBack={noop} />
  </Canvas>
);

// Вторая строка — чья это страница.
export const WithSubtitle = () => (
  <Canvas>
    <ScreenHeader title="История" subtitle="Павел Иванов" onBack={noop} />
  </Canvas>
);

// Действие справа — значком в круге 44pt (поделиться PDF инвойса).
export const WithAction = () => (
  <Canvas>
    <ScreenHeader
      title="INV-2026-007"
      onBack={noop}
      right={
        <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <icons.Share2 color="rgba(11,18,32,0.86)" size={18} />
        </div>
      }
    />
  </Canvas>
);

// Под шапкой сразу лента календарей — шов гасится (`seam={false}`), линию
// под лентой рисует сама лента.
export const WithChips = () => (
  <Canvas>
    <ScreenHeader title="Права" subtitle="Юра · мастер" onBack={noop} seam={false} />
    <ScopeChips
      items={[
        { id: 'team-1', name: 'Команда 1', color: '#3276FB' },
        { id: 'team-2', name: 'Команда 2', color: '#15A84F' },
      ]}
      activeId="team-1"
      onSelect={noop}
    />
  </Canvas>
);

// Корень вкладки: крупный заголовок в потоке, без «назад».
export const Large = () => (
  <Canvas>
    <ScreenHeader large title="Чаты" subtitle="12 диалогов · 3 непрочитанных" />
  </Canvas>
);
