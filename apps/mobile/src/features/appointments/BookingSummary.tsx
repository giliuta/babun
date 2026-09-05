import {
  Pressable,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { AlertTriangle, ChevronRight, MapPin, Users } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { durationLabel } from "@/features/services/format";
import { tintOver } from "@/components/ui/color-contrast";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

// СТЕППЕР СО СТРЕЛКАМИ СНЕСЁН 2026-09-04. Количество услуги набирают ТАПАМИ
// по строке в списке услуг, а сама запись печатает его оттиском «×3»
// (`QtyBadge`): владелец, сравнив четыре варианта на экране рядом, выбрал
// этот — «стрелочки вверх-вниз можно сделать красивее и статичнее».

// ИТОГ — СТРОКА-ДВЕРЬ В ЛИСТ ДЕНЕГ (владелец 2026-09-04: «когда я открываю
// „Итого“, открывается снизу вверх шторка, где прописаны каждая услуга,
// количество их, и там уже можно редактировать… там же можно делать скидки»).
//
// Раньше это было поле прямо в строке: сумму правили между списком услуг и
// предоплатой, а из чего она сложилась — видно не было, и скидку поставить
// было нечем. Поле переехало в лист вместе с услугами и скидкой; здесь
// осталась строка того же диалекта, что клиент, объект и время.
export function TotalRow({
  total,
  custom,
  discountAmount,
  discountReason,
  onPress,
}: {
  total: number;
  /** Сумму перебили рукой — «Итого» перестало следовать за услугами. */
  custom: boolean;
  discountAmount: number;
  discountReason: string | null;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const note =
    discountAmount > 0
      ? `Скидка${discountReason ? ` · ${discountReason}` : ""} −${formatEURExact(discountAmount)}`
      : custom
        ? "Сумма вписана рукой"
        : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Итого ${formatEURExact(total)}${note ? `, ${note}` : ""}`}
      accessibilityHint="Открывает услуги, количество и скидку"
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>Итого</Text>
        {note ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
            {note}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontSize: 17,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatEURExact(total)}
      </Text>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}

// ЦВЕТ ЗАПИСИ ПОДСВЕЧИВАЕТ ВСЮ ШАПКУ (владелец 2026-09-05: «хочу, чтоб блок
// автоматически подсвечивался этим цветом; выбрал „Автоматически“ — значит
// тем, который сейчас действует»). Раньше выбранный цвет жил только в хроме
// экрана и в кнопке — самой записи он не касался, и «Цвет» читался как
// настройка неизвестно чего. Теперь три карточки шапки — это и есть цвет
// записи: у неё он всегда есть, выбранный руками или взятый у команды.
const TINT = 0.1;

// ДВА БЛОКА ВМЕСТО ОДНОГО (владелец 2026-09-04: «мы можем по сути совместить
// команду и метку в одно, а время поставить блоком ниже — так будет лучше»).
//
// Верхний блок отвечает на «КТО и ГДЕ»: команда с мастером и метка этого
// выезда — две зоны тапа в одной карточке, разделённые волоском. Нижний — на
// «КОГДА»: дата, начало и длительность во всю ширину, и под ним единственная
// янтарная строка предупреждения (пересечение, вне графика, буфер).
//
// Раньше это была одна строка «команда · когда», а метка стояла третьей
// карточкой ниже — три разных предмета в трёх местах. Теперь порядок читается
// сверху вниз: кто едет и куда, когда, к кому, на какой объект.


export function TeamLabelRow({
  teamName,
  teamColor,
  masterName,
  label,
  labelColor,
  labelFromDay,
  identity,
  showLabel,
  onEditTeam,
  onEditLabel,
}: {
  teamName: string;
  teamColor: string;
  masterName?: string | null;
  /** Метка этого выезда: своя либо унаследованная у дня. */
  label: string | null;
  labelColor?: string | null;
  /** Метка не своя, а взята у дня — читается тише, чтобы отличать. */
  labelFromDay?: boolean;
  /** Цвет ЗАПИСИ: выбранный руками либо тот, что действует автоматически. */
  identity: string;
  /** Бизнес не пользуется метками — тогда команда занимает всю строку. */
  showLabel: boolean;
  onEditTeam: () => void;
  onEditLabel: () => void;
}) {
  const t = useThemeColors();
  return (
    // ДВА ПОЛНОЦЕННЫХ БЛОКА, А НЕ ОДИН СО ШВОМ (владелец 2026-09-04:
    // «раздели не волосиной между командой и меткой, а раздели полноценные
    // блоки»). Волосок делил карточку на две половинки одного предмета, а
    // команда и метка — предметы разные: кто едет и куда. Рядом они стоят
    // потому, что отвечают на один вопрос и вместе занимают одну строку
    // экрана.
    <View className="mx-4 mt-2" style={{ flexDirection: "row", gap: 8 }}>
      <IdentityCard
        icon={Users}
        color={teamColor}
        tint={identity}
        title={teamName}
        sub={masterName ?? undefined}
        onPress={onEditTeam}
        accessibilityLabel={`Команда: ${teamName}${masterName ? `, мастер ${masterName}` : ""}`}
        accessibilityHint="Открывает выбор команды и мастера"
      />
      {showLabel ? (
      <IdentityCard
        icon={MapPin}
        color={label ? (labelColor ?? t.accent) : t.faint}
        tint={identity}
        title={label ?? "Метка"}
        muted={!label}
        quiet={!!label && !!labelFromDay}
        onPress={onEditLabel}
        accessibilityLabel={
          label
            ? `Метка: ${label}${labelFromDay ? ", как у дня" : ""}`
            : "Метка не выбрана"
        }
        accessibilityHint="Открывает выбор метки"
      />
      ) : null}
    </View>
  );
}

/** Блок «кто» или «куда»: кружок со значком в цвете сущности и значение рядом.
 *
 *  ЦВЕТ ПЕРЕЕХАЛ ИЗ КОРЕШКА В КРУЖОК (владелец 2026-09-04: «вроде неплохо, но
 *  что-то оно как-то отпугивает»). Отпугивала именно полоска: яркая вертикаль,
 *  прижатая к левому краю маленькой карточки, читается как маркер тревоги —
 *  такими в списках метят «ошибка» и «непрочитанное», — и была самым громким
 *  пятном страницы. Тот же цвет в кружке под значком звучит спокойно и говорит
 *  ровно то же; тем же приёмом набраны строки в листе метки, который владелец
 *  уже одобрил.
 *
 *  Шеврона нет (владелец 2026-09-04: «убери справа эти стрелочки») — вся
 *  карточка и есть кнопка. */
function IdentityCard({
  icon: Icon,
  color,
  tint,
  title,
  sub,
  muted,
  quiet,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  icon: LucideIcon;
  color: string;
  /** Цвет записи: им подсвечена вся карточка. */
  tint: string;
  title: string;
  sub?: string;
  /** Значения ещё нет — «Метка» вместо имени метки. */
  muted?: boolean;
  /** Значение не своё, а взятое у дня: тише, но на том же месте. */
  quiet?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
}) {
  const t = useThemeColors();
  const bg = tintOver(tint, t.surface, TINT);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: t.radius.card,
        backgroundColor: pressed ? tintOver(tint, t.surface, TINT * 2.2) : bg,
        boxShadow: t.cardShadow,
      })}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${color}1f`,
        }}
      >
        <Icon color={color} size={15} strokeWidth={2.2} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: muted ? t.placeholder : quiet ? t.body : t.ink,
          }}
        >
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function WhenRow({
  date,
  timeStart,
  timeEnd,
  duration,
  allDay,
  warning,
  identity,
  onPress,
}: {
  date: string;
  timeStart: string;
  timeEnd: string;
  duration: number;
  allDay?: boolean;
  warning?: string | null;
  /** Цвет записи: им подсвечена карточка, как у команды и метки. */
  identity: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <View className="mx-4 mt-2">
      <View
        style={{
          flexDirection: "row",
          alignItems: "stretch",
          backgroundColor: tintOver(identity, t.surface, TINT),
          borderRadius: t.radius.card,
          boxShadow: t.cardShadow,
          overflow: "hidden",
        }}
      >
        {/* У ВРЕМЕНИ НЕТ СВОЕГО ЦВЕТА (владелец 2026-09-04: «убери синенькую плашку
            с времени, она там не нужна — у времени нет цвета»). Цветной
            корешок называет ЧЕЙ выезд; час дня ничей, и полоска рядом с ним
            только притворялась значащей. */}
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: pressed
              ? tintOver(identity, t.surface, TINT * 2.2)
              : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel={`Дата и время: ${humanDay(date)}, ${allDay ? "весь день" : `с ${timeStart} до ${timeEnd}, ${durationLabel(duration)}`}`}
          accessibilityHint="Открывает выбор даты и времени"
        >
          {/* ОДНОЙ СТРОКОЙ: ДЕНЬ · ВРЕМЯ · ДЛИТЕЛЬНОСТЬ (владелец 2026-09-04:
              «первое — суббота 19 сентября, потом время, потом длительность;
              не сверху мелким шрифтом, а красиво всё в строчку, чтоб это
              нормально анализировалось»). Дата стояла надстрочной подписью
              12-м кеглем — читалась как служебная пометка, хотя это первое,
              что спрашивают о записи. Теперь три величины идут слева направо
              в порядке вопроса «когда»: какой день, во сколько, насколько.
              Время держит вес: его ищут глазами. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {humanDay(date)}
            </Text>
            <Text style={{ fontSize: 15, color: t.separator }}>·</Text>
            {allDay ? (
              <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
                весь день
              </Text>
            ) : (
              <>
                {/* НАЧАЛО И КОНЕЦ, ПОТОМ ДЛИТЕЛЬНОСТЬ (владелец 2026-09-04:
                    «поставим начало и конец — 11:00 – 11:30, — а ещё
                    длительность; так будет ещё круче»). Одно число отвечало
                    только на «во сколько приезжать»; пара отвечает и на «когда
                    освободимся», а длительность остаётся третьей величиной —
                    её считают услуги. */}
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {`${timeStart} – ${timeEnd}`}
                </Text>
                {/* ДЛИТЕЛЬНОСТЬ — ТИХОЙ ПИЛЮЛЕЙ: третья величина в строке
                    спорила с первыми двумя одинаковым весом, а она СЛЕДСТВИЕ
                    начала и конца. Серая подложка отделяет её от времени лучше
                    точки и делает строку ритмичной, а не сплошной. */}
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: t.radius.pill,
                    backgroundColor: t.fill,
                  }}
                >
                  <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub }}>
                    {durationLabel(duration)}
                  </Text>
                </View>
              </>
            )}
          </View>
        </Pressable>
      </View>

      {warning ? (
        <View
          className="mt-2 flex-row items-center gap-2 rounded-[10px] px-3 py-2.5"
          style={{ backgroundColor: `${t.warning}14`, borderWidth: 1, borderColor: `${t.warning}33` }}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          <AlertTriangle color={t.warning} size={ICON.sm} />
          <Text style={{ fontSize: 13, fontWeight: "500", color: t.warning, flex: 1 }}>
            {warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
