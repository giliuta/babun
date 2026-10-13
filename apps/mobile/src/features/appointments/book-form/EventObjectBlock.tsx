import { View } from "react-native";
import { MapPin } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { FieldRow } from "@/components/ui/card-rows";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { LocationRequestRow } from "@/features/clients/blocks/LocationRequestRow";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { haptics } from "@/lib/haptics";
import { Text } from "./book-text";
import type { BookModel } from "./use-book-form";

/** Block «Объект» of an event: any client's object, or an old free address. */
export function EventObjectBlock({ form }: { form: BookModel }) {
  const {
    t,
    evShowObject,
    can,
    workInPlan,
    eventLocationEntry,
    eventAddress,
    setEventAddress,
    setObjectPicker,
    clientObjectsWritable,
    setObjectEdit,
    clientId,
    eventObjectNote,
    pendingRequests,
    requestActions,
    eventLocationPool,
    openEventObjectAdd,
  } = form;
  return (
    <>
      {/* ОБЪЕКТ — ТОТ ЖЕ, ЧТО В КЛИЕНТАХ, ОДИН В ОДИН (владелец
          2026-09-08: «объект надо сделать точно такой же вид объекта,
          как мы делали в клиентах, один в один; только тут другое — в
          событии можно добавить объект, не выбирая клиента»).

          Раньше здесь стояло поле «Адрес или ссылка на карту»: у
          события был свой вольный адрес, не из базы. Он не знал ни
          кода ворот, ни маршрута, ни того, что на этот же дом ездят
          записями. Теперь событие берёт НАСТОЯЩИЙ объект — ту же
          строку `ObjectRow`, что на карточке клиента и в записи.

          БЕЗ КЛИЕНТА ВЫБОР РАБОТАЕТ: список — объекты всех клиентов,
          чей объект, сказано подписью в листе. Заводится новый объект
          всё-таки клиенту (своей таблицы у объекта нет), поэтому
          «Добавить объект» без клиента сперва спрашивает клиента.

          Прежний вольный адрес старого события НЕ ТЕРЯЕТСЯ: пока
          объект не выбран, он стоит тем же полем и уезжает в патч. */}
      {evShowObject &&
      can.showObject &&
      // Объект — всегда объект клиента: без тарифа его не завести.
      ((workInPlan && can.editObject) || eventLocationEntry || eventAddress.trim()) ? (
        <SectionCard title="Объект">
          {eventLocationEntry ? (
            <>
              <ObjectRow
                loc={eventLocationEntry.loc}
                showNote={false}
                // Тап — выбор другого объекта, удержание — правка этого (владелец
                // 03.10: «три точки справа убираем… редактирование объекта —
                // задержать, как у клиента переход в карточку»).
                onPress={
                  can.editObject
                    ? () => {
                        setObjectPicker(true);
                        haptics.tap();
                      }
                    : undefined
                }
                onLongPress={
                  can.editObject && clientObjectsWritable
                    ? () => {
                        haptics.tap();
                        setObjectEdit(true);
                      }
                    : undefined
                }
                longPressLabel="Правка объекта"
              />
              {/* Чей объект — строкой под ним, когда это не клиент
                  события: иначе «Дом» ничего не говорит о том, куда
                  едут. */}
              {eventLocationEntry.ownerId !== clientId ? (
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{
                    paddingHorizontal: 16,
                    paddingBottom: 8,
                    fontSize: 13,
                    color: t.faint,
                  }}
                >
                  {`Объект клиента: ${eventLocationEntry.ownerName}`}
                </Text>
              ) : null}
              <InlineNoteField
                note={eventObjectNote}
                placeholder="Заметка объекта"
                accessibilityLabel="Заметка объекта"
                readOnly={!clientObjectsWritable}
              />
            </>
          ) : (
            <>
              {/* «ЖДЁМ АДРЕС» — И У СОБЫТИЯ (сведено 2026-09-10). Ссылка
                  клиенту уже отправлена, ответа ещё нет — в записи об
                  этом говорила строка, а событие молчало: та же ссылка,
                  тот же клиент, но узнать о ней было негде. */}
              {pendingRequests.map((request, i) => (
                <LocationRequestRow
                  key={request.id}
                  request={request}
                  separated={i > 0}
                  onPress={() => void requestActions.menu(request)}
                />
              ))}
              {/* Вольный адрес прежнего события — только пока объекта
                  нет: у нового события поля не будет вовсе. */}
              {eventAddress.trim() ? (
                <FieldRow
                  label="Адрес"
                  hideLabel
                  value={eventAddress}
                  placeholder="Адрес или ссылка на карту"
                  stacked
                  multiline
                  live
                  onSave={setEventAddress}
                />
              ) : null}
              {/* ОДНА КНОПКА, А НЕ ДВЕ (владелец 2026-09-08: «ты
                  неправильно сделал объект — „выбрать объект“ или
                  „добавить объект“ это неправильно, идёт одна кнопка;
                  посмотри, как сделано в клиентах»). «Добавить объект»
                  живёт в футере листа выбора — там, куда идут, когда
                  нужного объекта нет. Пустой справочник — единственный
                  случай, когда выбирать нечего и дверь сразу ведёт к
                  добавлению. */}
              <View
                style={{
                  borderTopWidth: eventAddress.trim() ? 1 : 0,
                  borderTopColor: t.separator,
                }}
              >
                {eventLocationPool.length > 0 ? (
                  <ChooseRow
                    icon={MapPin}
                    label="Выбрать объект"
                    hint="Открывает объекты клиентов"
                    onPress={() => {
                      setObjectPicker(true);
                      haptics.tap();
                    }}
                  />
                ) : (
                  <ChooseRow
                    icon={MapPin}
                    label="Добавить объект"
                    hint="Заводит первый объект"
                    onPress={openEventObjectAdd}
                  />
                )}
              </View>
            </>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
