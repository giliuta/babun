import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
import {
  contactWayDef,
  isWayOffered,
  useEnabledWays,
  useReorderWays,
  useToggleWay,
  useWaysOrder,
  type ContactWayId,
} from "@/features/clients/contact-ways";

// «СПОСОБЫ СВЯЗИ» — ОДИН СПИСОК (владелец 2026-09-04: «мы можем это всё в
// одну настройку пихнуть и совместить — зачем „можно добавить в карточку“ или
// „у номера“, ну типа немного странно»).
//
// Страница держала две секции, и WhatsApp с Telegram стояли в ней ДВАЖДЫ, с
// двумя галками: внутри продукта это два разных списка — каналы у номера и
// поля карточки. Различие продукта, а не человека: человек думает «мы
// работаем в WhatsApp».
//
// Теперь галка одна на способ, а что он умеет — сказано подписью строки:
// «у номера», «в карточке» или обе. Правило и перенос старых настроек живут в
// `contact-ways`.

export default function ClientChannelsScreen() {
  const order = useWaysOrder();
  const enabled = useEnabledWays();
  const toggle = useToggleWay();
  const reorder = useReorderWays();

  // ЗВОНОК В СПИСКЕ НЕ СТОИТ (владелец 2026-09-04: «зачем лишний шум
  // создавать — это можно даже не выбирать, оно идёт как стандарт, вообще
  // убирается, и всё»). Строка «Позвонить · всегда» была строкой-нельзя:
  // галка стоит, тап не работает, приписка объясняет, почему. Настройка — это
  // выбор; звонок по номеру выбором не является и остаётся первым в кнопке
  // связи сам (`pinned` в наборе), просто больше не занимает строку.
  const items = order
    .filter((id) => isWayOffered(id) && contactWayDef(id)?.optional !== false)
    .map((id) => {
      const def = contactWayDef(id);
      return def
        ? {
            id: def.id,
            label: def.label,
            icon: def.icon,
            color: def.color,
            checked: enabled.includes(def.id),
            onToggle: () => toggle.mutate(def.id),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <ToggleListScreen
      title="Способы связи"
      sections={[
        { items, onReorder: (ids) => reorder.mutate(ids as ContactWayId[]) },
      ]}
    />
  );
}
