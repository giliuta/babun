import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, MapPin, Settings } from "lucide-react-native";
import { parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// Пикер метки дня — web parity CityPickerModal (Sprint 029): центрированная
// iOS-карточка. Шапка: шестерёнка «Настройки меток» (страница меток команды)
// + «Метка» + дата; список — тонированная плитка-пин, имя, галочка на
// активной. Тап по активной строке снимает метку (web v501 — отдельного
// «Снять метку» нет, v693).

export interface CityOption {
  name: string;
  color: string;
}

export function CityPickerModal({
  visible,
  dateKey,
  options,
  selected,
  onPick,
  onClear,
  onClose,
  onSettings,
}: {
  visible: boolean;
  /** YYYY-MM-DD дня, чью метку меняем — подзаголовок шапки. */
  dateKey: string;
  options: CityOption[];
  /** Текущая метка дня (имя) или "". */
  selected: string;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Шестерёнка в шапке — настройки меток активной команды. */
  onSettings?: () => void;
}) {
  const t = useThemeColors();
  const dateLabel = (() => {
    const s = parseYMD(dateKey).toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const handlePick = (name: string) => {
    // Тап по активной метке = снять её (web v501: «не могу отменить выбор»).
    if (name === selected) onClear();
    else onPick(name);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundColor: t.scrim,
        }}
      >
        {/* stopPropagation: тап по карточке не закрывает модалку */}
        <Pressable
          onPress={() => {}}
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 14,
            overflow: "hidden",
            paddingBottom: 12,
            backgroundColor: t.canvas,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            className="flex-row items-center gap-3 px-4 pb-3 pt-4"
            style={{
              backgroundColor: t.surface,
              borderBottomWidth: 1,
              borderBottomColor: t.separator,
            }}
          >
            {onSettings ? (
              <Pressable
                onPress={onSettings}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Настройки меток"
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
              >
                <Settings color={t.sub} size={20} strokeWidth={2} />
              </Pressable>
            ) : null}
            <View style={{ minWidth: 0 }}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>
                Метка
              </Text>
              <Text style={{ marginTop: 2, fontSize: 13, color: t.sub }}>
                {dateLabel}
              </Text>
            </View>
          </View>

          <View className="mx-3 mt-3 overflow-hidden rounded-[14px]" style={{ backgroundColor: t.surface }}>
            <ScrollView style={{ maxHeight: 380 }} bounces={false}>
              {options.length === 0 ? (
                <Text className="px-4 py-3 text-sm" style={{ color: t.faint }}>
                  У команды пока нет меток — добавьте их через шестерёнку
                  выше.
                </Text>
              ) : (
                options.map((o, i) => {
                  const active = o.name === selected;
                  return (
                    <View key={o.name}>
                      {i > 0 ? (
                        <View style={{ height: 1, backgroundColor: t.separator }} />
                      ) : null}
                      <Pressable
                        onPress={() => handlePick(o.name)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={
                          active ? `${o.name} — снять метку` : o.name
                        }
                        className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                        style={{ minHeight: 48 }}
                      >
                        <View
                          className="items-center justify-center"
                          style={{
                            height: 28,
                            width: 28,
                            borderRadius: 7,
                            backgroundColor: o.color,
                          }}
                        >
                          <MapPin color={t.onAccent} size={16} strokeWidth={2.2} />
                        </View>
                        <Text
                          className="flex-1"
                          style={{ fontSize: 15, fontWeight: "500", color: t.ink }}
                        >
                          {o.name}
                        </Text>
                        {active ? (
                          <Check color={t.accent} size={18} strokeWidth={2.5} />
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
