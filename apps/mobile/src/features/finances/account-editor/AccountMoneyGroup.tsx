import { View } from "react-native";
import {
  formatMoneyForInput,
  money,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { Divider } from "@/components/ui/Divider";
import { SwitchRow } from "@/components/ui/SwitchRow";
import {
  ActionRow,
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/components/ui/card-rows";
import { notify } from "@/lib/notify";
import type { Team } from "@/features/reference/queries";
import { useSetPrimaryAccount, type AccountWithBalance } from "../accounts";
import { useAccountVatDue } from "../vat-queries";
import {
  CLOSED_ACCOUNT_OPENING_FROZEN,
  FROZEN_FIELDS_CAPTION,
  FROZEN_OPENING_CAPTION,
  ORPHAN_FROZEN_FIELDS_CAPTION,
} from "../account-alerts";
import { teamControl } from "./editor-logic";
import { TeamChips } from "./TeamChips";
import type { AlertError, SaveAccount } from "./types";

// ДЕНЬГИ, КОМАНДА И ОПЛАТА ЗАПИСИ: сколько на счёте (и сколько в этом VAT к
// уплате), с чего он начался, чей он, основной ли он у команды и стоит ли
// плиткой в блоке «Оплата» записи. Строки «Тип счёта» нет (владелец
// 2026-09-15: «тип вообще убираем») — тип задаёт значок в первой строке листа.
export function AccountMoneyGroup({
  account,
  accounts,
  activeTeams,
  teamById,
  save,
  busy,
  alertError,
  onTransfer,
}: {
  account: AccountWithBalance;
  accounts: readonly AccountWithBalance[];
  /** Живые команды — кому можно отдать счёт. */
  activeTeams: readonly Team[];
  /** Все команды, включая архивные: у счёта может остаться имя распущенной. */
  teamById: Map<string, Team>;
  save: SaveAccount;
  /** Идёт другая правка счёта — переключатели ждут её ответа. */
  busy: boolean;
  alertError: AlertError;
  /** Открыть перевод с этого счёта (или на него, если денег нет). */
  onTransfer: () => void;
}) {
  const setPrimary = useSetPrimaryAccount();
  // ПЕРЕВОДИТЬ ЕСТЬ КУДА, только если рядом есть другой открытый счёт; у
  // закрытого счёта денег в оборотах нет вовсе.
  const canTransfer =
    account.is_active
    && accounts.some((other) => other.is_active && other.id !== account.id);
  // VAT СКОБКОЙ ПРИ СУММЕ, а не отдельной настройкой (владелец 2026-09-23:
  // «общая сумма, и в скобочках — сколько VAT мы должны будем заплатить; это
  // мелочь»). Нет налога — нет и скобки.
  const vatDue = useAccountVatDue(account.id, true).data ?? 0;
  const onHand =
    moneySign(vatDue) !== 0
      ? `${money(account.balance)} (VAT ${money(vatDue)})`
      : money(account.balance);

  // Ответ на «можно ли ещё править» приезжает ВМЕСТЕ со счётом
  // (`account_balances.has_history`) и зеркалит серверный
  // `guard_account_financial_history`: лист глушит правку старта и команды
  // заранее, а не отказом после сохранения.
  const hasHistory = account.has_history;
  // ДВЕ РАЗНЫЕ ПРИЧИНЫ ЗАМОРОЗИТЬ ОСТАТОК НА НАЧАЛО, и обе кончаются одним:
  // поле показывается, но не правится. У счёта С ОПЕРАЦИЯМИ правка ломает
  // сходимость истории; у ЗАКРЫТОГО счёта заданный после закрытия остаток не
  // попадает ни в «Всего денег», ни в один подытог (§9.7). Тот же запрет стоит
  // на сервере, в `guard_account_financial_history`.
  const openingFrozen = hasHistory || !account.is_active;
  const control = teamControl(
    account,
    activeTeams.map((team) => team.id),
  );
  // ГРУППЫ «КОМАНДА» НЕТ, КОГДА ВЫБИРАТЬ НЕ ИЗ ЧЕГО (прогон 2026-09-23): у
  // компании с одной командой строка «Команда · Y&D» — единственная в своей
  // группе и ничего не решает. Тот же закон, что у листа создания: «у тенанта
  // с одной командой вопрос не задаётся вовсе». Счёт удалённой или архивной
  // команды и счёт «Без команды» группу держат — там она и есть новость.
  const showTeam = !(
    control === "fixed"
    && account.brigade_id !== null
    && activeTeams.length <= 1
    && activeTeams.some((team) => team.id === account.brigade_id)
  );

  // Основной счёт уникален внутри (тенант, команда); у счетов старой схемы
  // brigade_id равен NULL, и они образуют свою группу — сравнение по одному
  // полю покрывает оба случая.
  const currentPrimary = accounts.find(
    (a) =>
      a.is_primary && a.id !== account.id && a.brigade_id === account.brigade_id,
  );
  const primaryHint = !account.show_in_payments
    ? "Основным может быть только счёт, который стоит в оплате записи."
    : account.is_primary
      ? "Сюда по умолчанию попадают деньги, если счёт не выбран вручную."
      : currentPrimary
        ? `Куда по умолчанию попадают деньги. Сейчас это «${currentPrimary.name}».`
        : "Куда по умолчанию попадают деньги, если счёт не выбран вручную.";

  // ПОДПИСЬ ГОВОРИТ ПОСЛЕДСТВИЕ, А НЕ МЕХАНИКУ, И СЛОВАМИ ПРОДУКТА: «запись» и
  // «оплата», а не «заявка» и «бригадир» старого словаря. Выключенный счёт
  // никуда не девается: он остаётся на «Финансах», в переводах, операциях и
  // отчётах — он только перестаёт стоять плиткой в блоке «Оплата» записи
  // (сервер: `list_payment_accounts_safe` и
  // `resolve_appointment_payment_account` читают тот же флаг).
  const paymentsHint = account.show_in_payments
    ? "Плитка счёта стоит в блоке «Оплата» записи — деньги можно зачислить сюда."
    : "В записи счёта нет. На «Финансах», в переводах и операциях он остаётся.";

  return (
    <>
      <RowGroup title="Деньги">
        {/* На счёте — факт, а не поле: остаток меняют операции и переводы. */}
        <NavRow label="На счёте" value={onHand} />
        {canTransfer ? (
          // ДЕЙСТВИЕ С ДЕНЬГАМИ СТОИТ У ДЕНЕГ: строкой группы «Деньги», а не
          // второй кнопкой в футере — действие листа одно, а это — операция
          // над суммой строкой выше; подпись о заморозке остаётся под своим полем.
          <ActionRow label="Перевести" separated onPress={onTransfer} />
        ) : null}
        {openingFrozen ? (
          // ЗАМОРОЖЕННОЕ ПОЛЕ — ФАКТ, А НЕ ДВЕРЬ. `NavRow` без `onPress` теряет
          // шеврон, нажатие и роль кнопки; причина живёт одной подписью под
          // группой.
          <NavRow
            label="Остаток на начало"
            value={money(account.opening_balance)}
            separated
          />
        ) : (
          <FieldRow
            label="Остаток на начало"
            value={formatMoneyForInput(account.opening_balance)}
            placeholder="0"
            separated
            tabular
            keyboardType="numbers-and-punctuation"
            onSave={(next: string) => {
              if (!next.trim()) return; // очистили поле — не значит «ноль»
              const cents = parseMoneyInputToCents(next, {
                allowNegative: true,
                allowZero: true,
              });
              if (cents == null) {
                notify(
                  "Проверьте сумму",
                  "Остаток на начало — число, максимум два знака после "
                  + "запятой. Например: 1250,50",
                );
                return;
              }
              const num = cents / 100;
              if (num === account.opening_balance) return;
              void save({ opening_balance: num }, "Не удалось изменить остаток");
            }}
          />
        )}
      </RowGroup>
      {hasHistory ? (
        // У счёта-наследия «Без команды» общий текст врал бы про единственную
        // живую дверь: команду ему назначить КАК РАЗ можно.
        <RowCaption
          text={
            account.brigade_id === null
              ? ORPHAN_FROZEN_FIELDS_CAPTION
              : showTeam
                ? FROZEN_FIELDS_CAPTION
                : FROZEN_OPENING_CAPTION
          }
        />
      ) : openingFrozen ? (
        <RowCaption text={CLOSED_ACCOUNT_OPENING_FROZEN} />
      ) : null}

      {showTeam ? (
      <RowGroup title="Команда">
        {/* ЧЕЙ ЭТО СЧЁТ. Пустая команда — не «команду удалили», а счёт старой
            схемы: его отдают команде целиком (`scope` и `brigade_id` одной
            правкой) даже с историей — иначе деньги навечно оставались бы без
            хозяина. */}
        {control === "fixed" ? (
          <NavRow
            label="Команда"
            value={
              account.brigade_id
                ? (teamById.get(account.brigade_id)?.name ?? "Команда удалена")
                : "Без команды"
            }
          />
        ) : (
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <TeamChips
              teams={activeTeams}
              selectedId={account.brigade_id}
              disabled={busy}
              onSelect={(teamId) => {
                if (teamId === account.brigade_id) return;
                void (control === "hand-over"
                  ? save(
                      { scope: "team", brigade_id: teamId },
                      "Не удалось отдать счёт команде",
                    )
                  : save({ brigade_id: teamId }, "Не удалось сменить команду счёта"));
              }}
            />
          </View>
        )}
      </RowGroup>
      ) : null}

      {/* ОПЛАТА ЗАПИСИ — СВОЕЙ ГРУППОЙ (владелец 2026-09-23: «настройка того,
          будет ли он впадать в оплату при записи, — собрать правильно по
          нашей архитектуре»). Оба переключателя отвечают на один вопрос —
          куда ложатся деньги записи — и стояли под «Командой» чужими
          соседями. */}
      <RowGroup title="Оплата записи">
        {/* ПРИНИМАЕТ ЛИ СЧЁТ ДЕНЬГИ ЗАПИСИ. Решает не тип счёта, а сам счёт:
            накопительный или резервный лежит рядом с рабочей кассой, и одного
            промаха пальцем хватает, чтобы выручка ушла туда, откуда её
            достанут через месяц. */}
        <SwitchRow
          label="В оплате записи"
          hint={paymentsHint}
          value={account.show_in_payments}
          disabled={!account.is_active || busy}
          onChange={(next) => {
            // ОСНОВНОЙ ВСЕГДА В ОПЛАТЕ. Спрятанный основной — это «деньги
            // записи по умолчанию идут туда, куда их положить нельзя»: сервер
            // молча перешагнёт его, и человек узнает об этом по деньгам.
            if (!next && account.is_primary) {
              notify(
                "Это основной счёт команды",
                "Сначала сделайте основным другой счёт — сюда по умолчанию "
                  + "ложатся деньги записи.",
              );
              return;
            }
            void save(
              { show_in_payments: next },
              "Не удалось изменить оплату записи",
            );
          }}
        />
        {/* Куда по умолчанию падают деньги. Развязано с порядком плиток:
            поднять «Карту Ани» повыше для удобства чтения и переадресовать все
            оплаты команды — разные решения. */}
        <Divider inset={16} />
        <SwitchRow
          label="Основной счёт команды"
          hint={primaryHint}
          value={account.is_primary}
          disabled={
            !account.is_active
            || setPrimary.isPending
            || (!account.show_in_payments && !account.is_primary)
          }
          onChange={(next) =>
            void setPrimary
              .mutateAsync({ account, primary: next })
              .catch(alertError("Не удалось сменить основной счёт"))
          }
        />
      </RowGroup>
    </>
  );
}
