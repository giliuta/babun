import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Check, Search } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useClients } from "@/features/clients/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВЫБОР КЛИЕНТА ИЗ СПИСКА — лист с поиском.
//
// PickerSheet отвечает на вопрос «что сделать» из пяти-шести вариантов; здесь
// вариантов сотни, поэтому нужен поиск. Всё остальное — тот же диалект: та же
// шапка, тот же ритм строки 52pt, тот же кружок 28pt слева (только с
// инициалами вместо значка), галка у выбранного.

const AVATAR = 28;

export function ClientPickerSheet({
  visible,
  title,
  selectedId,
  excludeId,
  onSelect,
  onClear,
  clearLabel,
  onClose,
}: {
  visible: boolean;
  title: string;
  selectedId?: string | null;
  /** Кого не предлагать (себя же). */
  excludeId?: string | null;
  onSelect: (client: Client) => void;
  onClear?: () => void;
  clearLabel?: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const { data: all = [] } = useClients();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const base = all.filter((c) => c.id !== excludeId && !c.deleted_at);
    const q = query.trim();
    const found = q ? base.filter((c) => matchesClient(c, q)) : base;
    // Без запроса длинный список бесполезен — показываем начало, поиск
    // добирает остальное.
    return q ? found.slice(0, 50) : found.slice(0, 30);
  }, [all, excludeId, query]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      maxHeightRatio={0.7}
      avoidKeyboard
    >
      <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginHorizontal: 20,
          marginBottom: 10,
          paddingHorizontal: 12,
          minHeight: 40,
          borderRadius: t.radius.input,
          backgroundColor: t.fill,
        }}
      >
        <Search color={t.faint} size={16} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Имя или телефон"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoCorrect={false}
          maxFontSizeMultiplier={1.2}
          accessibilityLabel="Поиск клиента"
          style={{ flex: 1, fontSize: 15, color: t.ink }}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 8 }}
        ListEmptyComponent={
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              paddingVertical: 18,
              textAlign: "center",
              fontSize: 13,
              color: t.faint,
            }}
          >
            Никого не нашли
          </Text>
        }
        renderItem={({ item }) => {
          const name = item.full_name || item.phone || "Без имени";
          const chosen = item.id === selectedId;
          return (
            <Pressable
              onPress={() => {
                haptics.tap();
                onSelect(item);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={name}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 52,
                paddingHorizontal: 14,
                borderRadius: t.radius.input,
                backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
              })}
            >
              <View
                style={{
                  width: AVATAR,
                  height: AVATAR,
                  borderRadius: AVATAR / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${getAvatarColor(name)}33`,
                }}
              >
                <Text
                  maxFontSizeMultiplier={1.1}
                  style={{ fontSize: 11, fontWeight: "700", color: t.ink }}
                >
                  {name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {name}
                </Text>
                {item.phone ? (
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    style={{ fontSize: 13, color: t.sub }}
                  >
                    {item.phone}
                  </Text>
                ) : null}
              </View>
              {chosen ? (
                <Check color={t.accent} size={18} strokeWidth={2.4} />
              ) : null}
            </Pressable>
          );
        }}
      />

      {onClear && selectedId ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onClear();
            onClose();
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginHorizontal: 20,
            marginBottom: 20,
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.input,
            backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: t.danger }}
          >
            {clearLabel ?? "Убрать"}
          </Text>
        </Pressable>
      ) : (
        <View style={{ height: 20 }} />
      )}
    </BottomSheet>
  );
}

export default ClientPickerSheet;
