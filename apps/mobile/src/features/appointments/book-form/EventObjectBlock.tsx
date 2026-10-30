import { MapPin } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { LocationRequestRow } from "@/features/clients/blocks/LocationRequestRow";
import { InlineNoteField } from "@/components/blocks/InlineNoteField";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import { haptics } from "@/lib/haptics";
import { Text } from "./book-text";
import { hasEventPlace, placeAsLocation, placeTypeName } from "./event-place";
import type { BookModel } from "./use-book-form";

/** Block «Объект» of an event: its client's object, or the event's own. */
export function EventObjectBlock({ form }: { form: BookModel }) {
  const {
    t,
    evShowObject,
    can,
    workInPlan,
    eventLocationEntry,
    eventAddress,
    setEventAddress,
    eventPlacePin,
    setEventPlacePin,
    eventPlaceNote,
    setEventPlaceNote,
    eventPlaceTypeId,
    setEventPlaceTypeId,
    placeTypePresets,
    setObjectPicker,
    setPlaceSheet,
    clientObjectsWritable,
    setObjectEdit,
    clientId,
    eventObjectNote,
    pendingRequests,
    requestActions,
    eventPickPool,
    openEventObjectAdd,
    teamId,
  } = form;
  if (!evShowObject || !can.showObject) return null;

  // ОБЪЕКТ СОБЫТИЯ — ДВА ВИДА, ОДНА СТРОКА `ObjectRow`:
  //   • С КЛИЕНТОМ — только объект ЭТОГО клиента (выбор из его объектов,
  //     нет объектов — сразу его форма добавления);
  //   • БЕЗ КЛИЕНТА — объект самого события (`event-place.ts`): форма
  //     открывается сразу, без списка, и в базу клиентов он не пишется.
  // Объекта «любого клиента» в событии нет: список всех объектов открывал
  // чужие адреса. Старое событие, где такой уже стоит, показывает его как
  // есть — только читать, данные не теряются.
  // БЕЗ ТАРИФА — ОБЪЕКТ САМОГО СОБЫТИЯ РАБОТАЕТ, ОБЪЕКТ КЛИЕНТА — НЕТ. Объект
  // события живёт только в событии и клиентской функцией не является; объект
  // клиента приходит вместе с клиентом, а клиента без тарифа не записать.
  // Замок — `workInPlan` формы (одно место, `use-book-form.ts`).
  const clientObjects = workInPlan;
  const objectClientId = clientObjects ? clientId : null;
  const place = { address: eventAddress, pin: eventPlacePin, note: eventPlaceNote };
  const ownPlace = !eventLocationEntry && hasEventPlace(place);
  const foreign = !!eventLocationEntry && eventLocationEntry.ownerId !== clientId;
  const removePlace = () => {
    setEventAddress("");
    setEventPlacePin("");
    setEventPlaceNote("");
    setEventPlaceTypeId(null);
    haptics.tap();
  };
  const openPlace = () => {
    haptics.tap();
    setPlaceSheet(true);
  };

  const block = (
    <SectionCard title="Объект">
      {eventLocationEntry ? (
        <>
          <ObjectRow
            loc={eventLocationEntry.loc}
            showNote={false}
            teamId={teamId}
            // Тап — выбор другого объекта клиента, удержание — правка этого.
            onPress={
              can.editObject && !foreign
                ? () => {
                    setObjectPicker(true);
                    haptics.tap();
                  }
                : undefined
            }
            onLongPress={
              can.editObject && clientObjectsWritable && !foreign
                ? () => {
                    haptics.tap();
                    setObjectEdit(true);
                  }
                : undefined
            }
            longPressLabel="Правка объекта"
          />
          {/* Старое событие с объектом другого клиента: чей он — строкой под
              ним, иначе «Дом» ничего не говорит о том, куда едут. Новых
              таких выборов нет. */}
          {foreign ? (
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ paddingHorizontal: 16, paddingBottom: 8, fontSize: 13, color: t.faint }}
            >
              {`Объект клиента: ${eventLocationEntry.ownerName}`}
            </Text>
          ) : null}
          <InlineNoteField
            note={eventObjectNote}
            placeholder="Заметка объекта"
            accessibilityLabel="Заметка объекта"
            readOnly={!clientObjectsWritable || foreign}
          />
        </>
      ) : ownPlace ? (
        // Свой объект события: тап — правка той же формой, смахнуть — убрать.
        can.editObject ? (
          <SwipeRow
            label="Убрать"
            color={t.danger}
            onAction={removePlace}
            accessibilityLabel="Убрать объект"
          >
            <ObjectRow loc={placeAsLocation(place, placeTypeName(placeTypePresets, eventPlaceTypeId))} teamId={teamId} onPress={openPlace} />
          </SwipeRow>
        ) : (
          <ObjectRow loc={placeAsLocation(place, placeTypeName(placeTypePresets, eventPlaceTypeId))} teamId={teamId} />
        )
      ) : (
        <>
          {/* «ЖДЁМ АДРЕС» — и у события: ссылка клиенту уже ушла, ответа
              ещё нет. */}
          {pendingRequests.map((request, i) => (
            <LocationRequestRow
              key={request.id}
              request={request}
              separated={i > 0}
              onPress={() => void requestActions.menu(request)}
            />
          ))}
          {/* ОДНА КНОПКА: у клиента с объектами — выбор (добавить — в
              футере выбора), без объектов — сразу добавление; без клиента —
              сразу форма объекта события. Без права менять объект двери нет. */}
          {can.editObject ? (
            objectClientId && eventPickPool.length > 0 ? (
              <ChooseRow
                icon={MapPin}
                label="Выбрать объект"
                hint="Открывает объекты клиента"
                onPress={() => {
                  setObjectPicker(true);
                  haptics.tap();
                }}
              />
            ) : (
              <ChooseRow
                icon={MapPin}
                label="Добавить объект"
                hint={objectClientId ? "Заводит первый объект клиента" : "Открывает форму объекта"}
                onPress={openEventObjectAdd}
              />
            )
          ) : null}
        </>
      )}
    </SectionCard>
  );

  // ОБЪЕКТ КЛИЕНТА БЕЗ ТАРИФА — ВИДНО, НО СЕРО: тап — плашка тарифа, как у
  // «Сохранить» в записи. Старое событие показывает его как было.
  return !clientObjects && eventLocationEntry ? (
    <TariffLocked locked>{block}</TariffLocked>
  ) : (
    block
  );
}
