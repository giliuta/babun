import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "expo-router";
import { ScrollView, Text, View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Star } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow } from "@/components/ui/card-rows";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import {
  ObjectFields,
  useObjectTypeOptions,
  type ObjectFieldsValue,
} from "@/features/clients/ObjectFields";
import { useClientSettingsDoor } from "@/features/clients/use-settings-door";
import { isPlaceReady } from "@/features/clients/object-address";
import { useKeyboardShown } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";
import { useObjectCreate, type AddedObject } from "./object-sheet/use-object-create";
import { useObjectEdit } from "./object-sheet/use-object-edit";

// ЛИСТ ОБЪЕКТА — ОДИН НА СОЗДАНИЕ И ПРАВКУ (AGENTS, правило 2).
//
// Новый объект не открываем полноценной страницей — он выезжает снизу вверх;
// отдельной страницы объекта нет и у правки: тап по строке открывает этот же
// лист. Вид — `ObjectFields`, одно тело на оба режима. Режимы отличаются
// только СПОСОБОМ ЗАПИСИ: создание копит черновик и пишет одной кнопкой
// (`object-sheet/use-object-create.ts`), правка пишет сразу, на уходе с
// каждого поля (`object-sheet/use-object-edit.ts`). Два файла-листа уже
// разошлись однажды: подсказка над кнопкой была только у создания, «Сделать
// основным» — только у правки.
//
// ЖИЛЬЦОВ В ЛИСТЕ НЕТ (добавлять жильца отсюда — перебор). Под виллой на
// странице клиента остаётся только ПОКАЗАНИЕ уже связанных.

type Common = {
  visible: boolean;
  /** Писатель `locations` карточки — один на все листы: свой завёл бы вторую
   *  очередь от своего снимка массива и стирал чужие правки. */
  writer: LocationWriter;
  /** «Попросить адрес у клиента» (STORY-077): выписать ссылку и открыть
   *  «Поделиться». Правке это нужно даже чаще — объект часто заводят по
   *  названию улицы и уточняют точку при первом выезде. Нет — иконки нет
   *  (черновик клиента, роль мастера). */
  onRequestFromClient?: () => void;
  onClose: () => void;
};

type ObjectSheetProps = Common &
  (
    | {
        mode: "create";
        /** Команда клиента — её «Типы объектов» (у каждой команды свои). */
        teamId?: string | null;
        /** Чем заполнить главную строку при открытии. Экран записи открывает
         *  лист с уже набранным там адресом — перепечатывать его незачем. */
        initialTarget?: string;
        /** Объект записан. Экран записи по этому сигналу СРАЗУ выбирает его. */
        onAdded?: (added: AddedObject) => void;
      }
    | {
        mode: "edit";
        client: Client;
        /** Какой объект правим. null — лист закрыт. */
        locationId: string | null;
        /** Открыт свайпом «Удалить» — спрашиваем сразу, форму не показываем. */
        askDelete?: boolean;
        /** Объект удалён. Форма записи по этому сигналу снимает выбор, если
         *  выбран был именно он: иначе в запись уехал бы id удалённого объекта. */
        onDeleted?: (id: string) => void;
      }
  );

export function ObjectSheet(props: ObjectSheetProps) {
  // Режим у смонтированного листа не меняется: карточка держит по листу на
  // режим, поэтому хуки каждого режима живут в своей ветке.
  return props.mode === "edit" ? <EditMode {...props} /> : <CreateMode {...props} />;
}

function CreateMode(props: Extract<ObjectSheetProps, { mode: "create" }>) {
  const teamId = props.teamId ?? null;
  const typeOptions = useObjectTypeOptions(teamId);
  const form = useObjectCreate({ ...props, typeOptions });
  const t = useThemeColors();
  return (
    <Shell
      {...props}
      teamId={teamId}
      title="Новый объект"
      draft
      value={form.value}
      typeOptions={typeOptions}
      onChange={form.onChange}
      addressRef={form.addressRef}
      flush={() => {}}
      footer={
        <>
          {/* ПОЧЕМУ КНОПКА СЕРАЯ — СКАЗАНО НАД НЕЙ: тот же
              приём, что у CTA страницы записи. */}
          {!form.ready && !form.saving ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.sub, textAlign: "center", marginBottom: 8 }}
            >
              Впишите адрес, вставьте ссылку или отметьте точку на карте
            </Text>
          ) : null}
          <Button
            label="Добавить объект"
            onPress={() => void form.add()}
            disabled={!form.ready}
            loading={form.saving}
          />
        </>
      }
    />
  );
}

function EditMode(props: Extract<ObjectSheetProps, { mode: "edit" }>) {
  const teamId = props.client.team_id ?? null;
  const typeOptions = useObjectTypeOptions(teamId);
  /** Что сделать, когда лист полностью уйдёт (см. `onExited`). */
  const afterExit = useRef<(() => void) | null>(null);
  const form = useObjectEdit({ ...props, typeOptions, afterExit });
  // Пришли со свайпа — сразу вопрос, без формы: жест уже сказал, чего хотят.
  if (!form.loc || props.askDelete) return null;
  const loc = form.loc;
  return (
    <Shell
      {...props}
      teamId={teamId}
      title="Объект"
      value={form.value}
      typeOptions={typeOptions}
      onChange={form.onChange}
      onCommit={form.commitAll}
      flush={form.commitAll}
      afterExit={afterExit}
      // «УДАЛИТЬ ОБЪЕКТ» СТРОКОЙ ЗДЕСЬ НЕТ: удаление — свайп по строке объекта
      // в карточке, он же приходит сюда с `askDelete`. ОСНОВНОЙ — СО
      // ЗВЁЗДОЧКОЙ: та же звезда стоит у основного объекта в списке.
      extra={
        !loc.isPrimary ? (
          <SectionCard dense>
            <ActionRow icon={Star} label="Сделать основным" onPress={form.makePrimary} />
          </SectionCard>
        ) : null
      }
      // Лист сам пишет объект — «Сохранить» (AGENTS, правило 7: лист правки
      // сущности сохраняет, шторка выбора применяет).
      footer={
        <Button
          label="Сохранить"
          onPress={() => {
            form.commitAll();
            props.onClose();
          }}
        />
      }
    />
  );
}

/** Пустая форма объекта без клиента. */
const EMPTY_PLACE: ObjectFieldsValue = {
  type: "",
  target: "",
  parts: {},
  partsOpen: false,
  pin: "",
  note: "",
};

/** ОБЪЕКТ СОБЫТИЯ БЕЗ КЛИЕНТА — ТА ЖЕ ФОРМА, ТОЛЬКО БЕЗ «ТИПА ОБЪЕКТА».
 *
 *  Такой объект живёт в самом событии (адрес, точка, заметка записи) и в
 *  базу клиентов не попадает, поэтому писателя `locations` у листа нет: он
 *  отдаёт готовое значение форме события, а в базу оно уедет с «Сохранить»
 *  события. Тип объекта хранить негде — блока нет. Вид — `Shell`, как у
 *  объекта клиента: разных дизайнов одной формы нет. */
export function PlaceSheet({
  visible,
  initial,
  onApply,
  onClose,
}: {
  visible: boolean;
  /** Объект, который уже стоит в событии; `null` — заводим новый. */
  initial: ObjectFieldsValue | null;
  onApply: (value: ObjectFieldsValue) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<ObjectFieldsValue>(initial ?? EMPTY_PLACE);
  // Каждое открытие — с того, что стоит в событии сейчас: лист остаётся
  // смонтированным, и без пересева он показывал бы прошлый ввод.
  useEffect(() => {
    if (visible) setValue(initial ?? EMPTY_PLACE);
    // Сеем только на открытие: `initial` пересобирается каждый рендер формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const t = useThemeColors();
  const ready = isPlaceReady(value);
  return (
    <Shell
      visible={visible}
      title={initial ? "Объект" : "Новый объект"}
      draft={!initial}
      teamId={null}
      value={value}
      typeOptions={[]}
      noType
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      flush={() => {}}
      onClose={onClose}
      footer={
        <>
          {!ready ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.sub, textAlign: "center", marginBottom: 8 }}
            >
              Впишите адрес, вставьте ссылку или отметьте точку на карте
            </Text>
          ) : null}
          <Button
            label={initial ? "Сохранить" : "Добавить объект"}
            disabled={!ready}
            onPress={() => {
              onApply(value);
              onClose();
            }}
          />
        </>
      }
    />
  );
}

function Shell({
  visible,
  title,
  teamId,
  value,
  typeOptions,
  onChange,
  onCommit,
  addressRef,
  flush,
  afterExit: ownAfterExit,
  onRequestFromClient,
  onClose,
  extra,
  footer,
  noType = false,
  draft = false,
}: {
  visible: boolean;
  title: string;
  teamId: string | null;
  value: ObjectFieldsValue;
  typeOptions: string[];
  onChange: (patch: Partial<ObjectFieldsValue>) => void;
  onCommit?: () => void;
  addressRef?: RefObject<TextInput | null>;
  /** Записать недописанное перед уходом: правке — всё, созданию — ничего
   *  (черновик доживает до следующего открытия). */
  flush: () => void;
  afterExit?: { current: (() => void) | null };
  onRequestFromClient?: () => void;
  onClose: () => void;
  extra?: ReactNode;
  footer: ReactNode;
  /** Без «Типа объекта» (`PlaceSheet`). */
  noType?: boolean;
  /** Новый объект — меню полей со «Вставить» стоит всегда (`ObjectFields`). */
  draft?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const doorway = useSheetDoorway();
  // Шестерёнка типов — та же дверь, что у остальных строк шестерёнки
  // клиентов: компания в адресе, нет права или команда чужая — двери нет.
  const typesDoor = useClientSettingsDoor("objects", teamId);
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  /** Что сделать, когда лист полностью уйдёт: системный «Поделиться» поверх
   *  уходящего модального окна iOS закрывается вместе с ним. */
  const localAfterExit = useRef<(() => void) | null>(null);
  const afterExit = ownAfterExit ?? localAfterExit;

  return (
    <BottomSheet
      padded={false}
      visible={visible && !doorway.parked}
      // Закрытие скримом/свайпом — тоже уход со строки: без этого набранный
      // в правке адрес пропадал вместе с листом. Черновик создания при
      // закрытии не теряется: лист остаётся смонтированным.
      onClose={() => {
        flush();
        onClose();
      }}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      // ЗАГОЛОВОК — КАНОНИЧЕСКИЙ, БЕЗ «ГОТОВО» В УГЛУ: у нас нижняя кнопка.
      title={title}
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
        <ObjectFields
          addressRef={addressRef}
          noType={noType}
          draft={draft}
          teamId={teamId}
          value={value}
          typeOptions={typeOptions}
          onChange={onChange}
          onCommit={onCommit}
          onRequestFromClient={
            onRequestFromClient
              ? () => {
                  // Лист сперва уходит, действие запускается после его ухода.
                  afterExit.current = onRequestFromClient;
                  flush();
                  onClose();
                }
              : undefined
          }
          onTypeSettings={
            typesDoor && !noType
              ? () => {
                  // ДВЕРЬ ПАРКУЕТ ЛИСТ, А НЕ ЗАКРЫВАЕТ ЕГО, как выбор категории:
                  // закрытый лист вернул бы «назад» на карточку, а начатый объект
                  // пришлось бы заводить заново. Лист уезжает вниз и
                  // возвращается с набранным (`use-sheet-doorway`, AGENTS 5.4).
                  flush();
                  doorway.open(() => router.push(typesDoor));
                }
              : undefined
          }
        />
        {extra}
      </ScrollView>

      {/* Футер — единственная громкая поверхность листа. Над клавиатурой его
          держит avoidKeyboard. */}
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
        {footer}
      </View>
    </BottomSheet>
  );
}
