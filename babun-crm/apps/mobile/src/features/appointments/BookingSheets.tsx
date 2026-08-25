import {
  Modal,
  Pressable,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PRESET_COLOR_VALUES } from "@babun/shared/common/utils/colors";

import { Chip } from "@/components/ui/Chip";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { useThemeColors } from "@/theme/colors";
import { useReduceMotion } from "@/lib/reduce-motion";

const EVENT_COLORS = PRESET_COLOR_VALUES;

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

export function TeamMasterSheet({
  visible,
  onClose,
  teams,
  masters,
  teamId,
  masterId,
  onPickTeam,
  onPickMaster,
}: {
  visible: boolean;
  onClose: () => void;
  teams: { id: string; name: string; color?: string | null }[];
  masters: { id: string; full_name: string; team_id: string | null }[];
  teamId: string | null;
  masterId: string | null;
  onPickTeam: (id: string) => void;
  onPickMaster: (id: string | null) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const teamMasters = masters.filter(
    (m) => !teamId || m.team_id === teamId || m.team_id == null,
  );
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: t.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View
          style={{
            backgroundColor: t.canvas,
            borderTopLeftRadius: t.radius.card,
            borderTopRightRadius: t.radius.card,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View
            className="flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
          >
            <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>Команда и мастер</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Закрыть выбор команды и мастера"
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Готово</Text>
            </Pressable>
          </View>
          <View className="px-4 pt-3">
            <Text style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}>
              БРИГАДА
            </Text>
            {teams.length > 0 ? (
              <View className="mt-2 flex-row flex-wrap gap-2">
                {teams.map((tm) => (
                  <Chip
                    key={tm.id}
                    label={tm.name}
                    variant="outline"
                    color={tm.color ?? t.accent}
                    selected={teamId === tm.id}
                    radio
                    onPress={() => onPickTeam(tm.id)}
                  />
                ))}
              </View>
            ) : (
              <View
                className="mt-2 rounded-[10px] px-4 py-4"
                style={{ backgroundColor: t.surface }}
              >
                <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                  Команд пока нет
                </Text>
                <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}>
                  Сначала создайте команду в кабинете, затем вернитесь к заявке.
                </Text>
              </View>
            )}
          </View>
          {teamMasters.length > 0 ? (
            <View className="px-4 pt-4">
              <Text style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}>
                МАСТЕР
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {teamMasters.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.full_name}
                    variant="tint"
                    selected={masterId === m.id}
                    radio
                    onPress={() => onPickMaster(masterId === m.id ? null : m.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function ColorSheet({
  visible,
  onClose,
  value,
  onPick,
  isEvent,
}: {
  visible: boolean;
  onClose: () => void;
  value: string | null;
  onPick: (c: string | null) => void;
  isEvent?: boolean;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const entity = isEvent ? "событие" : "запись";
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? "none" : "slide"}
      onRequestClose={onClose}
    >
      {/* Лёгкий скрим (12% вместо 30%): пока выбираешь цвет, вся страница за
          шитом уже подсвечивается им — и это видно в истинном цвете. */}
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,18,32,0.12)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View
          style={{
            backgroundColor: t.canvas,
            borderTopLeftRadius: t.radius.card,
            borderTopRightRadius: t.radius.card,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View
            className="px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
          >
            <View className="flex-row items-center justify-between">
              <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>
                {isEvent ? "Цвет события" : "Цвет записи"}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Закрыть выбор цвета"
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Готово</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>
              Цветом отмечаете {entity} в календаре
            </Text>
          </View>
          <View className="px-4 py-4">
            <View className="mb-3 self-start">
              <Chip
                label="По умолчанию"
                radio
                variant="tint"
                selected={value == null}
                onPress={() => onPick(null)}
              />
            </View>
            <ColorPicker
              label={null}
              colors={EVENT_COLORS}
              value={value}
              onChange={onPick}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
