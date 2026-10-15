import {
  Pressable,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { Bookmark, Users } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { useThemeColors } from "@/theme/colors";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { Card } from "@/components/ui/Card";

/** Плитка выбранного — того же размера, что плитка строки шторки (`TILE` в
 *  `select-rows`): при 28 `AppearanceTile` рисует и глиф того же размера, 16.
 *  Число сверяет `select-sheet-contract.test.ts`. */
const CHOSEN_TILE = 28;

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

// КАРТОЧКИ ШАПКИ БЕЛЫЕ, КАК ВСЕ БЛОКИ ФОРМЫ: эти блоки не окрашиваются, они
// такие же белые, как клиент и объект. Подсветка цветом записи живёт у
// подложки, шапки, halo и кружка «Цвет», а карточки стоят в одном ряду с
// остальными: один предмет — одна поверхность, `Card`.

// ДВА БЛОКА ВМЕСТО ОДНОГО: команда и метка вместе, время — блоком ниже.
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
  teamIcon = Users,
  masterName,
  label,
  labelColor,
  labelFromDay,
  showLabel,
  labelIcon,
  labelPlaceholder,
  onEditTeam,
  onEditLabel,
}: {
  teamName: string;
  teamColor: string;
  /** Глиф плитки команды — ТОТ ЖЕ, что у строки в шторке команды: `Users` у
   *  команды, `UserRound` у «Личного» события: выбранное показывается так же,
   *  как в шторке — иначе шторка рисует «Личное» человеком, а плитка людьми. */
  teamIcon?: LucideIcon;
  masterName?: string | null;
  /** Метка этого выезда: своя либо унаследованная у дня. */
  label: string | null;
  labelColor?: string | null;
  /** Метка не своя, а взята у дня — читается тише, чтобы отличать. */
  labelFromDay?: boolean;
  /** Бизнес не пользуется метками — тогда команда занимает всю строку. */
  showLabel: boolean;
  /** У события в этой плитке стоит ТИП (значок и слово другие). */
  labelIcon?: LucideIcon;
  labelPlaceholder?: string;
  /** Нет — плитка та же, но только читается: права менять команду у
   *  человека нет (STORY-084, одна страница записи для всех). */
  onEditTeam?: () => void;
  onEditLabel?: () => void;
}) {
  const t = useThemeColors();
  return (
    // ДВА ПОЛНОЦЕННЫХ БЛОКА, А НЕ ОДИН СО ШВОМ.
    // Волосок делил карточку на две половинки одного предмета, а
    // команда и метка — предметы разные: кто едет и куда. Рядом они стоят
    // потому, что отвечают на один вопрос и вместе занимают одну строку
    // экрана.
    <View className="mx-4 mt-2" style={{ flexDirection: "row", gap: 8 }}>
      <IdentityCard
        icon={teamIcon}
        color={teamColor}
        title={teamName}
        sub={masterName ?? undefined}
        onPress={onEditTeam}
        accessibilityLabel={`Команда: ${teamName}${masterName ? `, мастер ${masterName}` : ""}`}
        accessibilityHint="Открывает выбор команды и мастера"
      />
      {showLabel ? (
      <IdentityCard
        // ЗАКЛАДКА, А НЕ БУЛАВКА (выбрана глазами из шести значков).
        // Булавку носит ОБЪЕКТ — адрес на карте, — и метка с тем же значком
        // читалась как второй адрес. Метка не место, а ярлык выезда: её
        // вешают на день и на запись, чтобы отличать одно от другого.
        icon={labelIcon ?? Bookmark}
        // ПУСТАЯ МЕТКА — ПРИГЛАШЕНИЕ, А НЕ ТЕНЬ: булавка акцентом в голубом
        // кружке, как у «Выбрать клиента». Серая булавка (`t.sub`) режет глаза
        // и читается как испорченное значение. Выбранная метка носит СВОЙ
        // цвет: по нему её и узнают.
        color={label ? (labelColor ?? t.accent) : t.accent}
        title={label ?? labelPlaceholder ?? "Метка"}
        muted={!label}
        quiet={!!label && !!labelFromDay}
        onPress={onEditLabel}
        accessibilityLabel={
          label
            ? `${labelPlaceholder ?? "Метка"}: ${label}${labelFromDay ? ", как у дня" : ""}`
            : // Целыми фразами: окончание, приклеенное к слову, на другом
              // языке интерфейса стало бы лишней буквой.
              labelPlaceholder
              ? `${labelPlaceholder} не выбран`
              : "Метка не выбрана"
        }
        accessibilityHint={`Открывает выбор: ${(labelPlaceholder ?? "метка").toLowerCase()}`}
      />
      ) : null}
    </View>
  );
}

/** Блок «кто» или «куда»: плитка со значком в цвете сущности и значение рядом.
 *
 *  ВЫБРАННОЕ — ПЛИТКОЙ ШТОРКИ, КАРТОЧКА — БЕЛАЯ: выбранное показывается так
 *  же, как в шторке — блок с подсветкой и иконкой — во всех формах. Шторка
 *  команды и метки рисует сущность квадратной плиткой, залитой её цветом в
 *  полную силу; бледный кружок с глифом того же цвета дал бы «выбрал плитку —
 *  получил кружок», поэтому здесь та же `AppearanceTile`, что у строки
 *  шторки. Подсветки карточки нет и не будет: эти два блока не окрашиваются,
 *  они такие же белые, как клиент и объект. Пустая «Метка» остаётся
 *  кружком — см. ниже.
 *
 *  ЦВЕТ — НЕ ВЕРТИКАЛЬНАЯ ПОЛОСКА КОРЕШКА. Яркая вертикаль, прижатая к левому
 *  краю маленькой карточки, читается как маркер тревоги — такими в списках
 *  метят «ошибка» и «непрочитанное», — и была бы самым громким пятном
 *  страницы. Тот же цвет под значком звучит спокойно и говорит ровно то же.
 *  Выбранное значение несёт квадратную плитку шторки (`AppearanceTile`, см.
 *  абзац выше); кружком рисуется только пустая «Метка».
 *
 *  Шеврона нет — вся карточка и есть кнопка. */
export function IdentityCard({
  icon: Icon,
  color,
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
  title: string;
  sub?: string;
  /** Значения ещё нет — «Метка» вместо имени метки. */
  muted?: boolean;
  /** Значение не своё, а взятое у дня: тише, но на том же месте. */
  quiet?: boolean;
  /** Нет — плитка только читается: без нажатия и без подсветки. */
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
}) {
  const t = useThemeColors();
  // ЦВЕТ ЗАПИСИ — ТОЛЬКО #RRGGBB. Токены темы записаны в `rgba()`, и приписать
  // к ним альфу строкой нельзя: `rgba(11,18,32,0.64)1f` — не цвет, и RN красит
  // кружок ТЁМНЫМ. Именно так пустая «Метка» получила почти чёрный диск с
  // белой булавкой
  // — то же, что уже ловили на плитках типов событий.
  const hex = /^#[0-9a-f]{6}$/i.test(color);
  const fill = hex ? `${color}1f` : t.rowFill;
  return (
    // ШИРИНА НЕ ЗАВИСИТ ОТ СОДЕРЖИМОГО: плитки делят строку РОВНО ПОПОЛАМ
    // Сужение пустой метки по слову сдвинуло бы команду — соседняя плитка не
    // имеет права дышать чужим состоянием.
    <Card style={{ flex: 1 }}>
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 10,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
      })}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onPress ? accessibilityHint : undefined}
    >
      {/* ЗНАЧОК СТОИТ ВСЕГДА, И ЭТО ТРЕТИЙ ЗАХОД. Сначала у пустой метки был
          диск, посчитанный из rgba-токена, — RN красил его почти чёрным, и
          владелец потребовал «убрать вот эту вот хуйню»; я снёс значок
          целиком. Он вернулся с «сделай со значком, по правильному» и выбрал
          глазами вариант 4: тот же кружок 26 с той же тонировкой `1f`, но в
          акценте. Значит виноват был ЧЁРНЫЙ ДИСК, а не сам значок — плитка
          без него читалась как пустое место, а не как «нажми и выбери». */}
      {muted ? (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: fill,
          }}
        >
          <Icon color={color} size={15} strokeWidth={2.2} />
        </View>
      ) : (
        // Не hex — плитка без краски, как строка шторки без цвета: к
        // rgba-токену альфу не приписать, а читаемость глифа считается по hex.
        <AppearanceTile
          color={hex ? color : null}
          icon={null}
          fallback={Icon}
          size={CHOSEN_TILE}
        />
      )}
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
    </Card>
  );
}
