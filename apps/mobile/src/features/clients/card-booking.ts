// card-booking — one shared «записать» для всех поверхностей карточки
// клиента (строка действий, спайн «Обслуживание», «Записать сюда» у объекта).
//
// РАНЬШЕ переход шёл через календарь: push на таб «Календарь» с ?new=1, там
// обработчик переключал команду и день, и только потом открывал /book.
// Пользователь видел вспышку чужого календаря, а после «Готово» или «Отмена»
// оставался НА КАЛЕНДАРЕ — на дне, который выбрал не он (владелец 2026-07-26:
// «нажимаю записать, она перекидывает запись непонятно на какой день»).
//
// ТЕПЕРЬ /book открывается НАПРЯМУЮ. Дата — сегодня (её ставит сам /book),
// команда — последняя команда клиента, объект — основной. «Готово» и
// «Отмена» возвращают туда, откуда пришли: на карточку клиента.
// Обработчик ?new=1 в app/(dashboard)/(home)/index.tsx остаётся для входов ИЗ
// календаря (напоминания, тап по слоту) — там календарь и есть контекст.

import { useRef } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { haptics } from "@/lib/haptics";

export interface BookingTarget {
  clientId: string;
  locationId?: string | null;
  teamId?: string | null;
  /** Услуги для предзаполнения — из последнего завершённого визита.
   *  Экран записи читает их из параметра `services` (id через запятую). */
  serviceIds?: readonly string[];
  /** YYYY-MM-DD, если дата известна («Записать» на дату ТО). Без неё
   *  экран записи открывается на СЕГОДНЯ по времени тенанта. */
  date?: string | null;
  /** Повторное ТО: экран записи гасит напоминание только после
   *  подтверждённой вставки заявки — иначе то же ТО осталось бы в «Пора». */
  reminderId?: string | null;
}

/** Returns a stable-enough callback that opens the calendar pre-aimed at
 *  the given client/object/team. */
export function useBookingNav(): (target: BookingTarget) => void {
  const router = useRouter();
  // Засов от двойного тапа: два быстрых нажатия открывали ДВА экрана
  // «Новая запись» друг за другом, и второй приходилось закрывать вручную.
  // Снимается, когда экран записи закрылся (следующий тик после ухода).
  const busy = useRef(false);
  return ({
    clientId,
    locationId,
    teamId,
    serviceIds,
    date,
    reminderId,
  }: BookingTarget) => {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      busy.current = false;
    }, 700);
    // СНАЧАЛА «КОГДА» (владелец 2026-08-07, по образцу Bumpix): «Записать»
    // открывает НАСТОЯЩИЙ КАЛЕНДАРЬ в режиме подбора — со всеми записями на
    // своих местах и зелёной подсветкой свободного времени. Тап по зелёному
    // ведёт в форму с этим временем. Раньше форма открывалась сразу, а время
    // крутили колесом, не видя, занято оно или нет.
    //
    // Исключение: дата уже известна (тап по пустому слоту в календаре,
    // «Записать ТО» на дату) — выбирать «когда» второй раз незачем.
    if (!date) {
      router.push({
        pathname: "/",
        params: {
          pickClient: clientId,
          ...(locationId ? { pickLocation: locationId } : {}),
          // Команда, услуги и напоминание ЕДУТ ДАЛЬШЕ вместе с клиентом.
          // Раньше эта ветка забирала только клиента: календарь считал
          // свободное время по команде, открытой в чипе, и записывал туда
          // же — клиента, который всегда ездит к команде Б, ставили к А.
          // «Как в прошлый раз» без услуг тем более пустое.
          ...(teamId ? { pickTeam: teamId } : {}),
          ...(serviceIds && serviceIds.length
            ? { pickServices: serviceIds.join(",") }
            : {}),
          ...(reminderId ? { pickReminder: reminderId } : {}),
        },
      });
      return;
    }
    router.push({
      pathname: "/book",
      params: {
        clientId,
        ...(locationId ? { locationId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(date ? { date } : {}),
        ...(reminderId ? { reminderId } : {}),
        ...(serviceIds && serviceIds.length
          ? { services: serviceIds.join(",") }
          : {}),
      },
    });
  };
}

/** То же, но с предупреждением о чёрном списке. Записать такого клиента
 *  можно, но не молча — и это правило должно быть одно на все точки записи
 *  (ряд действий карточки, «Обслуживание», страница объекта), иначе одна из
 *  них тихо проведёт мимо предупреждения. */
export function useGuardedBookingNav(): (
  client: Client,
  target: Omit<BookingTarget, "clientId">,
) => void {
  const book = useBookingNav();
  return (client, target) => {
    haptics.tap();
    const go = () => book({ ...target, clientId: client.id });
    if (client.blacklisted) {
      Alert.alert("Клиент в чёрном списке", "Всё равно записать?", [
        { text: "Отмена", style: "cancel" },
        { text: "Записать", onPress: go },
      ]);
      return;
    }
    go();
  };
}
