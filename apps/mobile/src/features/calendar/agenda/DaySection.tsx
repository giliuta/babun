import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MapService } from "@babun/shared/common/utils/map-links";
import type { Appointment } from "@babun/shared/local/appointments";
import { pluralize } from "@babun/shared/common/utils/pluralize";
import type { ThemeColors } from "@/theme/colors";
import { AgendaRow } from "./AgendaRow";
import { useEnabledMapServices } from "@/features/clients/map-services";
import { openDirect } from "@/features/clients/route-menu";
import { RouteSheet } from "@/features/clients/RouteSheet";
import { haptics } from "@/lib/haptics";
import { dayRouteAddresses, dayRouteTeamId, dayRouteUrlFor } from "./day-route";
import type { AgendaSection } from "./types";

export function DaySection({
  section,
  header,
  label,
  offLabelFor,
  hueFor,
  situationFor,
  overdueFor,
  clientName,
  serviceSummary,
  onEdit,
  onMenu,
  showAmounts,
  addressFor,
  t,
}: {
  section: AgendaSection;
  header: string;
  label: { name: string; color: string } | null;
  offLabelFor?: (a: Appointment) => { name: string; color: string } | null;
  hueFor?: (a: Appointment) => string;
  situationFor?: (a: Appointment) => string | null;
  overdueFor?: (a: Appointment) => boolean;
  clientName: (a: Appointment) => string;
  serviceSummary: (a: Appointment) => string;
  onEdit: (a: Appointment) => void;
  onMenu?: (a: Appointment) => void;
  showAmounts: boolean | ((a: Appointment) => boolean);
  addressFor?: (a: Appointment) => string | null;
  t: ThemeColors;
}) {
  // Маршрут — `day-route.ts` (only field visits, the grid's address rule).
  const addresses = dayRouteAddresses(section.data, addressFor);
  // «МАРШРУТ →» — В КАРТАХ КОМАНДЫ, как «Маршрут» у объекта: одна включённая
  // карта открывается сразу, несколько — тот же лист выбора карт.
  const routeTeamId = dayRouteTeamId(section.data);
  const maps = useEnabledMapServices(routeTeamId);
  const [chooseMap, setChooseMap] = useState(false);
  const openRoute = (service: MapService) => {
    const url = dayRouteUrlFor(service, addresses);
    if (url) openDirect(url);
  };
  const onRoute = () => {
    if (maps.length === 1) {
      openRoute(maps[0]);
      return;
    }
    haptics.tap();
    setChooseMap(true);
  };

  return (
    <View>
      <View className="flex-row items-center justify-between px-2 pb-1">
        {/* Левая группа ужимается, а «Маршрут дня» — нет: длинная дата с
            меткой («ВОСКРЕСЕНЬЕ, 20 СЕНТЯБРЯ · ЛИМАССОЛ») выталкивала ссылку
            за кромку экрана. Ссылка короче — «Маршрут →»: она
            и так в шапке дня. Если тесно и так, жмётся чип метки. */}
        <View
          className="flex-row items-center"
          style={{ gap: 6, flexShrink: 1, minWidth: 0 }}
        >
          <Text
            accessibilityRole="header"
            style={{
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: t.sub,
            }}
          >
            {header}
          </Text>
          {/* Чип метки дня — тот же цвет города, что в шапках сетки. */}
          {label ? (
            <View
              className="flex-row items-center rounded-full"
              style={{
                flexShrink: 1,
                paddingHorizontal: 6,
                paddingVertical: 1,
                backgroundColor: `${label.color}1f`,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  marginRight: 4,
                  borderRadius: 3,
                  backgroundColor: label.color,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  // 11 — пол подписи.
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  // User colors remain the marker/tint; body text keeps an
                  // AA-readable foreground even for yellow/green labels.
                  color: t.ink,
                }}
              >
                {label.name}
              </Text>
            </View>
          ) : null}
        </View>
        {addresses.length > 0 ? (
          <Pressable
            onPress={onRoute}
            hitSlop={8}
            className="active:opacity-60"
            accessibilityRole="link"
            accessibilityLabel={`Маршрут дня, ${pluralize(addresses.length, "адрес", "адреса", "адресов")}`}
            // 44 — минимальная тап-мишень HIG: текст 11pt, мишень — контейнер.
            // Мишень заходит на поля, а не раздвигает шапку: у дня с
            // «Маршрутом» зазор до карточки был вдвое больше, чем у соседних
            // дней.
            style={{
              minHeight: 44,
              marginVertical: -13,
              justifyContent: "center",
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: t.accent }}>
              Маршрут →
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: t.radius.card,
          overflow: "hidden",
          boxShadow: t.cardShadow,
        }}
      >
        {section.data.map((apt, i) => (
          <View key={apt.id}>
            {i > 0 ? (
              <View style={{ height: 1, backgroundColor: t.separator }} />
            ) : null}
            <AgendaRow
              apt={apt}
              clientName={clientName(apt)}
              serviceSummary={serviceSummary(apt)}
              onPress={() => onEdit(apt)}
              onLongPress={onMenu ? () => onMenu(apt) : undefined}
              showAmounts={typeof showAmounts === "function" ? showAmounts(apt) : showAmounts}
              offLabel={offLabelFor?.(apt) ?? null}
              hue={hueFor?.(apt) ?? t.accent}
              situation={situationFor?.(apt) ?? null}
              overdue={overdueFor?.(apt) ?? false}
              t={t}
            />
          </View>
        ))}
      </View>
      {addresses.length > 0 ? (
        <RouteSheet
          visible={chooseMap}
          target={addresses[0]}
          teamId={routeTeamId}
          open={openRoute}
          onClose={() => setChooseMap(false)}
        />
      ) : null}
    </View>
  );
}
