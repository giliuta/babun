import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client, Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow } from "@/components/ui/card-rows";
import { useLastNonNull } from "@/lib/use-last-non-null";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  ObjectFields,
  useObjectTypeOptions,
} from "@/features/clients/ObjectFields";
import { objectTarget, primaryLine } from "@/features/clients/object-address";
import { useAddressPartsEdit } from "@/features/clients/use-address-parts-edit";
import { snapObjectType } from "@/features/clients/object-types";
import { useReferenceHref } from "@/features/clients/reference-href";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { confirmAction } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";

// ПРАВКА ОБЪЕКТА — ЛИСТ, А НЕ СТРАНИЦА (владелец 2026-08-06: «отдельная
// страница объекта вообще не открывается… если нажимаешь — вылазит менюшка
// по поводу редактирования»).
//
// ВИД ЛИСТА ЖИВЁТ НЕ ЗДЕСЬ, А В `ObjectFields` — том же теле, что у листа
// добавления (см. его заголовок). Этот файл отвечает ровно за одно: писать
// правки в объект СРАЗУ, на уходе с каждого поля, — так ведут себя все строки
// карточки. Раньше здесь лежала вторая форма того же объекта, и она разошлась
// с первой: тип строкой вместо своей карточки, ни карты, ни «попросить адрес
// у клиента».
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
  onRequestFromClient,
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
  /** «Попросить адрес у клиента» — та же иконка, что у листа создания
   *  (2026-09-10). Объект часто заводят по названию улицы и уточняют точку
   *  при первом выезде: дослать ссылку УЖЕ созданному объекту надо чаще, чем
   *  новому. Нет обработчика — иконки нет (черновик клиента, роль мастера). */
  onRequestFromClient?: () => void;
  /** Объект удалён. Форма записи по этому сигналу снимает выбор, если выбран
   *  был именно он: иначе в запись уехал бы id удалённого объекта. */
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const doorway = useSheetDoorway();
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

  const typeOptions = useObjectTypeOptions(loc?.label);

  // Черновик главной строки и заметки. Заполняем ТОЛЬКО на открытии листа (по
  // locationId, а не по самому объекту): `loc` — новая ссылка после каждого
  // ответа сервера, и эффект по нему перезаписывал набранное под курсором.
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

  // Свайп «Удалить»: спрашиваем один раз на открытие. Вопрос живёт в эффекте —
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
    const victim = loc;
    const ask = () =>
      confirmAction("Удалить объект?", {
        message: objectTarget(victim) || victim.label || "Объект",
        confirmLabel: "Удалить",
        destructive: true,
      }).then((ok) => {
        if (ok) {
          haptics.warning();
          void writer.removeLocation(victim.id);
          onDeleted?.(victim.id);
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
    // честно появлялся ПОД ним. Сперва уезжаем — с набранным, как при любом
    // закрытии, — и спрашиваем, когда окно листа СНЯТО (`onExited`).
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
      visible={visible && !doorway.parked}
      // Закрытие скримом/свайпом — тоже уход со строки: без этого набранный
      // адрес пропадал вместе с листом (onEditEnd при размонтировании не
      // приходит, а live-строки коммит на размонтировании пропускают).
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
      maxHeightRatio={0.92}
      avoidKeyboard
    >
      {/* Тело — то же, что у листа добавления: прохладный фон под карточками
          блоков. Паддинги только через contentContainerStyle — className на
          ScrollView NativeWind молча роняет. */}
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <ObjectFields
          value={{
            type: loc.label ?? "",
            target,
            parts: address.details,
            partsOpen: address.open,
            pin: address.pin,
            note,
          }}
          typeOptions={typeOptions}
          onChange={(p) => {
            // Тип — единственное, что пишется тем же тапом: строка выбора не
            // знает «ухода с поля», а объект уже существует.
            if (p.type !== undefined)
              patch({ label: snapObjectType(p.type, typeOptions) });
            if (p.target !== undefined) setTarget(p.target);
            if (p.parts !== undefined) address.setDetails(p.parts);
            if (p.pin !== undefined) address.setPin(p.pin);
            if (p.partsOpen !== undefined) address.setOpen(p.partsOpen);
            if (p.note !== undefined) setNote(p.note);
          }}
          onCommit={commitAll}
          onRequestFromClient={
            onRequestFromClient
              ? () => {
                  // Системный «Поделиться» поверх уходящего окна листа iOS
                  // закрывает вместе с ним — сперва уезжаем.
                  afterExit.current = onRequestFromClient;
                  commitAll();
                  onClose();
                }
              : undefined
          }
          onTypeSettings={() => {
            // Коммит набранного остаётся: адрес, недописанный в строке, иначе
            // теряется по дороге. А вот ЗАКРЫВАТЬ лист больше не надо —
            // он паркуется и возвращается по «назад» (владелец 2026-09-10:
            // «сделай стандарт, как и везде», AGENTS 5.4).
            commitAll();
            doorway.open(() => router.push(typesHref));
          }}
        />

        {/* «УДАЛИТЬ ОБЪЕКТ» СТРОКОЙ ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-09-04:
            «удалить объект так нельзя — это свайп вправо удалить, как
            стандартно в архитектуре»). Разрушительное живёт на кромке строки
            объекта в карточке и там же переспрашивает; `confirmDelete` цел —
            именно его зовёт свайп, приходя сюда с `askDelete`. */}
        {!loc.isPrimary ? (
          <SectionCard>
            <ActionRow
              label="Сделать основным"
              onPress={() => {
                haptics.tap();
                void writer.makePrimary(loc.id);
              }}
            />
          </SectionCard>
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
            2026-09-04). */}
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
    </BottomSheet>
  );
}

export default ObjectEditSheet;
