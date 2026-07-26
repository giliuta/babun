// «ВИЗИТЫ И ДЕНЬГИ» — один блок вместо двух (Визиты + Финансы).
//
// Владелец 2026-07-26: «не надо делать вот эту длинную запись, много
// всего лишнего — визиты вот это вот куча; компактно, чем проще тем
// лучше». Было: лента визитов (дата · статус-пилюля · пилюля «К оплате» ·
// сумма) с пагинацией «Показать ещё» — четверть экрана на архив, который
// и так весь лежит в Календаре; плюс отдельный блок Финансы с пятью
// read-only строками (LTV, средний чек, последняя оплата, последний
// визит, долг) и пилюлей лояльности.
//
// Стало две строки, и обе — действия:
//   Принять оплату   €100                  ›   (только при долге по визитам)
//   Прошлый визит    Чистка кондиционера   ›   → тот визит в календаре
//
// Что куда уехало (де-дупликация): «3 визита · €50 · был 27 мая» —
// единственный дом чисел, строка доверия в идентичности. Долг — здесь, в
// действии, которое его закрывает. Полная история — в Календаре.

import { useMemo } from "react";
import { ActionSheetIOS, Alert } from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  buildDebtPaidPatch,
  PAY_METHOD_LABELS,
  type PayMethod,
} from "@/features/appointments/payment";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { formatShortDateRu } from "@/features/clients/format";
import { NavRow, RowGroup } from "@/features/clients/card-rows";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

export default function VisitsMoneyBlock({
  appointments,
  services,
  stats,
}: {
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  stats: ClientStats | undefined;
}) {
  const router = useRouter();
  const t = useThemeColors();
  const toast = useToast();
  const updateApt = useUpdateAppointment();

  const serviceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);

  // Долг ВЫЧИСЛЯЕТСЯ из неоплаченных визитов, поэтому и закрывать его надо
  // у источника — иначе цифра в карточке разошлась бы с записями.
  // Закрываем самый СТАРЫЙ долг: он и просрочен сильнее всех.
  //
  // ТОЛЬКО СОСТОЯВШИЕСЯ визиты — ровно как считает client-stats (там долг
  // копится в ветке status === "completed"). Без этого фильтра сюда
  // попадали ЗАПЛАНИРОВАННЫЕ и ОТМЕНЁННЫЕ заявки: строка требовала денег
  // за работу, которую ещё не сделали, её сумма расходилась с «Долг» в
  // шапке карточки, а тап писал платёж в будущую запись.
  const debtApts = useMemo(
    () =>
      appointments
        .filter((a) => a.status === "completed" && getDebtAmount(a) > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [appointments],
  );
  const totalDebt = debtApts.reduce((n, a) => n + getDebtAmount(a), 0);
  const oldestDebt = debtApts[0] ?? null;

  const lastVisit = useMemo(() => {
    const done = appointments
      .filter((a) => a.status === "completed")
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return done[0] ?? null;
  }, [appointments]);

  const takePayment = () => {
    if (!oldestDebt) return;
    haptics.tap();
    const amount = getDebtAmount(oldestDebt);
    const methods = Object.keys(PAY_METHOD_LABELS) as PayMethod[];
    const options = [...methods.map((m) => PAY_METHOD_LABELS[m]), "Отмена"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        // Заголовок называет КОНКРЕТНЫЙ визит: при нескольких долгах видно,
        // какой именно закрывается, и «€100» в строке не обманывает.
        title: `Визит ${formatShortDateRu(oldestDebt.date)} · ${formatEUR(amount)}`,
        options,
        cancelButtonIndex: options.length - 1,
      },
      (i) => {
        const method = methods[i];
        if (!method) return;
        updateApt.mutate(
          {
            id: oldestDebt.id,
            patch: buildDebtPaidPatch(oldestDebt, { method, amount }),
          },
          {
            onSuccess: () => toast(`Оплата ${formatEUR(amount)} получена`),
            onError: (e) => Alert.alert("Ошибка", (e as Error).message),
          },
        );
      },
    );
  };

  const openLastVisit = () => {
    if (!lastVisit) return;
    haptics.tap();
    router.push({
      pathname: "/(dashboard)",
      params: {
        appointmentId: lastVisit.id,
        date: lastVisit.date,
        ...(lastVisit.team_id ? { teamId: lastVisit.team_id } : {}),
      },
    });
  };

  const lastVisitValue = lastVisit
    ? (lastVisit.service_ids ?? [])
        .map((id) => serviceName.get(id))
        .filter(Boolean)
        .join(", ") || formatShortDateRu(lastVisit.date)
    : null;

  // Ни долга, ни истории — блока нет вовсе (пустых полок не держим).
  if (!oldestDebt && !lastVisit) return null;

  return (
    <RowGroup title="Визиты и деньги">
      {oldestDebt ? (
        <NavRow
          label="Принять оплату"
          value={formatEUR(totalDebt)}
          valueColor={t.warning}
          onPress={takePayment}
        />
      ) : null}
      {lastVisit ? (
        <NavRow
          label="Прошлый визит"
          value={lastVisitValue}
          separated={!!oldestDebt}
          onPress={openLastVisit}
        />
      ) : null}
    </RowGroup>
  );
}

/** Долг клиента по визитам — для читателей вне блока (карточка/список).
 *  Оставлен здесь, чтобы формула жила рядом с действием, которое её
 *  закрывает. */
export function visitsDebt(appointments: Appointment[]): number {
  return appointments.reduce((n, a) => n + getDebtAmount(a), 0);
}

/** Совместимость: `stats.debt` уже считает то же самое; экспорт нужен
 *  только чтобы будущий читатель не заводил шестую копию формулы. */
export type { ClientStats };
