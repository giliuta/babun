import { View } from "react-native";
import { MapPin } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { LocationRequestRow } from "@/features/clients/blocks/LocationRequestRow";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { haptics } from "@/lib/haptics";
import type { BookModel } from "./use-book-form";

/** Block «Объект» of a client record: the client's object, its note,
 *  pending address requests, or the door to add the first one. */
export function WorkObjectBlock({ form }: { form: BookModel }) {
  const {
    t,
    showObject,
    can,
    selectedLocation,
    client,
    setObjectPicker,
    clientObjectsWritable,
    setObjectEdit,
    objectNote,
    clientLocations,
    pendingRequests,
    requestActions,
    setObjectSheet,
  } = form;
  return (
    <>
      {/* Объект без права менять и без выбранного — смотреть нечего:
          блока нет, а не пригашенная дверь «Добавить объект». */}
      {showObject && can.showObject && (can.editObject || selectedLocation) ? (
        <SectionCard title="Объект">
          {client ? (
            // БЕЗ ВЕРХНЕГО ВОЛОСКА: он шёл сразу под заголовком «ОБЪЕКТ»
            // и читался как чужая линия — у карточки клиента её нет.
            <View>
              {/* ОБЪЕКТ ВЕДЁТ СЕБЯ КАК КЛИЕНТ (владелец 2026-09-03: «мы
                  тапаем на клиента — открывается выбор клиента; то же
                  самое объект: тапаем на объект — идёт замена объекта, и
                  внизу вылазит „Добавить объект“»). Строки «Добавить
                  объект» под выбранным больше нет: она стояла бы под
                  объектом, как не стоит «Добавить клиента» под клиентом.
                  Добавление живёт в листе выбора — там, куда идут, когда
                  нужного объекта нет.

                  Строка НЕ СКОПИРОВАНА, а взята та же — `ObjectRow` с
                  карточки клиента (владелец 2026-08-31: «блок объекта
                  должен быть такой же, как в клиентах»). Разница ровно
                  одна: здесь объект ВЫБИРАЮТ, поэтому справа шеврон, а
                  заметка объекта стоит своей плашкой под строкой, а не
                  третьей строкой. */}
              {selectedLocation ? (
                <>
                  <ObjectRow
                    loc={selectedLocation}
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
                  {/* ЗАМЕТКА ОБЪЕКТА — «код ворот», «ключ у соседей»:
                      мини-блок пишет прямо в объект (см. `writeObjectNote`),
                      третья строка карточки объекта её не дублирует. */}
                  <InlineNoteField
                    note={objectNote}
                    placeholder="Заметка объекта"
                    accessibilityLabel="Заметка объекта"
                    readOnly={!clientObjectsWritable}
                  />
                </>
              ) : clientLocations.length > 0 && can.editObject ? (
                /* Объекты есть, но ни один не выбран (снят после
                   удаления или запись сохранена с разовым адресом): та
                   же строка-дверь, что «Выбрать клиента».

                   ПОЛЯ «АДРЕС ВЫЕЗДА» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец
                   2026-09-04: «тут должно быть просто в блоке „Добавить
                   объект“, без адреса выезда и так далее»). Блок
                   объекта отвечает на один вопрос — КУДА ехать, — и
                   ответ у него один: объект. Разовый выезд по звонку
                   заводится тем же объектом, на это есть строка ниже.
                   Адрес-снимок сохранённой записи цел: состояние
                   `address` гидрируется и уезжает в патч как было. */
                <ChooseRow
                  icon={MapPin}
                  label="Выбрать объект"
                  hint="Открывает список объектов клиента"
                  onPress={() => {
                    setObjectPicker(true);
                    haptics.tap();
                  }}
                />
              ) : null}

              {/* ПОДСКАЗКА «ПОРА ОБСЛУЖИТЬ ОБОРУДОВАНИЕ» СНЕСЕНА
                  2026-09-04 вместе с самим интервалом обслуживания
                  (владелец: «сделаем лучше в напоминаниях для клиента»).
                  Она считалась по технике объекта, а техники в продукте
                  нет с тех пор, как ушёл словарь кондиционеров: строка
                  не могла загореться ни у одного клиента. */}

              {/* Ссылка клиенту ещё без ответа — строка «Ждём адрес»
                  (STORY-077); при выбранном объекте она лишняя. */}
              {!selectedLocation
                ? pendingRequests.map((request, i) => (
                    <LocationRequestRow
                      key={request.id}
                      request={request}
                      separated={clientLocations.length > 0 || i > 0}
                      onPress={() => void requestActions.menu(request)}
                    />
                  ))
                : null}

              {/* У клиента без единого объекта выбирать нечего — первый
                  заводится прямо отсюда, листом добавления.

                  ТА ЖЕ ДВЕРЬ, ЧТО У КЛИЕНТА, ОБЪЕКТА И УСЛУГИ (владелец
                  2026-09-09: «почему тут изменилась архитектура, если
                  она должна быть другой — как у нас принято»). Здесь
                  стоял `AddRow`: без кружка со значком и с волоском
                  сверху. Пока над ним были строки объектов, волосок их
                  разделял; у клиента без объектов он оказывался прямо
                  под надписью «ОБЪЕКТ», а голая синяя строка — рядом с
                  «Выбрать услугу», у которой кружок есть. Один вопрос —
                  одна дверь: `ChooseRow`, как у соседей. */}
              {clientLocations.length === 0 && can.editObject && clientObjectsWritable ? (
                <View
                  style={{
                    borderTopWidth: pendingRequests.length > 0 ? 1 : 0,
                    borderTopColor: t.separator,
                  }}
                >
                  <ChooseRow
                    icon={MapPin}
                    label="Добавить объект"
                    hint="Заводит первый объект клиента"
                    onPress={() => setObjectSheet(true)}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            /* ДВЕРЬ СТОИТ НА МЕСТЕ И ПРИГАШЕНА (владелец 2026-09-08).
               Фраза «Сначала выберите клиента» отвечала на вопрос,
               которого человек не задавал, и меняла высоту блока; серая
               строка «Добавить объект» говорит то же самое собой — она
               тут, но пока не нажимается. */
            <ChooseRow
              icon={MapPin}
              label="Добавить объект"
              hint="Станет доступно после выбора клиента"
              disabled
              onPress={() => {}}
            />
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
