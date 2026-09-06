import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { RowGroup } from "@/components/ui/card-rows";
import { AddRow } from "@/components/ui/AddRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { objectTarget, routeAddress } from "@/features/clients/object-address";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// ОБЪЕКТЫ на карточке клиента.
//
// Владелец 2026-07-27: «первая строчка — не пишешь „тип объекта", а просто:
// я выбрал дом — значит Дом; потом чёткая адресная ссылка и чётко заметка.
// Всё кратенько в три строчки. И небольшая кнопка навигации: нажимаю —
// вылазит снизу шторка, и оно определяет Google, Waze, Яндекс».
//
// Поэтому строка объекта — не «ярлык · значение», а КАРТОЧКА АДРЕСА в три
// строки: что это → куда ехать → когда снова и как войти. Тип идёт сам по
// себе (он и есть имя объекта), адрес крупнее, третья строка делится между
// сроком обслуживания и заметкой через «·» — четвёртый этаж поднимал строку
// до ~86pt и ломал ритм списка.
//
// Тап по строке ОТКРЫВАЕТ ЛИСТ ПРАВКИ, а не страницу (владелец 2026-08-06:
// «отдельная страница объекта вообще не открывается… если нажимаешь —
// вылазит менюшка по поводу редактирования»). Шеврона поэтому нет: он обещал
// бы этаж навигации, которого больше не существует.
//
// Удаление — СМАХНУТЬ ВЛЕВО (тот же жест, что у номеров в Контактах). Кнопки
// удаления в строке нет: она занимала бы место всегда и смыкалась зоной с
// кнопкой маршрута — именно так палец однажды делал не то, во что целился.

export default function ObjectsBlock({
  client,
  onOpen,
  onDelete,
  onAdd,
}: {
  client: Client;
  /** Открыть лист правки этого объекта. */
  onOpen: (locId: string) => void;
  /** Удалить объект (спрашивает подтверждение сама карточка). */
  onDelete: (loc: Location) => void;
  /** Открыть лист добавления. Работает и в черновике: объект пишется в тот же
   *  черновик, поэтому пригашать строку больше не нужно. */
  onAdd: () => void;
}) {
  const t = useThemeColors();
  // Основной первым: при записи подставляется он, и в списке он должен
  // читаться первым. Бейджа «основной» нет — порядок и есть признак.
  const ordered = useMemo(
    () =>
      [...(client.locations ?? [])].sort(
        (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
      ),
    [client.locations],
  );

  return (
    <RowGroup title="Объекты">
      {ordered.map((loc, i) => (
        <SwipeRow
          key={loc.id}
          label="Удалить"
          color={t.danger}
          onAction={() => onDelete(loc)}
          accessibilityLabel={`Удалить объект ${loc.label || ""}`.trim()}
        >
          <ObjectRow
            loc={loc}
            separated={i > 0}
            onPress={() => onOpen(loc.id)}
          />
        </SwipeRow>
      ))}
      {/* Пустого состояния нет: при нуле объектов группа — одна эта строка.
          Добавление открывается ЛИСТОМ снизу (владелец 2026-07-27), а не
          страницей: три поля не стоят экрана поверх экрана, и объектов подряд
          заводят несколько. */}
      <AddRow
        label="Добавить объект"
        separated={ordered.length > 0}
        onPress={onAdd}
      />
    </RowGroup>
  );
}

// СТРОКА ОБЪЕКТА ОТКРЫТА НАРУЖУ (2026-08-31). Форма записи показывала объекты
// клиента ЧИПАМИ — одно слово в пилюле, без адреса, без срока ТО, без заметки.
// Владелец: «блок объекта должен быть такой же, как в клиентах». Не похожий —
// ТОТ ЖЕ: скопированная карточка адреса разошлась бы с оригиналом на первой же
// правке, как разошлись две формы записи.
export function ObjectRow({
  loc,
  separated,
  onMore,
  showNote = true,
  onPress,
}: {
  loc: Location;
  separated?: boolean;
  /** Кружок «…» в хвосте строки — правка ЭТОГО объекта (форма записи, где
   *  сам тап по строке меняет объект). Стрелки справа нет нигде: владелец
   *  2026-09-04 — «эти стрелочки убираем, ставим красивую иконку, при тапе на
   *  неё открывается редактирование объекта». На карточке клиента правку
   *  открывает сам тап, и кружка там нет. */
  onMore?: () => void;
  /** Заметка третьей строкой. Запись выключает: у неё заметка объекта стоит
   *  своей плашкой под строкой, и третья строка дублировала бы её. */
  showNote?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const target = objectTarget(loc);
  const note = showNote ? (loc.note ?? "").trim() : "";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        minHeight: 60,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={[loc.label || "Объект", target, note]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint={
          onMore ? "Открывает выбор объекта" : "Открывает правку объекта"
        }
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            {loc.label || "Объект"}
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 13,
              color: target ? t.body : t.faint,
            }}
          >
            {target || "адрес не указан"}
          </Text>
          {/* ТРЕТЬЯ СТРОКА — ЗАМЕТКА («код домофона»). Срок обслуживания делил
              её через «·», пока у объекта был интервал; сам интервал снесён
              2026-09-04 (владелец: «сделаем лучше в напоминаниях»). */}
          {note ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {note}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {/* Маршрут — отдельное действие над адресом этой строки; шторка выбора
          карты приезжает снизу (chooseOption → канонический лист). */}
      <ObjectRouteButton
        mapUrl={loc.mapUrl}
        // Объект с частями едет по геокодируемой части адреса: подъезд, этаж и
        // квартира карте только мешают.
        address={routeAddress(loc)}
        label={loc.label}
      />

      {/* Правка объекта — кружок в хвосте, СНАРУЖИ нажимаемой области строки
          (иначе VoiceOver склеит их в один элемент). */}
      {onMore ? (
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel={`Правка объекта ${loc.label || "Объект"}`}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            backgroundColor: t.rowFill,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <MoreHorizontal color={t.body} size={ICON.sm} />
        </Pressable>
      ) : null}
    </View>
  );
}
