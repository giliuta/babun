// ЗАПИСИ КЛИЕНТА — на карточке ОДНА строка.
//
// Владелец 2026-07-26: «должна быть просто история записей: нажимаю — и там
// абсолютно все записи, полноценная страница… оставь только историю записи,
// где всё написано — долг и всё остальное».
//
// Поэтому здесь больше нет ни «Прошлого визита», ни «Принять оплату»: и то,
// и другое — про КОНКРЕТНУЮ запись, а конкретная запись живёт в истории.
// Оплата принимается там же, где она случилась: история → запись → «Оплата».
// Долг при этом остаётся на виду — в сводке под номером телефона.
//
// Что было до этого: лента визитов с пагинацией на четверть экрана плюс
// отдельный блок «Финансы» из пяти read-only строк.

import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { NavRow, RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";

export default function VisitsMoneyBlock({
  clientId,
  appointments,
}: {
  clientId: string;
  appointments: Appointment[];
}) {
  const router = useRouter();
  const count = appointments.length;

  // Записей не было — строки нет вовсе (пустых полок не держим).
  if (count === 0) return null;

  return (
    <RowGroup>
      <NavRow
        label="История записей"
        value={String(count)}
        onPress={() => {
          haptics.tap();
          router.push({ pathname: "/clients/visits", params: { clientId } });
        }}
      />
    </RowGroup>
  );
}
