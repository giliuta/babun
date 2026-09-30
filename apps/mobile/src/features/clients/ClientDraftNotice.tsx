import { Pressable, Text, View } from "react-native";
import { ChevronRight, PhoneOff } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// «НОМЕР УЖЕ ЕСТЬ» — ТИХОЙ СТРОКОЙ НАД БЛОКОМ «КЛИЕНТ».
//
// Владелец 30.09: «если находит дубль — не даёт сдать, сразу плашка сверху»;
// в тот же вечер, увидев карточку-плашку: «очень жёсткая, не надо вовсю
// плашку». Поэтому одна строка без подложки: значок, кто владеет номером,
// шеврон. Тап — существующий клиент (из записи — выбрать его); «Создать
// клиента» погашена, а почему — говорит подпись над ней.

interface ClientDraftNoticeProps {
  duplicate: Client | null;
  error: string | null;
  onOpenDuplicate: (id: string) => void;
  /** Из записи дубль ВЫБИРАЮТ, а не открывают. */
  openLabel?: string;
}

export function ClientDraftNotice({
  duplicate,
  error,
  onOpenDuplicate,
  openLabel = "Открыть",
}: ClientDraftNoticeProps) {
  const t = useThemeColors();
  if (!duplicate && !error) return null;
  const name = duplicate?.full_name.trim() || "у другого клиента";

  const line = (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: GUTTER + 4,
        paddingTop: 10,
        paddingBottom: 2,
      }}
    >
      <PhoneOff color={duplicate ? t.warning : t.danger} size={15} strokeWidth={2} />
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ flex: 1, fontSize: 13, color: duplicate ? t.warning : t.danger }}
      >
        {duplicate ? `Номер уже есть — ${name}` : error}
      </Text>
      {duplicate ? <ChevronRight color={t.warning} size={15} strokeWidth={2} /> : null}
    </View>
  );

  if (!duplicate) return line;
  return (
    <Pressable
      onPress={() => onOpenDuplicate(duplicate.id)}
      accessibilityRole="button"
      accessibilityLabel={`${openLabel} клиента ${name}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {line}
    </Pressable>
  );
}
