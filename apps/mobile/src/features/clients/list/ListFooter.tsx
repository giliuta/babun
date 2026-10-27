import { useMemo } from "react";
import { View } from "react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { buildQuickClientDraft } from "@/features/appointments/booking-prefill";
import { useDefaultCountry } from "@/features/reference/default-country";
import { TourTarget } from "@/components/tour/TourTarget";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { clientCardHref, ownClientCardHref } from "@/session/clients-company";
import { withNewClientTeam } from "@/features/clients/team-scope";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import type { ClientsList } from "./use-clients-list";

/** Bottom of the list: bulk actions in selection mode, otherwise
 *  «Создать клиента». */
export function ListFooter({ list }: { list: ClientsList }) {
  const {
    router,
    scope,
    caps,
    selecting,
    pickedCount,
    setSmsOpen,
    onExport,
    onBulkDelete,
    clientsInPlan,
    chipGuest,
    createHere,
    teamChoice,
    query,
  } = list;
  // НАБРАННОЕ В ПОИСКЕ — БУДУЩИЙ КЛИЕНТ, как в шторке клиента записи: искали,
  // не нашли — кнопка зовёт набранное и уносит его в карточку (имя или номер).
  const country = useDefaultCountry();
  const typed = query.trim();
  const quick = useMemo(() => buildQuickClientDraft(typed, country), [typed, country]);
  const prefill = !typed
    ? {}
    : quick.kind === "phone"
      ? { phone: quick.phone }
      : { name: quick.full_name };
  return (
    <>
      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу, вместо отдельной иконки в шапке.

          «СОЗДАТЬ КЛИЕНТА», А НЕ «ДОБАВИТЬ»: кнопка называется так же, как в
          шторке. Одно и то же
          действие звалось двумя словами: лист выбора клиента говорит
          «Создать клиента», чат говорит «Создать клиента», а вкладка говорила
          «Добавить». «Добавить …» в продукте значит «дописать строку в
          список» — счёт, услугу, номер; человека же заводят, и заводят его
          одной и той же дверью откуда угодно. */}
      {selecting ? (
        <BulkActionBar
          count={pickedCount}
          onSms={() => setSmsOpen(true)}
          onExport={onExport}
          onDelete={caps.manage ? onBulkDelete : undefined}
        />
      ) : (
        // КНОПКА НА СВОЁМ МЕСТЕ И СЕРАЯ, как в «Финансах»: визуал страницы
        // сохраняется целиком, отключается только то, что не работает. Исчезающий футер менял
        // рост страницы вместе с правами.
        // НАД КЛАВИАТУРОЙ: искали и не нашли — следующий шаг «Создать», и
        // клавиатура поиска не имеет права его закрывать.
        // Отступы — на внутреннем View: KeyboardLift пишет подъём в свой
        // paddingBottom и затёр бы наш.
        <KeyboardLift>
        <View
          style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}
        >
          {/* ТАРИФ БЕЗ КЛИЕНТОВ — КНОПКА СЕРАЯ, а не спрятана (всё видно, новое
              серым): тап поднимает плашку «Нужно изменить
              тариф». Партнёр без своего тарифа видит общий список, но своего
              клиента не заведёт — сервер отбил бы его на сохранении. */}
          <TourTarget id="clients.create" shape="control">
          <TariffLocked locked={!clientsInPlan}>
            <GradientButton
              label={typed ? `Создать «${typed}»` : "Создать клиента"}
              onPress={() => {
                const href = withNewClientTeam(
                  chipGuest
                    ? clientCardHref("new", chipGuest.scope.tenantId)
                    : ownClientCardHref("new", scope),
                  teamChoice,
                );
                router.push({ ...href, params: { ...href.params, ...prefill } });
              }}
              disabled={!createHere}
            />
          </TariffLocked>
          </TourTarget>
        </View>
        </KeyboardLift>
      )}
    </>
  );
}
