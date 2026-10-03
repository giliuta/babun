import { useRef } from "react";
import type React from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  Ban,
  Bell,
  CalendarClock,
  Check,
  Clock,
  Trash2,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { haptics } from "@/lib/haptics";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { formatShortDateRu } from "@/features/clients/format";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import type { CardFieldPrefs } from "@/features/clients/card-prefs";
import type { ClientsScope } from "@/features/clients/clients-company";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { visitMark } from "@/features/clients/visit-mark";

// СТРОКА КЛИЕНТА — ОДНА НА ВСЕ СПИСКИ.
//
// Жила внутри экрана списка, поэтому архив рисовал свою карточку с рамкой и
// кнопкой внутри: другой рост, другая типографика, ни денег, ни последнего
// визита. Владелец 2026-08-08: «чтоб выглядело как клиент полноценный с
// историей». По закону «один дизайн на все списки» вёрстка живёт здесь, а
// экраны отличаются только тем, ЧТО показывают и что делают жесты.

/** Ширина места номера в строке: «+357 99 999 999» и «+7 916 123 45 67»
 *  шрифтом 14 с моноширинными цифрами — и запас до даты. */
const PHONE_COLUMN = 138;

export default function ClientRow({
  client,
  stats,
  cardFields,
  evidence,
  selectionMode,
  picked,
  onPress,
  onLongPress,
  onRemind,
  onDelete,
  onSwipeOpen,
  trailing,
  source,
}: {
  client: Client;
  stats: ClientStats | undefined;
  cardFields: CardFieldPrefs;
  /** Почему этот человек попал в выбранный статус («не был 87 дн.»).
   *  Печатается первым в мете — доказательство должно попадаться на глаза
   *  раньше справочных полей. */
  evidence?: string | null;
  selectionMode: boolean;
  picked: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** Свайп вправо: лист «Напомнить». Жесты НЕОБЯЗАТЕЛЬНЫ: в корзине
   *  глаголы другие («Восстановить», «Стереть»), и привычный флик «убери»
   *  там означал бы не то. Без обработчика стороны нет; без обоих строка
   *  не оборачивается в свайп. */
  onRemind?: () => void;
  /** Свайп влево: «Удалить» (спрашивает подтверждение сам). */
  onDelete?: () => void;
  /** Открылся свайп этой строки — список закрывает предыдущий. */
  onSwipeOpen?: (row: SwipeableMethods | null) => void;
  /** Хвост строки ВМЕСТО кнопки связи: «через 27 дней» в корзине. */
  trailing?: React.ReactNode;
  /** Компания клиента, если она не компания экрана (строка работодателя в
   *  общем списке): кнопка связи читает набор и шестерёнку её (03.10). */
  source?: ClientsScope;
}) {
  const t = useThemeColors();
  const country = useDefaultCountry(client.team_id ?? null);
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";

  // ДЕНЕГ В СТРОКЕ НЕТ (владелец 01.10: «уберём полностью этот блок — долг,
  // доход, ожидается — со страницы клиентов»). Долг и доход — на странице
  // клиента; отбор «Должники» в фильтрах остаётся.

  // УЛИКА ВЫБРАННОГО СТАТУСА — своей строкой под датой, только когда она
  // есть: в архиве и корзине это срок («удалится через 27 дн.»).
  // «Историю записей» ему закрыли — даты нет вовсе: «нет записей» у клиента,
  // который был вчера, — неправда (проверка глазами 30.09).
  const showLast = cardFields.last && clientBlockLevel(client, "clients.history") !== "hidden";
  // ДАТА — ОДНА, РЯДОМ С НОМЕРОМ, И ЦВЕТОМ (владелец 01.10, вариант 3:
  // «номер и запись одной строкой»): последний визит синим — деньги с него
  // получены; не закрыт — жёлтым, как долг; визитов не было, но записан
  // вперёд — серым; записей нет — ничего. Правило — `visit-mark.ts`.
  const mark = showLast ? visitMark(stats) : null;
  const markColor =
    mark?.kind === "unclosed" ? t.warning : mark?.kind === "ahead" ? t.sub : t.accent;
  const MarkIcon = mark?.kind === "ahead" ? CalendarClock : Clock;
  const phoneShown = cardFields.phone && client.phone.trim() !== "";
  // Место номера — под самый длинный номер при крупном тексте телефона
  // (ограничен тем же 1.3, что и сами строки).
  const { fontScale } = useWindowDimensions();
  const phoneColumn = Math.round(PHONE_COLUMN * Math.min(fontScale, 1.3));

  // VoiceOver: строка зачитывает реально показанные бизнес-сигналы в
  // порядке экрана, а не только имя+телефон.
  const a11yLabel = [
    client.full_name || "Без имени",
    client.blacklisted ? "чёрный список" : "",
    // Номер, потом дата — в порядке строки на экране.
    client.phone ?? "",
    !mark
      ? ""
      : mark.kind === "unclosed"
        ? `визит ${formatShortDateRu(mark.date)} не закрыт`
        : mark.kind === "ahead"
          ? `записан ${formatShortDateRu(mark.date)}`
          : `последний визит ${formatShortDateRu(mark.date)}`,
    evidence ?? "",
  ]
    .filter(Boolean)
    .join(". ");

  const row = (
    <View
      className="flex-row items-stretch"
      style={{ backgroundColor: t.canvas }}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={
          selectionMode
            ? "Переключить выбор клиента"
            : "Открыть карточку клиента"
        }
        accessibilityState={selectionMode ? { selected: picked } : undefined}
        className={`min-h-[56px] flex-1 flex-row items-center py-2.5 pl-4 active:opacity-60 ${phoneDigits && !selectionMode ? "" : "pr-4"}`}
      >
        {/* БЕЗ КРУЖКА С ИНИЦИАЛАМИ (владелец 30.09: «не нравится слева эти
            кружочки… давай компактнее»). Инициалы по хешу имени не несли
            смысла и съедали 60pt слева у каждой строки. В режиме выбора слева
            встаёт только маленькая отметка — ряд почти не сдвигается. */}
        {selectionMode ? (
          <View
            className="mr-3 h-6 w-6 items-center justify-center rounded-full"
            style={{
              backgroundColor: picked ? t.accent : "transparent",
              borderWidth: picked ? 0 : 2,
              borderColor: t.separatorStrong,
            }}
          >
            {picked ? <Check color="#fff" size={14} strokeWidth={3} /> : null}
          </View>
        ) : null}
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            {/* Чёрный список: в списке забаненный клиент был НЕОТЛИЧИМ от
                обычного (маркер жил только на карточке) — мастер мог
                позвонить и записать того, кого владелец занёс. */}
            {client.blacklisted ? (
              <Ban color={t.danger} size={12} strokeWidth={2.5} />
            ) : null}
            <Text
              maxFontSizeMultiplier={1.3}
              className="shrink text-base font-semibold"
              style={{ color: t.ink }}
              numberOfLines={1}
            >
              {client.full_name || "Без имени"}
            </Text>
          </View>
          {/* НОМЕР И ДАТА ОДНОЙ СТРОКОЙ ПОД ИМЕНЕМ (владелец 01.10, вариант 3).
              Номер — то, по чему ищут (2026-08-06: «хочу, чтоб сразу было
              видно номер телефона»), в том же виде, что на карточке: в базе
              номера лежат как их когда-то ввели, и «+357 97469998» рядом с
              «+357 97 469998» читались как два разных человека. */}
          {/* НОМЕР И ДАТА — КОЛОНКАМИ (владелец 01.10: «чёткий столбик…
              специальное место для визита, для номера и для имени, чтобы
              дата не прыгала слева направо»). У номера место одной ширины
              под самый длинный номер («+357 99 999 999», «+7 916 123 45 67»),
              дата начинается за ним в одной точке у каждой строки — даже у
              клиента без номера. */}
          {phoneShown || mark ? (
            <View className="mt-0.5 flex-row items-center">
              <View style={{ width: phoneColumn }}>
                {phoneShown ? (
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ fontSize: 14, color: t.sub, fontVariant: ["tabular-nums"] }}
                  >
                    {formatPhoneForDisplay(client.phone, country)}
                  </Text>
                ) : null}
              </View>
              {mark ? (
                <View className="shrink flex-row items-center gap-1">
                  <MarkIcon color={markColor} size={12} strokeWidth={2} />
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ fontSize: 13, color: markColor, fontVariant: ["tabular-nums"] }}
                  >
                    {formatShortDateRu(mark.date)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {evidence ? (
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              className="mt-0.5 text-[11px] font-semibold"
              style={{ color: t.ink }}
            >
              {evidence}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {/* ТАП ЗВОНИТ, УДЕРЖАНИЕ — СПОСОБЫ СВЯЗИ (владелец 2026-09-06): та же
          кнопка и тот же лист, что у номера в карточке и в записи. С
          2026-08-06 тап открывал лист со звонком первым пунктом — самое
          частое действие стоило двух тапов; WhatsApp и остальное теперь за
          удержанием. */}
      {trailing ? (
        <View className="mx-4 my-3 self-center">{trailing}</View>
      ) : phoneDigits && !selectionMode ? (
        <View className="mx-4 my-3 self-center">
          <PhoneChannelButton
            number={client.phone}
            telegramUsername={client.telegram_username}
            label={client.full_name || undefined}
            teamId={client.team_id ?? null}
            source={source}
          />
        </View>
      ) : null}
    </View>
  );

  // ЖЕСТЫ СТРОКИ (переосмыслены 2026-08-06 по разбору четырёх линз).
  //
  // БЫЛО: свайп влево — «Позвонить», свайп вправо — «SMS» + «WhatsApp». То
  // есть СВЯЗЬ жила на свайпах, в листе long-press и в зелёной кнопке —
  // четыре дороги к одному глаголу. При этом два действия, ради которых
  // список и существует («Записать», «Напомнить»), жеста не имели вовсе.
  //
  // Хуже: свайп ВЛЕВО — то место, где во всех приложениях iPhone лежит
  // «Удалить». Заученный флик «убери» звонил клиенту, а звонок не отменить.
  //
  // СТАЛО (владелец 03.10: «„Записать" убираем, туда — „Напомнить",
  // вправо — соответственно „Удалить"; архива не будет»):
  //   вправо = отложить → «Напомнить»
  //   влево  = убрать   → «Удалить», там же, где во всех приложениях iPhone
  // «Записать» осталась в меню долгого нажатия. Связи в жестах нет вовсе:
  // она в зелёной кнопке — единственной поверхности, которая читает
  // настройку «Способы связи» и её порядок. Свайп не зависит от наличия
  // телефона: ни один из глаголов номера не требует.
  // Без глаголов свайпа (корзина, нет прав) строка остаётся просто строкой.
  if (selectionMode || (!onRemind && !onDelete)) return row;
  const closeSwipe = () => swipeRef.current?.close();
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={44}
      leftThreshold={44}
      overshootRight={false}
      overshootLeft={false}
      // Мёртвая зона у левого края: на всех остальных экранах эта же моторика
      // означает системное «назад».
      dragOffsetFromLeftEdge={30}
      // Открытым может быть только ОДИН свайп: иначе на экране две-три
      // раскрытые строки, и следующий тап попадает не туда, куда целились.
      onSwipeableWillOpen={() => {
        haptics.tap();
        onSwipeOpen?.(swipeRef.current);
      }}
      renderLeftActions={
        onRemind
          ? () => (
              <Pressable
                onPress={() => {
                  closeSwipe();
                  haptics.tap();
                  onRemind();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Напомнить — ${client.full_name || client.phone}`}
                className="w-[88px] items-center justify-center gap-1"
                style={{ backgroundColor: t.warning }}
              >
                <Bell color="#fff" size={ICON.sm} />
                <Text
                  maxFontSizeMultiplier={1.3}
                  className="text-[11px] font-semibold"
                  style={{ color: "#fff" }}
                >
                  Напомнить
                </Text>
              </Pressable>
            )
          : undefined
      }
      renderRightActions={
        onDelete
          ? () => (
              // Удаление спрашивает подтверждение само — поэтому оно допустимо
              // у пальца, а полного свайпа здесь нет вовсе.
              <Pressable
                onPress={() => {
                  closeSwipe();
                  haptics.warning();
                  onDelete();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Удалить — ${client.full_name || client.phone}`}
                className="w-[88px] items-center justify-center gap-1"
                style={{ backgroundColor: t.danger }}
              >
                <Trash2 color="#fff" size={ICON.sm} />
                <Text
                  maxFontSizeMultiplier={1.3}
                  className="text-[11px] font-semibold"
                  style={{ color: "#fff" }}
                >
                  Удалить
                </Text>
              </Pressable>
            )
          : undefined
      }
    >
      {row}
    </ReanimatedSwipeable>
  );
}
