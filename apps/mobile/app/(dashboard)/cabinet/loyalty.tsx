import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Trash2 } from "lucide-react-native";
import { confirmThen } from "@/lib/confirm";
import {
  DEFAULT_LOYALTY,
  generateLoyaltyTierId,
  STARTER_LOYALTY_TIERS,
  type LoyaltySettings,
  type LoyaltyTier,
} from "@babun/shared/local/loyalty";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useLoyalty, useSaveLoyalty } from "@/features/settings/local-settings";
import { notify } from "@/lib/notify";

export default function LoyaltyScreen() {
  const th = useThemeColors();
  const loyaltyQuery = useLoyalty();
  const data = loyaltyQuery.data;
  const save = useSaveLoyalty();
  const [s, setS] = useState<LoyaltySettings>(DEFAULT_LOYALTY);
  const [dirty, setDirty] = useState(false);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [threshold, setThreshold] = useState("");
  const [percent, setPercent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setS(data);
      setDirty(false);
    }
  }, [data]);

  const patch = (p: Partial<LoyaltySettings>) => {
    setS((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  const openNewTier = () => {
    setEditingId(null);
    setLabel("");
    setThreshold("");
    setPercent("");
    setOpen(true);
  };

  const openTier = (tier: LoyaltyTier) => {
    setEditingId(tier.id);
    setLabel(tier.label);
    setThreshold(String(tier.threshold));
    setPercent(String(tier.percent));
    setOpen(true);
  };

  const saveTier = () => {
    const thresholdValue = Number(threshold.replace(",", "."));
    const percentValue = Number(percent.replace(",", "."));
    if (!Number.isInteger(thresholdValue) || thresholdValue < 1) {
      notify("Проверьте уровень", "Количество визитов должно быть целым числом от 1.");
      return;
    }
    if (!Number.isFinite(percentValue) || percentValue <= 0 || percentValue > 100) {
      notify("Проверьте скидку", "Скидка должна быть больше 0 и не превышать 100 процентов.");
      return;
    }
    if (s.tiers.some((tier) => tier.id !== editingId && tier.threshold === thresholdValue)) {
      notify("Такой порог уже есть", "Для одного количества визитов можно задать только один уровень.");
      return;
    }
    const t: LoyaltyTier = {
      id: editingId ?? generateLoyaltyTierId(),
      label: label.trim() || "Уровень",
      threshold: thresholdValue,
      percent: percentValue,
    };
    patch({
      tiers: [
        ...s.tiers.filter((tier) => tier.id !== editingId),
        t,
      ].sort((a, b) => a.threshold - b.threshold),
    });
    setLabel("");
    setThreshold("");
    setPercent("");
    setOpen(false);
  };

  // РАЗРУШИТЕЛЬНОЕ ПЕРЕСПРАШИВАЕТ (аудит 2026-09-10). Уровень удалялся с
  // первого тапа по мусорке — ни вопроса, ни свайпа, ни отмены; при законе
  // «ни одно денежное действие не существует только в жесте». Скидка уровня
  // считается в записях, и восстановить стёртый порог было нечем.
  const removeTier = (id: string) => {
    const tier = s.tiers.find((t) => t.id === id);
    if (!tier) return;
    confirmThen(
      "Удалить уровень?",
      {
        message: `«${tier.label}» — от ${tier.threshold} визитов, −${tier.percent}%. Клиенты этого уровня перестанут получать скидку.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () => patch({ tiers: s.tiers.filter((t) => t.id !== id) }),
    );
  };

  // Гейт загрузки — иначе до прихода данных мигает выключенный дефолт.
  if (loyaltyQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Лояльность" />
        <EmptyState state="loading" />
      </Screen>
    );
  }

  if (loyaltyQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Лояльность" />
        <EmptyState
          state="error"
          fill
          subtitle={
            loyaltyQuery.error instanceof Error
              ? loyaltyQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void loyaltyQuery.refetch(),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Лояльность" />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {/* ТУМБЛЕР — СТРОКОЙ (сведено 2026-09-10). Здесь стоял голый
            `Switch` в самодельном ряду: тап по слову «Программа лояльности»
            не переключал ничего, попасть надо было точно в тумблер.
            `SwitchRow` для этого и существует (LOCKED 2026-08-17). Абзац под
            карточкой снят: объяснялок под карточками канон не допускает. */}
        <SectionCard>
          <SwitchRow
            label="Программа лояльности"
            value={s.enabled}
            onChange={(v: boolean) => patch({ enabled: v })}
          />
        </SectionCard>

        <SectionEyebrow>Уровни — по числу визитов</SectionEyebrow>
        {s.tiers.length === 0 ? (
          <EmptyState
            title="Уровней пока нет"
            action={{
              label: "Загрузить пример",
              onPress: () =>
                patch({ tiers: STARTER_LOYALTY_TIERS, enabled: true }),
            }}
          />
        ) : (
          <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
            {s.tiers.map((tier) => (
              // РАЗРУШИТЕЛЬНОЕ — НА КРОМКЕ ЖЕСТА (сведено 2026-09-10): здесь
              // стояла голая мусорка в строке, и до сегодняшнего дня она
              // удаляла уровень вообще без вопроса.
              <SwipeRow
                key={tier.id}
                label="Удалить"
                color={th.danger}
                icon={Trash2}
                accessibilityLabel={`Удалить уровень ${tier.label}`}
                onAction={() => removeTier(tier.id)}
              >
                <Pressable
                  onPress={() => openTier(tier)}
                  accessibilityRole="button"
                  accessibilityLabel={`Уровень ${tier.label}, изменить`}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    borderRadius: th.radius.card,
                    backgroundColor: pressed ? th.pressed : th.surface,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 16, fontWeight: "600", color: th.ink }}
                    >
                      {tier.label}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 13, color: th.sub }}
                    >
                      {`от ${tier.threshold} визитов`}
                    </Text>
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{
                      fontSize: 16,
                      fontWeight: "700",
                      color: th.success,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {`−${tier.percent}%`}
                  </Text>
                </Pressable>
              </SwipeRow>
            ))}
            <View style={{ paddingTop: 4 }}>
              <GradientButton label="Добавить уровень" onPress={openNewTier} />
            </View>
          </View>
        )}

        <View className="mx-3 mt-5">
          <Button
            label="Сохранить"
            onPress={() =>
              save.mutate(s, {
                onSuccess: () => setDirty(false),
                onError: (e) => notify("Ошибка", e.message),
              })
            }
            disabled={!dirty || save.isPending}
            loading={save.isPending}
          />
        </View>
      </ScrollView>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Уровень" : "Новый уровень"}
        avoidKeyboard
        footer={
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button
              label={editingId ? "Сохранить" : "Добавить уровень"}
              onPress={saveTier}
              disabled={!threshold.trim() || !percent.trim()}
            />
          </View>
        }
      >
        <Field
          label="Название"
          value={label}
          onChangeText={setLabel}
          placeholder="Серебро"
          autoFocus
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field
              label="От N визитов"
              value={threshold}
              onChangeText={setThreshold}
              placeholder="10"
              keyboardType="number-pad"
            />
          </View>
          <View className="flex-1">
            <Field
              label="Скидка %"
              value={percent}
              onChangeText={setPercent}
              placeholder="10"
              keyboardType="number-pad"
            />
          </View>
        </View>
      </BottomSheet>

    </Screen>
  );
}
