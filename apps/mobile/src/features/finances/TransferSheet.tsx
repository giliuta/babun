import { useMemo } from "react";
import { useIsOnline } from "@babun/shared/sync";
import { moneyInputProblem } from "@babun/shared/common/utils/money";
import { todayYmd } from "@/lib/paper/format";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole, useTenant } from "@/session/tenant";
import { minusWarning } from "./account-alerts";
import { pastTransferMinus } from "./transfer-sheet/past-minus";
import { useMovesAfter } from "./transfer-sheet/past-minus-query";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "./accounts";
import {
  accountOwnerLabel,
  transferSpansTeams,
  transferGroups,
} from "./transfer-options";
import { useTransferWithUndo } from "./transfer-undo";
import {
  transferDateFloor,
  transferIsDirty,
  transferReason,
  transferTitle,
} from "./transfer-sheet/transfer-rules";
import type { TransferView } from "./transfer-sheet/transfer-view";
import { useTransferDraft } from "./transfer-sheet/use-transfer-draft";
import { useTransferSend } from "./transfer-sheet/use-transfer-send";
import { renderTransferAccountStep } from "./transfer-sheet/TransferAccountStep";
import { renderTransferDateStep } from "./transfer-sheet/TransferDateStep";
import { renderTransferFormStep } from "./transfer-sheet/TransferFormStep";

// ЛИСТ ПЕРЕВОДА (ТЗ §5.2–5.4).
//
// Счета выбираются не чипами (2N пилюль без остатков и в порядке из базы: у живого
// тенанта 14 одинаковых «Наличные», среди которых нужно вслепую найти свою), а двумя
// СТРОКАМИ-значениями, каждая открывает выбор ВТОРЫМ ШАГОМ ТОГО ЖЕ
// листа. Второй лист поверх первого невозможен: `BottomSheet` — это RN Modal,
// и окно поверх него требует сперва закрыть нижнее, то есть потерять набранное.
//
// Три вещи, которые лист обязан делать:
//   • сумма предзаполнена ВСЕМ остатком и выделена — «сдать всё» это ноль
//     набора, а частичная сумма набирается поверх;
//   • причина погашенной кнопки печатается ВСЕГДА, а не после первого символа;
//   • подтверждения перед переводом НЕТ — есть «Отменить» после (§5.2).
//
// ФОРМА — КАК «ПЕРЕВЕСТИ ДЕНЬГИ» В REVOLUT: две карточки одна над другой, у каждой имя счёта и его остаток, а
// сумма стоит СПРАВА В САМОЙ КАРТОЧКЕ — со знаком. Набираешь в верхней, нижняя
// повторяет ту же цифру плюсом: видно обе стороны сделки, не читая подписей.
// Круглая кнопка разворота — на шве между ними.
//
// ДАТА ВЫБИРАЕТСЯ ВРУЧНУЮ
// и стоит первой строкой. Она — ТРЕТИЙ ШАГ ТОГО ЖЕ ЛИСТА, а не отдельный
// пикер-модал: `BottomSheet` — это RN Modal, и окно поверх него требует сперва
// закрыть нижнее, то есть потерять набранное (та же причина, по которой выбор
// счёта живёт шагом).
//
// Быстрых сумм «10 / 20 / 50 / 100» здесь нет: у команды перевод — это чаще
// всего вся касса целиком, а не двадцатка. Ту же роль играет чип «Весь остаток».
//
// «СДАЧИ ВЫРУЧКИ» отдельным словом нет: она
// означала «касса команды → счёт компании», а общего счёта в продукте не
// осталось. Одно событие — одно слово: перевод.

export function TransferSheet({
  visible,
  onClose,
  accounts,
  teamById,
  presetFromId,
  presetToId,
  presetAmount,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  /** Перевод записан (до закрытия листа). */
  onSent?: () => void;
  /** Активные счета с балансами (owner-only данные). Фильтр экрана на перевод
   *  не распространяется: деньги ходят между всеми счетами тенанта. */
  accounts: AccountWithBalance[];
  teamById: Map<string, Team>;
  /** Источник, с которого пришли (свайп по строке, карточка счёта). */
  presetFromId?: string | null;
  /** ПОЛУЧАТЕЛЬ ИЗ ВЫЗЫВАЮЩЕГО СЦЕНАРИЯ. Нужен ровно там, где деньги идут В
   *  счёт, а не из него: счёт в минусе закрыть нельзя, и единственный выход —
   *  пополнить его с другого. Раньше такому счёту
   *  показывали только текст «сначала проведите приход», и человек шёл искать
   *  перевод сам, вручную выбирая направление. */
  presetToId?: string | null;
  /** Сумма из вызывающего сценария («Сдать остаток» при закрытии счёта).
   *  Без неё подставляется весь остаток источника. */
  presetAmount?: number | null;
}) {
  const t = useThemeColors();
  const online = useIsOnline();
  const runTransfer = useTransferWithUndo();
  const tenantQuery = useTenant();
  const currency = tenantQuery.data?.currency;
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia");

  const draft = useTransferDraft({
    visible,
    accounts,
    presetFromId,
    presetToId,
    presetAmount,
    businessToday,
  });
  const { step, from, to, amountCents } = draft;

  const teamName = useMemo(
    () => (id: string | null) => (id ? (teamById.get(id)?.name ?? null) : null),
    [teamById],
  );
  // ОДНО ПРАВИЛО ИМЕНИ на весь лист: в карточках счёт называется полностью,
  // «Наличка · Команда 2». Условной дописки команды больше нет — в СПИСКЕ её
  // говорит заголовок группы, и там строка остаётся голым именем.
  const spansTeams = useMemo(() => transferSpansTeams(accounts), [accounts]);
  const label = useMemo(
    () => (account: AccountWithBalance) =>
      accountOwnerLabel(account, teamName, spansTeams),
    [teamName, spansTeams],
  );
  // Порядок списка по-прежнему считается от команды ИСТОЧНИКА: её счета идут
  // первыми — в них сдают и из них переводят чаще всего.
  const ownTeamId = from?.brigade_id ?? null;
  const amountNum = (amountCents ?? 0) / 100;

  const groups = useMemo(
    () =>
      transferGroups({
        accounts,
        // В шаге «Откуда» из списка убирается ПОЛУЧАТЕЛЬ, в шаге «Куда» —
        // источник: счёт сам себе стороной перевода не бывает. Так выбор
        // недопустимой пары просто невозможен, и объяснять постфактум нечего.
        from: step === "from" ? to : from,
        teams: [...teamById.values()],
        ownTeamId,
      }),
    [accounts, from, to, ownTeamId, step, teamById],
  );

  const dateFloor = useMemo(
    () => transferDateFloor(accounts, businessToday),
    [accounts, businessToday],
  );

  // Введённая, но негодная сумма — её настоящая причина, а не общее «больше нуля».
  const amountProblem = moneyInputProblem(draft.amount);
  const reason =
    online && from && to && amountProblem
      ? amountProblem
      : transferReason(online, from, to, amountNum);
  const canSend = reason === null && !draft.sending;
  // Задним числом — остаток источника на те дни, а не на сегодня
  // (`past-minus.ts`): минус в прошлом не запрет, а слова под кнопкой.
  const isOwner = useCurrentRole().data === "owner";
  const backdated = draft.occurredOn < businessToday;
  const movesAfter = useMovesAfter(
    from?.id ?? null,
    draft.occurredOn,
    visible && isOwner && backdated && !!from?.balance_known,
  );
  const pastMinus =
    reason === null && from && movesAfter.data
      ? pastTransferMinus({
          name: label(from),
          balance: from.balance,
          date: draft.occurredOn,
          today: businessToday,
          movesAfter: movesAfter.data,
          amount: amountNum,
        })
      : null;
  const warning = pastMinus ? minusWarning(pastMinus) : null;
  // ПОКА ПЕРЕВОД ЛЕТИТ, ЛИСТ НЕ ЗАКРЫВАЕТСЯ: смахнутый в
  // этот момент лист прятал отказ сервера, и человек думал, что деньги ушли.
  // НАБРАННОЕ — ТОЛЬКО ПОСЛЕ ВОПРОСА: свайп вниз молча
  // терял сумму, день и заметку. Открытый и нетронутый лист закрывается сразу.
  const dirty = transferIsDirty(draft.opened.current, draft);
  const guard = useGuardedClose({
    dirty,
    busy: draft.sending,
    onClose,
    message: "Перевод не сохранится.",
  });

  const send = useTransferSend({
    visible,
    from,
    to,
    amountCents,
    amountNum,
    occurredOn: draft.occurredOn,
    note: draft.note,
    businessToday,
    currency,
    label,
    runTransfer,
    setSending: draft.setSending,
    setFailure: draft.setFailure,
    onClose,
    onSent,
  });

  const title = transferTitle(step);

  // ВЕТКИ «НЕТ ДОПУСТИМОЙ ПАРЫ» ЗДЕСЬ НЕТ. Она объясняла запрет
  // «между командами только через общий счёт» и предлагала завести общий счёт;
  // ни запрета, ни общего счёта в продукте нет.
  // Единственная оставшаяся невозможность — меньше двух активных счетов, и её
  // словами называет пустое состояние шага выбора: двери в лист (иконка ⇄ на
  // экране счетов) не гаснут, и молчаливый пустой список читался бы как
  // поломка.
  const view: TransferView = {
    ...draft,
    t,
    visible,
    guard,
    title,
    businessToday,
    currency,
    dateFloor,
    groups,
    spansTeams,
    label,
    reason,
    warning,
    canSend,
    amountNum,
    send,
  };
  if (step === "date") return renderTransferDateStep(view);
  if (step === "from" || step === "to") return renderTransferAccountStep(view);
  return renderTransferFormStep(view);
}
