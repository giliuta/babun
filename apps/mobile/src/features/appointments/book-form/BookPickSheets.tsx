import { locationAddressForBooking } from "@babun/shared/local/clients";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import { ObjectPickerSheet } from "@/features/clients/ObjectPickerSheet";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import { ServicePicker } from "@/features/appointments/BookingPickers";
import { minutesBetweenHM } from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";
import type { BookModel } from "./use-book-form";
import { SETTLED_STAYS, settledVisit } from "@/features/calendar/home/appointment-rules";

/** Sheets that pick what the record is about: time, object, client, services. */
export function BookPickSheets({ form }: { form: BookModel }) {
  const {
    router,
    toast,
    whenOpen,
    setWhenOpen,
    date,
    setDate,
    timeStart,
    setTimeStart,
    timeEnd,
    setTimeEnd,
    allDay,
    setAllDay,
    dateTouchedRef,
    setDurationTouched,
    setDurationByHand,
    client,
    objectSheet,
    setObjectSheet,
    locationWriter,
    locationId,
    setLocationId,
    address,
    setAddress,
    canRequestAddress,
    requestActions,
    setAddedLocation,
    serverLocations,
    objectPicker,
    setObjectPicker,
    kind,
    eventLocationPool,
    eventPickPool,
    clientLocations,
    pickLocation,
    clientObjectsWritable,
    openEventObjectAdd,
    objectEditClient,
    objectEdit,
    setObjectEdit,
    eventLocationWriter,
    forgetLocation,
    clientPickerOpen,
    setClientPickerOpen,
    statsById,
    clients,
    recentClientIds,
    clientId,
    clearClient,
    pickClient,
    teamId,
    chainStep,
    setChainStep,
    servicePickerOpen,
    setServicePickerOpen,
    teamServices,
    serviceIds,
    toggleService,
    overrides,
    setQty,
    selectedServices,
    servicesQuery,
  } = form;
  return (
    <>
      <WhenSheet
        open={whenOpen}
        date={date}
        timeStart={timeStart}
        timeEnd={timeEnd}
        allDay={allDay}
        // «Весь день» с формы события снят.
        allowAllDay={false}
        // Шаг минут здесь больше не передают: пятиминутка — закон продукта
        // (`MINUTE_STEP`, DS §5), и попап знает его сам. Почему это НЕ
        // «Длительность записи» тенанта — записано в шапке попапа.
        onCommit={(next) => {
          // ОПЛАЧЕННУЮ — ТОЛЬКО В ЕЁ ДНЕ, как в календаре: сервер
          // (`protect_paid_appointment_finance`) отклонил бы сохранение, и с
          // ним пропали бы все остальные правки этого «Сохранить».
          const editing = form.editing;
          if (editing && settledVisit(editing) && next.date !== editing.date) {
            toast(SETTLED_STAYS, "info");
            return;
          }
          dateTouchedRef.current = true;
          setDate(next.date);
          setTimeStart(next.timeStart);
          setTimeEnd(next.timeEnd);
          setAllDay(false);
          // Конец перестаёт расти под услуги, только если его ДЛИТЕЛЬНОСТЬ
          // задали руками. Смена даты или начала — не про длительность:
          // попап сдвигает конец вместе с началом, и добавленная после
          // услуга по-прежнему обязана удлинить запись.
          const before = minutesBetweenHM(timeStart, timeEnd);
          const after = minutesBetweenHM(next.timeStart, next.timeEnd);
          if (next.allDay || after !== before) {
            setDurationTouched(true);
            // Рука человека на длительности — с этого момента тип её не
            // перебивает (см. `durationByHand`).
            setDurationByHand(true);
          }
        }}
        onClose={() => setWhenOpen(false)}
      />
      {/* Добавление объекта — ТОТ ЖЕ лист, что на карточке клиента: один
          диалект и одна дорога записи. Открывается с уже набранным здесь
          адресом и сразу выбирает добавленный объект для этой записи.

          АДРЕС ПОДСТАВЛЯЕТСЯ ТОЛЬКО РАЗОВЫЙ — тот, что набрали в поле без
          объекта. Пока выбран объект, `address` держит ЕГО адрес, и лист
          открывался с «Karpathou 9» в поле НОВОГО объекта: одно «Готово»
          заводило клиенту второй такой же дом. */}
      {client ? (
        <ObjectSheet
          // Черновик листа — у ЭТОГО клиента: сменили клиента, и адрес,
          // набранный для прежнего, ушёл бы в объекты нового.
          key={client.id}
          visible={objectSheet}
          writer={locationWriter}
          teamId={client.team_id ?? null}
          initialTarget={locationId ? "" : address}
          onRequestFromClient={
            canRequestAddress
              ? () => void requestActions.request(client.id)
              : undefined
          }
          onAdded={(added) => {
            setAddedLocation({
              clientId: client.id,
              loc: { ...added, isPrimary: serverLocations.length === 0 },
            });
            setLocationId(added.id);
            setAddress(locationAddressForBooking(added));
            toast("Объект сохранён");
          }}
          onClose={() => setObjectSheet(false)}
        />
      ) : null}
      {/* Выбор/замена объекта; «Добавить объект» в его футере открывает лист
          добавления, когда этот уже уехал. И у записи, и у события список —
          объекты её клиента. */}
      <ObjectPickerSheet
        visible={objectPicker}
        locations={
          kind === "event"
            ? eventPickPool.map((row) => row.loc)
            : clientLocations
        }
        selectedId={locationId}
        ownerNameFor={
          kind === "event"
            ? (loc) =>
                eventLocationPool.find((row) => row.loc.id === loc.id)?.ownerName ??
                null
            : undefined
        }
        onSelect={(loc) => pickLocation(loc.id)}
        onDeselect={() => {
          setLocationId(null);
          // Адрес записи — снимок выбранного объекта: снятый объект уносит и
          // его. Иначе запись сохранялась «без объекта» с прежним адресом —
          // в маршруте, в SMS и в цвете «нет объекта». У
          // события адрес — своё поле, его не трогаем.
          if (kind === "work") setAddress("");
          haptics.tap();
        }}
        onAdd={
          !clientObjectsWritable ? undefined : kind === "event" ? openEventObjectAdd : () => setObjectSheet(true)
        }
        onClose={() => setObjectPicker(false)}
      />
      {/* Правка выбранного объекта — тем же листом, что на карточке, и тем же
          писателем, что у его владельца. */}
      {objectEditClient ? (
        <ObjectEditSheet
          visible={objectEdit}
          client={objectEditClient}
          locationId={objectEdit ? locationId : null}
          writer={kind === "event" ? eventLocationWriter : locationWriter}
          onRequestFromClient={
            canRequestAddress && objectEditClient
              ? () => void requestActions.request(objectEditClient.id)
              : undefined
          }
          onDeleted={forgetLocation}
          onClose={() => setObjectEdit(false)}
        />
      ) : null}
      {/* ОДНА ШТОРКА КЛИЕНТА НА ПРОДУКТ: вся разница — недавние наверх, вводная о
          человеке и создание из набранного — это пропы общей шторки. */}
      <ClientPickerSheet
        visible={clientPickerOpen}
        statsById={statsById}
        clients={clients}
        recentIds={recentClientIds}
        selectedId={clientId}
        onSelect={(pickedClient) => {
          pickClient(pickedClient);
          setClientPickerOpen(false);
        }}
        // ПОВТОРНЫЙ ТАП ПО ВЫБРАННОМУ СНИМАЕТ ЕГО.
        // Объект уходит вместе с клиентом: чужому он не принадлежит.
        onDeselect={() => {
          clearClient();
          setClientPickerOpen(false);
        }}
        // СОЗДАНИЕ — ТОЛЬКО КАРТОЧКОЙ КЛИЕНТА, И ОНА ОТКРЫВАЕТСЯ ПОВЕРХ
        // ЗАПИСИ (`/client`): быстрое создание одним тапом
        // заводило бы клиента с именем без телефона или наоборот. Набранное в
        // поиске уезжает в карточку параметром.
        onCreate={(prefill) =>
          router.push({
            pathname: "/client",
            // Клиент записи — клиент её команды.
            params: { id: "new", ...prefill, ...(teamId ? { team: teamId } : {}) },
          })
        }
        onClose={() => setClientPickerOpen(false)}
        onExited={() => {
          if (chainStep === "clientClosing") setChainStep("services");
        }}
      />
      <ServicePicker
        visible={servicePickerOpen}
        onClose={() => setServicePickerOpen(false)}
        services={teamServices}
        selectedIds={serviceIds}
        // Каталог знает день записи: услуга, которую по вторникам не делают,
        // уезжает вниз списка под свою подпись.
        date={date}
        // И команду записи: дверь «Добавить услугу» открывает её прайс.
        teamId={teamId}
        onToggle={toggleService}
        quantities={Object.fromEntries(
          serviceIds.map((id) => [id, overrides[id]?.qty ?? 1]),
        )}
        onQtyChange={setQty}
        // Цена, которую держит запись (снимок прошлой правки или вписанная
        // руками), — лист печатает её, а не сегодняшний прайс.
        recordLines={Object.fromEntries(
          selectedServices
            .filter(
              (line) =>
                overrides[line.serviceId]?.locked != null ||
                overrides[line.serviceId]?.price != null,
            )
            .map((line) => [
              line.serviceId,
              { unitPrice: line.pricePerUnit, total: line.totalPrice },
            ]),
        )}
        catalog={
          servicesQuery.isLoadingError
            ? "failed"
            : servicesQuery.isPending
              ? "loading"
              : "ready"
        }
        catalogError={servicesQuery.error}
        onRetryCatalog={() => void servicesQuery.refetch()}
      />
    </>
  );
}
