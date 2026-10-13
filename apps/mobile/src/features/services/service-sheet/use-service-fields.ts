import { useState } from "react";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { type Service } from "@/features/services/queries";
import { roundToStep } from "@/features/services/format";
import {
  economicsDraftFromService,
  type ServiceEconomicsDraft,
  type ServiceEconomicsErrors,
  type PriceEntryMode,
} from "@/features/services/economics";
import { seedWeekdays, type ServiceBaseErrors } from "./service-sheet-math";

/** Draft fields of the service form and their seeding from a service. */
export function useServiceFields() {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  /** Расход за одну у первой строки — колонка `cost_per_unit`. Пустым не
   *  бывает: он не доходит до клиента и живёт только в прибыли. */
  const [cost, setCost] = useState("0");
  const [description, setDescription] = useState("");
  /** Карточка описания заведена: пустая строка и «нет описания» — разные вещи,
   *  и снятое описание уезжает в базу явным `null`. */
  const [hasDescription, setHasDescription] = useState(false);
  /** Раскрыт РОВНО ОДИН барабан на весь лист: `"base"` или id строки.
   *  Состояние живёт здесь, а не в таблице: лист всегда в дереве и лишь
   *  гасится пропом `visible`, поэтому чужой `useState` переезжал бы от
   *  услуги к услуге. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Линза показа чисел: «за всё» или «за одну». Хранение не меняет. */
  // ЗА ЕДИНИЦУ ПО УМОЛЧАНИЮ (владелец 2026-08-27, согласившись с разбором):
  // тогда лесенка значит «сколько стоит одна единица при таком объёме», и
  // промежуточный объём считается сам. При «за всё» таблица становится
  // справочником, и на 13 м² между ступенями 10 и 20 продукт обязан гадать.
  // У уже заведённых услуг режим свой — он лежит в колонке `price_entry`.
  const [priceEntry, setPriceEntry] = useState<PriceEntryMode>("unit");
  // РЕЖИМ РАСХОДА КОЛОНКИ В БАЗЕ НЕ ИМЕЕТ. Расход хранится ЗА ЕДИНИЦУ всегда
  // (`cost_per_unit`), а этот флаг — только способ ввода: «за всё» делит
  // напечатанное на количество. Поэтому он не переживает переоткрытие листа,
  // и это честно: само ЧИСЛО в базе от режима не зависит и не портится.
  // Долг: колонка `cost_entry`, чтобы режим запоминался.
  const [costEntry, setCostEntry] = useState<PriceEntryMode>("unit");
  /** Дни недели ISO 1..7. Пустой массив — делаем в любой день. */
  const [weekdays, setWeekdays] = useState<number[]>([]);
  // РАБОЧИЕ ДНИ — НЕОБЯЗАТЕЛЬНЫЙ ПАРАМЕТР, А НЕ ЧАСТЬ ФОРМЫ (владелец
  // 2026-08-29: «это исключительно для тех, кому нужно; случайно нажмёшь — и
  // он просто не будет работать»). Семь всегда зажжённых плиток были
  // приглашением погасить день мимоходом и тихо сломать услугу: она бы
  // перестала предлагаться, а причина осталась бы в форме, куда больше не
  // заходят. Пустой список = «любой день», и пока он пуст, блока нет вовсе.
  const [hasWeekdays, setHasWeekdays] = useState(false);
  // ПЕРЕРЫВ ПОСЛЕ УСЛУГИ — тоже добавляемый параметр (владелец 2026-08-29:
  // «можно добавить, сделать более автоматически — плюс добавить перерыв
  // после услуги»). Это дорога до следующего объекта и уборка после работы:
  // время, которое сейчас не считает никто, и поэтому в день влезает меньше
  // работ, чем обещает сетка.
  const [hasBufferAfter, setHasBufferAfter] = useState(false);
  // ФЛАГ «ПОКАЗАН ЛИ СТОЛБЕЦ РАСХОДА» ДОЖИЛ ДО ХОЛОСТОГО ХОДА И УБРАН
  // 2026-08-30. Расход показывается ВСЕГДА своей колонкой с тех пор, как
  // лесенка стала таблицей, и значение флага перестали читать — его выбросили
  // прямо в объявлении (`const [, setCostShown]`). Осталась только запись:
  // состояние, которое никто не смотрит, но которое исправно дёргает
  // перерисовку листа на каждом открытии.
  //
  // Комментарий про ТИП УСЛУГИ снят следом: он описывал устройство листа для
  // «вариантов», а вариантов в продукте больше нет.
  // СЕМЬ СОСТОЯНИЙ УБРАНЫ ОТСЮДА 2026-08-30, и все семь были одинаковы:
  // заводились, посевались из услуги и уезжали обратно в базу тем же
  // значением — БЕЗ ЕДИНОГО ЭЛЕМЕНТА УПРАВЛЕНИЯ в форме. Форма делала вид,
  // что ими распоряжается.
  //   `unit`, `overflow_price`, `overflow_duration_min` — владелец убрал сами
  //     настройки 27–29 августа (единица живёт в НАЗВАНИИ услуги: «Обмотка
  //     1 м», регрессия «свыше N» снесена целиком);
  //   `min_qty`, `max_qty`, `required_staff`, `buffer_before_min` — двери на
  //     мобильном не было никогда.
  //
  // УДАЛЕНИЕ НИЧЕГО НЕ СТИРАЕТ, и это проверено по обоим путям: обновление
  // шлёт ЧАСТИЧНЫЙ патч — не отправленная колонка остаётся как была; а
  // создание подставляет в `useCreateService` ровно те же значения по
  // умолчанию, что стояли здесь (`unit ?? null`, `min_qty ?? 1`,
  // `required_staff ?? 1`, `buffer_before_min ?? 0`). Значение, выставленное
  // из веба, переживает сохранение с мобильного и так и так.
  //
  // `service_type` и `variants` УБРАНЫ СЛЕДОМ, 30 августа: владелец решил
  // «удалить тогда», а данные подтвердили, что ломать нечего — вариантных
  // услуг в базе НОЛЬ и строк вариантов НОЛЬ. Таблица `service_variants` и
  // колонка `service_type` в базе целы: удалён интерфейс, а не данные.
  //
  // ДВЕ ИЗ СЕМИ КОЛОНОК ЖИВЫ и читаются записью — `unit` печатает «2 м» в
  // строке услуги, `buffer_before_min` резервирует дорогу ДО работы. Это не
  // мусор, а функции без двери на мобильном; сказано владельцу отдельно.
  /** Перерыв ПОСЛЕ работы: дорога до следующего адреса и уборка за собой. */
  const [bufferAfter, setBufferAfter] = useState("0");
  /** Количество в блоке «Проверка» — живой калькулятор, не данные услуги. */
  const [economics, setEconomics] = useState<ServiceEconomicsDraft>(() =>
    economicsDraftFromService(),
  );
  const [economicsErrors, setEconomicsErrors] =
    useState<ServiceEconomicsErrors>();
  const [baseErrors, setBaseErrors] = useState<ServiceBaseErrors>({});

  // ЗАСЕВ ПОЛЕЙ — ОДИН НА ОТКРЫТИЕ ЛИСТА И НА ВЫБОР ШАБЛОНА: шаблон
  // заполняет форму ровно так, как её заполнила бы копия при открытии.
  const seedFields = (from: Service | null, nameValue: string) => {
    setName(nameValue);
    // ВИД БЕРЁТСЯ У ТОЙ ЖЕ СТРОКИ, ЧТО ОСТАЛЬНОЕ: у правки — свой, у копии —
    // исходной услуги, у новой — следующий свободный цвет автомата, чтобы
    // строка в справочнике не родилась бесцветной.
    setColor(from?.color || PRESET_COLOR_CYCLE[0].value);
    setIcon(from?.icon ?? null);
    setPrice(from ? String(Number(from.price)) : "");
    // ОКРУГЛЕНИЕ К ПЯТИМИНУТКЕ ИДЁТ В ЧЕРНОВИК, А НЕ НА ВИД. Барабан ходит
    // шагом 5, и услуга с 47 минутами покажется как 45 — значит 45 и должно
    // лечь в черновик СРАЗУ. Иначе строка говорит одно, а база хранит другое:
    // ровно та тихая ложь, на которой в этом продукте уже обжигались.
    setDuration(String(roundToStep(from ? from.duration_minutes : 60)));
    setCost(String(Number(from?.cost_per_unit ?? 0) || 0));
    setEconomics(economicsDraftFromService(from));
    setEconomicsErrors(undefined);
    setBaseErrors({});
    // Владелец: у правки — свой, у дубля — тот же, у новой из хаба команды —
    // эта команда, иначе первая в списке. Услуга без команды не существует.
    //
    setDescription(from?.description ?? "");
    setHasDescription(!!from?.description?.trim());
    setBufferAfter(String(from?.buffer_after_min ?? 0));
    setPriceEntry(from?.price_entry === "total" ? "total" : "unit");
    setCostEntry("unit");
    setWeekdays(seedWeekdays(from?.available_weekdays));
    // Блок показывается, только если у услуги ДЕЙСТВИТЕЛЬНО есть ограничение.
    // Пустой список — «любой день», показывать нечего.
    setHasWeekdays(
      Array.isArray(from?.available_weekdays) &&
        (from.available_weekdays as unknown[]).length > 0,
    );
    setHasBufferAfter(Number(from?.buffer_after_min ?? 0) > 0);
    setOpenRow(null);
  };

  return {
    name, setName,
    color, setColor,
    icon, setIcon,
    price, setPrice,
    duration, setDuration,
    cost, setCost,
    description, setDescription,
    hasDescription, setHasDescription,
    openRow, setOpenRow,
    priceEntry, setPriceEntry,
    costEntry, setCostEntry,
    weekdays, setWeekdays,
    hasWeekdays, setHasWeekdays,
    hasBufferAfter, setHasBufferAfter,
    bufferAfter, setBufferAfter,
    economics, setEconomics,
    economicsErrors, setEconomicsErrors,
    baseErrors, setBaseErrors,
    seedFields,
  };
}
