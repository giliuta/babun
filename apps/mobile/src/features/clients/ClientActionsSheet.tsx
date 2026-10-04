import type { Client } from "@babun/shared/local/clients";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { useLastNonNull } from "@/lib/use-last-non-null";
import { useThemeColors } from "@/theme/colors";

import { clientMenuItems } from "./client-menu-items";
import type { ShareTextOptions } from "./client-share";
import { useCardAccess } from "./use-card-access";

// МЕНЮ КЛИЕНТА по long-press в списке.
//
// СВЯЗИ ЗДЕСЬ НЕТ (2026-08-06). Раньше первыми тремя строками стояли
// «Позвонить · Сообщение · WhatsApp» — те же действия, что в зелёной кнопке
// строки и на обоих свайпах: четыре дороги к одному глаголу. Хуже, эти три
// строки НЕ читали настройку «Способы связи»: тенант, выключивший SMS, всё
// равно её здесь получал, а Telegram и Viber не появлялись никогда. Связь
// живёт ровно в одном месте — в кнопке у номера, которая уважает и набор, и
// порядок каналов.
//
// Осталось то, чего в кнопке нет: записать, отложить, поделиться, пометить,
// удалить. «Напомнить» и «Удалить» продублированы свайпами строки (владелец
// 03.10) — жест быстрее, лист обнаруживаемее, и по закону продукта у
// действия должна быть видимая дорога, а не только жест.
//
// Сам лист — канонический `PickerSheet`: был самописный `Modal
// animationType="slide"`, что DS запрещает дословно. Пункты — общие с «⋯»
// страницы клиента (`clientMenuItems`, владелец 03.10: «это одно и то же»).

interface ClientActionsSheetProps {
  /** null → лист закрыт. */
  client: Client | null;
  onClose: () => void;
  /** Пункт стоит, только если есть обработчик (STORY-088, волна 4): нет
   *  права — нет и пункта, а не пункт, который кончится отказом. */
  onBook?: (c: Client) => void;
  /** Нет — пункта «Выбрать несколько» нет: за ним экспорт и массовая SMS,
   *  а клиента чужой компании не выносят (владелец 30.09). */
  onSelectMany?: (c: Client) => void;
  onRemind?: (c: Client) => void;
  /** Нет — «Поделиться» нет: клиента нельзя вынести (партнёр, 30.09).
   *  `opts.requisites` — реквизиты видны так же, как на карточке, в компании
   *  ЛИСТА: вызывающий оборачивает лист источником строки (03.10). */
  onShare?: (c: Client, opts: ShareTextOptions) => void;
  onToggleBlacklist?: (c: Client) => void;
  onDelete?: (c: Client) => void;
}

export function ClientActionsSheet({
  client,
  onClose,
  onBook,
  onSelectMany,
  onRemind,
  onShare,
  onToggleBlacklist,
  onDelete,
}: ClientActionsSheetProps) {
  const t = useThemeColors();
  // Держим последнего клиента, пока лист уезжает: ранний `return null` на
  // закрытии размонтировал лист в том же кадре, и вся выездная анимация
  // BottomSheet не проигрывалась — панель просто исчезала.
  const shown = useLastNonNull(client);
  // «ПОДЕЛИТЬСЯ» — ТОТ ЖЕ ТЕКСТ, ЧТО ИЗ «⋯» КАРТОЧКИ (аудит 03.10): реквизиты
  // уходят, только когда блок «Реквизиты» виден на карточке — выключатели
  // компании и команды клиента и права строки. Компания — источник вокруг
  // листа: у строки работодателя это его компания, а не своя.
  const requisites = useCardAccess(shown, false).requisites.show;
  if (!shown) return null;

  const c = shown;
  const items = clientMenuItems(t, Boolean(c.blacklisted), {
    onBook: onBook && (() => onBook(c)),
    onRemind: onRemind && (() => onRemind(c)),
    onShare: onShare && (() => onShare(c, { requisites })),
    onSelectMany: onSelectMany && (() => onSelectMany(c)),
    onToggleBlacklist: onToggleBlacklist && (() => onToggleBlacklist(c)),
    onDelete: onDelete && (() => onDelete(c)),
  });

  return (
    <PickerSheet
      visible={client !== null}
      title={c.full_name || c.phone || "Клиент"}
      items={items}
      onClose={onClose}
    />
  );
}

export default ClientActionsSheet;
