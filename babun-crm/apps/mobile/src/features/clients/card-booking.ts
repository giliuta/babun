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
// команда — последняя бригада клиента, объект — основной. «Готово» и
// «Отмена» возвращают туда, откуда пришли: на карточку клиента.
// Обработчик ?new=1 в app/(dashboard)/index.tsx остаётся для входов ИЗ
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
}

/** Returns a stable-enough callback that opens the calendar pre-aimed at
 *  the given client/object/team. */
export function useBookingNav(): (target: BookingTarget) => void {
  const router = useRouter();
  // Засов от двойного тапа: два быстрых нажатия открывали ДВА экрана
  // «Новая запись» друг за другом, и второй приходилось закрывать вручную.
  // Снимается, когда экран записи закрылся (следующий тик после ухода).
  const busy = useRef(false);
  return ({ clientId, locationId, teamId, serviceIds, date }: BookingTarget) => {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      busy.current = false;
    }, 700);
    router.push({
      pathname: "/book",
      params: {
        clientId,
        ...(locationId ? { locationId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(date ? { date } : {}),
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
