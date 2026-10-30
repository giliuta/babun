import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { useSession } from "@/providers/SessionProvider";
import { useMirror } from "@/session/mirror-state";
import { useThemeColors } from "@/theme/colors";
import { personCardView } from "./person-card";
import { TourTarget } from "@/components/tour/TourTarget";

// КАРТА ЧЕЛОВЕКА — ВЕРХ КАБИНЕТА. Кабинет про человека, а не про компанию,
// поэтому карта называет его самого и ведёт в «Профиль».
//
// МИНИМАЛИЗМ: обычная белая карточка канона, как блоки под ней, — имя крупно,
// под ним почта, под ней номер, если он есть. Без аватара-кругляша и без
// цветной «витрины»: кругляш с инициалами ничего не сообщал, а градиент
// спорил с плитками строк. Имя аккаунта (компании) живёт в «Профиле».

export function PersonCard({ onPress, tourId }: { onPress?: () => void; tourId?: string }) {
  const t = useThemeColors();
  const { session } = useSession();
  // В ЗЕРКАЛЕ КАРТА — ТОГО, ЗА КЕМ СМОТРЯТ. Сессия в зеркале ваша, и карта
  // печатала имя, почту и телефон владельца, а тап вёл в его «Профиль».
  // Знаем о нём только имя — его и печатаем, без почты и без двери.
  const mirror = useMirror();
  const view = mirror
    ? personCardView({ user_metadata: { full_name: mirror.name } })
    : personCardView(session?.user);
  const door = mirror ? undefined : onPress;
  const label = door ? `${view.title}, открыть профиль` : view.title;

  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ ...TYPE.title, color: t.ink }}>
          {view.title}
        </Text>
        {view.lines.map((line) => (
          <Text
            key={line.kind}
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ ...TYPE.body, color: t.sub, fontVariant: line.kind === "phone" ? ["tabular-nums"] : undefined }}
          >
            {line.text}
          </Text>
        ))}
      </View>
      {door ? <ChevronRight color={t.chevron} size={18} strokeWidth={1.75} /> : null}
    </View>
  );

  return (
    // Обучение подсвечивает саму карточку — без полей вокруг неё.
    <TourTarget id={tourId ?? "cabinet.person"}>
      <SectionCard>
        {door ? (
          <Pressable
            onPress={door}
            accessibilityRole="button"
            accessibilityLabel={label}
            // НАЖАТИЕ УГЛУБЛЯЕТ МАТЕРИАЛ, а не гасит карту прозрачностью —
            // тот же закон, что у `SettingsRow`.
            style={({ pressed }) => ({ backgroundColor: pressed ? t.pressed : "transparent" })}
          >
            {content}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={label}>
            {content}
          </View>
        )}
      </SectionCard>
    </TourTarget>
  );
}
