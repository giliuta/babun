import type { Href } from "expo-router";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { NavRow, RowGroup } from "@/components/ui/card-rows";
import { useReferenceHref } from "@/features/clients/reference-href";
import {
  useTeamVatOverrides,
  useVatSettings,
  vatSummaryLine,
} from "../vat-queries";
import type { AccountWithBalance } from "../accounts";
import type { SaveAccount } from "./types";
import { accountVatView } from "./vat-view";

// НДС СЧЁТА — ОДИН ПЕРЕКЛЮЧАТЕЛЬ «С НДС» (владелец 2026-09-15: «да, есть
// переключатель — с НДС или без НДС»). Здесь стояли четыре ответа: «Без НДС»,
// «НДС включён», «Плюс НДС», «Как в настройках». Владелец спрашивает о другом:
// идут ли деньги этого счёта с налогом. КАК налог считается — в цене или
// сверху — и по какой ставке, решают команда и компания; подпись под
// переключателем это показывает, чтобы не проваливаться в настройки.
//
// Переключатель стоит на действующем значении: счёт без своего выбора
// показывает то, что унаследовал. Первое касание пишет выбор счёта — `on` или
// `off` (миграция `account_vat_switch`). В самой операции налог по-прежнему
// переключается тремя клавишами: счёт даёт только значение по умолчанию.
export function AccountVatGroup({
  account,
  save,
  busy,
  openPage,
}: {
  account: AccountWithBalance;
  save: SaveAccount;
  /** Идёт другая правка счёта — переключатель ждёт её ответа. */
  busy: boolean;
  /** Дверь из листа на страницу: лист паркуется и возвращается по «назад»
   *  (`use-sheet-doorway`, AGENTS 5.4). */
  openPage: (href: Href) => void;
}) {
  const vatHref = useReferenceHref().vat;
  const vatSettings = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
  const view = accountVatView({
    company: { data: vatSettings.data, failed: vatSettings.isError },
    overrides: {
      data: teamVatOverrides.data,
      failed: teamVatOverrides.isError,
    },
    teamId: account.scope === "team" ? account.brigade_id : null,
    accountMode: account.vat_mode,
    summary: vatSummaryLine,
  });

  // ГРУППА НДС НЕ ИСЧЕЗАЕТ НИКОГДА (§6). У компании без налога переключателю
  // нечего включать — вместо него строка-дверь отвечает и «почему тут пусто»,
  // и «где это включается». Пока ответа нет, строка говорит именно это, а не
  // «компания без НДС»: незагруженное — ещё не ответ.
  if (view.kind !== "switch") {
    const companyOff = view.kind === "company-off";
    return (
      <RowGroup title="НДС">
        {/* Подпись — та же, что у переключателя («С НДС»), а не второе «НДС»
            под заголовком группы: слово стояло трижды подряд. */}
        <NavRow
          label="С НДС"
          value={
            companyOff
              ? "Выключен в компании"
              : view.kind === "loading"
                ? "Загружается"
                : "Не загрузилось"
          }
          // Общий адрес: `/finances/vat` — это ВКЛАДКА «Финансы», и push туда
          // из корневого стека уводил «назад» на календарь.
          onPress={companyOff ? () => openPage(vatHref) : undefined}
        />
      </RowGroup>
    );
  }

  return (
    <RowGroup title="НДС">
      <SwitchRow
        label="С НДС"
        hint={view.hint}
        value={view.value}
        disabled={busy}
        onChange={(next) =>
          void save(
            { vat_mode: next ? "on" : "off" },
            "Не удалось изменить НДС счёта",
          )
        }
      />
    </RowGroup>
  );
}
