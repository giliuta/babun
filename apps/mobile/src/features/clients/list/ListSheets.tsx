import type { ReactNode } from "react";
import { ClientActionsSheet } from "@/features/clients/ClientActionsSheet";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportWizardSheet } from "@/features/clients/import/ImportWizardSheet";
import { ContactsImportSheet } from "@/features/clients/import/ContactsImportSheet";
import { BulkSmsSheet } from "@/features/clients/BulkSmsSheet";
import { clientsInsightsHref, type ClientsScope } from "@/session/clients-company";
import { ClientsScopeProvider } from "@/session/company-scope";
import { teamForNewClient } from "@/features/clients/team-scope";
import type { ClientsList } from "./use-clients-list";
import { BulkEditSheets } from "./BulkEditSheets";

/** Поддерево в компании строки. Источник у вкладки есть всегда (ворота
 *  открывают экран только с ним), так что обёртка не пропадает и лист не
 *  пересобирается посреди выезда. */
function RowScope({ scope, children }: { scope: ClientsScope | null; children: ReactNode }) {
  return scope ? <ClientsScopeProvider scope={scope}>{children}</ClientsScopeProvider> : <>{children}</>;
}

/** Sheets of the list: remind, the row menu, filters, imports, bulk SMS,
 *  bulk tags / team / source. */
export function ListSheets({ list }: { list: ClientsList }) {
  const {
    router,
    scope,
    remindClient,
    setRemindClient,
    updateById,
    guestOf,
    menuScope,
    menuClient,
    setMenuClient,
    menuActions,
    bookFor,
    enterSelection,
    openRemindMenu,
    onShareClient,
    onToggleBlacklist,
    confirmDeleteOne,
    sheetOpen,
    setSheetOpen,
    filter,
    setFilter,
    result,
    dataSpan,
    query,
    setQuery,
    initialFacet,
    sort,
    setSort,
    importOpen,
    setImportOpen,
    contactsOpen,
    setContactsOpen,
    teamChoice,
    ownTeams,
    smsOpen,
    setSmsOpen,
    selectedClients,
    exitSelection,
  } = list;
  return (
    <>
      <RemindSheet
        visible={remindClient !== null}
        clientName={remindClient?.full_name}
        hasReminder={!!remindClient?.reminder_at}
        onPick={(reminder_at) => {
          if (remindClient) {
            updateById.mutate({
              id: remindClient.id,
              patch: { reminder_at },
              source: guestOf.get(remindClient.id),
            });
          }
        }}
        onClose={() => setRemindClient(null)}
      />
      {/* Лист — в компании строки (`menuScope`): реквизиты «Поделиться»
          клиента работодателя — по его выключателям, а не своим. */}
      <RowScope scope={menuScope}>
        <ClientActionsSheet
          client={menuClient}
          // Те же пункты, что в «⋯» карточки (`clientMenuItems`):
          // записать — «можно записать», напомнить и чёрный список — «меняет
          // карточку» / «Меню клиента», удалить — владелец своей компании /
          // «Удаление клиента».
          onBook={menuActions?.book ? bookFor : undefined}
          onClose={() => setMenuClient(null)}
          // Выбор нескольких ведёт к экспорту и массовой SMS: своя база — по
          // «можно вынести», партнёр — по «Меню клиента»; строки
          // работодателя в выбор не попадают вовсе.
          onSelectMany={menuActions?.selectMany ? (c) => enterSelection(c.id) : undefined}
          onRemind={menuActions?.remind ? openRemindMenu : undefined}
          onShare={menuActions?.share ? (c, opts) => void onShareClient(c, opts) : undefined}
          onToggleBlacklist={menuActions?.blacklist ? onToggleBlacklist : undefined}
          onDelete={menuActions?.remove ? confirmDeleteOne : undefined}
        />
      </RowScope>
      <ClientsFilterSheet
        visible={sheetOpen}
        filter={filter}
        result={result}
        dataFrom={dataSpan.from}
        dataTo={dataSpan.to}
        search={query}
        onClearSearch={setQuery}
        initialFacet={initialFacet}
        sort={sort}
        onSortChange={(s) => setSort.mutate(s)}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        hideTeam
        onAnalytics={
          scope
            ? () => {
                setSheetOpen(false);
                router.push(clientsInsightsHref(scope));
              }
            : undefined
        }
      />
      {/* Импорт — в выбранную команду (из «Все» — в первую): у каждой
          команды свой импорт. */}
      <ImportWizardSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        teamId={teamForNewClient(teamChoice, ownTeams.map((tm) => tm.id))}
      />
      <ContactsImportSheet
        visible={contactsOpen}
        onClose={() => setContactsOpen(false)}
        teamId={teamForNewClient(teamChoice, ownTeams.map((tm) => tm.id))}
      />
      <BulkSmsSheet
        visible={smsOpen}
        recipients={selectedClients}
        onClose={() => setSmsOpen(false)}
        onSent={() => {
          setSmsOpen(false);
          exitSelection();
        }}
      />
      <BulkEditSheets list={list} />
    </>
  );
}
