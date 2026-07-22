import { Alert, Switch, Text, View } from "react-native";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { useRenameLabelCascade } from "@/features/reference/label-cascade";
import { useThemeColors } from "@/theme/colors";
import {
  useCities,
  useCreateCity,
  useDeleteCity,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";

// «Города» — справочник city-роли той же таблицы `cities`, что и метки
// календаря. Показывает И выключенные (меню обещает «Список и активность»):
// тумблер в строке — soft on/off, единственный путь реактивации (аудит
// P1-12). Переименование каскадится в team.cities/day_cities/personalLabels
// через useRenameLabelCascade — имена-строки не сиротеют.

export default function CitiesScreen() {
  const th = useThemeColors();
  const { data: cities = [], isLoading, isError, error, refetch } = useCities({
    includeInactive: true,
  });
  const create = useCreateCity();
  const update = useUpdateCity();
  const del = useDeleteCity();
  const cascade = useRenameLabelCascade();

  const toggleActive = (c: City, next: boolean) => {
    update.mutate(
      { id: c.id, patch: { is_active: next } },
      { onError: (e) => Alert.alert("Ошибка", e.message) },
    );
  };

  return (
    <RefListScreen<City>
      title="Города"
      items={cities}
      isLoading={isLoading}
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
      emptyText="Нет городов"
      addLabel="Добавить город"
      fields={[
        { key: "name", label: "Город", placeholder: "Limassol", required: true },
        { key: "country", label: "Страна", placeholder: "Кипр" },
      ]}
      onCreate={async (v) => {
        await create.mutateAsync({ name: v.name, country: v.country });
      }}
      onUpdate={async (id, v) => {
        const prev = cities.find((c) => c.id === id);
        await update.mutateAsync({
          id,
          patch: { name: v.name, country: v.country || "" },
        });
        if (prev && prev.name !== v.name) {
          const failures = await cascade.run(prev.name, v.name);
          if (failures.length > 0) {
            Alert.alert(
              "Город переименован частично",
              `Не удалось обновить: ${failures.join(", ")}. Проверьте сеть и повторите переименование.`,
            );
          }
        }
      }}
      onDelete={async (id) => {
        await del.mutateAsync(id);
      }}
      itemToValues={(c) => ({ name: c.name, country: c.country ?? "" })}
      itemAccessibilityLabel={(c) =>
        `${c.name}${c.country ? `, ${c.country}` : ""}. Изменить город`
      }
      renderItem={(c) => (
        <View className="flex-row items-center px-4 py-2.5">
          <View className="min-w-0 flex-1 pr-3">
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: c.is_active ? th.ink : th.faint,
              }}
              numberOfLines={1}
            >
              {c.name}
            </Text>
            {c.country ? (
              <Text style={{ fontSize: 13, color: th.sub }} numberOfLines={1}>
                {c.country}
              </Text>
            ) : null}
          </View>
          <Switch
            value={!!c.is_active}
            onValueChange={(next) => toggleActive(c, next)}
            trackColor={{ true: th.accent }}
            accessibilityLabel={`Город ${c.name} ${c.is_active ? "активен" : "выключен"}`}
          />
        </View>
      )}
    />
  );
}
