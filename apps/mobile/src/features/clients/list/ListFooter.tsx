import { View } from "react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { clientCardHref, ownClientCardHref } from "@/features/clients/clients-company";
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
  } = list;
  return (
    <>
      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу, вместо отдельной иконки в шапке.

          «СОЗДАТЬ КЛИЕНТА», А НЕ «ДОБАВИТЬ» (владелец 2026-09-10: «тут кнопка
          должна быть „создать клиента", как и в шторке»). Одно и то же
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
        // КНОПКА НА СВОЁМ МЕСТЕ И СЕРАЯ, как в «Финансах» (владелец 20.09:
        // «визуал целой страницы мы полностью сохраняем, а потом просто
        // отключаем, что будет работать, а что нет»). Исчезающий футер менял
        // рост страницы вместе с правами.
        <View
          style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}
        >
          {/* ТАРИФ БЕЗ КЛИЕНТОВ — КНОПКА СЕРАЯ, а не спрятана (владелец 1.10:
              «всё видно, новое серым»): тап поднимает плашку «Нужно изменить
              тариф». Партнёр без своего тарифа видит общий список, но своего
              клиента не заведёт — сервер отбил бы его на сохранении. */}
          <TariffLocked locked={!clientsInPlan}>
            <GradientButton
              label="Создать клиента"
              onPress={() =>
                router.push(
                  chipGuest
                    ? clientCardHref("new", chipGuest.scope.tenantId)
                    : ownClientCardHref("new", scope),
                )
              }
              disabled={!createHere}
            />
          </TariffLocked>
        </View>
      )}
    </>
  );
}
