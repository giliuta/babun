import { View } from "react-native";
import {
  formatMoneyForInput,
  money,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { Divider } from "@/components/ui/Divider";
import { SwitchRow } from "@/components/ui/SwitchRow";
import {
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/components/ui/card-rows";
import { notify } from "@/lib/notify";
import type { Team } from "@/features/reference/queries";
import { useSetPrimaryAccount, type AccountWithBalance } from "../accounts";
import {
  CLOSED_ACCOUNT_OPENING_FROZEN,
  FROZEN_FIELDS_CAPTION,
  ORPHAN_FROZEN_FIELDS_CAPTION,
} from "../account-alerts";
import { teamControl } from "./editor-logic";
import { TeamChips } from "./TeamChips";
import type { AlertError, SaveAccount } from "./types";

// ДЕНЬГИ И КОМАНДА СЧЁТА: сколько на нём, с чего он начался, чей он, основной
// ли он у команды и принимает ли оплату заявок. Строки «Тип счёта» нет
// (владелец 2026-09-15: «тип вообще убираем») — тип задаёт значок в первой
// строке листа.
export function AccountMoneyGroup({
  account,
  accounts,
  activeTeams,
  teamById,
  save,
  busy,
  alertError,
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
}) {
  const setPrimary = useSetPrimaryAccount();

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

  // Основной счёт уникален внутри (тенант, команда); у счетов старой схемы
  // brigade_id равен NULL, и они образуют свою группу — сравнение по одному
  // полю покрывает оба случая.
  const currentPrimary = accounts.find(
    (a) =>
      a.is_primary && a.id !== account.id && a.brigade_id === account.brigade_id,
  );
  const primaryHint = account.is_primary
    ? "Сюда по умолчанию попадают деньги, если счёт не выбран вручную."
    : currentPrimary
      ? `Куда по умолчанию попадают деньги. Сейчас это «${currentPrimary.name}».`
      : "Куда по умолчанию попадают деньги, если счёт не выбран вручную.";

  // ПОДПИСЬ ГОВОРИТ ПОСЛЕДСТВИЕ, А НЕ МЕХАНИКУ. Выключенный счёт никуда не
  // девается: он остаётся плиткой на «Финансах», в переводах и в отчётах — он
  // только перестаёт принимать деньги заявок.
  const paymentsHint = account.show_in_payments
    ? "Бригадир видит счёт при оплате заявки и может зачислить деньги сюда."
    : "Счёт остаётся на «Финансах» и в переводах, но оплату заявок не принимает.";

  return (
    <>
      <RowGroup title="Деньги">
        {/* На счёте — факт, а не поле: остаток меняют операции и переводы. */}
        <NavRow label="На счёте" value={money(account.balance)} />
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
              : FROZEN_FIELDS_CAPTION
          }
        />
      ) : openingFrozen ? (
        <RowCaption text={CLOSED_ACCOUNT_OPENING_FROZEN} />
      ) : null}

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
        {/* Куда по умолчанию падают деньги. Развязано с порядком плиток:
            поднять «Карту Ани» повыше для удобства чтения и переадресовать все
            оплаты команды — разные решения. */}
        <Divider inset={16} />
        <SwitchRow
          label="Основной счёт команды"
          hint={primaryHint}
          value={account.is_primary}
          disabled={!account.is_active || setPrimary.isPending}
          onChange={(next) =>
            void setPrimary
              .mutateAsync({ account, primary: next })
              .catch(alertError("Не удалось сменить основной счёт"))
          }
        />
        {/* ПРИНИМАЕТ ЛИ ЭТОТ СЧЁТ ДЕНЬГИ ЗАЯВОК. Решает не тип счёта, а сам
            счёт: накопительный или резервный лежит рядом с рабочей кассой, и
            одного промаха пальцем хватает, чтобы выручка ушла туда, откуда её
            достанут через месяц. Обе серверные двери — пикер бригадира и
            автоподбор — уважают эту колонку. */}
        <Divider inset={16} />
        <SwitchRow
          label="Показывать при оплате заявок"
          hint={paymentsHint}
          value={account.show_in_payments}
          disabled={!account.is_active || busy}
          onChange={(next) =>
            void save(
              { show_in_payments: next },
              "Не удалось изменить приём оплаты",
            )
          }
        />
      </RowGroup>
    </>
  );
}
