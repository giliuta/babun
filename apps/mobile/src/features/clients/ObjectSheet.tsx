import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { AccessibilityInfo, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  ObjectFields,
  useObjectTypeOptions,
  type ObjectFieldsValue,
} from "@/features/clients/ObjectFields";
import { hasAddressPlace, objectPlacePatch } from "@/features/clients/object-address";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import { defaultObjectType, snapObjectType } from "@/features/clients/object-types";
import { useReferenceHref } from "@/features/clients/reference-href";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";

// ЛИСТ «НОВЫЙ ОБЪЕКТ» — ДОБАВЛЕНИЕ СНИЗУ ВВЕРХ.
//
// Владелец 2026-07-27: «зачем нам открывать новый объект полноценной
// страницей — пусть оно открывается как снизу вверх добавление». Отсюда
// разделение, которое он сам и вывел: ДОБАВИТЬ объект — лист (три вопроса,
// объект существует по адресу или ссылке); ИНФОРМАЦИЯ объекта — строка
// карточки. Страницы создания объекта в продукте нет.
//
// ВИД ЛИСТА ЖИВЁТ НЕ ЗДЕСЬ, А В `ObjectFields` — одном теле на создание и на
// правку (см. его заголовок). Этот файл отвечает ровно за одно: за черновик и
// за то, как он уезжает в базу одной кнопкой. Правка того же объекта пишет
// сразу, на уходе с каждого поля, — это законная разница СПОСОБА ЗАПИСИ, а не
// повод рисовать вторую форму.
//
// В ЧЕРНОВИКЕ КЛИЕНТА лист работает так же: писатель `locations` кладёт объекты
// в черновик, а `locations` проходит белый список create_client_with_tags — то
// есть уедет в базу вместе с «Готово».

const EMPTY_DRAFT: ObjectFieldsValue = {
  type: "",
  target: "",
  parts: {},
  partsOpen: false,
  pin: "",
  note: "",
};

export function ObjectSheet({
  visible,
  client,
  writer,
  initialTarget,
  onAdded,
  onRequestFromClient,
  onClose,
}: {
  visible: boolean;
  client: Client;
  /** Писатель `locations` — общий с листом правки: свой завёл бы вторую
   *  очередь от своего снимка массива и стирал чужие правки. */
  writer: LocationWriter;
  /** Чем заполнить главную строку при открытии. Экран записи открывает лист с
   *  уже набранным там адресом — перепечатывать его незачем. */
  initialTarget?: string;
  /** Объект записан. Экран записи по этому сигналу СРАЗУ выбирает его. */
  onAdded?: (added: {
    id: string;
    label: string;
    address: string;
    mapUrl?: string;
    note?: string;
  }) => void;
  /** «Попросить адрес у клиента» (STORY-077): выписать ссылку и открыть
   *  «Поделиться». Нет — иконки нет (черновик клиента, роль мастера). */
  onRequestFromClient?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Куда ведёт шестерёнка — решает маршрут (см. `useReferenceHref`).
  const typesHref = useReferenceHref().objectTypes;
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

  const [draft, setDraft] = useState<ObjectFieldsValue>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** Идёт запись — синхронно, в отличие от `saving`. */
  const busy = useRef(false);
  /** Что сделать, когда лист полностью уйдёт: системный «Поделиться» поверх
   *  уходящего модального окна iOS закрывается вместе с ним. */
  const afterExit = useRef<(() => void) | null>(null);

  // Предзаполнение — РОВНО ОДИН РАЗ на открытие и только в пустой черновик:
  // лист остаётся смонтированным, и без засова подстановка перетирала бы то,
  // что человек уже набрал.
  const seeded = useRef(false);
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    const start = initialTarget?.trim();
    if (start) setDraft((d) => (d.target.trim() ? d : { ...d, target: start }));
  }, [visible, initialTarget]);

  const typeOptions = useObjectTypeOptions(draft.type);
  // ТИП ПРЕДЗАПОЛНЕН, НО НЕ ОБЯЗАТЕЛЕН (владелец 2026-09-10: «выбор типа
  // объекта необязательно — можно создать объект без типа, просто ссылку или
  // адрес»). Раньше тип не хранился, а СЧИТАЛСЯ: `draft.type || default`, и
  // снять его было нечем — пустое значение в ту же секунду снова становилось
  // «Домом». Теперь подстановка сеется РОВНО ОДИН РАЗ на открытие, когда
  // словарь приехал, и дальше значение принадлежит человеку: снял в шторке —
  // объект запишется без типа. Пустой тип продукт уже умеет: списки печатают
  // такой объект как «Объект» (`loc.label || "Объект"`).
  const typeSeeded = useRef(false);
  useEffect(() => {
    if (!visible) {
      typeSeeded.current = false;
      return;
    }
    if (typeSeeded.current || typeOptions.length === 0) return;
    typeSeeded.current = true;
    setDraft((d) =>
      d.type.trim() ? d : { ...d, type: defaultObjectType(client, typeOptions) },
    );
  }, [visible, typeOptions, client]);

  // Объект существует, когда есть адрес, части с «где» ИЛИ отмеченная точка:
  // по пину команда доедет даже без единого слова адреса — на кипрских виллах
  // это обычное дело.
  const ready =
    draft.target.trim().length > 0 ||
    hasAddressPlace(draft.parts) ||
    isLikelyUrl(draft.pin.trim());

  const add = async (): Promise<boolean> => {
    // Засов СИНХРОННЫЙ: между тапом и появлением `saving` есть кадр, в который
    // второй тап успевал влезть в ту же очередь.
    if (!ready || busy.current) return false;
    busy.current = true;
    setSaving(true);
    try {
      // Главная строка + уточнение → одно место: строка-ссылка станет пином,
      // строка-текст — «улица и дом» (см. objectPlacePatch).
      const { address, mapUrl, addressParts } = objectPlacePatch(
        draft.target,
        draft.parts,
        draft.pin,
      );
      const label = snapObjectType(draft.type, typeOptions);
      const note = draft.note.trim() || undefined;
      const id = await writer.addLocation({
        label,
        address,
        mapUrl,
        addressParts,
        note,
      });
      if (!id) {
        // Причину показал useUpdateClient — набранное НЕ выбрасываем.
        haptics.error();
        return false;
      }
      haptics.success();
      onAdded?.({ id, label, address, mapUrl, note });
      // ДОБАВИЛ — ЛИСТ УХОДИТ (владелец 2026-09-04: «когда я добавил объект,
      // он уже должен закрываться и перекидывать на саму запись»). Второй
      // объект заводят вторым открытием, как и всё остальное в продукте.
      setDraft((d) => ({ ...EMPTY_DRAFT, type: d.type }));
      // Анонс — не в тот же кадр: лист уже уходит, и VoiceOver перебивал бы
      // сам себя (тот же приём, что в листе фильтров).
      setTimeout(
        () =>
          AccessibilityInfo.announceForAccessibility(
            `Объект добавлен: ${address || mapUrl || ""}`,
          ),
        350,
      );
      onClose();
      return true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      // ЗАГОЛОВОК — КАНОНИЧЕСКИЙ, БЕЗ «ГОТОВО» В УГЛУ (владелец 2026-09-04:
      // «нет такого у нас по архитектуре, что справа „Готово“ — у нас нижняя
      // кнопка»). Набранное при закрытии не теряется: лист остаётся
      // смонтированным и черновик доживает до следующего открытия.
      title="Новый объект"
      maxHeightRatio={0.92}
      avoidKeyboard
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
    >
      {/* Тело листа — язык страницы (группы строк на прохладном фоне): лист
          заменяет собой страницу, и строки в нём те же самые. Паддинги только
          через contentContainerStyle — className на ScrollView NativeWind
          молча роняет. */}
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <ObjectFields
          value={draft}
          typeOptions={typeOptions}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onTypeSettings={() => {
            // Настройки ЗАКРЫВАЮТ лист: страница не может жить под ним.
            onClose();
            router.push(typesHref);
          }}
          onRequestFromClient={
            onRequestFromClient
              ? () => {
                  // Лист сперва уходит, действие запускается после его ухода.
                  afterExit.current = onRequestFromClient;
                  onClose();
                }
              : undefined
          }
        />
      </ScrollView>

      {/* Футер — единственная громкая поверхность листа. Над клавиатурой его
          держит avoidKeyboard, поэтому добавлять можно, не убирая её. */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          // Клавиатура iOS уже включает зону home-индикатора — иначе под
          // кнопкой висели бы лишние ~34pt пустоты.
          paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16),
          borderTopWidth: 1,
          borderTopColor: t.separator,
          backgroundColor: t.surface,
        }}
      >
        {/* ПОЧЕМУ КНОПКА СЕРАЯ — СКАЗАНО НАД НЕЙ (аудит 2026-09-09): тот же
            приём, что у CTA страницы записи. */}
        {!ready && !saving ? (
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 13,
              color: t.sub,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Впишите адрес, вставьте ссылку или отметьте точку на карте
          </Text>
        ) : null}
        {/* КНОПКА — КАНОНИЧЕСКАЯ (2026-09-10). Здесь стояла своя `Pressable` с
            плоской заливкой `t.accent`: единственная главная кнопка в
            продукте, нарисованная руками, — рядом с «Создать клиента» и
            «Применить» она выглядела чужой, без градиента и без ореола. */}
        <Button
          label="Добавить объект"
          onPress={() => void add()}
          disabled={!ready}
          loading={saving}
        />
      </View>
    </BottomSheet>
  );
}
