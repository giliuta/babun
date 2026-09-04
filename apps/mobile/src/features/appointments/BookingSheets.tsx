import { Text as NativeText, Pressable, View, type TextProps } from "react-native";
import { Check } from "lucide-react-native";
import { PRESET_COLOR_VALUES } from "@babun/shared/common/utils/colors";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

const EVENT_COLORS = PRESET_COLOR_VALUES;
/** Боковое поле листов: они идут `padded={false}`, поля ставим сами — одно
 *  число на строки и на кнопку (закон одного хозяина отступа). */
const SIDE = 20;

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

// ОБА ЛИСТА — КАНОНИЧЕСКИЙ `BottomSheet` (владелец 2026-09-04: «справа
// „Готово" — нет такого у нас по архитектуре: у нас есть нижняя кнопка, и
// там нажимается „Применить"»; про команду — «выбор команды, оно снизу вверх
// открывается, всё та же архитектура»).
//
// Раньше это были самописные `Modal animationType="slide"` со своей шапкой и
// «Готово» в её правом углу — ровно то, что DS запрещает: примитив тянет
// вверх ВЕСЬ серый прямоугольник, а действие листа живёт в футере, вне
// прокрутки и над home-индикатором.

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
  const teamMasters = masters.filter(
    (m) => !teamId || m.team_id === teamId || m.team_id == null,
  );
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Команда"
      padded={false}
      scroll
      maxHeightRatio={0.5}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      {/* СТРОКА КОМАНДЫ — ТОТ ЖЕ ДИАЛЕКТ, ЧТО У ВЫБОРА КЛИЕНТА И ОБЪЕКТА:
          52pt на подложке, цвет команды точкой слева, галка у выбранной.
          Пилюли-чипы здесь были единственным местом в продукте, где сущность
          выбирают лентой, — а выбирают её ровно так же, как клиента. */}
      <View style={{ paddingHorizontal: SIDE, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
        {teams.length > 0 ? (
          teams.map((team) => {
            const chosen = teamId === team.id;
            return (
              <Pressable
                key={team.id}
                onPress={() => onPickTeam(team.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`Команда ${team.name}`}
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
                    width: 10,
                    height: 10,
                    borderRadius: t.radius.pill,
                    backgroundColor: team.color ?? t.accent,
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {team.name}
                </Text>
                {chosen ? (
                  <Check color={t.accent} size={18} strokeWidth={2.4} />
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <View style={{ paddingVertical: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
              Команд пока нет
            </Text>
            <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}>
              Сначала создайте команду в кабинете, затем вернитесь к заявке.
            </Text>
          </View>
        )}
      </View>

      {/* МАСТЕР — необязательный и редкий выбор (1 запись из 30), поэтому
          лентой чипов под командой, а не вторым списком строк. */}
      {teamMasters.length > 0 ? (
        <View style={{ paddingHorizontal: SIDE, paddingBottom: 12 }}>
          <Text
            style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}
          >
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
    </BottomSheet>
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
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={isEvent ? "Цвет события" : "Цвет записи"}
      padded={false}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          {/* «ПРИМЕНИТЬ» ВНИЗУ, А НЕ «ГОТОВО» В УГЛУ ШАПКИ (владелец
              2026-09-04). Цвет виден сразу — вся страница за листом уже
              подсвечена им, — поэтому кнопка только закрывает. */}
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: SIDE, paddingBottom: 8 }}>
        <View className="mb-3 self-start">
          <Chip
            label="По умолчанию"
            radio
            variant="tint"
            selected={value == null}
            onPress={() => {
              haptics.tap();
              onPick(null);
            }}
          />
        </View>
        <ColorPicker
          label={null}
          colors={EVENT_COLORS}
          value={value}
          onChange={onPick}
        />
      </View>
    </BottomSheet>
  );
}

export default ColorSheet;
