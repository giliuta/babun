import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { NavRow } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useTeams } from "@/features/reference/queries";
import { useAccountKind } from "@/features/settings/my-accounts";
import { canAddTeam } from "@/features/tariffs/tiers";
import { useTariff, useTariffNudge } from "@/features/tariffs/use-tariff";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { CalendarCreateSheet } from "./CalendarCreateSheet";

// КАБИНЕТ → КОМПАНИЯ → «КАЛЕНДАРИ» (владелец 11.10: «создание календаря не в
// настройках — перейти в компанию и там создать новый календарь»). Список
// календарей открытой компании; «Добавить» — словом в шапке справа (канон:
// действие создания подписано текстом). Тап по календарю — его настройки.
// Сверх лимита тарифа «Добавить» серое и поднимает плашку про тариф. В
// Личном календарь один — «Добавить» нет (сервер держит то же).

export function CompanyCalendarsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const tenantId = useTenantId();
  const kind = useAccountKind(tenantId);
  const { data: teams = [] } = useTeams();
  const tier = useTariff().state.tier;
  const nudgeTariff = useTariffNudge();
  const [createOpen, setCreateOpen] = useState(false);
  const canNew = canAddTeam(tier, teams.length);
  const company = kind === "company";

  return (
    <Screen>
      <ScreenHeader
        title="Календари"
        right={
          company ? (
            <Pressable
              onPress={() => (canNew ? setCreateOpen(true) : nudgeTariff())}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Добавить календарь"
              style={({ pressed }: { pressed: boolean }) => ({
                minHeight: 44,
                justifyContent: "center",
                opacity: !canNew ? 0.4 : pressed ? 0.5 : 1,
              })}
            >
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
                Добавить
              </Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}>
        <SectionCard>
          {teams.map((team, i) => (
            <NavRow
              key={team.id}
              label={team.name}
              separated={i > 0}
              accessory={
                <View
                  style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: team.color || t.accent }}
                />
              }
              onPress={() => router.push({ pathname: "/calendar", params: { team: team.id } } as Href)}
            />
          ))}
        </SectionCard>
      </ScrollView>
      <CalendarCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        teams={teams}
        onCreated={(team) => router.push({ pathname: "/calendar", params: { team: team.id } } as Href)}
      />
    </Screen>
  );
}
