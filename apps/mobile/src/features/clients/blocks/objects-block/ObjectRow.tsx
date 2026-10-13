import { Pressable, Text, View } from "react-native";
import { House, MoreHorizontal, Star, Tag, UserRound } from "lucide-react-native";
import type { Location } from "@babun/shared/local/clients";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { addressLines, objectTarget, routeAddress } from "@/features/clients/object-address";
import { formatShortDateRu } from "@/features/clients/format";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { PICKER_RADIUS } from "@/components/ui/picker-grid";
import { useLocationLabels } from "@/features/settings/local-settings";
import { findObjectType } from "@/features/clients/object-types";

// The object row of `ObjectsBlock` — also used by the booking form, invoices,
// documents and rights previews (they import it through `ObjectsBlock`).

/** Плитка объекта — того же размера, что плитка записи в «Истории»
 *  (`SelectRow`, 28): рядом на карточке они не должны различаться
 *  (владелец 03.10: «значки отличаются прям»). */
const OBJECT_TILE = 28;

/** ПЛИТКА ТИПА ОБЪЕКТА — ТА ЖЕ, ЧТО У ТИПА В ЛИСТЕ ОБЪЕКТА (владелец 03.10:
 *  «иконка и цвет от типа объекта переходят сюда полноценно»). Правило
 *  блока «Тип объекта» (`ObjectFields`): цвет типа, а без него акцент;
 *  значок типа, а без него ярлык. Тип не выбран — светлый домик. */
function ObjectTypeTile({ typed, color, icon }: { typed: boolean; color?: string | null; icon?: string | null }) {
  const t = useThemeColors();
  if (typed) {
    return <AppearanceTile color={color ?? t.accent} icon={icon ?? null} fallback={Tag} size={OBJECT_TILE} />;
  }
  return (
    <View
      style={{
        // Та же геометрия, что у `AppearanceTile` (владелец 03.10: домик
        // «отличается размером — не очень аккуратно»): радиус и глиф 56 %.
        width: OBJECT_TILE,
        height: OBJECT_TILE,
        borderRadius: PICKER_RADIUS,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.accent}14`,
      }}
    >
      <House color={t.accent} size={Math.round(OBJECT_TILE * 0.56)} strokeWidth={2} />
    </View>
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
  residents,
  lastVisit,
  onPress,
  onLongPress,
  longPressLabel,
  pressHint,
  primary = false,
  teamId = null,
}: {
  loc: Location;
  separated?: boolean;
  /** Что делает тап — для VoiceOver, когда это не правка (карточка клиента:
   *  тап по объекту открывает страницу всех). */
  pressHint?: string;
  /** Звёздочка у адреса — это основной объект, его подставит запись
   *  (владелец 03.10). Ставят только там, где объектов несколько: у
   *  единственного звезда ничего не различает. */
  primary?: boolean;
  /** Кружок «…» в хвосте строки — правка ЭТОГО объекта (форма записи, где
   *  сам тап по строке меняет объект). Стрелки справа нет нигде: владелец
   *  2026-09-04 — «эти стрелочки убираем, ставим красивую иконку, при тапе на
   *  неё открывается редактирование объекта». На карточке клиента правку
   *  открывает сам тап, и кружка там нет. */
  onMore?: () => void;
  /** Заметка третьей строкой. Запись выключает: у неё заметка объекта стоит
   *  своей плашкой под строкой, и третья строка дублировала бы её. */
  showNote?: boolean;
  /** Жильцы объекта одной строкой — «Мария Спиру · жилец, Андреас · жилец».
   *  Четвёртый этаж строки, со значком человека: без него перечень имён
   *  читался бы продолжением заметки. */
  residents?: string;
  /** Последний визит на объект, YYYY-MM-DD. Печатается «был 12 авг» в той же
   *  третьей строке, что заметка, — не четвёртым этажом. */
  lastVisit?: string;
  /** Нет — строка только читается (STORY-084: в записи объект человеку не
   *  меняется). Маршрут при этом остаётся: это дорога, а не правка. */
  onPress?: () => void;
  /** Долгое нажатие по строке — на карточке клиента копирует адрес; в записи
   *  и инвойсе — правка объекта (владелец 03.10: «три точки убираем…
   *  редактирование — задержать»). */
  onLongPress?: () => void;
  /** Что делает удержание — словами для VoiceOver («Правка объекта»): тогда
   *  подсказка называет оба жеста и есть действие удержания. Нет — как было. */
  longPressLabel?: string;
  /** Команда клиента — её «Карты для маршрута» (у каждой команды свои). */
  teamId?: string | null;
}) {
  const t = useThemeColors();
  const target = objectTarget(loc);
  // ТИП ОБЪЕКТА — ТОЛЬКО ЗНАЧКОМ (владелец 03.10: «слово не пишем — тип
  // обозначает иконка: цвет и значок из „Типов объектов“; типа нет — домик»).
  const { data: labelPresets = [] } = useLocationLabels(teamId);
  // Тип — только из справочника команды (владелец 03.10: типы каждый
  // заводит сам). Метка удалённого типа объект не красит: он без типа.
  const type = findObjectType(labelPresets, loc.label);
  const typed = !!type;
  // Адрес двумя строками: улица и дом — чёрным, уточнение — мелко серым.
  const lines = addressLines(loc);
  // ТИП СЛОВОМ — ПЕРВЫМ ВО ВТОРОЙ СТРОКЕ (владелец 03.10, вторым заходом:
  // «тип объекта всё-таки надо где-то писать словами — полезная функция»).
  // Плитка слева говорит цветом и значком, слово — «Офис · подъезд 4 ·
  // эт. 3»; своей строки ему не дали — строка объекта не растёт.
  const typeWord = type ? type.name : "";
  const note = showNote ? (loc.note ?? "").trim() : "";
  const people = (residents ?? "").trim();
  // «БЫЛ 12 АВГ» ДЕЛИТ ТРЕТЬЮ СТРОКУ С ЗАМЕТКОЙ через «·» — формат тот же,
  // что «был 30 мая» в сводке. Дата ПЕРВОЙ: строка одна и режется хвостом,
  // короткая дата должна уцелеть, а длинная заметка — обрезаться.
  const visited = lastVisit ? `был ${formatShortDateRu(lastVisit)}` : "";
  const thirdLine = [visited, note].filter(Boolean).join(" · ");

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
        onLongPress={onLongPress}
        disabled={!onPress && !onLongPress}
        accessible
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={[
          type?.name || "Объект",
          primary ? "основной" : "",
          target,
          visited,
          note,
          // Перечень имён без слова «жильцы» VoiceOver прочитал бы как
          // продолжение заметки: значок он не озвучивает.
          people ? `Жильцы: ${people}` : "",
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint={
          longPressLabel && onPress
            ? `Открывает выбор объекта; удерживайте — ${longPressLabel.toLowerCase()}`
            : !onPress
              ? undefined
              : pressHint
                ? pressHint
                : onMore
                ? "Открывает выбор объекта"
                : "Открывает правку объекта"
        }
        accessibilityActions={
          longPressLabel && onLongPress ? [{ name: "longpress", label: longPressLabel }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "longpress") onLongPress?.();
        }}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed && onPress ? 0.6 : 1,
        })}
      >
        <View style={{ marginRight: 4 }}>
          <ObjectTypeTile typed={typed} color={type?.color} icon={type?.icon} />
        </View>
        <View style={{ flex: 1 }}>
          {/* АДРЕС — ГЛАВНАЯ СТРОКА (владелец 03.10): едут по адресу, тип
              объекта говорит плитка слева. Улица и дом — чёрным, точный адрес
              (комплекс, подъезд, этаж, квартира, город) — под ним мелко серым. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontSize: 15,
                fontWeight: lines.main ? "500" : "400",
                color: lines.main ? t.ink : t.faint,
              }}
            >
              {lines.main || "адрес не указан"}
            </Text>
            {primary ? (
              <Star
                color={t.accent}
                fill={t.accent}
                size={12}
                strokeWidth={2}
              />
            ) : null}
          </View>
          {typeWord || lines.detail ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {typeWord ? (
                <Text style={{ fontWeight: "600", color: t.body }}>{typeWord}</Text>
              ) : null}
              {typeWord && lines.detail ? " · " : ""}
              {lines.detail}
            </Text>
          ) : null}
          {/* ТРЕТЬЯ СТРОКА — «был 12 авг · код домофона». Срок обслуживания
              делил её через «·», пока у объекта был интервал; сам интервал
              снесён 2026-09-04 (владелец: «сделаем лучше в напоминаниях»).
              Нет заметки — строка из одной даты; нет обоих — строки нет. */}
          {thirdLine ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {thirdLine}
            </Text>
          ) : null}
          {people ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <UserRound color={t.faint} size={12} strokeWidth={2.2} />
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 13, color: t.sub }}
              >
                {people}
              </Text>
            </View>
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
        teamId={teamId}
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
