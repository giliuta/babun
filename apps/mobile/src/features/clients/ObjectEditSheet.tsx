import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { RotateCcw, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client, Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useLastNonNull } from "@/lib/use-last-non-null";
import {
  ActionRow,
  ChoiceRow,
  FieldRow,
  NavRow,
  RowGroup,
} from "@/components/ui/card-rows";
import { PickerSheet } from "@/components/ui/PickerSheet";
import {
  intervalLabel,
  SERVICE_INTERVALS,
} from "@/features/clients/service-plan";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  addressOrLinkPatch,
  objectTarget,
} from "@/features/clients/object-address";
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
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!visible || !locationId) return;
    const current = locations.find((l) => l.id === locationId);
    setTarget(current ? objectTarget(current) : "");
    setNote(current?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, locationId]);

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
  const commitTarget = () => {
    if (objectTarget(loc) === target.trim()) return;
    patch(addressOrLinkPatch(target, { address: loc.address, mapUrl: loc.mapUrl }));
  };

  /** Заметка пишется на уходе с поля и на закрытии листа — как строки
   *  карточки. Пустая стирает прежнюю. */
  const commitNote = () => {
    const value = note.trim();
    if ((loc.note ?? "") === value) return;
    patch({ note: value || undefined });
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
    commitTarget();
    commitNote();
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
        commitTarget();
        commitNote();
        onClose();
      }}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      avoidKeyboard
    >
      <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          Объект
        </Text>
      </View>

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup>
          <ChoiceRow
            label="Тип объекта"
            options={typeOptions}
            value={loc.label}
            // Шестерёнка ведёт в настройки типов и ЗАКРЫВАЕТ лист: страница
            // настроек не может жить под нашим листом. Уход отсюда — такой
            // же уход со строки, как скрим: без коммита набранный адрес
            // пропадал по дороге в настройки.
            onSettings={() => {
              commitTarget();
              commitNote();
              onClose();
              router.push(typesHref);
            }}
            onSelect={(v) => patch({ label: snapObjectType(v, typeOptions) })}
          />
          <NavRow
            label="Обслуживание"
            value={intervalLabel(loc.serviceEveryMonths)}
            placeholder="разовое"
            separated
            onPress={() => {
              haptics.tap();
              setIntervalOpen(true);
            }}
          />
          <FieldRow
            label="Адрес или ссылка"
            value={target}
            placeholder=""
            stacked
            separated
            multiline
            live
            onSave={(v) => setTarget(v)}
            // Разбор «адрес или ссылка» — на уходе со строки: делать это на
            // каждый символ значило бы подменять набираемый текст.
            onEditEnd={commitTarget}
          />
        </RowGroup>

        {/* ЗАМЕТКА ОБЪЕКТА — КОМПОЗЕР, как заметки клиента (владелец
            2026-08-06: «этот плюсик „добавить" надо изменить — как у нас уже
            существуют заметки»). Строка-действие «+ Добавить» просила нажать
            на себя, прежде чем пустить к полю; подложка с полем пускает
            сразу. Кнопки отправки здесь нет: заметка одна, она не
            добавляется в список, а правится и сохраняется на уходе. */}
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

        <RowGroup>
          {!loc.isPrimary ? (
            <ActionRow
              label="Сделать основным"
              onPress={() => {
                haptics.tap();
                void writer.makePrimary(loc.id);
              }}
            />
          ) : null}
          <ActionRow
            label="Удалить объект"
            tone="danger"
            separated={!loc.isPrimary}
            onPress={confirmDelete}
          />
        </RowGroup>
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
        <Pressable
          onPress={() => {
            // Набранное могло не успеть закоммититься, если «Готово» нажали,
            // не уходя с поля.
            commitTarget();
            commitNote();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Готово"
          style={({ pressed }) => ({
            minHeight: 50,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.input,
            backgroundColor: t.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 17, fontWeight: "600", color: t.onAccent }}
          >
            Готово
          </Text>
        </Pressable>
      </View>

      {/* КАК ЧАСТО СЮДА ЕЗДИТЬ. Регулярность — свойство объекта: виллу моют
          раз в месяц, сплиты чистят раз в полгода. Срок считается от
          последнего визита, поэтому «дату обслуживания» здесь не спрашивают
          и её невозможно забыть проставить. */}
      <PickerSheet
        visible={intervalOpen}
        title="Обслуживание объекта"
        items={[
          ...SERVICE_INTERVALS.map((i) => ({
            id: String(i.months),
            label: i.label,
            icon: RotateCcw,
            color: t.accent,
            onPress: () => patch({ serviceEveryMonths: i.months }),
          })),
          ...(loc.serviceEveryMonths
            ? [
                {
                  id: "off",
                  label: "Разовое",
                  icon: X,
                  color: t.danger,
                  onPress: () => patch({ serviceEveryMonths: undefined }),
                },
              ]
            : []),
        ]}
        onClose={() => setIntervalOpen(false)}
      />
    </BottomSheet>
  );
}

export default ObjectEditSheet;
