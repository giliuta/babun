import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
import {
  channelDef,
  isChannelOffered,
  useChannelsOrder,
  useEnabledChannels,
  useReorderChannels,
  useToggleChannel,
  type ChannelId,
} from "@/features/clients/contact-channels";
import {
  contactFieldDef,
  useContactFieldsOrder,
  useEnabledContactFields,
  useReorderContactFields,
  useToggleContactField,
  type ContactFieldId,
} from "@/features/clients/contact-fields";

// «СПОСОБЫ СВЯЗИ» — ОДНА страница на оба списка (владелец 2026-08-02: «сделай
// способ связи и что можно добавить в одну целую страницу — по сути это одно
// и то же»). Разница между ними только в том, ЧТО с ними делают:
//   • «У номера» — по чему связываются с уже записанным номером;
//   • «Можно добавить в карточку» — что вообще заводят клиенту плюсом.
// Оба набора включаются галкой и перетаскиваются за ручку; порядок в каждом
// свой и виден там, где список предлагается.

export default function ClientChannelsScreen() {
  const order = useChannelsOrder();
  const enabled = useEnabledChannels();
  const toggle = useToggleChannel();
  const reorder = useReorderChannels();

  const fieldOrder = useContactFieldsOrder();
  const fieldsEnabled = useEnabledContactFields();
  const toggleField = useToggleContactField();
  const reorderFields = useReorderContactFields();

  const channelItems = order
    .filter(isChannelOffered)
    .map((id) => {
      const def = channelDef(id);
      return def
        ? {
            id: def.id,
            label: def.label,
            icon: def.icon,
            color: def.color,
            checked: enabled.includes(def.id),
            // «Позвонить» не отключается и стоит первым: без него кнопка
            // связи теряет смысл.
            locked: !def.optional,
            pinned: !def.optional,
            lockedNote: "всегда",
            onToggle: () => toggle.mutate(def.id),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const fieldItems = fieldOrder
    .map((id) => {
      const def = contactFieldDef(id);
      return def
        ? {
            id: def.id,
            label: def.label,
            icon: def.icon,
            color: def.color,
            checked: fieldsEnabled.includes(def.id),
            onToggle: () => toggleField.mutate(def.id),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <ToggleListScreen
      title="Способы связи"
      hint="Чем связываться и что заводить клиенту"
      sections={[
        {
          title: "У номера",
          items: channelItems,
          onReorder: (ids) => reorder.mutate(ids as ChannelId[]),
          footer:
            "Появляется по кнопке связи справа от номера — в этом же порядке.",
        },
        {
          title: "Можно добавить в карточку",
          items: fieldItems,
          onReorder: (ids) => reorderFields.mutate(ids as ContactFieldId[]),
          footer:
            "Предлагается по плюсу в карточке. Номер телефона — всегда, его не отключают. Уже заполненное поле остаётся на карточке, даже если способ выключен.",
        },
      ]}
    />
  );
}
