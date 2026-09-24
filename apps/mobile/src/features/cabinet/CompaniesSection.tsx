import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { InvitationsRow } from "@/features/access/InvitationsRow";
import { useMyCalendars } from "@/features/settings/workspaces";
import { useTenantId } from "@/lib/tenant";
import { groupMemberships, membershipSubtitle } from "./companies";

// «МОИ КОМПАНИИ» — ГДЕ ЧЕЛОВЕК СОСТОИТ И КЕМ (владелец 2026-09-15: Кабинет
// полноценный и информативный, «как компании не будет, только личное»).
//
// Это членства самого человека, а не настройки компании: подпись строки сразу
// говорит, где он сейчас, кем он там и сколько у него календарей. Переход между
// компаниями по-прежнему живёт в ленте календарей; тап по строке открывает
// страницу компании — роль, календари и права, а владельцу тариф и лимиты.
//
// «ПРИГЛАШЕНИЯ» — ПЕРВОЙ СТРОКОЙ ЭТОЙ ЖЕ КАРТОЧКИ: приглашение — это компания,
// в которую зовут, а строка стоит на месте всегда, даже пока список компаний
// ещё не доехал (владелец не нашёл прежний блок, пропадавший без приглашений).

export function CompaniesSection() {
  const router = useRouter();
  const activeTenantId = useTenantId();
  const { data: calendars } = useMyCalendars();
  const companies = groupMemberships(calendars ?? [], activeTenantId);

  return (
    <View>
      <SectionEyebrow>Мои компании</SectionEyebrow>
      <SectionCard>
        <InvitationsRow />
        {companies.map((company) => (
          <View key={company.tenantId}>
            {/* Линия начинается там, где текст строки под ней: у голого глифа
                это 48 (16 + бокс 20 + 12), а не 56, как у цветной плитки. */}
            <Divider inset={48} />
            <SettingsRow
              // Своего пигмента у членства нет (словарь `SETTINGS_TILE`):
              // голый глиф, как у «Часового пояса» и «Мастеров».
              tile="neutral"
              icon={Building2}
              title={company.tenantName}
              sub={membershipSubtitle(company)}
              onPress={() =>
                router.push(
                  `/cabinet/company?tenant=${encodeURIComponent(company.tenantId)}` as Href,
                )
              }
            />
          </View>
        ))}
      </SectionCard>
    </View>
  );
}
