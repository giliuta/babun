import { Keyboard, Pressable } from "react-native";
import {
  Archive,
  Ban,
  Bell,
  Merge,
  MoreHorizontal,
  Pin,
  Share2,
  Split,
  Trash2,
} from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useThemeColors } from "@/theme/colors";

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
  onShare: () => void;
  onToggleBlacklist: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Карточка правится: без этого в меню нет «Напомнить». */
  canEdit?: boolean;
  /** Хозяйство базы — чёрный список, архив, удаление. У клиента компании,
   *  где человек только работает, этих строк нет: пометки общие для всей
   *  компании, и ведёт их её владелец. */
  canManage?: boolean;
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
  /** Клиент закреплён наверху списка (`pinned_at`). */
  pinned?: boolean;
  /** «Закрепить / Открепить» — то же, что в долгом нажатии по строке списка
   *  (`ClientActionsSheet`), и тем же писателем. Пункт есть, только когда
   *  страница его передала: а передаёт она его по тому же праву, по какому
   *  список открывает своё меню. */
  onTogglePin?: () => void;
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
  onArchive,
  onDelete,
  canEdit = true,
  canManage = true,
  onMerge,
  onSplit,
  onMenuExited,
  pinned = false,
  onTogglePin,
}: ClientDetailChromeProps) {
  const t = useThemeColors();
  // Кнопки хедера живут ВЫШЕ прокрутки с полями и фокус у поля не забирают:
  // без явного снятия клавиатуры набранное в открытом поле не успевало
  // закоммититься по «Назад». Футер черновика снимает её сам.
  const withCommit = (run: () => void) => () => {
    Keyboard.dismiss();
    run();
  };
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
          draft ? null : (
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
        title="Клиент"
        items={[
          ...(canEdit
            ? [
                {
                  id: "remind",
                  label: "Напомнить",
                  icon: Bell,
                  color: t.accent,
                  onPress: onRemind,
                },
              ]
            : []),
          ...(onTogglePin
            ? [
                {
                  id: "pin",
                  label: pinned ? "Открепить" : "Закрепить",
                  icon: Pin,
                  color: t.accent,
                  onPress: onTogglePin,
                },
              ]
            : []),
          {
            id: "share",
            label: "Поделиться",
            icon: Share2,
            color: t.accent,
            onPress: onShare,
          },
          ...(onMerge
            ? [
                {
                  id: "merge",
                  label: "Объединить с дублем",
                  icon: Merge,
                  color: t.accent,
                  onPress: onMerge,
                },
              ]
            : []),
          ...(onSplit
            ? [
                {
                  id: "split",
                  label: "Разделить клиента",
                  icon: Split,
                  color: t.accent,
                  onPress: onSplit,
                },
              ]
            : []),
          ...(canManage
            ? [
          {
            id: "blacklist",
            label: blacklisted ? "Убрать из чёрного списка" : "В чёрный список",
            icon: Ban,
            color: blacklisted ? t.accent : t.danger,
            onPress: onToggleBlacklist,
          },
          {
            // ДВА РАЗНЫХ ИСХОДА, а не один с разной силой. Архив — «больше
            // не работаем, история цела, срока нет». Удаление — корзина на
            // 30 дней и потом насовсем. Раньше был только архив, и удалить
            // клиента, заведённого по ошибке, было нечем.
            id: "archive",
            label: "В архив",
            icon: Archive,
            color: t.accent,
            onPress: onArchive,
          },
          {
            id: "delete",
            label: "Удалить",
            icon: Trash2,
            color: t.danger,
            onPress: onDelete,
          },
              ]
            : []),
        ]}
        onClose={onCloseMenu}
        onExited={onMenuExited}
      />
    </>
  );
}
