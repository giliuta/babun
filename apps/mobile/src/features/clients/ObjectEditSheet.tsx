import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client, Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useLastNonNull } from "@/lib/use-last-non-null";
import {
  ActionRow,
  ChoiceRow,
  FieldRow,
  RowGroup,
} from "@/components/ui/card-rows";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  AddressDetailsFields,
  AddressDetailsToggle,
} from "@/features/clients/AddressPartsFields";
import { objectTarget, primaryLine } from "@/features/clients/object-address";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import { useAddressPartsEdit } from "@/features/clients/use-address-parts-edit";
import {
  snapObjectType,
  useFrozenObjectTypes,
} from "@/features/clients/object-types";
import { useClients } from "@/features/clients/queries";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useLocationLabels } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { confirmAction } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";

// ПРАВКА ОБЪЕКТА — ЛИСТ, А НЕ СТРАНИЦА (владелец 2026-08-06: «отдельная
// страница объекта вообще не открывается… если нажимаешь — вылазит менюшка
// по поводу редактирования»).
//
// Объект — это три поля: что это, куда ехать, как войти. Ради них экран
// поверх экрана не открывают. Страницы `/clients/object` и `/clients/unit`
// удалены целиком вместе с уровнем «Информация»: техника с датами ТО была
// придумана под кондиционерщиков и для клининга или бьюти означала пустой
// раздел с чужими словами.
//
// Удаление живёт ЗДЕСЬ (и свайпом по строке на карточке) — с подтверждением:
// объект с историей стирается насовсем.

const EMPTY_LOCATIONS: Location[] = [];

export function ObjectEditSheet({
  visible,
  client,
  locationId,
  writer,
  askDelete,
  onDeleted,
  onClose,
}: {
  visible: boolean;
  client: Client;
  /** Какой объект правим. null — лист закрыт. */
  locationId: string | null;
  /** Писатель `locations` КАРТОЧКИ — один на все листы: свой завёл бы вторую
   *  очередь от своего снимка массива и стирал чужие правки. */
  writer: LocationWriter;
  /** Открыт свайпом «Удалить» — спрашиваем сразу, форму не показываем. */
  askDelete?: boolean;
  /** Объект удалён. Форма записи по этому сигналу снимает выбор, если выбран
   *  был именно он: иначе в запись уехал бы id удалённого объекта. */
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Куда ведёт шестерёнка — решает маршрут (см. `useReferenceHref`).
  const typesHref = useReferenceHref().objectTypes;
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

  const locations = client.locations ?? EMPTY_LOCATIONS;
  // Последний правившийся объект держим до конца анимации закрытия: иначе
  // `if (!loc) return null` размонтирует лист в том же кадре, и он не
  // уезжает вниз, а пропадает.
  const loc = useLastNonNull(
    useMemo(
      () => locations.find((l) => l.id === locationId) ?? null,
      [locations, locationId],
    ),
  );

  const { data: allClients = [] } = useClients();
  const { data: labelPresets = [] } = useLocationLabels();
  const presetNames = useMemo(
    () => labelPresets.map((p) => p.name),
    [labelPresets],
  );
  const typeOptions = useFrozenObjectTypes(allClients, presetNames, loc?.label);

  // Черновик поля «адрес или ссылка»: разбираем его один раз — на уходе со
  // строки. Заполняем ТОЛЬКО на открытии листа (по locationId, а не по самому
  // объекту): `loc` — новая ссылка после каждого ответа сервера, и эффект по
  // нему перезаписывал набранный адрес прямо под курсором.
  const asked = useRef(false);
  const confirmDeleteRef = useRef<() => void>(() => {});
  /** Что сделать, когда лист полностью уйдёт (см. `onExited`). Хук стоит
   *  ДО `if (!loc) return null`: иначе число хуков плясало между рендерами. */
  const afterExit = useRef<(() => void) | null>(null);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!visible || !locationId) return;
    const current = locations.find((l) => l.id === locationId);
    setTarget(current ? primaryLine(current) : "");
    setNote(current?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, locationId]);
  // Уточнение адреса «как на доставке» — см. useAddressPartsEdit.
  const address = useAddressPartsEdit(visible, locationId, locations, loc, (id, p) =>
    void writer.patchLocation(id, p),
  );

  // Свайп «Удалить»: спрашиваем один раз на открытие. Alert живёт в эффекте —
  // из render его звать нельзя (он выполняется и при повторных рендерах).
  useEffect(() => {
    if (!visible || !askDelete) {
      asked.current = false;
      return;
    }
    if (asked.current || !loc) return;
    asked.current = true;
    confirmDeleteRef.current();
  }, [visible, askDelete, loc]);

  if (!loc) return null;

  const patch = (p: Partial<Location>) => void writer.patchLocation(loc.id, p);

  /** Разбор «адрес или ссылка» с оглядкой на ПРЕЖНЕЕ значение: без него
   *  присланный клиентом пин стирался при любой правке адреса — и даже от
   *  простого «Готово», ничего не трогая. */
  /** Место пишется целиком — главная строка + уточнение (см. хук). */
  const commitTarget = () => address.commit(target);

  /** Заметка пишется на уходе с поля и на закрытии листа — как строки
   *  карточки. Пустая стирает прежнюю. */
  const commitNote = () => {
    const value = note.trim();
    if ((loc.note ?? "") === value) return;
    patch({ note: value || undefined });
  };

  /** Всё, что могло не успеть записаться, — одной точкой. */
  const commitAll = () => {
    commitTarget();
    commitNote();
  };

  const confirmDelete = () => {
    const target = loc;
    const ask = () =>
      confirmAction("Удалить объект?", {
        message: objectTarget(target) || target.label || "Объект",
        confirmLabel: "Удалить",
        destructive: true,
      }).then((ok) => {
        if (ok) {
          haptics.warning();
          void writer.removeLocation(target.id);
          onDeleted?.(target.id);
        } else {
          // Без этого отказ оставлял лист открытым (askDelete рисует null —
          // экран выглядел обычным), а `asked` — взведённым: красная кнопка
          // «Удалить» на ВСЕХ объектах после одного отказа молчала.
          asked.current = false;
        }
      });
    // Со свайпа лист не нарисован (`askDelete` → null): спрашиваем сразу и
    // закрываем по ответу, как было.
    if (askDelete) {
      void ask().then(() => onClose());
      return;
    }
    // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29): вопрос
    // рисует хост приложения, а лист — отдельное окно `Modal`, и вопрос
    // честно появлялся ПОД ним: «Удалить объект» из строки листа молчала, и
    // на карточке, и в записи. Сперва уезжаем — с набранным, как при любом
    // закрытии, — и спрашиваем, когда окно листа СНЯТО (`onExited`): таймер
    // по анимации здесь не успевал, iOS отвечал «already presenting».
    afterExit.current = () => void ask();
    commitAll();
    onClose();
  };
  confirmDeleteRef.current = confirmDelete;

  // Пришли со свайпа — сразу вопрос, без формы: жест уже сказал, чего хотят.
  if (askDelete) return null;

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      // Закрытие скримом/свайпом — тоже уход со строки: без этого набранный
      // адрес пропадал вместе с листом (onEditEnd при размонтировании не
      // приходит, а live-строки коммит на размонтировании пропускает).
      onClose={() => {
        commitAll();
        onClose();
      }}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      title="Объект"
      avoidKeyboard
    >

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup>
          {/* АДРЕС — ПЕРВЫМ, без подписи сверху (дизайн-ревью 2026-09-06):
              плейсхолдер и есть подпись. */}
          <FieldRow
            label="Адрес"
            hideLabel
            big
            value={target}
            placeholder="Адрес или ссылка на карту"
            stacked
            multiline
            live
            onSave={(v) => setTarget(v)}
            // Разбор «адрес или ссылка» — на уходе со строки: делать это на
            // каждый символ значило бы подменять набираемый текст.
            onEditEnd={commitTarget}
          />
          <ChoiceRow
            separated
            options={typeOptions}
            value={loc.label}
            // Шестерёнка ведёт в настройки типов и ЗАКРЫВАЕТ лист: страница
            // настроек не может жить под нашим листом. Уход отсюда — такой
            // же уход со строки, как скрим: без коммита набранный адрес
            // пропадал по дороге в настройки.
            onSettings={() => {
              commitAll();
              onClose();
              router.push(typesHref);
            }}
            onSelect={(v) => patch({ label: snapObjectType(v, typeOptions) })}
          />
          {/* ТОЧНЫЙ АДРЕС — «мини-доп» под главной строкой: раскрывается и
              сворачивается обратно; свёрнутая строка показывает, что в ней
              есть. Пустые части снимаются на записи сами. */}
          <AddressDetailsToggle
            open={address.open}
            summary={address.summary}
            onToggle={address.toggle}
          />
          {address.open ? (
            <AddressDetailsFields
              parts={address.details}
              onChange={address.setDetails}
              onEditEnd={commitTarget}
              pin={address.pin}
              onPinChange={address.setPin}
              onPinEditEnd={commitTarget}
              showPin={!isLikelyUrl(target.trim())}
            />
          ) : null}
        </RowGroup>

        {/* ЗАМЕТКА — СВОЕЙ КАРТОЧКОЙ, ПОЛЕМ-ПОДЛОЖКОЙ (владелец 2026-09-07:
            «мне нравились старые заметки»). Тот же вид, что у заметок на
            странице записи; поле открыто сразу, без кнопки «добавить»
            (владелец 2026-09-04). Пишется на уходе с поля и на закрытии. */}
        <RowGroup title="Заметка">
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              onBlur={commitNote}
              multiline
              accessibilityLabel="Заметка об объекте"
              placeholder="Как войти, код, кто встречает…"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              maxFontSizeMultiplier={1.2}
              style={{
                minHeight: 44,
                maxHeight: 120,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: t.radius.input,
                backgroundColor: t.fill,
                fontSize: 15,
                color: t.ink,
              }}
            />
          </View>
        </RowGroup>


        {/* «УДАЛИТЬ ОБЪЕКТ» СТРОКОЙ ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-09-04:
            «удалить объект так нельзя — это свайп вправо удалить, как
            стандартно в архитектуре»). Разрушительное живёт на кромке строки
            объекта в карточке и там же переспрашивает; `confirmDelete` цел —
            именно его зовёт свайп, приходя сюда с `askDelete`. */}
        {!loc.isPrimary ? (
          <RowGroup>
            <ActionRow
              label="Сделать основным"
              onPress={() => {
                haptics.tap();
                void writer.makePrimary(loc.id);
              }}
            />
          </RowGroup>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16),
          borderTopWidth: 1,
          borderTopColor: t.separator,
          backgroundColor: t.surface,
        }}
      >
        {/* ОДНО СЛОВО НА ВСЕ ЛИСТЫ ЗАПИСИ И КАРТОЧКИ — «Применить» (владелец
            2026-09-04). Кнопка была собрана руками; теперь это канонический
            `Button`, как в листах метки, команды, цвета и времени. */}
        <Button
          label="Применить"
          onPress={() => {
            // Набранное могло не успеть закоммититься, если кнопку нажали,
            // не уходя с поля.
            commitAll();
            onClose();
          }}
        />
      </View>

      {/* «ОБСЛУЖИВАНИЕ» СНЕСЕНО 2026-09-04. Строка спрашивала, как часто сюда
          ездить («разовое / раз в 2 месяца»), и кормила подпись «Пора
          обслужить» в строке объекта. Владелец: «для чего это, давай это
          полностью сотри — мы потом это сделаем лучше в напоминаниях для
          клиента». Ни один объект интервала так и не получил (проверено
          запросом: 0 из 16 клиентов), то есть подпись не загоралась ни разу.
          Колонка в базе цела: частичный патч её не трогает, и будущие
          напоминания смогут ею воспользоваться. */}
    </BottomSheet>
  );
}

export default ObjectEditSheet;
