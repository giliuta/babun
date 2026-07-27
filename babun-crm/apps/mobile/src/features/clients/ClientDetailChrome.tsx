import { Keyboard, Pressable, Text, View } from "react-native";
import { ChevronLeft, MoreHorizontal } from "lucide-react-native";
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

      {menuOpen ? (
        <>
          <Pressable
            onPress={onCloseMenu}
            className="absolute inset-0 z-10"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View
            className="absolute right-3 top-12 z-20 w-52 overflow-hidden rounded-[14px] shadow-lg"
            style={{ backgroundColor: t.surface }}
          >
            {/* «Напомнить» уехало сюда с карточки (владелец 2026-07-26:
                кнопки «Напомнить» на карточке быть не должно) — действие
                редкое, но терять его нельзя. */}
            <MenuItem label="Напомнить о клиенте" onPress={onRemind} />
            <Divider />
            <MenuItem label="Поделиться" onPress={onShare} />
            <Divider />
            <MenuItem
              label={blacklisted ? "Убрать из чёрного списка" : "В чёрный список"}
              onPress={onToggleBlacklist}
              danger={!blacklisted}
            />
            <Divider />
            <MenuItem label="Архивировать клиента" onPress={onArchive} danger />
          </View>
        </>
      ) : null}
    </>
  );
}

function Divider() {
  const t = useThemeColors();
  return <View className="h-px" style={{ backgroundColor: t.separator }} />;
}

function MenuItem({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      className={`min-h-11 justify-center px-4 py-3 active:opacity-60 ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <Text className="text-sm font-medium" style={{ color: danger ? t.danger : t.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
