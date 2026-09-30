import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import { moneySymbol } from "@babun/shared/common/utils/money";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { RowCaption } from "@/components/ui/card-rows";
import { FieldLabel } from "@/components/ui/Field";
import { WEEKDAY_LABELS } from "@babun/shared/local/services";
import { GUTTER } from "@/components/ui/tokens";
import {
  ServiceLadder,
  type LadderStep,
} from "@/features/services/ServiceLadder";
import { useThemeColors } from "@/theme/colors";
import { useTenant } from "@/features/settings/tenant";
import { type Service, type ServiceInput } from "@/features/services/queries";
import { NameColorField } from "@/components/ui/picker-fields";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { durationLabel, roundToStep } from "@/features/services/format";
import { TimeWheelPair } from "@/components/ui/TimeWheel";

import {
  displayValue,
  draftValue,
  createTierDraft,
  economicsDraftFromService,
  validateServiceEconomics,
  type ServiceEconomicsDraft,
  type ServiceEconomicsErrors,
  type PriceEntryMode,
} from "@/features/services/economics";

// ФОРМА УСЛУГИ ПРАЙСА — своим файлом, а не внутри страницы (страница была
// 1457 строк). Вид и поведение — те же, что были на странице.

export type ServiceEditing =
  // `copy` — источник из ДРУГОЙ команды: имя не получает «копия» (в новой
  // команде это не копия, а своя услуга) и пишется связь для отчётов.
  | { mode: "create"; from?: Service; copy?: boolean }
  | { mode: "edit"; service: Service };

// ─── Редактор услуги ─────────────────────────────────────────────────
// Канонический нижний лист, а не самописный `Modal animationType="slide"`: та
// самая «серая плашка, которая поднимается вверх», забракованная владельцем на
// метках 2026-08-17.
export function ServiceSheet({
  editing,
  lockedTeamId,
  busy,
  onClose,
  onSave,
}: {
  editing: ServiceEditing | null;
  /** Per-team-контекст: новая услуга сразу привязана к этой команде. */
  lockedTeamId?: string;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ServiceInput, serviceId?: string) => void;
  /** Дубль из шапки листа — вторая дверь к тому же, что делает свайп вправо
   *  по строке прайса (который перехватывает системный жест «назад»). */
}) {
  const t = useThemeColors();
  // ЗНАК ВАЛЮТЫ — ИЗ ТЕНАНТА, а не зашитый «€»: у компании в другой валюте
  // прайс печатался бы в чужой.
  const currencySymbol = moneySymbol(useTenant().data?.currency);
  const service = editing?.mode === "edit" ? editing.service : null;
  /** Источник дубля: лист открыт на СОЗДАНИЕ, но поля засеяны чужими. */
  const source = editing?.mode === "create" ? editing.from : undefined;

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
  const [baseErrors, setBaseErrors] = useState<{
    price?: string;
    duration?: string;
  }>({});
  const [seeded, setSeeded] = useState<ServiceEditing | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (editing !== seeded) {
    // Новый показ листа — засеять поля (render-time reset).
    setSeeded(editing);
    const from = service ?? source ?? null;
    setName(
      service
        ? service.name
        : source
          ? editing?.mode === "create" && editing.copy
            ? source.name
            : `${source.name} копия`
          : "",
    );
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
    setWeekdays(
      Array.isArray(from?.available_weekdays)
        ? (from.available_weekdays as unknown[]).filter(
            (day): day is number =>
              typeof day === "number" && day >= 1 && day <= 7,
          )
        : [],
    );
    // Блок показывается, только если у услуги ДЕЙСТВИТЕЛЬНО есть ограничение.
    // Пустой список — «любой день», показывать нечего.
    setHasWeekdays(
      Array.isArray(from?.available_weekdays) &&
        (from.available_weekdays as unknown[]).length > 0,
    );
    setHasBufferAfter(Number(from?.buffer_after_min ?? 0) > 0);
    setOpenRow(null);
  }

  // Владелец услуги — команда, чей прайс открыт. Спрашивать её в форме
  // незачем: человек уже стоит в её списке.
  //
  // У КОПИИ ИЗ ЧУЖОЙ КОМАНДЫ ВЛАДЕЛЕЦ — ТА, КУДА КОПИРУЮТ. Команда источника
  // здесь перебивала открытый прайс, и «взять готовую» молча заводило вторую
  // услугу в ЧУЖОЙ команде: человек копировал в Команду 1, а услуга уезжала
  // обратно в Команду 2. У дубля внутри команды источник верен — он и есть
  // эта команда.
  const isForeignCopy = editing?.mode === "create" && !!editing.copy;
  const ownerTeam =
    service?.team_id ??
    (isForeignCopy ? lockedTeamId : source?.team_id ?? lockedTeamId) ??
    null;
  const canSubmit = name.trim().length > 0 && !!ownerTeam && !busy;

  const updateEconomics = (next: ServiceEconomicsDraft) => {
    setEconomics(next);
    if (economicsErrors) {
      setEconomicsErrors(validateServiceEconomics(next).errors);
    }
  };

  const bufferAfterMin = Math.max(0, Number(bufferAfter) || 0);

  // ЛЕСЕНКА ОДНИМ СПИСКОМ: базовая строка (количество 1) плюс ступени.
  // Четыре блока рисуют ОДИН И ТОТ ЖЕ список — иначе они разъехались бы по
  // столбцам, и цена оказалась бы у количества, которого нет.
  // ЧТО ЛЕЖИТ В ЧЕРНОВИКЕ И ЧТО ВИДИТ ЧЕЛОВЕК — РАЗНЫЕ ЧИСЛА, и направление
  // пересчёта у цены и расхода ПРОТИВОПОЛОЖНОЕ:
  //   цена   хранится ЗА ВСЮ строку  → в режиме «за единицу» делим на кол-во;
  //   расход хранится ЗА ЕДИНИЦУ     → в режиме «за всё» умножаем на кол-во.
  // Перепутать их местами — значит показать человеку число в десять раз
  // больше или меньше, и он не заметит, пока не выставит счёт.
  const qtyOf = (raw: string) => {
    const n = Number(String(raw).trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const showCost = (raw: string, qty: number) => {
    if (costEntry === "unit" || raw.trim() === "" || qty <= 1) return raw;
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? String(Math.round(n * qty * 100) / 100) : raw;
  };
  const storeCost = (typed: string, qty: number) => {
    if (costEntry === "unit" || typed.trim() === "" || qty <= 1) return typed;
    const n = Number(typed.trim().replace(",", "."));
    return Number.isFinite(n) ? String(Math.round((n / qty) * 100) / 100) : typed;
  };

  const ladderSteps: LadderStep[] = [
    {
      tier: null,
      qty: "1",
      price,
      cost,
      duration,
    },
    ...economics.tiers.map((tier) => {
      const q = qtyOf(tier.minQuantity);
      return {
        tier,
        qty: tier.minQuantity,
        price: displayValue(tier.rowPrice, q, priceEntry),
        cost: showCost(tier.rowCost, q),
        duration: tier.totalDuration,
      };
    }),
  ];

  const submit = () => {
    const parsedPrice = Number(price.trim().replace(",", "."));
    const parsedDuration = Number(duration.trim());
    const nextBaseErrors: { price?: string; duration?: string } = {};
    // ПУСТАЯ ЦЕНА = БЕСПЛАТНО, И ЭТО ЗАКОННО (владелец 2026-08-29: «цену
    // необязательно вписывать — услуга может быть полностью бесплатной, её
    // сделали, но денег не берём»).
    //
    // Запрет ставился против молчаливого нуля: `Number("")` даёт 0, и услуга
    // уезжала в прайс бесплатной незаметно для человека. Довод отпал, когда
    // ячейка цены стала показывать «0 €» подсказкой: пустое поле теперь
    // ЧИТАЕТСЯ нулём, а не выглядит незаполненным. Молчания больше нет —
    // значит нет и повода запрещать.
    //
    // Гарантийный выезд, переделка, бонус постоянному клиенту — работа
    // сделана, денег нет. Заставлять писать «0» ради проформы незачем.
    if (price.trim() !== "" && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      nextBaseErrors.price = "Цена от 0";
    }
    // НУЛЕВОЕ ВРЕМЯ РАЗРЕШЕНО (владелец 2026-08-29: «гарантия или диагностика
    // — добавляю её в запись, и структура времени не должна ломаться; ноль
    // евро, ноль по времени, а в счёт она попадёт»).
    //
    // Запрет стоял со словами «услуга нулевой длины ломает календарь молча».
    // Проверено — не ломает: конец записи только РАСТЁТ. В `AppointmentSheet`
    // пересчёт выходит раньше на `computedDuration <= 0` и время не сжимает,
    // а высоту блока в сетке задают `time_start`/`time_end` записи, а не
    // сумма длительностей услуг. Нулевая услуга просто ничего не прибавляет.
    //
    // Отрицательное и дробное по-прежнему недопустимы: это не «строка в
    // счёт», а испорченное число.
    if (!Number.isSafeInteger(parsedDuration) || parsedDuration < 0) {
      nextBaseErrors.duration = "Поставьте время";
    }
    const validated = validateServiceEconomics(economics);
    setBaseErrors(nextBaseErrors);
    setEconomicsErrors(validated.errors);
    if (Object.keys(nextBaseErrors).length > 0 || !validated.value) return;

    // СНЯТОЕ ОПИСАНИЕ — ТОЖЕ ЗАПИСЬ, А НЕ МОЛЧАНИЕ: обновление услуги шлёт
    // ЧАСТИЧНЫЙ патч, и без явного `null` стёртый текст остался бы в базе.
    onSave(
      {
        name: name.trim(),
        team_id: ownerTeam as string,
        ...(color ? { color } : {}),
        icon,
        description: description.trim() || null,
        cost_per_unit: Math.max(0, Number(cost.trim().replace(",", ".")) || 0),
        price: parsedPrice,
        duration_minutes: parsedDuration,
        // Уезжают ВСЕГДА, а не по «если заполнено»: снятая единица обязана
        // писаться явным `null`, снятые дни — явным пустым массивом.
        price_entry: priceEntry,
        available_weekdays: weekdays,
        ...(editing?.mode === "create" && editing.copy && source
          ? { copied_from_service_id: source.id }
          : {}),
        buffer_after_min: Math.max(0, Number(bufferAfter) || 0),
        ...validated.value,
      },
      service?.id,
    );
  };

  const addTier = () => {
    const number = (raw: string) => {
      const parsed = Number(raw.trim().replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    // Количество и время приезжают заполненными, цена — пустой: см.
    // `createTierDraft`. Зерно времени клампится к потолку барабана ВИДИМО:
    // показано — значит сказано, молчаливого исправления нет.
    // Новая строка наследует расход строки выше: у материалов на единицу от
    // количества скидки нет — та же химия на ту же штуку.
    // Расход наследуется ЗА ОДНУ и подставляется за всё — пересчёт живёт в
    // `createTierDraft`, которому для этого достаточно первой строки: у неё
    // количество 1, значит её расход и есть расход на единицу.
    const tier = createTierDraft(economics.tiers, number(duration), cost);
    const seeded = {
      ...tier,
      totalDuration: String(roundToStep(Number(tier.totalDuration))),
    };
    updateEconomics({ ...economics, tiers: [...economics.tiers, seeded] });
    setOpenRow(null);
    // Строка приезжает вниз — лист обязан САМ довести её до глаза, иначе
    // «＋ Количество» снаружи выглядит не сделавшей ничего.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  };

  // Одна красная строка ПОД таблицей: три подписи под тремя колонками сломали
  // бы выравнивание, ради которого таблица и затевалась.

  const firstError =
    baseErrors.price ??
    baseErrors.duration ??
    Object.values(economicsErrors?.tiers ?? {})
      .flatMap((tier) => [
        tier.minQuantity,
        tier.rowPrice,
        tier.rowCost,
        tier.totalDuration,
        // `row` — ошибка не КЛЕТКИ, а всей строки («впишите цену или время»).
        // Её забыли внести в цепочку, и она была недостижима: строка без цены
        // и без времени не сохранялась, а человек не получал ни слова —
        // «Сохранить» просто ничего не делала. Молчащая кнопка хуже отказа.
        tier.row,
      ])
      .find(Boolean);

  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      // ЗАГОЛОВОК НАЗЫВАЕТ УСЛУГУ, А НЕ ЖАНР (аудит 2026-08-21). «Услуга» —
      // это то, что человек и так видит: он тапнул по строке прайса. Имя в
      // шапке отвечает на другой вопрос — «ту ли я открыл», — который в списке
      // из сорока строк задают всерьёз.
      title={service ? service.name : "Новая услуга"}
      scroll
      scrollRef={scrollRef}
      avoidKeyboard
      padded={false}
      // ЗНАЧКОВ В ШАПКЕ НЕТ (владелец 2026-08-29: «убери эти кнопочки, они
      // нам на хер не нужны — у нас свайп вправо и можно удалить»).
      //
      // Здесь стояли «дублировать» и «удалить». Обе двери стали лишними:
      // удаление и скрытие теперь живут на кромках свайпа, у каждой своя
      // сторона и своё подтверждение. А мусорка вдобавок ОБРЕЗАЛАСЬ правым
      // краем листа — красный значок наполовину уходил за экран.
      //
      // Дубль исчез вместе с ней: он был обходом того, что свайп вправо
      // когда-то съедал системный жест «назад». Сейчас вправо — «Удалить»,
      // и обходить нечего; скопировать услугу можно, заведя новую.
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
        <Button
          label={service ? "Сохранить" : "Создать"}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
        />
        </View>
      }
    >
      {/* ИМЯ — ОНО ЖЕ ИМЯ В СЧЁТЕ. Второго имени «для документов» у услуги
          нет и не будет: его заводили дважды («Название в счёте», «Имя для
          клиента»), оба раза не заполнил никто, и оба раза владелец не понял
          строку. Подпись честно называет последствие — а формулировку для
          конкретного счёта правят в самом счёте, где она и замерзает. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        {/* ВИД ВЕРНУЛСЯ ВМЕСТЕ С БЛОКОМ (владелец 2026-09-10: «кинь,
            пожалуйста, этот же на услуги» — про общий блок «Вид», и «сделай
            подсветку блоков»). 8 сентября цвет был снят как бесполезный —
            «он заводился ради точки в строке записи, а точка ничего не
            различала». Теперь он различает: строка справочника ЗАЛИВАЕТСЯ
            цветом услуги, как строка выбора, и рядом стоит её значок. */}
        <NameColorField
          label="Название"
          name={name}
          onNameChange={setName}
          color={color}
          onColorChange={setColor}
          icon={icon}
          onIconChange={setIcon}
          autoFocus={!service}
          // «＋ Описание» переехало К ПОДПИСИ (владелец 2026-08-24: «название,
          // а с правой стороны — плюс описание; топаю — и внизу открывается
          // блок»). Под полем кнопка читалась как продолжение самого поля и
          // отодвигала цену; у ярлыка она читается как то, чем она является, —
          // необязательной припиской к имени.
          labelAction={
            hasDescription ? undefined : (
              <Pressable
                onPress={() => {
                  setOpenRow(null);
                  setHasDescription(true);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Добавить описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  paddingLeft: 12,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 14, fontWeight: "500", color: t.accent }}
                >
                  ＋ Описание
                </Text>
              </Pressable>
            )
          }
        />

        {/* ОПИСАНИЕ ЖИВЁТ ПРИ ИМЕНИ, А НЕ ОТДЕЛЬНОЙ КАРТОЧКОЙ (владелец
            2026-08-21: «это должна быть маленькая кнопочка добавить описание
            под самим названием, типа плюсик»). Оно описывает именно ИМЯ, и
            карточка во всю ширину обещала блок там, где нужна приписка.
            Пустое — маленькая накладка в одну строку; заведённое — такое же
            поле, как имя, только в три строки высотой.
            ДОХОДИТ ДО КЛИЕНТА: текст печатается второй строкой ПОД названием
            позиции в счёте и в PDF. */}
        {hasDescription ? (
          <View style={{ marginTop: -6, marginBottom: 16 }}>
            {/* ДВЕРЬ ОТКРЫВАЕТСЯ В ОБЕ СТОРОНЫ (аудит 2026-08-21). Раньше
                `hasDescription` обратно не снимался: тапнул «＋ Описание» по
                ошибке — и блок оставался до закрытия листа. Крестик убирает
                и блок, и текст: снятое описание уезжает в базу явным `null`,
                об этом заботится `submit`. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <FieldLabel text="Описание в счёте" />
              <Pressable
                onPress={() => {
                  setHasDescription(false);
                  setDescription("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Убрать описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  opacity: pressed ? 0.4 : 1,
                })}
              >
                <X color={t.faint} size={16} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              autoFocus={!description}
              accessibilityLabel="Описание в счёте"
              selectionColor={t.accent}
              keyboardAppearance="light"
              style={{
                minHeight: 76,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: t.radius.input,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: t.separator,
                fontSize: 16,
                lineHeight: 22,
                color: t.ink,
                textAlignVertical: "top",
              }}
            />
          </View>
        ) : null}
      </View>

      {/* ЧЕТЫРЕ БЛОКА ВМЕСТО ВСЕГО, ЧТО ЗДЕСЬ БЫЛО (владелец 2026-08-27:
          «всё, что ниже названия, удаляем; первый блок — количество, второй —
          цена, третий — расход, четвёртый — время»).

          ЧТО УБРАНО ИЗ ИНТЕРФЕЙСА:
            • «Тип услуги» и ветка «Варианты» — плоский список именованных
              опций;
            • «Проверка» — живой калькулятор «что получится на N штуках»;
            • «Время вокруг работы» (дорога, после, людей) и «Ограничения»
              (минимум, максимум);
            • «Работаем по дням» — семь плиток.

          НИ ОДНО ПОЛЕ БАЗЫ НЕ ТРОНУТО. Состояние живо, `submit` пишет те же
          колонки прежними значениями, уже заведённые услуги ничего не теряют
          при сохранении. Убран ТОЛЬКО интерфейс — вернуть его можно, не
          трогая данные. */}
      <ServiceLadder
        steps={ladderSteps}
        currencySymbol={currencySymbol}
        priceEntry={priceEntry}
        costEntry={costEntry}
        onPriceEntryChange={setPriceEntry}
        onCostEntryChange={setCostEntry}
        openTimeId={openRow}
        onOpenTime={(id) => {
          setOpenRow(id);
          // Барабан раскрывается ПОД строкой и в блоке «Время», то есть у
          // самого низа листа — за кнопкой «Создать». Лист обязан сам довести
          // его до глаза, иначе тап по времени выглядит не сделавшим ничего.
          if (id) {
            requestAnimationFrame(() =>
              scrollRef.current?.scrollToEnd({ animated: true }),
            );
          }
        }}
        onQtyChange={(id, v) =>
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id ? { ...x, minQuantity: v } : x,
            ),
          })
        }
        onPriceChange={(id, v) => {
          if (id === "base") return setPrice(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id
                ? { ...x, rowPrice: draftValue(v, qtyOf(x.minQuantity), priceEntry) }
                : x,
            ),
          });
        }}
        onCostChange={(id, v) => {
          if (id === "base") return setCost(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id
                ? { ...x, rowCost: storeCost(v, qtyOf(x.minQuantity)) }
                : x,
            ),
          });
        }}
        onDurationChange={(id, v) => {
          if (id === "base") return setDuration(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id ? { ...x, totalDuration: v } : x,
            ),
          });
        }}
        onAdd={addTier}
        onRemove={(id) =>
          updateEconomics({
            ...economics,
            tiers: economics.tiers.filter((x) => x.id !== id),
          })
        }
      />

      {/* РАБОЧИЕ ДНИ — ПАРАМЕТР, КОТОРЫЙ ДОБАВЛЯЮТ, А НЕ ФОРМА, КОТОРУЮ
          ЗАПОЛНЯЮТ (владелец 2026-08-29). Пока его нет — одна строчка-кнопка,
          как «＋ Описание» у названия. Заведён — семь плиток и крестик,
          который снимает ограничение целиком.

          Ограничение не про график команды: команда выезжает всю неделю, а
          чистку кондиционеров в воскресенье не ставят, потому что поставщик
          закрыт. Поэтому все семь зажжены сразу после добавления — гасят из
          них лишние, а не набирают нужные.

          КРЕСТИК ВОЗВРАЩАЕТ «ЛЮБОЙ ДЕНЬ», а не пустой набор дней: услуга без
          единого дня не предлагалась бы никогда, и это была бы поломка,
          выглядящая как настройка. */}
      {hasWeekdays ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="График недели" />
            <Pressable
              onPress={() => {
                setHasWeekdays(false);
                setWeekdays([]);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать ограничение по дням"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
              const on = weekdays.length === 0 || weekdays.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => {
                    // Гашение первого дня разворачивает «пусто = все» в явный
                    // список: иначе снять один день было бы нечем.
                    const current =
                      weekdays.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : weekdays;
                    const next = current.includes(day)
                      ? current.filter((x) => x !== day)
                      : [...current, day].sort((a, b) => a - b);
                    setWeekdays(next.length === 7 ? [] : next);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${WEEKDAY_LABELS[day]} — ${on ? "делаем" : "не делаем"}`}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    borderCurve: "continuous",
                    backgroundColor: on ? t.accent : t.fill,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "500",
                      color: on ? t.onAccent : t.faint,
                    }}
                  >
                    {WEEKDAY_LABELS[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 14 }}>
          <Pressable
            onPress={() => setHasWeekdays(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="График недели: в какие дни услуга доступна"
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              paddingVertical: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
            >
              ＋ График недели
            </Text>
          </Pressable>
        </View>
      )}

      {/* ПЕРЕРЫВ ПОСЛЕ УСЛУГИ. Не часть работы, а то, что идёт ПОСЛЕ неё:
          дорога до следующего объекта, уборка, мойка инструмента. В сетку
          он встаёт вместе с записью, поэтому следующая работа не садится
          вплотную — а раньше садилась, и день оказывался плотнее, чем он
          есть на самом деле.

          Пресеты, а не поле ввода: перерыв — это «пятнадцать минут» или
          «полчаса», а не 17. Клавиатура ради двух цифр здесь лишняя.
          «Нет» снимает параметр целиком — то же, что крестик. */}
      {hasBufferAfter ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel
              text={`Перерыв после услуги · ${durationLabel(bufferAfterMin)}`}
            />
            <Pressable
              onPress={() => {
                setHasBufferAfter(false);
                setBufferAfter("0");
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать перерыв после услуги"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>
          {/* ВРЕМЯ ВЫБИРАЕТСЯ БАРАБАНОМ. ВСЕГДА. Первый заход поставил здесь
              пресеты 10/15/20/30/45/60 — и это было нарушением архитектуры
              продукта, а не находкой: время в Babun выбирают барабаном везде,
              от часов календаря до длительности услуги строкой выше. Владелец
              2026-08-29: «у нас же выбор времени всегда заложен барабанами,
              на хуя тут 10, 15, 20». Пресеты вдобавок ВРАЛИ: перерыв в 25
              минут ими не выставить вовсе. */}
          <View style={{ alignItems: "center" }}>
            <TimeWheelPair
              hour={Math.floor(bufferAfterMin / 60)}
              minute={bufferAfterMin % 60}
              // Половины коммитятся ПОРОЗНЬ и каждая считает от предыдущего
              // состояния: колонка знает соседнее значение только по пропу, и
              // два коммита в одном батче унесли бы устаревшую половину.
              onChangeHour={(next) =>
                setBufferAfter(String(next * 60 + (bufferAfterMin % 60)))
              }
              onChangeMinute={(next) =>
                setBufferAfter(
                  String(Math.floor(bufferAfterMin / 60) * 60 + next),
                )
              }
              labelPrefix="Перерыв после услуги"
            />
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 10 }}>
          <Pressable
            onPress={() => {
              setHasBufferAfter(true);
              // Пятнадцать минут — самый частый перерыв: дорога внутри города
              // и разгрузка. Ноль означал бы «параметр есть, но не работает».
              if (Number(bufferAfter) <= 0) setBufferAfter("15");
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить перерыв после услуги"
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              paddingVertical: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
            >
              ＋ Перерыв после услуги
            </Text>
          </Pressable>
        </View>
      )}

      {/* ОНЛАЙН-ЗАПИСЬ — ЗАГЛУШКА, И ОНА ЧЕСТНАЯ (владелец 2026-08-29:
          «пока не включаем, ставим заглушку — скоро»).

          Строка НЕ ПЕРЕКЛЮЧАЕТСЯ намеренно. Живой тумблер над невыполненной
          функцией — худший вид вранья в продукте: человек его включает,
          уходит уверенный, что клиенты записываются сами, и узнаёт правду
          пустым календарём. Поэтому здесь нет тумблера вовсе — только
          название и слово «Скоро».

          Колонка `online_enabled` в базе есть и по умолчанию `true`; когда
          функция появится, эта строка станет настоящим переключателем без
          миграции. */}
      <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
        <View
          className="flex-row items-center"
          style={{
            minHeight: 52,
            paddingHorizontal: 16,
            gap: 12,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            backgroundColor: t.fill,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 16, color: t.sub }}
          >
            Онлайн-запись
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, fontWeight: "600", color: t.faint }}
          >
            Скоро
          </Text>
        </View>
      </View>

      {/* ПОД ТАБЛИЦЕЙ — ТОЛЬКО ОШИБКА (владелец 2026-08-21: «внизу не нужно
          писать, это полная хуета»). Тихая строка-проверка «а что будет на
          семи» отвечала на вопрос, которого человек не задавал, и висела под
          карточкой ещё одной серой строкой. Ответ и так виден: за последней
          заведённой строкой цена и время идут по её правилу. */}
      {firstError ? <RowCaption text={firstError} tone="danger" /> : null}

      {/* Воздух под последним блоком: без него «＋ Добавить» прижимается к
          кнопке футера и читается как её часть. */}
      <View style={{ height: 12 }} />

    </BottomSheet>
  );
}
