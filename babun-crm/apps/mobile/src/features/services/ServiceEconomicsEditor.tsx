import { Pressable, Text, View } from "react-native";

import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useThemeColors } from "@/theme/colors";
import {
  createTierDraft,
  type ServiceEconomicsDraft,
  type ServiceEconomicsErrors,
  type ServiceTierDraft,
} from "./economics";

function numericValue(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ServiceEconomicsEditor({
  value,
  errors,
  basePrice,
  baseDuration,
  onChange,
}: {
  value: ServiceEconomicsDraft;
  errors?: ServiceEconomicsErrors;
  basePrice: string;
  baseDuration: string;
  onChange: (value: ServiceEconomicsDraft) => void;
}) {
  const t = useThemeColors();

  const updateTier = (id: string, patch: Partial<ServiceTierDraft>) => {
    onChange({
      ...value,
      tiers: value.tiers.map((tier) =>
        tier.id === id ? { ...tier, ...patch } : tier,
      ),
    });
  };

  const removeTier = (id: string) => {
    onChange({
      ...value,
      tiers: value.tiers.filter((tier) => tier.id !== id),
    });
  };

  const addTier = () => {
    onChange({
      ...value,
      tiers: [
        ...value.tiers,
        createTierDraft(
          value.tiers,
          numericValue(basePrice),
          numericValue(baseDuration),
        ),
      ],
    });
  };

  return (
    <View>
      <Field
        label="Себестоимость за единицу, €"
        value={value.costPerUnit}
        onChangeText={(costPerUnit) => onChange({ ...value, costPerUnit })}
        placeholder="0"
        keyboardType="decimal-pad"
        error={errors?.costPerUnit}
      />

      <View
        style={{
          marginBottom: 16,
          overflow: "hidden",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.separator,
          backgroundColor: t.surface,
        }}
      >
        <SwitchRow
          label="Количество в заявке"
          hint="Разрешить выбирать несколько единиц услуги"
          value={value.isCountable}
          onChange={(isCountable) => onChange({ ...value, isCountable })}
        />
      </View>

      <Text
        style={{
          marginBottom: 4,
          fontSize: 14,
          fontWeight: "600",
          color: t.ink,
        }}
      >
        Ступени объёма
      </Text>
      <Text
        style={{ marginBottom: 12, fontSize: 13, lineHeight: 18, color: t.sub }}
      >
        Для каждого порога можно задать цену за единицу, общую длительность
        или оба значения.
      </Text>

      {!value.isCountable ? (
        <View
          style={{
            marginBottom: 12,
            borderRadius: 14,
            padding: 12,
            backgroundColor: t.fill,
          }}
        >
          <Text style={{ fontSize: 13, lineHeight: 18, color: t.sub }}>
            В заявке количество всегда будет равно одной единице. Сохранённые
            ступени останутся доступны, если снова включить количество.
          </Text>
        </View>
      ) : null}

      {value.tiers.map((tier, index) => {
        const tierErrors = errors?.tiers[tier.id];
        return (
          <View
            key={tier.id}
            style={{
              marginBottom: 12,
              overflow: "hidden",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: t.separator,
              backgroundColor: t.surface,
            }}
          >
            <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
              <Text
                style={{
                  marginBottom: 10,
                  fontSize: 13,
                  fontWeight: "600",
                  color: t.sub,
                }}
              >
                Ступень {index + 1}
              </Text>
              <Field
                label="От N единиц"
                value={tier.minQuantity}
                onChangeText={(minQuantity) =>
                  updateTier(tier.id, { minQuantity })
                }
                placeholder="2"
                keyboardType="number-pad"
                error={tierErrors?.minQuantity}
              />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Цена за единицу, €"
                    value={tier.pricePerUnit}
                    onChangeText={(pricePerUnit) =>
                      updateTier(tier.id, { pricePerUnit })
                    }
                    placeholder="Не менять"
                    keyboardType="decimal-pad"
                    error={tierErrors?.pricePerUnit}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Общая длительность"
                    value={tier.totalDuration}
                    onChangeText={(totalDuration) =>
                      updateTier(tier.id, { totalDuration })
                    }
                    placeholder="Минуты"
                    keyboardType="number-pad"
                    error={tierErrors?.totalDuration}
                  />
                </View>
              </View>
              {tierErrors?.row ? (
                <Text style={{ marginBottom: 10, fontSize: 14, color: t.danger }}>
                  {tierErrors.row}
                </Text>
              ) : null}
            </View>
            <Divider />
            <Pressable
              onPress={() => removeTier(tier.id)}
              accessibilityRole="button"
              accessibilityLabel={`Удалить ступень ${index + 1}`}
              style={({ pressed }) => ({
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: "500", color: t.danger }}>
                Удалить ступень
              </Text>
            </Pressable>
          </View>
        );
      })}

      {value.isCountable ? (
        <View
          style={{
            marginBottom: 16,
            overflow: "hidden",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.separator,
          }}
        >
          <AddRow label="Добавить ступень" onPress={addTier} />
        </View>
      ) : null}
    </View>
  );
}
