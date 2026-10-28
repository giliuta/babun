import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { loadErrorWords } from "@/lib/connection-words";
import { PageWash } from "@/features/appointments/PageWash";
import { first } from "@/features/appointments/book-form/book-math";
import { WASH } from "@/features/appointments/book-form/book-chrome";
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

// СПИСКА СТАТУСОВ ЗДЕСЬ НЕТ. Руками статус не ставят: он выводится из
// состояния записи и говорит ЦВЕТОМ — «не хватает данных», «готова»,
// «денег нет», «закрыто» (светофор). Само
// поле `status` живёт как жило: его пишет продукт, а не человек.

// ДРУГАЯ ЗАПИСЬ — ДРУГАЯ ФОРМА. Ссылка на `/book` с
// другим `appointmentId`, пришедшая при открытой форме, меняет параметры ТОГО
// ЖЕ экрана, а не открывает новый. Гидрация правки идёт один раз — и форма
// держала дату и время прежней записи («чт, 8 октября 11:00»), а оплату
// показывала уже новой («Дата изменена — сохраните»): «Сохранить» перенёс бы
// запись на чужой день. Ключ по записи собирает форму заново.
// «Удалить черновик» новой записи — тоже другая форма: метка `fresh` в
// ключе собирает её с чистого листа, с тем днём и клиентом, с какими открыли.
export default function BookScreen() {
  const params = useLocalSearchParams<{ appointmentId?: string; fresh?: string }>();
  return <BookForm key={`${first(params.appointmentId) ?? "new"}:${first(params.fresh) ?? ""}`} />;
}

function BookForm() {
  const form = useBookForm();
  const {
    t,
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
  // висел ради поля «Адрес выезда»; поля нет, а
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

      {/* Подъём над клавиатурой: «Создать запись» и нижние поля не уходят
          под клавиатуру. Высоту выреза `KeyboardLift` учитывает сам. */}
      <KeyboardLift style={{ flex: 1 }}>
        <ScrollView
          // СКРОЛЛ УПИРАЕТСЯ В КРАЙ БЛОКОВ, А НЕ ТЯНЕТСЯ: фиксируется на конце
          // блока, а не поднимается сколько угодно. Резинка iOS у формы
          // ничего не значит: тянуть для обновления здесь нечего.
          bounces={false}
          overScrollMode="never"
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* ПЕРЕКЛЮЧАТЕЛЯ «КЛИЕНТ / СОБЫТИЕ» ЗДЕСЬ БОЛЬШЕ НЕТ (всё зависит от
              того, что выбрали в начале, когда тапнули на календарь).

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
            <NoticeBar
              tone="warn"
              message={`Не удалось загрузить ${failedOptional.label} — часть подсказок недоступна`}
            />
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
