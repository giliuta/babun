import { useRouter, type Href } from "expo-router";
import { Archive, Download } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { TourTarget } from "@/components/tour/TourTarget";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useMirror } from "@/session/mirror-state";
import { useMyMemberships } from "@/session/my-memberships";
import { useCurrentRole } from "@/session/tenant";
import { useSwitchWorkspace } from "@/session/workspaces";
import { InventoryCabinetRow } from "@/features/inventory/InventoryCabinetRow";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { useTenantId } from "@/lib/tenant";
import { notify } from "@/lib/notify";

import { AccountScopeProvider } from "@/session/account-scope";
import { ArchiveRow } from "./ArchiveRow";
import { DataExportRow } from "./DataExportRow";
import { HistoryRow } from "./HistoryRow";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

// «КОМАНДЫ» — СВОЙ АККАУНТ ЧЕЛОВЕКА, КАКОЙ БЫ АККАУНТ НИ БЫЛ ОТКРЫТ НА ТЕЛЕФОНЕ
// (свой раздел всегда на месте). Если бы раздел
// стоял по роли в ОТКРЫТОМ аккаунте, партнёр, открывший календарь
// пригласившего, терял бы в Кабинете свои SMS и реквизиты, пока не
// тапнул свою команду.
//
// Открыт свой аккаунт — всё как обычно. Открыт чужой:
//   • SMS и история изменений — за СВОЙ
//     аккаунт (`?tenant=`), ровно как блок пригласившего (`InvitedAccounts`);
//   • «Выгрузка данных» и «Архив» сначала
//     переводят телефон в свой аккаунт и открываются там: это страницы
//     хозяйства аккаунта, и чужая лента под ними была бы неправдой. Подписи у
//     них спокойные — счётчики открытого аккаунта сюда не годятся.
//
// «Посмотреть его глазами» — раздела нет: свой аккаунт партнёра вашим
// токеном не читается.

/** СТРОКА «СКЛАД» СПРЯТАНА, ПОКА СКЛАД НЕ ГОТОВ: клиенты из магазина видели
 *  «В разработке». Код склада оставлен намеренно — включается этим флагом. */
const SHOW_INVENTORY = false;

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
          {/* ТАРИФА, ПАРТНЁРОВ И РЕКВИЗИТОВ ЗДЕСЬ НЕТ: у каждого календаря
              своя оплата и свои люди — они в шестерёнке календаря; реквизиты —
              в шестерёнке «Финансов» у каждого календаря. */}
          {/* ИСТОРИЯ ИЗМЕНЕНИЙ: кто что менял во всех
              календарях — он сам и каждый партнёр. */}
          <TourTarget id="cabinet.history">
            <HistoryRow />
          </TourTarget>
          {/* СКЛАД ОБОРУДОВАНИЯ — один на аккаунт; строка ждёт готовности. */}
          {SHOW_INVENTORY ? (
            <>
              <Divider inset={SETTINGS_ROW_INSET} />
              <InventoryCabinetRow />
            </>
          ) : null}
          <Divider inset={SETTINGS_ROW_INSET} />
          <TourTarget id="cabinet.sms">
            <SmsCabinetRow />
          </TourTarget>
          <Divider inset={SETTINGS_ROW_INSET} />
          {/* ВЫГРУЗКА ДАННЫХ (только из своих личных команд) — клиенты, записи и финансы своего аккаунта. */}
          <TourTarget id="cabinet.export">
            <DataExportRow />
          </TourTarget>
          <Divider inset={SETTINGS_ROW_INSET} />
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
        <HistoryRow tenantId={own} />
        {SHOW_INVENTORY ? (
          <>
            <Divider inset={SETTINGS_ROW_INSET} />
            <InventoryCabinetRow />
          </>
        ) : null}
        <Divider inset={SETTINGS_ROW_INSET} />
        <SmsCabinetRow tenantId={own} />
        <Divider inset={SETTINGS_ROW_INSET} />
        <SettingsRow
          tile={SETTINGS_TILE.green}
          icon={Download}
          title="Выгрузка данных"
          sub="Клиенты, записи, финансы"
          onPress={openInOwn("/cabinet/export")}
        />
        <Divider inset={SETTINGS_ROW_INSET} />
        <SettingsRow
          tile={SETTINGS_TILE.purple}
          icon={Archive}
          title="Архив"
          sub="Удалённые календари"
          onPress={openInOwn("/cabinet/archive")}
        />
      </SectionCard>
    </AccountScopeProvider>
  );
}
