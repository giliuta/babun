import { useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { CalendarClock, Navigation, Shapes } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { SERVICE_MONTH_CHOICES, serviceMonthsLabel } from "@/features/clients/service-default";
import { useTeamServiceMonths } from "@/features/clients/use-service-default";
import { useClientSettingLevelsOf } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";
import { useLocationLabels } from "@/features/settings/local-settings";
import { mapServicesSummary, useEnabledMapServices } from "@/lib/map-services";
import { useThemeColors } from "@/theme/colors";

// «ОБЪЕКТЫ» — ВСЁ ПРО ОБЪЕКТЫ КЛИЕНТОВ ОДНОЙ СТРАНИЦЕЙ (владелец 02.10:
// «настройки клиентов — по функциям»). Раньше это были четыре разные строки
// шестерёнки: блок «Объекты» в «Карточке клиента», «Типы объектов»,
// «Обслуживание объектов» и «Карты для маршрута». Теперь одна функция — одна
// дверь:
//   • «Объекты в карточке» — есть ли блок на странице клиента;
//   • «Типы объектов» — справочник команды («Дом», «Вилла»);
//   • «Обслуживание» — раз в сколько месяцев напоминать (фильтр «Пора
//     обслужить»);
//   • «Карты для маршрута» — что предлагать по кнопке «Маршрут».
// Каждая строка — за своим правом партнёра (тумблер — «Карточка клиента»,
// типы и срок — «Типы объектов», карты — «Карты для маршрута»).

export default function ClientObjectsSettingsRoute() {
  return (
    <ClientSettingsRoute row={["card", "objects", "maps"]}>
      <ClientObjectsSettingsScreen />
    </ClientSettingsRoute>
  );
}

function ClientObjectsSettingsScreen() {
  const router = useRouter();
  const t = useThemeColors();
  const { team, tenant } = useLocalSearchParams<{ team?: string; tenant?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamRow =
    (team ? ownTeams.find((tm) => tm.id === team) : undefined) ?? ownTeams[0] ?? null;
  const teamId = team || teamRow?.id || null;
  const levels = useClientSettingLevelsOf()(teamId);
  const { data: types = [] } = useLocationLabels(teamId);
  const service = useTeamServiceMonths(teamId);
  const [servicePicker, setServicePicker] = useState(false);
  const maps = useEnabledMapServices(teamId);
  const href = (pathname: string): Href =>
    ({ pathname, params: tenant ? { team: teamId, tenant } : { team: teamId } }) as Href;

  const showTypes = levels.objects !== "hidden";
  const showMaps = levels.maps !== "hidden";

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Объекты" subtitle={teamRow?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Включён ли блок «Объекты» на карточке — на странице «Блоки
            клиентов» (03.10); здесь типы, обслуживание и карты. */}

        {showTypes || showMaps ? (
          <SectionCard>
            {showTypes ? (
              <SettingsRow
                tile={SETTINGS_TILE.teal}
                icon={Shapes}
                title="Типы объектов"
                sub={types.length > 0 ? types.map((label) => label.name).join(", ") : "Добавить первый тип"}
                onPress={() => router.push(href("/clients/object-types"))}
              />
            ) : null}
            {showTypes ? <Divider inset={56} /> : null}
            {showTypes ? (
              // Раз в сколько месяцев обслуживать объект без своего срока: на
              // нём держится фильтр «Пора обслужить». «Только видит» —
              // значение без двери.
              <SettingsRow
                tile={SETTINGS_TILE.orange}
                icon={CalendarClock}
                title="Обслуживание"
                sub={serviceMonthsLabel(service.months)}
                onPress={levels.objects === "write" ? () => setServicePicker(true) : undefined}
              />
            ) : null}
            {showTypes && showMaps ? <Divider inset={56} /> : null}
            {showMaps ? (
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Navigation}
                title="Карты для маршрута"
                sub={mapServicesSummary(maps)}
                onPress={() => router.push(href("/clients/maps"))}
              />
            ) : null}
          </SectionCard>
        ) : null}
      </ScrollView>

      <PickerSheet
        visible={servicePicker}
        title="Обслуживание объектов"
        subtitle="Отсчёт — от последнего визита на объект"
        selectedId={String(service.months ?? "off")}
        items={SERVICE_MONTH_CHOICES.map((months) => ({
          id: String(months ?? "off"),
          label: serviceMonthsLabel(months),
          icon: CalendarClock,
          color: t.accent,
          onPress: () => {
            setServicePicker(false);
            if (months !== service.months) service.set(months);
          },
        }))}
        onClose={() => setServicePicker(false)}
      />
    </Screen>
  );
}
