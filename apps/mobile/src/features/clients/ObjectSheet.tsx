import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ChoiceRow,
  FieldRow,
  RowActionButton,
  RowGroup,
} from "@/features/clients/card-rows";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  addressOrLinkPatch,
  objectTarget,
} from "@/features/clients/object-address";
import {
  defaultObjectType,
  snapObjectType,
  useFrozenObjectTypes,
} from "@/features/clients/object-types";
import { useClients } from "@/features/clients/queries";
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
const EMPTY_LOCATIONS: Location[] = [];

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
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const { data: allClients = [] } = useClients();
  const { data: labelPresets = [] } = useLocationLabels();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** Идёт запись (добавление или отмена) — синхронно, в отличие от `saving`. */
  const busy = useRef(false);
  // Добавленные в ЭТОМ листе — только их можно отменить одним тапом.
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const objects = client.locations ?? EMPTY_LOCATIONS;

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
      setAddedIds((cur) => [...cur, id]);
      onAdded?.({ id, label: snapObjectType(type, typeOptions), address, mapUrl, note: draft.note.trim() || undefined });
      // Форма пустеет, но ВЫБРАННЫЙ ТИП остаётся: три виллы подряд не должны
      // требовать трёх тапов по чипу, а предзаполнение от основного объекта
      // возвращало «Дом». Клавиатура тоже остаётся — следующий адрес набирают
      // сразу, кнопка живёт в футере и фокус не отбирает.
      setDraft((d) => ({ ...EMPTY_DRAFT, label: d.label }));
      // Анонс — не в тот же кадр: у сфокусированной кнопки прямо сейчас
      // меняется состояние на «выключена», и VoiceOver перебивает сам себя
      // (тот же приём, что в листе фильтров).
      setTimeout(
        () =>
          AccessibilityInfo.announceForAccessibility(
            `Объект добавлен: ${address || mapUrl || ""}`,
          ),
        350,
      );
      return true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const undo = async (loc: Location) => {
    if (busy.current) return;
    busy.current = true;
    haptics.tap();
    try {
      const ok = await writer.removeLocation(loc.id);
      if (ok) setAddedIds((cur) => cur.filter((id) => id !== loc.id));
    } finally {
      busy.current = false;
    }
  };

  // Закрытие скримом или свайпом НЕ выбрасывает набранное: спросить там
  // нечего, а правило карточки — «набранное не теряем молча». Черновик
  // доживёт до следующего открытия (лист остаётся смонтированным), так что
  // работа продолжится с того же места. Сбрасываем только окно отмены: убрать
  // одним тапом можно то, что добавил ТОЛЬКО ЧТО.
  const close = () => {
    setAddedIds([]);
    onClose();
  };

  // «Готово» — это «я закончил», а не «выйти без сохранения»: если адрес
  // набран, объект ДОПИСЫВАЕТСЯ и только потом лист уходит. Иначе кнопка тем
  // же словом, которым на карточке сохраняют клиента, молча выбрасывала бы
  // работу. Запись не удалась — остаёмся на месте, причину уже показали.
  const finish = async () => {
    if (ready && !(await add())) return;
    close();
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={close}
      maxHeightRatio={0.92}
      avoidKeyboard
    >
      {/* Шапка 72│центр│72 — «Объекты» оптически по центру. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          paddingHorizontal: 16,
          paddingTop: 2,
        }}
      >
        <View style={{ width: 72 }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
          >
            Объекты
          </Text>
        </View>
        <View style={{ width: 72, alignItems: "flex-end" }}>
          <Pressable
            onPress={() => void finish()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={ready ? "Готово, добавить объект" : "Готово"}
            hitSlop={12}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
            >
              Готово
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Тело листа — язык страницы (группы строк на прохладном фоне): лист
          заменяет собой страницу, и строки в нём те же самые. Паддинги только
          через contentContainerStyle — className на ScrollView NativeWind
          молча роняет. */}
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {objects.length > 0 ? (
          <RowGroup title={`Уже есть · ${objects.length}`}>
            {objects.map((loc, i) => (
              <ObjectListRow
                key={loc.id}
                label={loc.label || "Объект"}
                target={objectTarget(loc) || "адрес не указан"}
                muted={!objectTarget(loc)}
                separated={i > 0}
                onUndo={addedIds.includes(loc.id) ? () => void undo(loc) : undefined}
              />
            ))}
          </RowGroup>
        ) : null}

        <RowGroup title="Новый объект">
          <ChoiceRow
            label="Тип объекта"
            options={typeOptions}
            value={type}
            // Шестерёнка ведёт в настройки типов и ЗАКРЫВАЕТ лист: страница
            // настроек не может жить под нашим листом.
            onSettings={() => {
              close();
              router.push("/clients/object-types");
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
          <FieldRow
            label="Заметка"
            value={draft.note}
            placeholder=""
            addLabel="Добавить"
            stacked
            separated
            multiline
            live
            onSave={(v) => setDraft((d) => ({ ...d, note: v }))}
          />
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
function ObjectListRow({
  label,
  target,
  muted,
  separated,
  onUndo,
}: {
  label: string;
  target: string;
  muted?: boolean;
  separated?: boolean;
  onUndo?: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {/* Тип и «куда ехать» — ОДИН элемент для VoiceOver: двумя текстами
          связь между ними теряется, а свайпов до формы становится вдвое
          больше. Кнопка отмены остаётся СНАРУЖИ (иначе склеится со строкой). */}
      <View
        accessible
        accessibilityLabel={`${label}: ${target}`}
        style={{ flex: 1 }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 13, color: muted ? t.faint : t.sub }}
        >
          {target}
        </Text>
      </View>
      {onUndo ? (
        <RowActionButton
          icon={X}
          color={t.danger}
          label={`Убрать объект ${label}`}
          hint="Отменяет только что добавленный объект"
          onPress={onUndo}
        />
      ) : null}
    </View>
  );
}
