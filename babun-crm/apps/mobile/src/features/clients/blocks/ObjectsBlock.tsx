import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { AddRow, RowGroup } from "@/components/ui/card-rows";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { objectTarget } from "@/features/clients/object-address";
import { useThemeColors } from "@/theme/colors";

// ОБЪЕКТЫ на карточке клиента.
//
// Владелец 2026-07-27: «первая строчка — не пишешь „тип объекта", а просто:
// я выбрал дом — значит Дом; потом чёткая адресная ссылка и чётко заметка.
// Всё кратенько в три строчки. И небольшая кнопка навигации: нажимаю —
// вылазит снизу шторка, и оно определяет Google, Waze, Яндекс».
//
// Поэтому строка объекта — не «ярлык · значение», а КАРТОЧКА АДРЕСА в три
// строки: что это → куда ехать → как войти. Тип идёт сам по себе (он и есть
// имя объекта), адрес крупнее заметки, заметка последняя и тише.
//
// Два действия в строке и ни одного лишнего: тап по строке открывает объект
// (шеврон это и обещает), кнопка маршрута — едет. Зазор между ними 12 и слоп
// только вправо: у соседней пары «связь / убрать номер» именно смыкание зон
// приводило к тому, что палец делал не то, во что целился.

export default function ObjectsBlock({
  client,
  onOpen,
  onAdd,
}: {
  client: Client;
  /** Открыть страницу объекта — навигацию держит карточка (в черновике она
   *  сначала сохраняет клиента: страница читает его по id). */
  onOpen: (locId: string) => void;
  /** Открыть лист добавления. Работает и в черновике: объект пишется в тот же
   *  черновик, поэтому пригашать строку больше не нужно. */
  onAdd: () => void;
}) {
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
        <ObjectRow
          key={loc.id}
          loc={loc}
          separated={i > 0}
          onPress={() => onOpen(loc.id)}
        />
      ))}
      {/* Пустого состояния нет: при нуле объектов группа — одна эта строка.
          Добавление открывается ЛИСТОМ снизу (владелец 2026-07-27), а не
          страницей: три поля не стоят экрана поверх экрана, и объектов подряд
          заводят несколько. */}
      <AddRow
        label="+ Добавить объект"
        separated={ordered.length > 0}
        onPress={onAdd}
      />
    </RowGroup>
  );
}

function ObjectRow({
  loc,
  separated,
  onPress,
}: {
  loc: Location;
  separated?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const target = objectTarget(loc);
  const note = (loc.note ?? "").trim();

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
        accessibilityHint="Открывает объект"
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
          {note ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 12, color: t.sub }}
            >
              {note}
            </Text>
          ) : null}
        </View>
        <ChevronRight color={t.chevron} size={17} strokeWidth={2.2} />
      </Pressable>

      {/* Маршрут — отдельное действие над адресом этой строки; шторка выбора
          карты приезжает снизу (chooseOption → канонический лист). */}
      <ObjectRouteButton
        mapUrl={loc.mapUrl}
        address={loc.address}
        label={loc.label}
      />
    </View>
  );
}
