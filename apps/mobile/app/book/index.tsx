import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { ICON } from "@/components/ui/tokens";
import { Screen } from "@/components/ui/Screen";
import { loadErrorWords } from "@/lib/connection-words";
import { PageWash } from "@/features/appointments/PageWash";
import { first } from "@/features/appointments/book-form/book-math";
import { WASH } from "@/features/appointments/book-form/book-chrome";
import { Text } from "@/features/appointments/book-form/book-text";
import { useBookForm } from "@/features/appointments/book-form/use-book-form";
import {
  BookLoadingScreen,
  BookMissingScreen,
} from "@/features/appointments/book-form/BookGateScreens";
import { BookHeader } from "@/features/appointments/book-form/BookHeader";
import { WorkBody } from "@/features/appointments/book-form/WorkBody";
import { EventBody } from "@/features/appointments/book-form/EventBody";
import { BookFooter } from "@/features/appointments/book-form/BookFooter";
import { BookPickSheets } from "@/features/appointments/book-form/BookPickSheets";
import { BookEditSheets } from "@/features/appointments/book-form/BookEditSheets";

// The appointment create/edit form. State and behaviour live in
// `useBookForm` (src/features/appointments/book-form/); this route renders it.

// СПИСКА СТАТУСОВ ЗДЕСЬ БОЛЬШЕ НЕТ (2026-08-30). Руками статус не ставят:
// он выводится из состояния записи и говорит ЦВЕТОМ — «не хватает данных»,
// «готова», «денег нет», «закрыто» (решение владельца о светофоре). Само
// поле `status` живёт как жило: его пишет продукт, а не человек.

// ИСТОЧНИК ЗАЯВКИ УБРАН ИЗ ЭТОГО ЭКРАНА (владелец 2026-08-30: «убрать
// совсем»). Он жил внутри «Дополнительно».
//
// ПОПРАВКА 2026-08-31, найдено проверкой: сказать «убран из продукта» было
// НЕВЕРНО. Форм записи в продукте ДВЕ, и во второй — `AppointmentSheet`,
// которой правят существующую запись с календаря и из истории визитов, —
// строка «Источник заявки» стоит на виду и полностью работает
// (AppointmentSheet.tsx:2144 и :2590, сохранение в патч на :1128).
//
// Это и есть цена двух форм: любое удаление на одном экране делает работу
// наполовину. Гасить поле во втором файле незачем — он идёт под снос целиком,
// когда этот экран научится править запись; до тех пор источник ЖИВ.

// ДРУГАЯ ЗАПИСЬ — ДРУГАЯ ФОРМА (прогон оплаты 04.10). Ссылка на `/book` с
// другим `appointmentId`, пришедшая при открытой форме, меняет параметры ТОГО
// ЖЕ экрана, а не открывает новый. Гидрация правки идёт один раз — и форма
// держала дату и время прежней записи («чт, 8 октября 11:00»), а оплату
// показывала уже новой («Дата изменена — сохраните»): «Сохранить» перенёс бы
// запись на чужой день. Ключ по записи собирает форму заново.
export default function BookScreen() {
  const params = useLocalSearchParams<{ appointmentId?: string }>();
  return <BookForm key={first(params.appointmentId) ?? "new"} />;
}

function BookForm() {
  const form = useBookForm();
  const {
    t,
    insets,
    scrollRef,
    isEdit,
    editing,
    referencesPending,
    failedReference,
    referenceQueries,
    failedOptional,
    leaveBook,
    requestClose,
    title,
    kind,
    groundBg,
    identityC,
  } = form;

  // «Маршрут» — реальное действие (его не было): открыть адрес в картах.
  // МАРШРУТ ЖИВЁТ У СТРОКИ ОБЪЕКТА, А НЕ У ФОРМЫ. Свой лист маршрута тут
  // висел ради поля «Адрес выезда»; поля не стало (владелец 2026-09-04), а
  // у выбранного объекта кнопка своя — `ObjectRouteButton` внутри строки.

  // Запись открыли по ссылке, справочники доехали, а её самой нет: удалили с
  // другого устройства или ссылка протухла. Пустой черновик на этом месте
  // читался бы как «запись очистилась», и «Сохранить» создал бы дубль.
  if (isEdit && !referencesPending && !failedReference && !editing) {
    return <BookMissingScreen t={t} onBack={leaveBook} />;
  }

  if (failedReference || referencesPending) {
    // Обрыв — словами, а не ответом шлюза: под заголовком вставала сырая
    // HTML-страница Cloudflare «525: SSL handshake failed» и налезала на
    // шапку. Отказ сервера по делу (права, данные) остаётся своим текстом.
    const errorWords = loadErrorWords(failedReference?.query.error, {
      failed: `Не удалось загрузить ${failedReference?.label ?? "данные"}`,
      later: "Проверьте связь и повторите загрузку.",
    });
    return (
      <BookLoadingScreen
        t={t}
        title={title}
        onClose={requestClose}
        failedReference={failedReference}
        errorWords={errorWords}
        referenceQueries={referenceQueries}
      />
    );
  }

  return (
    <Screen edges={["top"]} bg={groundBg}>
      {/* Подсветка цветом записи — ПОД шапкой и содержимым: рисуется первой,
          шапка со своей подложкой ложится поверх. */}
      <PageWash color={identityC} strength={WASH} />
      <BookHeader form={form} />

      {/* KAV МЕРЯЕТ СЕБЯ ОТНОСИТЕЛЬНО РОДИТЕЛЯ, А КЛАВИАТУРУ — В ОКНЕ.
          `Screen` кладёт верхний safe-area отступ во внешний View, и `layout.y`
          у KAV начинается ПОД ним: перекрытие с клавиатурой недооценивалось
          ровно на высоту «острова» (59pt), и кнопка «Создать запись» уезжала
          под клавиатуру наполовину — поймано на симуляторе 2026-09-03, когда
          у него отключили аппаратную клавиатуру. `keyboardVerticalOffset` и
          есть это расстояние от верха окна до View. */}
      <KeyboardLift
        style={{ flex: 1 }}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          // СКРОЛЛ УПИРАЕТСЯ В КРАЙ БЛОКОВ, А НЕ ТЯНЕТСЯ (владелец 2026-09-06:
          // «должно фиксироваться чётко на конце блока — а не можно поднимать
          // сколько угодно»). Резинка iOS у формы ничего не значит: тянуть
          // для обновления здесь нечего.
          bounces={false}
          overScrollMode="never"
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* ПЕРЕКЛЮЧАТЕЛЯ «КЛИЕНТ / СОБЫТИЕ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец
              2026-08-30: «всё будет зависеть от того, что я выберу в начале,
              когда тапаю на календарь — вылазит иконка, там оно уже всё»).

              Развилка и правда стоит РАНЬШЕ формы: попап слота отдаёт вид
              вместе со временем (`BookSlotSheet.onPick(kind, slot)`), и он же
              приезжает сюда параметром маршрута. Держать второй такой же
              вопрос внутри формы значило спрашивать дважды.

              СОСТОЯНИЕ `kind` ОСТАЁТСЯ, и сносить его нельзя: правку события
              открывает не параметр, а сама запись — вид выставляет гидрация
              (`setKind(editing.kind …)`). Выведи `kind` прямо из `params.kind`
              — и правка события нарисуется формой клиента, а сохранение
              затрёт событие.

              ЦЕНА, УПЛАЧЕННАЯ ОСОЗНАННО: из трёх холостых дверей — «записей
              нет», онбординг, пустой календарь — теперь заводится только
              клиентская запись: они зовут `bookAt()` без вида. Это их
              естественное значение («создать первую запись»), а дорога к
              событию остаётся там, где владелец её и назначил, — в попапе
              слота. */}

          {/* Необязательный справочник не загрузился — не блокируем, но честно
              предупреждаем, что часть подсказок недоступна. */}
          {failedOptional ? (
            <View
              className="mx-3 mt-2 flex-row items-center gap-2 rounded-[10px] px-3 py-2.5"
              style={{ backgroundColor: `${t.warning}14`, borderWidth: 1, borderColor: `${t.warning}33` }}
            >
              <AlertTriangle color={t.warning} size={ICON.sm} />
              <Text style={{ fontSize: 13, color: t.warning, flex: 1 }}>
                Не удалось загрузить {failedOptional.label} — часть подсказок недоступна
              </Text>
            </View>
          ) : null}

          {kind === "work" ? <WorkBody form={form} /> : <EventBody form={form} />}
        </ScrollView>

        <BookFooter form={form} />
      </KeyboardLift>

      <BookPickSheets form={form} />
      <BookEditSheets form={form} />
    </Screen>
  );
}
