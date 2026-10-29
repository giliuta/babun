import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { GUTTER } from "@/components/ui/tokens";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useClientTeamChoices } from "@/features/clients/use-client-team-choices";

// «КОМАНДА: Y&D ›» — ТИХОЙ СТРОКОЙ НАД КАРТОЧКОЙ НОВОГО КЛИЕНТА.
//
// Без чипа клиент уходил в первую команду компании, и это могла быть скрытая
// в ленте «My» — клиента потом не находили в списке. Команда теперь видна до
// «Создать клиента», и её можно сменить: варианты — живые команды, видимые в
// ленте (`useClientTeamChoices`). Одна команда — выбирать не из чего, строки
// нет. Вид — как у строки «Номер уже есть»: без подложки, значок, шеврон.

export function ClientTeamRow({
  teamId,
  onPick,
}: {
  teamId: string | null;
  onPick: (teamId: string) => void;
}) {
  const t = useThemeColors();
  const { choices } = useClientTeamChoices();
  const [open, setOpen] = useState(false);
  if (choices.length < 2) return null;
  const team = choices.find((tm) => tm.id === teamId) ?? null;
  const name = team?.name ?? "не выбрана";
  const color = team ? team.color || getAvatarColor(team.name) : t.faint;
  return (
    <>
      <Pressable
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Команда: ${name}`}
        accessibilityHint="Открывает выбор команды"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          paddingHorizontal: GUTTER + 4,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 13, color: t.sub }}
        >
          {`Команда: ${name}`}
        </Text>
        <ChevronRight color={t.sub} size={15} strokeWidth={2} />
      </Pressable>
      <ClientTeamSheet
        visible={open}
        teamId={teamId}
        onPick={onPick}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** Шторка выбора команды клиента — у строки нового клиента и у пункта
 *  «Сменить команду» в «⋯» карточки. Варианты — `useClientTeamChoices`. */
export function ClientTeamSheet({
  visible,
  teamId,
  onPick,
  onClose,
}: {
  visible: boolean;
  teamId: string | null;
  onPick: (teamId: string) => void;
  onClose: () => void;
}) {
  const { choices } = useClientTeamChoices();
  return (
    <ValuePickerSheet
      visible={visible}
      title="Команда клиента"
      options={choices.map((tm) => ({
        id: tm.id,
        label: tm.name,
        color: tm.color || getAvatarColor(tm.name),
      }))}
      selectedId={teamId}
      onPick={(id) => {
        onClose();
        if (id && id !== teamId) onPick(id);
      }}
      onClose={onClose}
    />
  );
}
