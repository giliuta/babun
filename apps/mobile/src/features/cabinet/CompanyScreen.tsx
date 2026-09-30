import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CalendarPlus, ShieldCheck, Users } from "lucide-react-native";
import { ActionRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { effectivePlan, ROLE_LABELS } from "@/features/settings/role-policy";
import { useTenant } from "@/features/settings/tenant";
import {
  useMyCalendars,
  useSwitchWorkspace,
} from "@/features/settings/workspaces";
import { notify } from "@/lib/notify";
import { fetchQuotaUsage, type MobileQuotaKind } from "@/lib/quota";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  grantsSummary,
  groupMemberships,
  planLabel,
  quotaLine,
} from "./companies";

// СТРАНИЦА КОМПАНИИ ИЗ «МОИХ КОМПАНИЙ» (владелец 2026-09-15: Кабинет полноценный
// и информативный). Здесь то, что человек может знать о своём членстве: роль,
// календари и что в каждом ему открыто. Владельцу АКТИВНОЙ компании — тариф и
// сколько использовано лимитов: без цен и кнопок оплаты, подписка продаётся на
// сайте (App Store 3.1.3(f)). Тариф другой компании сервер отдаёт только изнутри
// неё, поэтому для неактивной вместо него — переход.

function QuotaRow({
  tenantId,
  kind,
  title,
}: {
  tenantId: string;
  kind: MobileQuotaKind;
  title: string;
}) {
  const usage = useQuery({
    queryKey: ["cabinet-quota", tenantId, kind],
    queryFn: () => fetchQuotaUsage(supabase, tenantId, kind),
    staleTime: 60_000,
  });
  const line = usage.data ? quotaLine(usage.data) : null;
  return (
    <SettingsRow
      tile="neutral"
      icon={kind === "clients" ? Users : CalendarPlus}
      title={title}
      sub={line?.sub ?? (usage.isError ? "Не удалось загрузить" : "Загрузка…")}
      value={line?.value}
    />
  );
}

export function CompanyScreen() {
  const params = useLocalSearchParams<{ tenant?: string | string[] }>();
  const tenantId = Array.isArray(params.tenant) ? params.tenant[0] : params.tenant;
  const activeTenantId = useTenantId();
  const calendarsQuery = useMyCalendars();
  const tenant = useTenant();
  const switching = useSwitchWorkspace();
  const company = groupMemberships(calendarsQuery.data ?? [], activeTenantId).find(
    (item) => item.tenantId === tenantId,
  );

  if (!company) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Компания" />
        {calendarsQuery.isPending ? (
          <EmptyState state="loading" fill />
        ) : (
          <EmptyState title="Компания не найдена" />
        )}
      </Screen>
    );
  }

  const ownerHere = company.isActive && company.role === "owner";

  const switchHere = () => {
    void switching
      .mutateAsync({
        tenantId: company.tenantId,
        onboarded: company.onboarded,
        role: company.role ?? undefined,
      })
      .catch((error: unknown) =>
        notify(
          "Не удалось перейти",
          error instanceof Error ? error.message : "Проверьте соединение и повторите.",
        ),
      );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={company.tenantName} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={ShieldCheck}
            title="Роль"
            sub={company.role ? ROLE_LABELS[company.role] : "Не известна"}
          />
        </SectionCard>

        <SectionEyebrow>Календари</SectionEyebrow>
        <SectionCard>
          {company.calendars.map((calendar, index) => (
            <View key={calendar.teamId}>
              {index > 0 ? <Divider inset={56} /> : null}
              <SettingsRow
                swatch={calendar.teamColor}
                title={calendar.teamName}
                sub={grantsSummary(company.role, calendar.grants)}
              />
            </View>
          ))}
        </SectionCard>

        {ownerHere ? (
          <>
            <SectionEyebrow>Тариф</SectionEyebrow>
            <SectionCard>
              <SettingsRow
                tile="neutral"
                icon={BadgeCheck}
                title="Тариф"
                sub={planLabel(effectivePlan(tenant.data))}
              />
              <Divider inset={56} />
              <QuotaRow tenantId={company.tenantId} kind="clients" title="Клиенты" />
              <Divider inset={56} />
              <QuotaRow
                tenantId={company.tenantId}
                kind="appointments_month"
                title="Записи в этом месяце"
              />
            </SectionCard>
          </>
        ) : null}

        {!company.isActive ? (
          <SectionCard>
            <ActionRow
              label="Перейти в эту компанию"
              dimmed={switching.isPending}
              onPress={switchHere}
            />
          </SectionCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
