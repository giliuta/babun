import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ChoiceRow,
  FieldRow,
  RowGroup,
} from "@/components/ui/card-rows";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  addressOrLinkPatch,
} from "@/features/clients/object-address";
import {
  defaultObjectType,
  snapObjectType,
  useFrozenObjectTypes,
} from "@/features/clients/object-types";
import { useClients } from "@/features/clients/queries";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useLocationLabels } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";

// ЛИСТ «ОБЪЕКТЫ» — ДОБАВЛЕНИЕ СНИЗУ ВВЕРХ.
//
// Владелец 2026-07-27: «зачем нам открывать новый объект полноценной
// страницей — пусть оно открывается как снизу вверх добавление, и сразу чтоб
// указывались старые пункты объектов, то есть там будет добавлено сразу
// несколько объектов… если [информация] закрепляется, тогда лучше сделать
// информацию объекта [страницей]».
//
// Отсюда разделение, которое он сам и вывел:
//   ДОБАВИТЬ объект — лист (три поля, объект существует по адресу или ссылке);
//   ИНФОРМАЦИЯ объекта — страница (техника, ТО, «Записать сюда», основной).
// Страница создания больше не существует: она открывала экран поверх экрана
// ради трёх строк и после каждого объекта закрывалась, а объектов у клиента
// обычно два-три подряд.
//
// Уже имеющиеся объекты показаны ВЫШЕ формы — так видно, что уже заведено
// (второй раз тот же адрес не заводят), и каждый добавленный тут же прилетает
// в этот список. Строки списка НЕ ведут на страницу: лист про добавление, а
// дверь в объект — на карточке. Убрать можно только то, что добавлено в этом
// же листе: это отмена своей опечатки, а не удаление объекта с техникой и
// историей (для него на странице есть «Удалить объект» с подтверждением).
//
// В ЧЕРНОВИКЕ КЛИЕНТА лист работает так же: `update` карточки пишет объекты в
// черновик, а `locations` проходит белый список create_client_with_tags — то
// есть уедет в базу вместе с «Готово». Раньше объект в черновике требовал
// сначала сохранить клиента (страница читает его по id).

/** Стабильная пустая ссылка: новый литерал в пропе писателя пересобирал бы
 *  его на каждый рендер. */

interface Draft {
  label: string;
  /** Сырой ввод «адрес или ссылка». Разбор на address/mapUrl — при добавлении:
   *  разбирать на каждый символ значило бы подменять набираемый текст. */
  target: string;
  note: string;
}

const EMPTY_DRAFT: Draft = { label: "", target: "", note: "" };

export function ObjectSheet({
  visible,
  client,
  update,
  writer,
  initialTarget,
  onAdded,
  onClose,
}: {
  visible: boolean;
  client: Client;
  /** Единый persist-путь карточки: черновик — локально, клиент — PATCH. */
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Писатель `locations` — общий с листом правки (см. ObjectEditSheet). */
  writer: LocationWriter;
  /** Чем заполнить «Адрес или ссылка» при открытии. Экран записи открывает
   *  лист с уже набранным там адресом — перепечатывать его незачем. */
  initialTarget?: string;
  /** Объект записан. Экран записи по этому сигналу СРАЗУ выбирает его. */
  onAdded?: (added: {
    id: string;
    label: string;
    address: string;
    mapUrl?: string;
    note?: string;
  }) => void;
  /** Только что добавленный объект убрали «✕». Экран записи по этому сигналу
   *  снимает выбор, если выбрал именно его: иначе id висел бы на удалённом. */
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Куда ведёт шестерёнка — решает маршрут (см. `useReferenceHref`).
  const typesHref = useReferenceHref().objectTypes;
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const { data: allClients = [] } = useClients();
  const { data: labelPresets = [] } = useLocationLabels();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** Идёт запись (добавление или отмена) — синхронно, в отличие от `saving`. */
  const busy = useRef(false);

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

  // Словарь типов — из фактических объектов бизнеса (по частоте) + стандартный
  // набор; текущий набранный тип показываем всегда, даже если он новый.
  const presetNames = useMemo(
    () => labelPresets.map((preset) => preset.name),
    [labelPresets],
  );
  // Порядок ЗАМОРОЖЕН: тап по чипу меняет метку объекта, а значит и частоты, по
  // которым строится словарь — без заморозки чип уезжает из-под пальца через
  // базу (владелец 2026-07-27: «нажимаю офис — перекладывает на виллу»).
  const typeOptions = useFrozenObjectTypes(allClients, presetNames, draft.label);
  // Тип ПРЕДЗАПОЛНЕН: обычный объект заводится, не касаясь этой строки.
  // Считаем, а не сеем эффектом — после каждого добавления форма сбрасывается
  // в пустую, и тип должен подставиться заново сам.
  const type = draft.label.trim() || defaultObjectType(client, typeOptions);

  // Объект существует, когда есть адрес ИЛИ ссылка: метка одна ничего не
  // значит, а по адресу или пину команда доедет.
  const ready = draft.target.trim().length > 0;

  const add = async (): Promise<boolean> => {
    // Засов СИНХРОННЫЙ: между тапом и появлением saving есть кадр, в котором
    // второй тап (или ✕ по соседней строке) успевал влезть в ту же очередь.
    if (!ready || busy.current) return false;
    busy.current = true;
    setSaving(true);
    try {
      const { address, mapUrl } = addressOrLinkPatch(draft.target);
      const id = await writer.addLocation({
        label: snapObjectType(type, typeOptions),
        address,
        mapUrl,
        note: draft.note.trim() || undefined,
        });
      if (!id) {
        // Причину показал useUpdateClient — набранное НЕ выбрасываем.
        haptics.error();
        return false;
      }
      haptics.success();
      onAdded?.({ id, label: snapObjectType(type, typeOptions), address, mapUrl, note: draft.note.trim() || undefined });
      // ДОБАВИЛ — ЛИСТ УХОДИТ (владелец 2026-09-04: «когда я добавил объект,
      // он уже должен закрываться и перекидывать на саму запись»). Раньше лист
      // оставался открытым под следующий объект, а добавленный уезжал в
      // список «Уже есть» — экран отвечал на действие не тем, чего от него
      // ждали: работа сделана, а лист стоит. Второй объект заводят вторым
      // открытием, как и всё остальное в продукте.
      setDraft((d) => ({ ...EMPTY_DRAFT, label: d.label }));
      // Анонс — не в тот же кадр: лист уже уходит, и VoiceOver перебивал бы
      // сам себя (тот же приём, что в листе фильтров).
      setTimeout(
        () =>
          AccessibilityInfo.announceForAccessibility(
            `Объект добавлен: ${address || mapUrl || ""}`,
          ),
        350,
      );
      close();
      return true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  // Закрытие скримом или свайпом НЕ выбрасывает набранное: спросить там
  // нечего, а правило карточки — «набранное не теряем молча». Черновик
  // доживёт до следующего открытия (лист остаётся смонтированным), так что
  // работа продолжится с того же места.
  const close = () => {
    onClose();
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={close}
      // ЗАГОЛОВОК — КАНОНИЧЕСКИЙ, БЕЗ «ГОТОВО» В УГЛУ (владелец 2026-09-04:
      // «нет такого у нас по архитектуре, что справа „Готово“ — у нас нижняя
      // кнопка»). Своя шапка 72│центр│72 держала вторую кнопку действия в
      // углу; действие в листе одно и живёт внизу, а выход — скрим и свайп,
      // как у всех листов продукта. Набранное при закрытии не теряется: лист
      // остаётся смонтированным и черновик доживает до следующего открытия.
      title="Объекты"
      maxHeightRatio={0.92}
      avoidKeyboard
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
        {/* СПИСКА «УЖЕ ЕСТЬ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-09-04: «зачем мне
            этот мини-блок — добавил объект, он уехал вверх „уже есть“, а лист
            по сути не закрылся»). Он держался на том, что лист оставался
            открытым под следующий объект, и на крестике отмены — а крестик
            вдобавок спорил с законом свайпа: удаляют смахиванием, а не
            кнопкой в строке. Лист теперь уходит сразу после добавления, и
            показывать в нём чужие строки незачем: заведённые объекты видно
            там, откуда лист открыли. */}
        <RowGroup title="Новый объект">
          <ChoiceRow
            label="Тип объекта"
            options={typeOptions}
            value={type}
            // Шестерёнка ведёт в настройки типов и ЗАКРЫВАЕТ лист: страница
            // настроек не может жить под нашим листом.
            onSettings={() => {
              close();
              router.push(typesHref);
            }}
            onSelect={(v) =>
              setDraft((d) => ({ ...d, label: snapObjectType(v, typeOptions) }))
            }
          />
          <FieldRow
            label="Адрес или ссылка"
            value={draft.target}
            placeholder=""
            stacked
            separated
            multiline
            // live ОБЯЗАТЕЛЕН: кнопка «Добавить объект» живёт в футере, вне
            // прокрутки, и фокус у поля НЕ снимает. Без записи на каждый
            // символ она читала бы пустой черновик — кнопка оставалась серой,
            // а «Готово» закрывало лист, молча выбросив набранный адрес.
            // (Регресс 2026-07-27: проп снесло вместе с live у строки типа.)
            live
            onSave={(v) => setDraft((d) => ({ ...d, target: v }))}
            // Кнопки маршрута здесь НЕТ намеренно: (1) ехать некуда — объект
            // ещё не заведён; (2) выбор карты — это лист поверх листа, а
            // системный хост выбора живёт в корне и под нашим листом
            // невидим — тап по кнопке вешал ВСЕ последующие выборы в
            // приложении (аудит 2026-07-27). Маршрут живёт у заведённого
            // объекта: в его строке и на его странице.
          />
        </RowGroup>

        {/* ЗАМЕТКА — ПОЛЕ, А НЕ КНОПКА «ДОБАВИТЬ» (владелец 2026-09-04: «при
            добавлении объекта заметка должна показываться, как в клиентах и
            как в объекте, — не кнопка „добавить“, когда я добавляю»). Ровно
            тот счёт, что он предъявил правке объекта 2026-08-06: строка-
            действие просила нажать на себя, прежде чем пустить к полю.
            Подложка с полем пускает сразу, и лист добавления теперь говорит с
            человеком тем же языком, что лист правки. */}
        <RowGroup title="Заметка">
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <TextInput
              value={draft.note}
              onChangeText={(v) => setDraft((d) => ({ ...d, note: v }))}
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
        <Pressable
          onPress={() => void add()}
          disabled={!ready || saving}
          accessibilityRole="button"
          accessibilityLabel="Добавить объект"
          accessibilityState={{ disabled: !ready || saving, busy: saving }}
          style={({ pressed }) => ({
            minHeight: 50,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.input,
            backgroundColor: ready && !saving ? t.accent : t.disabledFill,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: ready && !saving ? t.onAccent : t.sub,
            }}
          >
            {saving ? "Сохраняю…" : "Добавить объект"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

/** Строка уже заведённого объекта: тип и «куда ехать». Двери в объект здесь
 *  нет намеренно (шеврон обещал бы страницу) — только отмена своего же
 *  добавления. */
