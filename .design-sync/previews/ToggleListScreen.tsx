import { ToggleListScreen, icons } from '@babun/ui';

// Страница-набор во всю высоту телефона: шапка и строки-карточки по 56pt
// (значок в тинте цвета · подпись · галка). Включённое стоит сверху и
// перетаскивается за ручку справа, выключенное само падает вниз.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, height: 640, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// «Способы связи»: чем фирма связывается с клиентами. Viber выключен — он внизу, без ручки.
export const ContactWays = () => (
  <Phone>
    <ToggleListScreen
      title="Способы связи"
      sections={[
        {
          onReorder: noop,
          items: [
            { id: 'whatsapp', label: 'WhatsApp', icon: icons.MessageCircle, color: '#075e54', checked: true, onToggle: noop },
            { id: 'telegram', label: 'Telegram', icon: icons.Send, color: '#0b6e99', checked: true, onToggle: noop },
            { id: 'viber', label: 'Viber', icon: icons.PhoneCall, color: '#5b2d8e', checked: false, onToggle: noop },
            { id: 'sms', label: 'SMS', icon: icons.MessageSquare, color: '#5b6678', checked: true, onToggle: noop },
            { id: 'instagram', label: 'Instagram', icon: icons.Instagram, color: '#b91c5c', checked: true, onToggle: noop },
            { id: 'email', label: 'Почта', icon: icons.Mail, color: '#5b6678', checked: true, onToggle: noop },
          ],
        },
      ]}
    />
  </Phone>
);

// «Карты для маршрута»: включена одна Waze — её нельзя снять, подпись гаснет и
// объясняет почему. Ручки нет: одной включённой строке переставлять некуда.
export const LastOneLocked = () => (
  <Phone>
    <ToggleListScreen
      title="Карты для маршрута"
      sections={[
        {
          onReorder: noop,
          items: [
            { id: 'google', label: 'Google Карты', icon: icons.MapPin, color: '#1a73e8', checked: false, onToggle: noop },
            { id: 'apple', label: 'Apple Карты', icon: icons.Map, color: '#3d4b5c', checked: false, onToggle: noop },
            {
              id: 'waze',
              label: 'Waze',
              icon: icons.Navigation,
              color: '#0e8f9e',
              checked: true,
              locked: true,
              lockedNote: 'нужна хотя бы одна',
              onToggle: noop,
            },
            { id: 'yandex', label: 'Яндекс Карты', icon: icons.Compass, color: '#c62828', checked: false, onToggle: noop },
          ],
        },
      ]}
    />
  </Phone>
);

// «Блоки формы» записи: без порядка (ручек нет), обязательные блоки закреплены «всегда».
const block = (id: string, label: string, checked: boolean, pinned = false) => ({
  id,
  label,
  icon: icons.CircleDot,
  color: '#2c5be0',
  checked,
  locked: pinned,
  lockedNote: pinned ? 'всегда' : undefined,
  onToggle: noop,
});

export const PinnedBlocks = () => (
  <Phone>
    <ToggleListScreen
      title="Блоки формы"
      sections={[
        {
          items: [
            block('team', 'Команда', true, true),
            block('label', 'Метка', true),
            block('when', 'Время', true, true),
            block('client', 'Клиент', true, true),
            block('object', 'Объект', false),
            block('services', 'Услуги', true, true),
            block('payment', 'Оплата', true),
            block('note', 'Заметка', true),
            block('files', 'Файлы', true, true),
          ],
        },
      ]}
    />
  </Phone>
);
