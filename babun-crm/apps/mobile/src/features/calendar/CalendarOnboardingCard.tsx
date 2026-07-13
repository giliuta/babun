import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { ICON } from "@/components/ui/tokens";

// First-run onboarding card — web CalendarOnboardingCard (STORY-060 §F1.1)
// parity, mobile-simplified: floats over the empty grid while the tenant has
// zero clients, zero services and zero appointments. Steps 1–2 deep-link into
// the create flows; step 3 teaches the tap-a-slot gesture (no action).
// Dismissal is session-only state held by the parent (web persists to
// localStorage; the card self-clears anyway once real data appears).
export function CalendarOnboardingCard({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();

  const steps: { n: number; label: string; onPress?: () => void }[] = [
    {
      n: 1,
      label: "Добавьте клиента",
      onPress: () => router.push("/clients/new"),
    },
    {
      n: 2,
      label: "Заведите услугу",
      onPress: () => router.push("/cabinet/services"),
    },
    { n: 3, label: "Тапните по свободному слоту — создастся запись" },
  ];

  return (
    // box-none: only the card itself catches touches — the grid, header and
    // tab bar around it stay fully interactive (web pointer-events parity).
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: t.surface,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.separator,
          padding: 20,
          boxShadow: t.cardShadow,
        }}
      >
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Скрыть подсказку"
          className="active:opacity-60"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            height: 28,
            width: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          <X color={t.faint} size={ICON.xs} strokeWidth={2.2} />
        </Pressable>

        <Text
          style={{
            fontSize: 17,
            fontWeight: "600",
            color: t.ink,
            marginBottom: 14,
          }}
        >
          Начните за 3 шага
        </Text>

        <View style={{ gap: 8 }}>
          {steps.map((s) => (
            <StepRow key={s.n} n={s.n} label={s.label} onPress={s.onPress} />
          ))}
        </View>
      </View>
    </View>
  );
}

function StepRow({
  n,
  label,
  onPress,
}: {
  n: number;
  label: string;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const rowStyle = {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: t.radius.input,
    backgroundColor: t.fill,
  } as const;
  const body = (
    <>
      <View
        style={{
          height: 28,
          width: 28,
          borderRadius: 14,
          backgroundColor: `${t.accent}1f`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          className="tabular-nums"
          style={{ fontSize: 14, fontWeight: "700", color: t.accent }}
        >
          {n}
        </Text>
      </View>
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}>
        {label}
      </Text>
      {onPress ? <ChevronRight color={t.chevron} size={ICON.sm} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:opacity-60"
      style={rowStyle}
    >
      {body}
    </Pressable>
  ) : (
    <View style={rowStyle}>{body}</View>
  );
}
