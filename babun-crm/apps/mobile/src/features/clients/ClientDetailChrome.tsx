import { Keyboard, Pressable, Text, View } from "react-native";
import {
  Archive,
  Ban,
  Bell,
  ChevronLeft,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { useThemeColors } from "@/theme/colors";

interface ClientDetailChromeProps {
  draft: boolean;
  canSave: boolean;
  saving: boolean;
  menuOpen: boolean;
  blacklisted: boolean;
  onBack: () => void;
  onSave: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRemind: () => void;
  onShare: () => void;
  onToggleBlacklist: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function ClientDetailChrome({
  draft,
  canSave,
  saving,
  menuOpen,
  blacklisted,
  onBack,
  onSave,
  onToggleMenu,
  onCloseMenu,
  onRemind,
  onShare,
  onToggleBlacklist,
  onArchive,
  onDelete,
}: ClientDetailChromeProps) {
  const t = useThemeColors();
  // Кнопки хедера живут ВЫШЕ прокрутки с полями и фокус у поля не забирают:
  // без явного снятия клавиатуры набранное в открытом поле не успевало
  // закоммититься ни по «Готово», ни по «Назад».
  const withCommit = (run: () => void) => () => {
    Keyboard.dismiss();
    run();
  };
  return (
    <>
      <View
        className="flex-row items-center border-b px-2 py-2"
        style={{ borderColor: t.separator }}
      >
        <Pressable
          onPress={withCommit(onBack)}
          disabled={saving}
          className="h-11 w-11 items-center justify-center rounded-[14px] active:opacity-60"
          accessibilityRole="button"
          accessibilityLabel="Назад"
          accessibilityState={{ disabled: saving, busy: saving }}
          style={{ opacity: saving ? 0.4 : 1 }}
        >
          <ChevronLeft color={t.body} size={22} />
        </Pressable>
        <Text className="flex-1 text-base font-semibold" style={{ color: t.ink }}>
          {draft ? "Новый клиент" : "Клиент"}
        </Text>
        {draft ? (
          <Pressable
            onPress={withCommit(onSave)}
            disabled={!canSave || saving}
            accessibilityRole="button"
            accessibilityLabel="Готово — сохранить клиента"
            accessibilityState={{ disabled: !canSave || saving, busy: saving }}
            className="h-11 items-center justify-center rounded-[14px] px-3 active:opacity-60"
          >
            <Text
              className="text-[15px] font-semibold"
              style={{ color: canSave && !saving ? t.accent : t.faint }}
            >
              {saving ? "Сохраняю…" : "Готово"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onToggleMenu}
            disabled={saving}
            className="h-11 w-11 items-center justify-center rounded-[14px] active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel="Действия с клиентом"
            accessibilityState={{ expanded: menuOpen, disabled: saving, busy: saving }}
          >
            <MoreHorizontal color={t.body} size={22} />
          </Pressable>
        )}
      </View>

      <PickerSheet
        visible={menuOpen}
        title="Клиент"
        items={[
          {
            id: "remind",
            label: "Напомнить",
            icon: Bell,
            color: t.accent,
            onPress: onRemind,
          },
          {
            id: "share",
            label: "Поделиться",
            icon: Share2,
            color: t.accent,
            onPress: onShare,
          },
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
        ]}
        onClose={onCloseMenu}
      />
    </>
  );
}
