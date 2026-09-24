import { PickerSheet, icons } from '@babun/ui';

const noop = () => {};

// Лист выбора ДЕЙСТВИЯ — «Как связаться» у номера: цветная плитка и подпись,
// тап выбирает и закрывает. Это действие, а не значение, поэтому галки нет.
// Заголовок — сам номер, ползунки в шапке ведут на страницу «Способы связи».
export const ContactChannels = () => (
  <PickerSheet
    visible
    title="+357 99 111222"
    items={[
      { id: 'call', label: 'Позвонить', icon: icons.Phone, color: '#1F7A44', onPress: noop },
      { id: 'whatsapp', label: 'WhatsApp', icon: icons.MessageCircle, color: '#075e54', onPress: noop },
      { id: 'telegram', label: 'Telegram', icon: icons.Send, color: '#0b6e99', onPress: noop },
      { id: 'viber', label: 'Viber', icon: icons.PhoneCall, color: '#5b2d8e', onPress: noop },
      { id: 'sms', label: 'SMS', icon: icons.MessageSquare, color: '#5b6678', onPress: noop },
    ]}
    onSettings={noop}
    settingsLabel="Способы связи"
    onClose={noop}
  />
);

// Тип события: значок и цвет каждого типа, тихая подпись — длительность,
// которую тип поставит. Выбранный отмечен галкой; тап по нему снимает тип.
// Ползунки в шапке — дверь на страницу типов событий.
export const EventType = () => (
  <PickerSheet
    visible
    title="Тип события"
    selectedId="ev-meeting"
    items={[
      { id: 'ev-lunch', label: 'Обед', icon: icons.Coffee, color: '#FF9500', hint: '1 ч по умолчанию', onPress: noop },
      { id: 'ev-meeting', label: 'Встреча', icon: icons.Briefcase, color: '#007AFF', hint: '1 ч по умолчанию', onPress: noop },
      { id: 'ev-office', label: 'Выезд в офис', icon: icons.Navigation, color: '#AF52DE', hint: '1 ч 30 мин по умолчанию', onPress: noop },
      { id: 'ev-supply', label: 'Закупка', icon: icons.Package, color: '#DF510F', hint: '30 мин по умолчанию', onPress: noop },
    ]}
    onSettings={noop}
    settingsLabel="Типы событий"
    onClose={noop}
  />
);

// Действия над клиентом: без ползунков, разрушительное — последним и красным.
export const WithDestructive = () => (
  <PickerSheet
    visible
    title="Павел Иванов"
    items={[
      { id: 'book', label: 'Записать', icon: icons.CalendarPlus, color: '#2c5be0', onPress: noop },
      { id: 'remind', label: 'Напомнить', icon: icons.Bell, color: '#955f00', onPress: noop },
      { id: 'pin', label: 'Закрепить', icon: icons.Pin, color: '#2c5be0', onPress: noop },
      { id: 'archive', label: 'В архив', icon: icons.Archive, color: '#2c5be0', onPress: noop },
      { id: 'delete', label: 'Удалить', icon: icons.Trash2, color: '#c9372c', onPress: noop },
    ]}
    onClose={noop}
  />
);
