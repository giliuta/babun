import { Keyboard, Pressable } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useThemeColors } from "@/theme/colors";

import { clientMenuItems } from "./client-menu-items";

// ХРОМ КАРТОЧКИ КЛИЕНТА — «НАЗАД», ЗАГОЛОВОК И «⋯».
//
// «ГОТОВО» ЗДЕСЬ БОЛЬШЕ НЕТ (STORY-086). Единственное действие черновика
// уехало вниз, в футер страницы (`ClientScreenFooter`): правый верхний угол —
// то место экрана, куда большой палец не дотягивается, и «Готово» было
// последним действием продукта наверху — запись, событие, инвойс и лист
// объекта давно кончаются плитой внизу. У сохранённой карточки действия нет
// вовсе: это контактная база, а не форма.
//
// Слот справа при этом остаётся ШИРИНОЙ 44pt и в черновике: шапка черновика
// и сохранённой карточки — одна геометрия. После «Создать клиента» экран
// сменяется карточкой, и строка заголовка не должна менять ни высоту, ни
// место, где обрезается длинное слово.

interface ClientDetailChromeProps {
  draft: boolean;
  /** Идёт создание: «назад» на это время заперт — черновик ещё пишется. */
  saving: boolean;
  menuOpen: boolean;
  blacklisted: boolean;
  onBack: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRemind: () => void;
  /** Нет — «Поделиться» в меню нет: клиента нельзя вынести из приложения
   *  (сотрудник, владелец 30.09). */
  onShare?: () => void;
  onToggleBlacklist: () => void;
  onDelete: () => void;
  /** Заголовок меню — имя клиента, как у долгого нажатия в списке. */
  menuTitle?: string;
  /** «Напомнить» и «В чёрный список» — «Меню клиента» (владелец 03.10). */
  canEdit?: boolean;
  /** «Удалить» — «Удаление клиента» (владелец 03.10). */
  canDelete?: boolean;
  /** «Объединить с дублем». Пункт есть, только когда страница его передала:
   *  заглушки без действия в меню не бывает. Когда слить нельзя (у дубля есть
   *  люди — `mergeBlocker`), страница всё равно передаёт обработчик и
   *  говорит причину словами по нажатию — пропавший пункт ничего не объяснит. */
  onMerge?: () => void;
  /** «Разделить клиента» — вынести дополнительный номер отдельным человеком
   *  (STORY-086, сценарий ж). Пункт есть, только когда страница его передала:
   *  а передаёт она его, лишь когда выносить есть что (`canSplitClient`). */
  onSplit?: () => void;
  /** Меню ушло и его окно снято — отсюда поднимается следующая шторка
   *  (iOS не показывает вторую модалку, пока первая не ушла). */
  onMenuExited?: () => void;
}

export function ClientDetailChrome({
  draft,
  saving,
  menuOpen,
  blacklisted,
  onBack,
  onToggleMenu,
  onCloseMenu,
  onRemind,
  onShare,
  onToggleBlacklist,
  onDelete,
  menuTitle,
  canEdit = true,
  canDelete = false,
  onMerge,
  onSplit,
  onMenuExited,
}: ClientDetailChromeProps) {
  const t = useThemeColors();
  // Кнопки хедера живут ВЫШЕ прокрутки с полями и фокус у поля не забирают:
  // без явного снятия клавиатуры набранное в открытом поле не успевало
  // закоммититься по «Назад». Футер черновика снимает её сам.
  const withCommit = (run: () => void) => () => {
    Keyboard.dismiss();
    run();
  };
  // Пункты — по праву на этого клиента. Нет ни одного (карточка «Только
  // видит» чужого клиента) — нет и «⋯»: пустая шторка с одним заголовком
  // была дверью в никуда (проверка глазами 30.09).
  const items = clientMenuItems(t, blacklisted, {
    onRemind: canEdit ? onRemind : undefined,
    onShare,
    onMerge,
    onSplit,
    onToggleBlacklist: canEdit ? onToggleBlacklist : undefined,
    onDelete: canDelete ? onDelete : undefined,
  });
  return (
    <>
      {/* ОБЩАЯ ШАПКА ПРОДУКТА (владелец 22.09: «„Новый клиент“ должен
          вписываться по такому же размеру и архитектуре, как у нас везде —
          посередине»). Своя шапка держала заголовок слева и 16-м кеглем. */}
      <ScreenHeader
        title={draft ? "Новый клиент" : "Клиент"}
        // Пока идёт запись, «назад» молчит: уход посреди сохранения терял бы
        // правку, которую строка ещё не донесла.
        onBack={saving ? () => {} : withCommit(onBack)}
        right={
          draft || items.length === 0 ? null : (
            <Pressable
              onPress={onToggleMenu}
              disabled={saving}
              className="h-11 w-11 items-center justify-center rounded-[10px] active:opacity-60"
              accessibilityRole="button"
              accessibilityLabel="Действия с клиентом"
              accessibilityState={{ expanded: menuOpen, disabled: saving, busy: saving }}
            >
              <MoreHorizontal color={t.body} size={22} />
            </Pressable>
          )
        }
      />

      <PickerSheet
        visible={menuOpen}
        title={menuTitle || "Клиент"}
        items={items}
        onClose={onCloseMenu}
        onExited={onMenuExited}
      />
    </>
  );
}
