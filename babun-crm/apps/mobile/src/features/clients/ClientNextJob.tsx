// «ЧТО ДАЛЬШЕ» — группа из трёх строк вместо постера-hero и ряда круглых
// кнопок (арбитраж поблочного редизайна 2026-07-26; владелец: «компактно,
// чем проще тем лучше, не надо накидывать куча всего»).
//
// БЫЛО: большая цветная плашка с иконкой, заголовком и подзаголовком,
// которая меняла и тон, и смысл (запись → просроченное ТО → скоро ТО →
// «Записать»), плюс НИЖЕ ряд из четырёх кругов, где «Записать» дублировал
// плашку, а звонок и WhatsApp жили в третьем месте.
//
// СТАЛО:
//   Запись      завтра · 14:00 · Лимассол   ›   (только если запись есть)
//   Напомнить   14 мар / «Не стоит»         ›
//   ▓ Записать                              ›   ← ЕДИНСТВЕННАЯ громкая строка
//
// Состояния ТО отсюда УБРАНЫ: они живут в своей группе «Обслуживание» —
// один факт, один дом. Звонок и WhatsApp уехали в хвост строки телефона.
// «Записать» на месте ВСЕГДА, поэтому его положение не «прыгает».

import { ActionSheetIOS, Alert } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  formatShortDateRu,
  MONTHS_RU_SHORT,
  ymdInDays,
} from "@/features/clients/format";
import { NavRow, RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface ClientNextJobProps {
  client: Client;
  appointments: Appointment[];
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => void;
}

/** Живая запись на дату+время из nextApt: селектор несёт только date+time,
 *  а календарю нужен id и бригада — иначе визит чужой бригады открыл бы
 *  пустой день. */
function findHeroApt(
  appointments: Appointment[],
  nextApt: { date: string; time: string },
): Appointment | null {
  return (
    appointments.find(
      (a) =>
        a.date === nextApt.date &&
        a.time_start === nextApt.time &&
        (a.status === "scheduled" || a.status === "in_progress"),
    ) ?? null
  );
}

function aptLabel(nextApt: { date: string; time: string }): string {
  const [y, m, d] = nextApt.date.split("-").map(Number);
  if (!y || !m || !d) return `${nextApt.date} · ${nextApt.time}`;
  const now = new Date();
  const at = new Date(y, m - 1, d);
  const days = Math.round(
    (at.getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  if (days === 0) return `сегодня · ${nextApt.time}`;
  if (days === 1) return `завтра · ${nextApt.time}`;
  return `${d} ${MONTHS_RU_SHORT[m - 1] ?? ""} · ${nextApt.time}`;
}

function placeLabel(client: Client, apt: Appointment | null): string | null {
  const loc = apt?.location_id
    ? client.locations?.find((l) => l.id === apt.location_id)
    : null;
  return loc?.label || null;
}

export default function ClientNextJob({
  client,
  appointments,
  stats,
  update,
}: ClientNextJobProps) {
  const router = useRouter();
  const t = useThemeColors();

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  const nextApt = stats?.nextApt ?? null;
  const heroApt = nextApt ? findHeroApt(appointments, nextApt) : null;

  const openApt = () => {
    if (!nextApt) return;
    haptics.tap();
    router.push({
      pathname: "/(dashboard)",
      params: heroApt
        ? {
            appointmentId: heroApt.id,
            date: nextApt.date,
            ...(heroApt.team_id ? { teamId: heroApt.team_id } : {}),
          }
        : { date: nextApt.date },
    });
  };

  const book = () => {
    haptics.tap();
    const go = () =>
      router.push({
        pathname: "/(dashboard)",
        params: {
          new: "1",
          clientId: client.id,
          ...(primaryLocationId ? { locationId: primaryLocationId } : {}),
          ...(stats?.lastTeamId ? { teamId: stats.lastTeamId } : {}),
        },
      });
    // Записать человека из чёрного списка можно, но не молча.
    if (client.blacklisted) {
      Alert.alert("Клиент в чёрном списке", "Всё равно записать?", [
        { text: "Отмена", style: "cancel" },
        { text: "Записать", onPress: go },
      ]);
      return;
    }
    go();
  };

  const remind = () => {
    haptics.tap();
    const options = ["Завтра", "Через неделю", "Через месяц"];
    if (client.reminder_at) options.push("Убрать напоминание");
    options.push("Отмена");
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Напомнить о клиенте",
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: client.reminder_at
          ? options.length - 2
          : undefined,
      },
      (i) => {
        if (i === 0) update({ reminder_at: ymdInDays(1) });
        else if (i === 1) update({ reminder_at: ymdInDays(7) });
        else if (i === 2) update({ reminder_at: ymdInDays(30) });
        else if (client.reminder_at && i === options.length - 2)
          update({ reminder_at: null });
      },
    );
  };

  // Дата напоминания янтарём, когда срок уже наступил — «обрати внимание».
  const reminderYmd = client.reminder_at?.slice(0, 10) ?? "";
  const reminderDue = !!reminderYmd && reminderYmd <= ymdInDays(0);

  return (
    <RowGroup>
      {nextApt ? (
        <NavRow
          label="Запись"
          value={[aptLabel(nextApt), placeLabel(client, heroApt)]
            .filter(Boolean)
            .join(" · ")}
          onPress={openApt}
        />
      ) : null}

      <NavRow
        label="Напомнить"
        value={
          reminderYmd ? formatShortDateRu(reminderYmd) || reminderYmd : null
        }
        placeholder="Не стоит"
        valueColor={reminderDue ? t.warning : undefined}
        separated={!!nextApt}
        onPress={remind}
      />

      <NavRow label="Записать" loud separated onPress={book} />
    </RowGroup>
  );
}
