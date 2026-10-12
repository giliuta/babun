import { useRouter, type Href } from "expo-router";
import { Archive, Download, Users } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { useCurrentRole } from "@/features/settings/tenant";
import { useSwitchWorkspace } from "@/features/settings/workspaces";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { TariffRow } from "@/features/tariffs/TariffRow";
import { useTenantId } from "@/lib/tenant";
import { notify } from "@/lib/notify";
import { CAN_PAY_HERE } from "@/lib/pay-here";

import { AccountScopeProvider } from "./account-scope";
import { ArchiveRow } from "./ArchiveRow";
import { CabinetRequisitesRow } from "./CabinetRequisitesRow";
import { DataExportRow } from "./DataExportRow";
import { HistoryRow } from "./HistoryRow";
import { TariffPaymentsRow } from "./TariffPaymentsRow";

// «КОМАНДЫ» — СВОЙ АККАУНТ ЧЕЛОВЕКА, КАКОЙ БЫ АККАУНТ НИ БЫЛ ОТКРЫТ НА ТЕЛЕФОНЕ
// (владелец 04.10: «да» — свой раздел всегда на месте). Раньше раздел стоял по
// роли в ОТКРЫТОМ аккаунте: партнёр, открывший календарь пригласившего,
// терял в Кабинете свой тариф, SMS и партнёров, пока не тапнул свою команду.
//
// Открыт свой аккаунт — всё как было. Открыт чужой:
//   • тариф, оплаты тарифа, SMS, реквизиты и история изменений — за СВОЙ
//     аккаунт (`?tenant=`), ровно как блок пригласившего (`InvitedAccounts`);
//   • «Партнёры», «Выгрузка данных» и «Архив» сначала
//     переводят телефон в свой аккаунт и открываются там: это страницы
//     хозяйства аккаунта, и чужая лента под ними была бы неправдой. Подписи у
//     них спокойные — счётчики открытого аккаунта сюда не годятся.
//
// «Посмотреть его глазами» — раздела нет: свой аккаунт партнёра вашим
// токеном не читается.

export function OwnAccountSection() {
  const router = useRouter();
  const mirror = useMirror();
  const role = useCurrentRole().data;
  const activeTenant = useTenantId();
  const memberships = useMyMemberships().data ?? [];
  const switchWorkspace = useSwitchWorkspace();

  if (mirror) return null;
  const own =
    memberships.find((m) => m.role === "owner")?.tenantId ??
    (role === "owner" ? activeTenant : null);
  if (!own) return null;

  if (role === "owner" || own === activeTenant) {
    return (
      <>
        <SectionEyebrow>Команды</SectionEyebrow>
        <SectionCard>
          {/* ТАРИФ — ПЕРВЫМ (владелец 01.10: «выбор тарифа — в кабинете»).
              Страницы тариф не закрывает (владелец 02.10: «всё открывается,
              блокируются только кнопки»): «Партнёры» открыты всегда, серая
              там только «Пригласить партнёра». */}
          <TariffRow />
          <Divider inset={48} />
          {/* ОПЛАТЫ ТАРИФА (владелец 03.10) — платежи за подписку и чеки.
              Только на сайте: страница ведёт к счетам Stripe с оплатой, а в
              приложении из магазина покупок нет (`pay-here.ts`). */}
          {CAN_PAY_HERE ? (
            <>
              <TariffPaymentsRow />
              <Divider inset={48} />
            </>
          ) : null}
          {/* ПАРТНЁРЫ — ОДИН СПИСОК НА АККАУНТ (владелец 29.09: «страницу
              мастера перенесём в кабинет… и полноценно на каждую команду, что
              он может делать»). */}
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={Users}
            title="Партнёры"
            sub="Права по командам"
            onPress={() => router.push("/cabinet/people" as Href)}
          />
          <Divider inset={48} />
          {/* РЕКВИЗИТЫ (владелец 03.10: «единый блок на все компании —
              запихни в кабинет»), прежде — шестерёнка «Финансов». */}
          <CabinetRequisitesRow />
          <Divider inset={48} />
          {/* ИСТОРИЯ ИЗМЕНЕНИЙ (владелец 03.10): кто что менял во всех
              календарях — он сам и каждый партнёр. */}
          <HistoryRow />
          <Divider inset={48} />
          <SmsCabinetRow />
          <Divider inset={48} />
          {/* ВЫГРУЗКА ДАННЫХ (владелец 03.10: «только из своих личных
              команд») — клиенты, записи и финансы своего аккаунта. */}
          <DataExportRow />
          <Divider inset={48} />
          {/* АРХИВ — в архив календарь уводит владелец, и только он может
              вернуть его или стереть. */}
          <ArchiveRow />
        </SectionCard>
      </>
    );
  }

  /** Перевести телефон в свой аккаунт и открыть страницу уже там. */
  const openInOwn = (href: string) => async () => {
    try {
      await switchWorkspace.mutateAsync({ tenantId: own, onboarded: true, role: "owner" });
      router.push(href as Href);
    } catch (e) {
      notify("Не удалось открыть", (e as Error).message);
    }
  };

  return (
    <AccountScopeProvider tenantId={own}>
      <SectionEyebrow>Команды</SectionEyebrow>
      <SectionCard>
        <TariffRow tenantId={own} />
        <Divider inset={48} />
        {CAN_PAY_HERE ? (
          <>
            <TariffPaymentsRow tenantId={own} />
            <Divider inset={48} />
          </>
        ) : null}
        <SettingsRow
          tile={SETTINGS_TILE.indigo}
          icon={Users}
          title="Партнёры"
          sub="Права по командам"
          onPress={openInOwn("/cabinet/people")}
        />
        <Divider inset={48} />
        <CabinetRequisitesRow tenantId={own} />
        <Divider inset={48} />
        <HistoryRow tenantId={own} />
        <Divider inset={48} />
        <SmsCabinetRow tenantId={own} />
        <Divider inset={48} />
        <SettingsRow
          tile={SETTINGS_TILE.blue}
          icon={Download}
          title="Выгрузка данных"
          sub="Клиенты, записи, финансы"
          onPress={openInOwn("/cabinet/export")}
        />
        <Divider inset={48} />
        <SettingsRow
          tile="neutral"
          icon={Archive}
          title="Архив"
          sub="Удалённые календари"
          onPress={openInOwn("/cabinet/archive")}
        />
      </SectionCard>
    </AccountScopeProvider>
  );
}
