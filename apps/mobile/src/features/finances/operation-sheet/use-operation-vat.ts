import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { defaultTxVatMode } from "@babun/shared/local/finance/vat";
import type { Account } from "@babun/shared/local/finance/account";
import { useRememberedVatRate } from "../remembered-vat-rate";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "../vat-queries";
import { defaultOperationVatMode } from "../operation-vat";
import { vatControlsVisible } from "./vat-controls";
import type { OperationDraft } from "./use-operation-draft";

/** The tax of this operation: settings in force, the remembered rate, the
 *  «+ VAT» / «Без VAT» switch and the rate the sum is counted by. */
export function useOperationVat({
  isOwner,
  isEdit,
  transaction,
  selectedAccount,
  draft,
}: {
  isOwner: boolean;
  isEdit: boolean;
  transaction: FinanceTransaction | null | undefined;
  selectedAccount: Pick<Account, "vat_mode"> | null;
  draft: Pick<
    OperationDraft,
    | "teamId"
    | "type"
    | "vatRetouched"
    | "setVatMode"
    | "setVatShown"
    | "setVatTouched"
    | "setVatRetouched"
    | "vatShown"
  >;
}) {
  const {
    teamId, type, vatRetouched, vatShown, setVatMode, setVatShown, setVatTouched, setVatRetouched,
  } = draft;
  // ДЕЙСТВУЮЩИЙ НАЛОГ ЭТОЙ ОПЕРАЦИИ: счёт → команда → компания.
  const vatSettingsQuery = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
  const settingsVat = effectiveVatSettings(
    vatSettingsQuery.data,
    (teamVatOverrides.data ?? []).find((o) => o.teamId === teamId),
    selectedAccount?.vat_mode ?? null,
  );
  // СТАВКА — КАК В «ИТОГО» ДОКУМЕНТОВ (VAT регулируется через блок «Итого»,
  // страницы VAT нет): написанная последней на
  // этом телефоне, а пока не писали — ставка команды из прежних настроек.
  const rememberedVat = useRememberedVatRate(settingsVat.rate);
  // ЗАПОМНЕННЫЙ НОЛЬ СТАВКУ КОМАНДЫ НЕ ГАСИТ. «0» в поле ставки запоминался
  // на телефон, и у каждой новой операции пропадала клавиша «+ VAT»
  // (`vatControlsVisible` ждёт ставку больше нуля) — 19 % команды больше не
  // предлагались. Операция без налога — это «Без VAT», а не ставка 0.
  const vat = { ...settingsVat, rate: rememberedVat.rate > 0 ? rememberedVat.rate : settingsVat.rate };
  // КЛАВИШИ ГАСИТ ТОЛЬКО ТУМБЛЕР КОМПАНИИ, А НЕ ПИН СЧЁТА.
  //
  // ТУМБЛЕРА VAT У КОМПАНИИ НЕТ (всё включено): клавиши видны, как только известна ставка — её пишут в
  // «Итого» документа, и она запоминается. Ставки нет — считать нечем, и
  // клавиш нет. «Без НДС», закреплённое ЗА СЧЁТОМ, — это ПРЕДУСТАНОВКА:
  // настройки счёта прямо обещают «значение подставляется в новую операцию… в
  // самой операции его всегда можно переключить». Пока сюда смотрел
  // эффективный режим, пин счёта прятал секцию целиком — подпись врала, а
  // канон «три клавиши на КАЖДОЙ операции» ломался ровно там, где он важнее
  // всего: на расчётный счёт падает выручка с налогом, а в ту же кассу от
  // частника — без.
  //
  // Сервер против этого не возражает: `fill_transaction_vat` уважает и явное
  // 'none', и присланный снимок `vat_amount` — то есть клавиша операции
  // сильнее пина счёта и на записи тоже.
  // КЛАВИШИ — ТОЛЬКО ТОМУ, КТО ВИДИТ НАСТРОЙКУ НАЛОГА. Сотруднику настройки
  // НДС не отдаются: «Без НДС» у него вышло бы не выбором, а последствием
  // отказа чтения — и молча уносило бы налог из операции компании.
  //
  // Открытая строка VAT не пропадает от того, что в поле ставки сейчас ноль:
  // иначе набранный «0» уносил бы и саму строку, и клавишу «Без VAT».
  const vatVisible = vatControlsVisible({ isOwner, rate: vat.rate, shown: vatShown });
  // Настройки компании И переопределения команд доехали — только тогда режим
  // формы что-то значит для сервера (`operation-vat.ts`).
  const vatSettingsKnown =
    vatSettingsQuery.data !== undefined && teamVatOverrides.data !== undefined;

  // ОПЕРАЦИЯ БЕЗ VAT, ПОКА VAT НЕ ОТКРЫЛИ. Открыли «+ VAT» — режим по настройке (у расхода «Плюс VAT» не
  // ставится, `defaultOperationVatMode`), а если настройка «без налога» —
  // «внутри цены»: сумма с чека остаётся той, что ушла.
  const openVat = () => {
    const base = defaultTxVatMode({ mode: vat.mode, rate: vat.rate, exemptionNote: null });
    setVatMode(base === "none" ? "inclusive" : defaultOperationVatMode(base, type));
    setVatShown(true);
    setVatTouched(true);
    setVatRetouched(true);
  };
  const closeVat = () => {
    setVatMode("none");
    setVatShown(false);
    setVatTouched(true);
    setVatRetouched(true);
  };

  // СТАВКА ОПЕРАЦИИ — ЕЁ СНИМОК, а не сегодняшняя настройка. Страница НДС
  // обещает: «поднимете ставку завтра — прошлые отчёты не изменятся», и
  // правка одной заметки у старой «Плюс НДС» не должна молча пересобрать
  // сумму по новой ставке (сервер снимок операции на UPDATE держит сам).
  // Сегодняшняя ставка достаётся новым операциям и явному пере-нажатию
  // клавиши НДС оператором.
  const opVatRate =
    isEdit && !vatRetouched ? Number(transaction?.vat_rate ?? 0) : vat.rate;

  return { rememberedVat, vatVisible, vatSettingsKnown, openVat, closeVat, opVatRate };
}
