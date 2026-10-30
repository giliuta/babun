import { useEffect, useMemo, useState, type Ref } from "react";
import { TextInput, View } from "react-native";
import { MapPinned, Send, Tag } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { useClientsCapabilities } from "@/session/company-scope";
import { useArchivedTeamIds } from "@/features/clients/use-archived-teams";
import { FieldRow } from "@/components/ui/card-rows";
import { iconPreset } from "@/components/ui/icon-set";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import { ReferenceBlock } from "@/components/ui/ReferenceBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import {
  googleMapsSearchUrl,
  type Coords,
} from "@/features/clients/location-request-form";
import {
  AddressDetailsFields,
  AddressDetailsToggle,
} from "@/features/clients/AddressPartsFields";
import { composeDetails } from "@/features/clients/object-address";
import { geocodeAddress } from "@/features/clients/geocode";
import {
  objectTypeKey,
  objectTypeVocabulary,
  snapObjectType,
} from "@/features/clients/object-types";
import { useLocationLabels } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { ObjectMapPanel } from "@/features/clients/object-fields/ObjectMapPanel";
import { coordsOf, objectGeoQuery } from "@/features/clients/object-fields/object-geo";

// The map panel and the pure map helpers live in `object-fields/`.
export { coordsOf } from "@/features/clients/object-fields/object-geo";

// ТЕЛО ФОРМЫ ОБЪЕКТА — ОДНО НА СОЗДАНИЕ И НА ПРАВКУ: что показано в одном
// месте, показано так же в другом, разных дизайнов нет.
//
// Две формы неизбежно разошлись бы, как расходится всякая копия: один и тот
// же объект выглядел бы двумя разными продуктами в зависимости от того,
// заводят его или чинят.
//
// Поэтому блоки живут здесь, а лист один — `ObjectSheet` с режимом и своим
// способом записи у каждого:
//   СОЗДАНИЕ пишет черновик и уезжает в базу одной кнопкой;
//   ПРАВКА пишет объект сразу, на уходе с каждого поля (`onCommit`).
// Разный способ записи — законная разница; разный вид — нет.
//
// ТРИ ВОПРОСА, ТРИ КАРТОЧКИ: что это · куда ехать · что знать у порога.
// Тот же примитив, что у блоков «Клиент» и «Объект» на странице записи:
// подпись ВНУТРИ карточки, её команда — иконкой справа в той же строке.

export interface ObjectFieldsValue {
  /** Тип объекта: «Дом», «Квартира», «Офис»… */
  type: string;
  /** Главная строка «адрес или ссылка». Разбор на текст/пин — при записи
   *  (см. `objectPlacePatch`): разбирать на каждый символ значило бы
   *  подменять набираемый текст. */
  target: string;
  /** Части «Точного адреса» БЕЗ улицы — она в `target`. */
  parts: AddressParts;
  /** Раскрыт ли «Точный адрес». */
  partsOpen: boolean;
  /** Отмеченная точка — отдельной ссылкой, когда главная строка текст. */
  pin: string;
  note: string;
}

/** Словарь типов объекта для строки выбора — ОДИН расчёт на оба листа.
 *  Порядок заморожен: тап по чипу меняет метку объекта, то есть частоты, по
 *  которым словарь строится, и без заморозки чип уезжает из-под пальца через
 *  базу («нажимаю офис — перекладывает на виллу»). */
export function useObjectTypeOptions(
  /** Команда клиента — её «Типы объектов» (у каждой команды свои). */
  teamId: string | null = null,
): string[] {
  // ТОЛЬКО СПРАВОЧНИК КОМАНДЫ (каждый сам создаёт свой тип): ни стандартного набора, ни типов, подсмотренных на объектах.
  const { data: labelPresets = [] } = useLocationLabels(teamId);
  // Календарь в архиве никого не обслуживает: его типы не предлагаются
  // (`serving-teams.ts`) — ни клиенту этой команды, ни клиенту без команды.
  const archivedTeamIds = useArchivedTeamIds();
  return useMemo(
    () =>
      teamId && archivedTeamIds.has(teamId)
        ? []
        : objectTypeVocabulary(
            labelPresets
              .filter((preset) => !preset.teamId || !archivedTeamIds.has(preset.teamId))
              .map((preset) => preset.name),
          ),
    [labelPresets, teamId, archivedTeamIds],
  );
}

export function ObjectFields({
  value,
  typeOptions,
  onChange,
  onTypeSettings,
  onRequestFromClient,
  onCommit,
  addressRef,
  teamId = null,
  noType = false,
  draft = false,
}: {
  value: ObjectFieldsValue;
  typeOptions: string[];
  /** Частичная правка значения — владеет им тот лист, который его открыл. */
  onChange: (patch: Partial<ObjectFieldsValue>) => void;
  /** Шестерёнка блока «Тип объекта»: закрыть лист и уйти в настройки типов —
   *  страница настроек не может жить под нижним листом. Нет — шестерёнки нет
   *  (права на «Типы объектов» нет или команда чужой компании). */
  onTypeSettings?: () => void;
  /** «Попросить адрес у клиента» (STORY-077). Нет — иконки нет: черновик
   *  клиента и роль мастера ссылку не выписывают. */
  onRequestFromClient?: () => void;
  /** Уход с поля. Правка пишет объект сразу; создание молчит — там всё
   *  уезжает одной кнопкой. */
  onCommit?: () => void;
  /** Поле адреса — лист нового объекта ставит в него курсор сам. */
  addressRef?: Ref<TextInput>;
  /** Команда клиента — вид типа из её справочника. */
  teamId?: string | null;
  /** Без блока «Тип объекта»: объект события без клиента хранится в самом
   *  событии, и типа у него держать негде. */
  noType?: boolean;
  /** Новый объект: всё в полях вписал сам человек, и меню поля — со
   *  «Вставить» — стоит всегда. iOS прячет меню целиком, вместе со вставкой,
   *  а без вставки ссылку на карту в адрес не положить. */
  draft?: boolean;
}) {
  const t = useThemeColors();
  // Без выноса: у сотрудника чужой компании адрес и заметку сохранённого
  // объекта не скопировать.
  const caps = useClientsCapabilities();
  const noCopy = !draft && !caps.export;
  /** Раскрыта ли карта под адресом. */
  const [mapOpen, setMapOpen] = useState(false);
  /** Поднят ли список типов объекта. */
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  // ВИД ТИПА — ИЗ СПРАВОЧНИКА, А НЕ ПРИДУМАННЫЙ ЗДЕСЬ. У типа объекта есть
  // свои цвет и значок (`location_labels.color/icon`), и кабинет рисует «Дом»
  // синим домиком. Покрасив строки шторки случайным цветом по имени
  // (`getAvatarColor(name)`), мы показали бы тот же тип в кабинете одним, а в
  // выборе другим. Ищем по КЛЮЧУ имени: типы
  // приходят из фактических данных и расходятся с справочником регистром и
  // пробелами. Нет записи (тип живёт только в данных) — общий значок сущности
  // и акцент: пустой цвет в справочнике значит «не красить», а не «покрасить
  // во что-нибудь».
  const { data: labelPresets = [] } = useLocationLabels(teamId);
  const presetByKey = useMemo(
    () => new Map(labelPresets.map((preset) => [objectTypeKey(preset.name), preset])),
    [labelPresets],
  );
  const typePreset = presetByKey.get(objectTypeKey(value.type));
  /** Куда переехать карте: адрес словами, найденный геокодером. */
  const [found, setFound] = useState<Coords | null>(null);

  // АДРЕС СЛОВАМИ ВЕДЁТ КАРТУ: вписанный точный адрес отображается на
  // мини-карте, чтобы убедиться в нём. Ищем только пока карта раскрыта и не чаще раза в 800 мс
  // после последней буквы: служба чужая и бесплатная. Ссылку не геокодируем —
  // у неё координаты уже внутри.
  const geoQuery = mapOpen ? objectGeoQuery(value) : "";
  useEffect(() => {
    if (!geoQuery) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void geocodeAddress(geoQuery, abort.signal).then((coords) => {
        if (coords) setFound(coords);
      });
    }, 800);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [geoQuery]);

  const pinCoords = coordsOf(value.pin);

  return (
    <>
      {/* ТИП ОБЪЕКТА — «БЛОК + ШТОРКА», КАК КАТЕГОРИЯ, МЕТКА И ТИП СОБЫТИЯ:
          тап по блоку поднимает шторку выбора, выбрал — тип применился,
          шторка ушла, форма прежней высоты (владелец: не раскрывашкой).

          ШТОРКА ЛОЖИТСЯ В ОКНО ЛИСТА ОБЪЕКТА (`overlayIfStacked`), а не вторым
          окном поверх: два модальных окна iOS не показывает, и форма
          застывала бы под невидимой шторкой (`sheet-overlay.tsx`). Дверь в
          «Типы объектов» — шестерёнкой шапки шторки; пустой справочник ведёт
          туда же. Повторный тап по выбранному снимает тип: объект бывает и
          без типа. */}
      {noType ? null : (
        <ReferenceBlock
          // ФОРМА В ШТОРКЕ — плотно, чтобы тип объекта не выпадал из размера.
          // Вид выбранного — тот же, что у категории; тише только воздух.
          dense
          title="Тип объекта"
          emptyIcon={Tag}
          emptyLabel="Выбрать тип объекта"
          emptyHint="Открывает список типов объектов"
          // Метка без типа в справочнике (тип удалили) — «не выбрано»: объект
          // без типа, как и в строке объекта (`findObjectType`).
          value={
            typePreset
              ? {
                  name: typePreset.name,
                  color: typePreset?.color ?? null,
                  Icon: iconPreset(typePreset?.icon),
                }
              : null
          }
          onPress={() => {
            haptics.tap();
            setTypeSheetOpen(true);
          }}
        />
      )}
      {noType ? null : (
        <ValuePickerSheet
          visible={typeSheetOpen}
          overlayIfStacked
          title="Тип объекта"
          options={typeOptions.map((name) => {
            const preset = presetByKey.get(objectTypeKey(name));
            return {
              id: name,
              label: name,
              icon: iconPreset(preset?.icon) ?? Tag,
              color: preset?.color ?? t.accent,
            };
          })}
          selectedId={typePreset?.name ?? null}
          emptyLabel="Типов объектов пока нет"
          onPick={(name) => {
            onChange({ type: name ? snapObjectType(name, typeOptions) : "" });
            onCommit?.();
          }}
          onSettings={onTypeSettings}
          settingsLabel="Типы объектов"
          onClose={() => setTypeSheetOpen(false)}
        />
      )}

      <SectionCard
        dense
        title="Адрес"
        action={[
          {
            // ТОЧКА НА КАРТЕ — СВОЙ ЛИСТ, А НЕ УХОД В GOOGLE MAPS. Вернуть выбранную точку из чужого приложения
            // нельзя: ни у Google, ни у Apple нет режима «выбери и вернись» —
            // их URL-схемы односторонние. Поэтому карта своя.
            label: "Выбрать точку на карте",
            icon: MapPinned,
            // Синим, как кнопка маршрута у объекта.
            accent: true,
            onPress: () => setMapOpen((v) => !v),
          },
          ...(onRequestFromClient
            ? [
                {
                  label: "Попросить адрес у клиента",
                  icon: Send,
                  accent: true,
                  onPress: onRequestFromClient,
                },
              ]
            : []),
        ]}
      >
        {/* ГЛАВНАЯ СТРОКА БЛОКА: сюда же вставляют ссылку на карту.
            `live` обязателен — кнопка листа живёт в футере, вне прокрутки, и
            фокус у поля не снимает; без записи на каждый символ она читала бы
            пустой черновик. */}
        <FieldRow
          label="Адрес"
          hideLabel
          big
          noCopy={noCopy}
          value={value.target}
          placeholder="Улица и дом или ссылка на карту"
          stacked
          multiline
          live
          onSave={(v) => onChange({ target: v })}
          onEditEnd={onCommit}
          inputRef={addressRef}
        />

        {/* КАРТА РАСКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, ПОД АДРЕСОМ: два модальных листа в
            один кадр iOS не показывает. Точка ставится в центре и применяется
            на каждое движение — «Готово» только сворачивает блок.

            КУДА ЗАПИСЫВАЕТСЯ: точка уходит в пин, а главная строка остаётся
            свободной для человеческого адреса. Иначе в поле «Адрес» тянулась
            бы голая ссылка Google Maps — ровно на это ругается разбор
            ссылок. */}
        {mapOpen ? (
          <ObjectMapPanel
            value={pinCoords ?? coordsOf(value.target)}
            pinCoords={pinCoords}
            follow={found}
            // Точка НЕ коммитится в том же кадре: в режиме правки значение
            // ещё не доехало до состояния, и запись ушла бы с прежним пином.
            // Её запишет следующая точка коммита — уход с поля, «Применить»
            // или закрытие листа, как и у полей «Точного адреса».
            onPick={(coords) => onChange({ pin: googleMapsSearchUrl(coords) })}
            onClear={() => onChange({ pin: "" })}
          />
        ) : null}

        {/* ТОЧНЫЙ АДРЕС — маленькой синей строкой: это уточнение адреса, а не
            второй адрес, и весить как главная строка оно не должно. */}
        <AddressDetailsToggle
          variant="link"
          open={value.partsOpen}
          summary={composeDetails(value.parts)}
          onToggle={() => {
            haptics.tap();
            onChange({ partsOpen: !value.partsOpen });
          }}
        />
        {value.partsOpen ? (
          <AddressDetailsFields
            parts={value.parts}
            onChange={(parts) => onChange({ parts })}
            onEditEnd={onCommit}
            noCopy={noCopy}
          />
        ) : null}
      </SectionCard>

      {/* ЗАМЕТКА — ПОЛЕМ-ПОДЛОЖКОЙ. Тот же вид, что у заметок на странице
          записи; поле открыто сразу, без кнопки «добавить». */}
      <SectionCard dense title="Заметка">
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 }}>
          <TextInput
            value={value.note}
            onChangeText={(v) => onChange({ note: v })}
            onBlur={onCommit}
            contextMenuHidden={noCopy}
            multiline
            accessibilityLabel="Заметка объекта"
            // ПОДСКАЗКА НАЗЫВАЕТ ПОЛЕ, А НЕ ОБЪЯСНЯЕТ ПРИМЕРОМ. Пример «как
            // войти, код, кто встречает…» читался бы как уже введённый текст.
            // В записи это поле подписано так же.
            placeholder="Заметка объекта"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            maxFontSizeMultiplier={1.2}
            style={{
              // РАСТЁТ ПОД ТЕКСТ, А НЕ СКРОЛЛИТСЯ В СЕБЕ:
              // при `maxHeight` длинная заметка про вход пряталась во
              // внутреннюю прокрутку, и на листе оказывалось два скролла один
              // в другом.
              minHeight: 44,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: t.radius.input,
              backgroundColor: t.fill,
              fontSize: 15,
              color: t.ink,
            }}
          />
        </View>
      </SectionCard>

    </>
  );
}
