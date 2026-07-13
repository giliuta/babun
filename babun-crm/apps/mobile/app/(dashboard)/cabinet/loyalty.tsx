import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Trash2 } from "lucide-react-native";
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
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useLoyalty, useSaveLoyalty } from "@/features/settings/local-settings";

export default function LoyaltyScreen() {
  const th = useThemeColors();
  const { data, isLoading } = useLoyalty();
  const save = useSaveLoyalty();
  const [s, setS] = useState<LoyaltySettings>(DEFAULT_LOYALTY);
  const [dirty, setDirty] = useState(false);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [threshold, setThreshold] = useState("");
  const [percent, setPercent] = useState("");

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

  const addTier = () => {
    const t: LoyaltyTier = {
      id: generateLoyaltyTierId(),
      label: label.trim() || "Уровень",
      threshold: Number(threshold) || 0,
      percent: Number(percent) || 0,
    };
    patch({
      tiers: [...s.tiers, t].sort((a, b) => a.threshold - b.threshold),
    });
    setLabel("");
    setThreshold("");
    setPercent("");
    setOpen(false);
  };

  const removeTier = (id: string) =>
    patch({ tiers: s.tiers.filter((t) => t.id !== id) });

  // Гейт загрузки — иначе до прихода данных мигает выключенный дефолт.
  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Лояльность" />
        <EmptyState state="loading" />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Лояльность" />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard padded>
          <View className="flex-row items-center justify-between px-1 py-1">
            <Text className="text-base" style={{ color: th.ink }}>Программа лояльности</Text>
            <Switch
              value={s.enabled}
              onValueChange={(v) => patch({ enabled: v })}
              trackColor={{ true: th.accent }}
            />
          </View>
        </SectionCard>
        <Text className="px-5 pt-2 text-xs" style={{ color: th.faint }}>
          Скидка уровня применяется автоматически при создании записи и видна
          в карточке клиента (раздел «Финансы»). Ручная скидка всегда важнее.
        </Text>

        <SectionCard title="Уровни — по числу визитов">
          {s.tiers.length === 0 ? (
            <View className="px-4 py-4">
              <Text className="text-sm" style={{ color: th.faint }}>
                Уровней пока нет. Клиент со столькими-то выполненными визитами
                получает скидку.
              </Text>
              <View className="mt-2 flex-row items-center gap-4">
                <Pressable
                  onPress={() =>
                    patch({ tiers: STARTER_LOYALTY_TIERS, enabled: true })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Загрузить пример уровней"
                  className="active:opacity-70"
                >
                  <Text className="text-sm font-medium" style={{ color: th.accent }}>
                    Загрузить пример (3 / 10 / 25 визитов)
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Добавить уровень"
                  className="active:opacity-70"
                >
                  <Text className="text-sm font-medium" style={{ color: th.accent }}>
                    Добавить свой
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              {s.tiers.map((t, i) => (
                <View key={t.id}>
                  {i > 0 ? <Divider inset={16} /> : null}
                  <View className="flex-row items-center px-4 py-3">
                    <View className="flex-1">
                      <Text className="text-base font-semibold" style={{ color: th.ink }}>
                        {t.label}
                      </Text>
                      <Text className="text-sm" style={{ color: th.sub }}>
                        от {t.threshold} визитов
                      </Text>
                    </View>
                    <Text className="mr-3 text-base font-bold" style={{ color: th.success }}>
                      −{t.percent}%
                    </Text>
                    <Pressable
                      onPress={() => removeTier(t.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить ${t.label}`}
                    >
                      <Trash2 color={th.danger} size={ICON.sm} />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Divider inset={16} />
              <AddRow label="Добавить уровень" onPress={() => setOpen(true)} />
            </>
          )}
        </SectionCard>

        <View className="mx-3 mt-5">
          <Button
            label="Сохранить"
            onPress={() =>
              save.mutate(s, {
                onSuccess: () => setDirty(false),
                onError: (e) => Alert.alert("Ошибка", e.message),
              })
            }
            disabled={!dirty || save.isPending}
            loading={save.isPending}
          />
        </View>
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>Новый уровень</Text>
          <Field label="Название" value={label} onChangeText={setLabel} placeholder="Серебро" autoFocus />
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
          <Button label="Добавить" onPress={addTier} disabled={!threshold.trim()} />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
