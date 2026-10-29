import { Keyboard, Pressable } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useThemeColors } from "@/theme/colors";

import { clientMenuItems } from "./client-menu-items";
import { ICON } from "@/components/ui/tokens";

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
  /** «Записать» — первым в меню; нет — права записи нет. */
  onBook?: () => void;
  /** Нет — «Поделиться» в меню нет: клиента нельзя вынести из приложения
   *  (сотрудник). */
  onShare?: () => void;
  onToggleBlacklist: () => void;
  onDelete: () => void;
  /** Заголовок меню — имя клиента, как у долгого нажатия в списке. */
  menuTitle?: string;
  /** Имя в шапке, когда карточка с именем уехала вверх; нет — «Клиент». */
  scrolledTitle?: string | null;
  /** «Напомнить» и «В чёрный список» — «Меню клиента». */
  canEdit?: boolean;
  /** «Удалить» — «Удаление клиента». */
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
  /** «Сменить команду» — только владелец своей базы; нет — пункта нет. */
  onChangeTeam?: () => void;
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
  onBook,
  onShare,
  onToggleBlacklist,
  onDelete,
  menuTitle,
  scrolledTitle,
  canEdit = true,
  canDelete = false,
  onMerge,
  onSplit,
  onChangeTeam,
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
  // была бы дверью в никуда.
  const items = clientMenuItems(t, blacklisted, {
    onBook,
    onRemind: canEdit ? onRemind : undefined,
    onShare,
    onMerge,
    onSplit,
    onChangeTeam,
    onToggleBlacklist: canEdit ? onToggleBlacklist : undefined,
    onDelete: canDelete ? onDelete : undefined,
  });
  return (
    <>
      {/* ОБЩАЯ ШАПКА ПРОДУКТА: «Новый клиент» вписывается по размеру и
          архитектуре, как везде, — заголовок посередине. Своя шапка держала бы
          заголовок слева и 16-м кеглем. */}
      <ScreenHeader
        title={draft ? "Новый клиент" : scrolledTitle || "Клиент"}
        backTourId="client.back"
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
              <MoreHorizontal color={t.body} size={ICON.header} />
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
