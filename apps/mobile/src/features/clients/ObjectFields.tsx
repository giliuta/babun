import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MapPinned, Send, Settings2 } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { ChoiceRow, FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { MapPicker } from "@/features/clients/MapPicker";
import {
  formatCoords,
  googleMapsSearchUrl,
  type Coords,
} from "@/features/clients/location-request-form";
import {
  AddressDetailsFields,
  AddressDetailsToggle,
} from "@/features/clients/AddressPartsFields";
import {
  composeAddress,
  composeDetails,
  hasAddressPlace,
} from "@/features/clients/object-address";
import { geocodeAddress } from "@/features/clients/geocode";
import { isLikelyUrl, parseAddress } from "@babun/shared/common/utils/map-links";
import { snapObjectType, useFrozenObjectTypes } from "@/features/clients/object-types";
import { useClients } from "@/features/clients/queries";
import { useLocationLabels } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТЕЛО ФОРМЫ ОБЪЕКТА — ОДНО НА СОЗДАНИЕ И НА ПРАВКУ (владелец 2026-09-10:
// «если я показываю в одном месте, значит то же самое будет показывать в
// другом месте, мне не надо разные дизайны»).
//
// До этого объект имели ДВЕ формы: `ObjectSheet` (добавить) и
// `ObjectEditSheet` (править). Они и разошлись, как расходится всякая копия:
// добавление переехало на `SectionCard`, получило блок «Тип объекта» своей
// карточкой, карту и «Попросить адрес у клиента», — а правка осталась на
// `RowGroup` с типом строкой внутри группы и вообще без карты. Один и тот же
// объект выглядел двумя разными продуктами в зависимости от того, заводят его
// или чинят.
//
// Теперь блоки живут здесь, а листы — тонкие двери со своим способом записи:
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
 *  базу (владелец 2026-07-27: «нажимаю офис — перекладывает на виллу»). */
export function useObjectTypeOptions(current: string | undefined): string[] {
  const { data: allClients = [] } = useClients();
  const { data: labelPresets = [] } = useLocationLabels();
  const presetNames = useMemo(
    () => labelPresets.map((preset) => preset.name),
    [labelPresets],
  );
  return useFrozenObjectTypes(allClients, presetNames, current);
}

export function ObjectFields({
  value,
  typeOptions,
  onChange,
  onTypeSettings,
  onRequestFromClient,
  onCommit,
}: {
  value: ObjectFieldsValue;
  typeOptions: string[];
  /** Частичная правка значения — владеет им тот лист, который его открыл. */
  onChange: (patch: Partial<ObjectFieldsValue>) => void;
  /** Шестерёнка блока «Тип объекта»: закрыть лист и уйти в настройки типов —
   *  страница настроек не может жить под нижним листом. */
  onTypeSettings: () => void;
  /** «Попросить адрес у клиента» (STORY-077). Нет — иконки нет: черновик
   *  клиента и роль мастера ссылку не выписывают. */
  onRequestFromClient?: () => void;
  /** Уход с поля. Правка пишет объект сразу; создание молчит — там всё
   *  уезжает одной кнопкой. */
  onCommit?: () => void;
}) {
  const t = useThemeColors();
  /** Раскрыта ли карта под адресом. */
  const [mapOpen, setMapOpen] = useState(false);
  /** Куда переехать карте: адрес словами, найденный геокодером. */
  const [found, setFound] = useState<Coords | null>(null);

  // АДРЕС СЛОВАМИ ВЕДЁТ КАРТУ (владелец 2026-09-10: «когда я вписываю точный
  // адрес, хочу, чтобы он отображался на этой мини-карте — убедиться, что это
  // точный адрес»). Ищем только пока карта раскрыта и не чаще раза в 800 мс
  // после последней буквы: служба чужая и бесплатная. Ссылку не геокодируем —
  // у неё координаты уже внутри.
  const geoQuery = mapOpen
    ? hasAddressPlace(value.parts)
      ? composeAddress(value.parts, { forRoute: true })
      : isLikelyUrl(value.target.trim())
        ? ""
        : value.target.trim()
    : "";
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
      <SectionCard
        title="Тип объекта"
        action={{
          label: "Настроить типы объектов",
          icon: Settings2,
          onPress: onTypeSettings,
        }}
      >
        <ChoiceRow
          options={typeOptions}
          value={value.type}
          onSelect={(v) => onChange({ type: snapObjectType(v, typeOptions) })}
        />
      </SectionCard>

      <SectionCard
        title="Адрес"
        action={[
          {
            // ТОЧКА НА КАРТЕ — СВОЙ ЛИСТ, А НЕ УХОД В GOOGLE MAPS (владелец
            // 2026-09-10). Вернуть выбранную точку из чужого приложения
            // нельзя: ни у Google, ни у Apple нет режима «выбери и вернись» —
            // их URL-схемы односторонние. Поэтому карта своя.
            label: "Выбрать точку на карте",
            icon: MapPinned,
            onPress: () => setMapOpen((v) => !v),
          },
          ...(onRequestFromClient
            ? [
                {
                  label: "Попросить адрес у клиента",
                  icon: Send,
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
          value={value.target}
          placeholder="Улица и дом или ссылка на карту"
          stacked
          multiline
          live
          onSave={(v) => onChange({ target: v })}
          onEditEnd={onCommit}
        />

        {/* КАРТА РАСКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, ПОД АДРЕСОМ: два модальных листа в
            один кадр iOS не показывает. Точка ставится в центре и применяется
            на каждое движение — «Готово» только сворачивает блок.

            КУДА ЗАПИСЫВАЕТСЯ: точка уходит в пин, а главная строка остаётся
            свободной для человеческого адреса. Раньше в поле «Адрес»
            тянулась голая ссылка Google Maps — ровно на это ругался разбор
            ссылок 2026-07-26. */}
        {mapOpen ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <MapPicker
              value={pinCoords ?? coordsOf(value.target)}
              follow={found}
              // Точка НЕ коммитится в том же кадре: в режиме правки значение
              // ещё не доехало до состояния, и запись ушла бы с прежним пином.
              // Её запишет следующая точка коммита — уход с поля, «Применить»
              // или закрытие листа, как и у полей «Точного адреса».
              onChange={(coords) => onChange({ pin: googleMapsSearchUrl(coords) })}
            />
            {pinCoords ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: t.sub,
                  textAlign: "center",
                }}
              >
                {`Точка отмечена · ${formatCoords(pinCoords)}`}
              </Text>
            ) : null}
            <Pressable
              onPress={() => {
                haptics.tap();
                setMapOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Свернуть карту"
              style={({ pressed }) => ({
                minHeight: 40,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: t.accent }}>
                Готово
              </Text>
            </Pressable>
          </View>
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
            pin={value.pin}
            onPinChange={(pin) => onChange({ pin })}
            onPinEditEnd={onCommit}
            showPin={!isLikelyUrl(value.target.trim())}
          />
        ) : null}
      </SectionCard>

      {/* ЗАМЕТКА — ПОЛЕМ-ПОДЛОЖКОЙ (владелец 2026-09-07: «мне нравились старые
          заметки»). Тот же вид, что у заметок на странице записи; поле открыто
          сразу, без кнопки «добавить» (владелец 2026-09-04). */}
      <SectionCard title="Заметка">
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 }}>
          <TextInput
            value={value.note}
            onChangeText={(v) => onChange({ note: v })}
            onBlur={onCommit}
            multiline
            accessibilityLabel="Заметка объекта"
            // ПОДСКАЗКА НАЗЫВАЕТ ПОЛЕ, А НЕ ОБЪЯСНЯЕТ ПРИМЕРОМ (владелец
            // 2026-09-10: «тут должно быть „заметка", а внизу — „заметка
            // объекта"»). Пример «как войти, код, кто встречает…» читался как
            // уже введённый текст. В записи это поле давно подписано так же —
            // лист объекта был единственным местом с примером.
            placeholder="Заметка объекта"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            maxFontSizeMultiplier={1.2}
            style={{
              // РАСТЁТ ПОД ТЕКСТ, А НЕ СКРОЛЛИТСЯ В СЕБЕ (аудит 2026-09-09):
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

/** Координаты из строки-ссылки, если они в ней есть: с них открывается карта,
 *  когда точку ставят повторно. */
export function coordsOf(value: string): Coords | null {
  const raw = value.trim();
  if (!raw) return null;
  return parseAddress(raw).coords ?? null;
}
