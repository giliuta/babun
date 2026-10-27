import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import {
  TemplateList,
  TemplatesHeaderButton,
  useTemplatePicking,
  type TemplateItem,
} from "@/components/ui/TemplatePicker";
import { NameColorField } from "@/components/ui/picker-fields";
import { FieldLabel } from "@/components/ui/Field";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { WeekProjection } from "@/features/reference/WeekProjection";
import type { City } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import {
  blockedDayNote,
  savableWeekdays,
  FALLBACK_COLOR,
  type DayOwners,
  type Editing,
  type LabelDraft,
} from "./label-rules";

// Label editor sheet of `LabelsScreen` — create and edit are one body.

export function LabelEditSheet({
  editing,
  takenBy,
  daysOff,
  busy,
  onClose,
  onCreate,
  onUpdate,
  templates,
}: {
  /** Шаблоны из других команд аккаунта (значок в шапке при создании). */
  templates?: readonly TemplateItem<City>[];
  editing: Editing | null;
  /** День недели → метка, которая его уже держит, вместе с её цветом. */
  takenBy: DayOwners;
  /** Дни, в которые не работает эта команда. */
  daysOff: Set<number>;
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: LabelDraft) => void;
  onUpdate: (city: City, draft: LabelDraft) => void;
}) {
  const { picking, setPicking } = useTemplatePicking();
  const t = useThemeColors();
  const isEdit = editing?.mode === "edit";
  // key-remount через editing==null → null; локальный стейт инициализируем
  // от editing при каждом открытии (паттерн «render-time reset»).
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_COLOR);
  // ДНИ НЕДЕЛИ — НЕОБЯЗАТЕЛЬНЫЙ ПАРАМЕТР, как «＋ Описание» у услуги. Пусто =
  // «ставлю руками»; это и есть поведение по умолчанию, поэтому блока сразу
  // нет — он появляется по кнопке.
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [hasWeekdays, setHasWeekdays] = useState(false);
  /** Заливать ли колонку дня цветом метки (не все метки должны подсвечиваться).
   *  Имя на дате остаётся в любом случае. */
  const [tintDay, setTintDay] = useState(true);
  /** Почему день не берётся. Пишется под плитками, а не плашкой сверху:
   *  ответ обязан стоять там, где задан вопрос. */
  const [blockNote, setBlockNote] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<Editing | null>(null);

  if (editing !== seeded) {
    setSeeded(editing);
    setPicking(false);
    setName(isEdit ? editing.city.name : "");
    setColor(
      isEdit ? editing.city.color ?? FALLBACK_COLOR : PRESET_COLOR_CYCLE[0].value,
    );
    const days = isEdit
      ? (editing.city.weekdays ?? []).filter((d) => d >= 1 && d <= 7)
      : [];
    setWeekdays(days);
    setHasWeekdays(days.length > 0);
    setTintDay(isEdit ? editing.city.tint_day ?? true : true);
  }

  const canSubmit = name.trim().length > 0 && !busy;
  // НАБРАННОЕ НЕ ПРОПАДАЕТ ОТ СКРИМА И СВАЙПА: имя, цвет и дни новой метки
  // терялись бы молча. Как у услуги — сначала вопрос.
  const seedDays = isEdit
    ? (editing.city.weekdays ?? []).filter((d) => d >= 1 && d <= 7)
    : [];
  const dirty =
    editing !== null &&
    (name !== (isEdit ? editing.city.name : "") ||
      color !==
        (isEdit ? editing.city.color ?? FALLBACK_COLOR : PRESET_COLOR_CYCLE[0].value) ||
      weekdays.join(",") !== seedDays.join(",") ||
      tintDay !== (isEdit ? editing.city.tint_day ?? true : true));
  const guard = useGuardedClose({
    dirty,
    busy,
    onClose,
    message: "Набранное в метке не сохранится.",
  });

  // У ДНЯ ОДНА МЕТКА. Разрешить второй встать в тот же день — значит сделать
  // календарь недетерминированным: какая из двух покрасит понедельник,
  // зависело бы от порядка строк в ответе базы.
  //
  // Свой собственный день занятым не считаем: иначе метка отбирала бы день у
  // самой себя и её нельзя было бы пересохранить.
  const ownName = isEdit ? editing.city.name : null;
  // Кто держит день, решает сама проекция: у неё для этого уже есть и
  // `takenBy`, и `daysOff`, и имя метки. Второй счётчик здесь разошёлся бы
  // с первым.

  // ЛИСТ — КАНОНИЧЕСКИЙ `BottomSheet`, а не самописный `Modal animationType
  // ="slide"`. Разница видна пальцем: у примитива
  // скрим гаснет на месте, лист приезжает пружиной, есть грабер и свайп вниз,
  // а системная «слайд-модалка» тащила вверх ВЕСЬ серый прямоугольник экрана.
  const applyTemplate = (tpl: City) => {
    setName(tpl.name);
    setColor(tpl.color ?? FALLBACK_COLOR);
    setTintDay(tpl.tint_day ?? true);
    setPicking(false);
  };

  return (
    <BottomSheet
      visible={editing !== null && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title={isEdit ? "Метка" : "Новая метка"}
      avoidKeyboard
      footer={picking ? undefined : (<>
          <Button
            label={isEdit ? "Сохранить" : "Создать метку"}
            onPress={() => {
              // Сохраняются только дни, которые плитки показывают своими:
              // выходной команды или чужой день, оставшийся в метке с прошлого
              // раза, иначе держался бы молча.
              const draft: LabelDraft = {
                name,
                color,
                weekdays: savableWeekdays(weekdays, { takenBy, daysOff, ownName, typedName: name }),
                tintDay,
              };
              if (isEdit) onUpdate(editing.city, draft);
              else onCreate(draft);
            }}
            disabled={!canSubmit}
            loading={busy}
          />
          {/* КНОПКИ «УДАЛИТЬ МЕТКУ» ЗДЕСЬ НЕТ: удаляют только смахом вправо.

              Кнопка к тому же не работала бы: `confirmThen` рисуется
              `ChoiceSheetHost`, а тот показывает СВОЙ `BottomSheet` — второй
              `Modal`. На iOS окно, поданное пока предыдущее ещё закрывается,
              не появляется вовсе и об этом не сообщает; кнопка выглядела
              сломанной. Лечить это закрытием листа перед вопросом было можно,
              но незачем: удаление уже живёт на кромке свайпа, где список не в
              `Modal` и подтверждение показывается честно.

              Одно действие — одно место. */}
        </>)}
    
      headerAction={
        !isEdit && (templates?.length ?? 0) > 0 ? (
          <TemplatesHeaderButton picking={picking} onToggle={() => setPicking((v) => !v)} />
        ) : undefined
      }
    >
      {picking ? (
        <TemplateList items={templates ?? []} gutter={false} onPick={applyTemplate} />
      ) : (
      <>
      {/* ТА ЖЕ СТРОКА, ЧТО У КАЛЕНДАРЯ И УСЛУГИ: цвет точкой слева, имя справа,
          один элемент вместо пары «Название» + «Цвет».

          ПОДСКАЗКИ НЕТ. «Лимассол, Германия, День ног…» подсказывала не
          формат, а СМЫСЛ — что вообще писать в метку, — и на пустом поле
          читалась как уже введённое значение. Метка это свободный текст,
          объяснять его примерами незачем. */}
      {/* БЕЗ СВОЕЙ ОБЁРТКИ: этот лист идёт с `padded` по умолчанию и уже
          добавляет `GUTTER` сам. Своя обёртка складывалась с его отступом, и
          поле метки выходило на 32pt уже, чем такое же поле в услуге, — а
          услуга гасит собственный отступ листа (`padded={false}`) и ставит
          `GUTTER` руками. Ширина обязана совпадать: это одна и та же строка
          в двух местах продукта. */}
      <NameColorField
        label="Название"
        placeholder="Название метки"
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        autoFocus
      />

      {/* В КАКИЕ ДНИ МЕТКА ВСТАЁТ САМА. «Основная метка», красящая ВСЕ дни
          разом, была бы невидима с календаря; здесь видно и ЧТО, и КОГДА.

          ПРОШЛОЕ НЕ ТРОГАЕТСЯ (канон): расписание
          считается только для дат сегодня и вперёд, а прошедший день
          показывает то, что на нём фактически было. Поэтому смена дней не
          перекрашивает историю. */}
      {hasWeekdays ? (
        <View style={{ marginTop: 14, marginBottom: 4 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="Всегда по этим дням" />
            <Pressable
              onPress={() => {
                setHasWeekdays(false);
                setWeekdays([]);
                setBlockNote(null);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать автоматическую постановку"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>

          {/* НЕДЕЛЯ ОДНИМ РЯДОМ БОЧОНКОВ: один элемент — колонка календаря, в
              которой вместо числа стоит день. Плитка-переключатель и корешок
              метки под ней были бы двумя рядами про один и тот же день. */}
          <WeekProjection
            weekdays={weekdays}
            color={color}
            name={name}
            ownName={ownName}
            takenBy={takenBy}
            daysOff={daysOff}
            onToggle={(day) => {
              setBlockNote(null);
              setWeekdays(
                weekdays.includes(day)
                  ? weekdays.filter((x) => x !== day)
                  : [...weekdays, day].sort((a, b) => a - b),
              );
            }}
            // ЗАНЯТЫЙ ДЕНЬ НЕ МОЛЧИТ. Он и так называет хозяина корешком, но
            // корешок мелкий — тап повторяет это словами, целиком.
            onBlocked={(day, reason) => setBlockNote(blockedDayNote(day, reason))}
          />

          {blockNote ? (
            <Text
              maxFontSizeMultiplier={1.2}
              style={{
                marginTop: 8,
                fontSize: 13,
                lineHeight: 18,
                color: t.sub,
              }}
            >
              {blockNote}
            </Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          // БЛОК ОТКРЫВАЕТСЯ ПУСТЫМ: если зажечь все свободные дни, неделя внизу
          // мгновенно заполнится меткой на все семь дней — расписание, которого
          // человек не выбирал, показанное как решённое. Набрать три дня из
          // пустоты короче, чем погасить четыре из семи, и честнее: пустая
          // неделя внизу говорит правду — пока не выбрано ничего.
          onPress={() => setHasWeekdays(true)}
          hitSlop={8}
          accessibilityRole="button"
          // КНОПКА И ЗАГОЛОВОК РАЗНЫМИ СЛОВАМИ — НАМЕРЕННО. Заголовок
          // «Всегда по этим дням» работает только когда плитки уже под ним:
          // «этим» обязано на что-то указывать. В кнопке плиток ещё нет, и
          // то же слово указывало бы в пустоту — проверено на экране.
          // Кнопка говорит, ЧТО добавляешь; заголовок — что это значит.
          accessibilityLabel="По дням недели: в какие дни метка ставится сама"
          // ПОДНЯТА И ОТСТАВЛЕНА ОТ КНОПКИ. Прижатая к футеру, строчка читалась бы его частью: глаз видел две
          // кнопки подряд, хотя это приписка к форме и главное действие.
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingTop: 2,
            paddingBottom: 6,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
          >
            ＋ По дням недели
          </Text>
        </Pressable>
      )}

      {/* ПОДСВЕЧИВАТЬ ДЕНЬ — РЕШЕНИЕ САМОЙ МЕТКИ: не все метки должны подсвечиваться.

          СТОИТ ПОД ГРАФИКОМ, а не над ним: сперва «когда метка встаёт», потом
          «как она при этом выглядит». Обратный порядок спрашивал бы про вид
          того, чего ещё нет.

          ЭТО НЕ ВТОРОЙ ТУМБЛЕР РЯДОМ С КОМАНДНЫМ. Командный
          `tint_days_by_label` гасит заливку во всём календаре разом, и
          переключателя для него на мобильном нет вовсе — так что доступ к
          решению «красить или нет» появляется здесь впервые, и сразу на
          верном уровне: красить ли день, зависит от того, ЧТО за метка. */}
      <View
        style={{
          marginTop: 6,
          paddingTop: 6,
          // ВОЗДУХ ДО «СОХРАНИТЬ». Прижатая к футеру строка читается
          // его частью — а это приписка к форме, не второе главное действие.
          marginBottom: 12,
          borderTopWidth: 1,
          borderTopColor: t.separator,
        }}
      >
        <SwitchRow
          inset={false}
          label="Подсвечивать день"
          hint="Заливка колонки в календаре"
          value={tintDay}
          onChange={setTintDay}
        />
      </View>
          </>
      )}
    </BottomSheet>
  );
}
