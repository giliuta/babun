import { Text, View } from "react-native";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { useThemeColors } from "@/theme/colors";
import {
  useCities,
  useCreateCity,
  useDeleteCity,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";

export default function CitiesScreen() {
  const th = useThemeColors();
  const { data: cities = [], isLoading } = useCities();
  const create = useCreateCity();
  const update = useUpdateCity();
  const del = useDeleteCity();
  return (
    <RefListScreen<City>
      title="Города"
      items={cities}
      isLoading={isLoading}
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
        await update.mutateAsync({
          id,
          patch: { name: v.name, country: v.country || "" },
        });
      }}
      onDelete={async (id) => {
        await del.mutateAsync(id);
      }}
      itemToValues={(c) => ({ name: c.name, country: c.country ?? "" })}
      renderItem={(c) => (
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text style={{ fontSize: 16, fontWeight: "600", color: th.ink }}>{c.name}</Text>
          {c.country ? (
            <Text style={{ fontSize: 14, color: th.sub }}>{c.country}</Text>
          ) : null}
        </View>
      )}
    />
  );
}
