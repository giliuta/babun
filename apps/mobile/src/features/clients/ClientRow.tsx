import { memo } from "react";
import type React from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
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
import { LIST_ROW } from "@/components/ui/tokens";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useThemeColors } from "@/theme/colors";
import { formatShortDateRu } from "@/features/clients/format";
import { formatPhoneForDisplay } from "@/lib/phone";
import { useDefaultCountry } from "@/features/reference/default-country";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import type { CardFieldPrefs } from "@/features/clients/card-prefs";
import type { ClientsScope } from "@/session/clients-company";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { visitMark } from "@/features/clients/visit-mark";

// СТРОКА КЛИЕНТА — ОДНА НА ВСЕ СПИСКИ.
//
// Жила внутри экрана списка, поэтому архив рисовал свою карточку с рамкой и
// кнопкой внутри: другой рост, другая типографика, ни денег, ни последнего
// визита; архивный клиент должен выглядеть полноценным клиентом с историей.
// По закону «один дизайн на все списки» вёрстка живёт здесь, а
// экраны отличаются только тем, ЧТО показывают и что делают жесты.

/** Ширина места номера в строке: «+357 99 999 999» и «+7 916 123 45 67»
 *  шрифтом подписи (13) с моноширинными цифрами — и запас до даты. */
const PHONE_COLUMN = 138;

function ClientRowView({
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
  /** Хвост строки ВМЕСТО кнопки связи: «через 27 дней» в корзине. */
  trailing?: React.ReactNode;
  /** Компания клиента, если она не компания экрана (строка работодателя в
   *  общем списке): кнопка связи читает набор и шестерёнку её. */
  source?: ClientsScope;
  /** Меняется, когда обработчики строки начинают значить другое (режим
   *  выбора): строка запомнена (`memo`) и обработчики сравнивает не по
   *  ссылке — список пересоздаёт их на каждой перерисовке. */
  memoKey?: string;
}) {
  const t = useThemeColors();
  const country = useDefaultCountry(client.team_id ?? null);
  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";
  // Instagram — тоже способ связи: кнопка есть и без номера.
  const hasInstagram = !!client.instagram_username?.trim();

  // ДЕНЕГ В СТРОКЕ НЕТ: долг, доход и ожидаемое — на странице
  // клиента; отбор «Должники» в фильтрах остаётся.

  // УЛИКА ВЫБРАННОГО СТАТУСА — своей строкой под датой, только когда она
  // есть: в архиве и корзине это срок («удалится через 27 дн.»).
  // «Историю записей» ему закрыли — даты нет вовсе: «нет записей» у клиента,
  // который был вчера, — неправда.
  const showLast = cardFields.last && clientBlockLevel(client, "clients.history") !== "hidden";
  // ДАТА — ОДНА, РЯДОМ С НОМЕРОМ, И ЦВЕТОМ (номер и запись одной строкой):
  // последний визит синим — деньги с него получены; не закрыт — жёлтым, как долг; визитов не было, но записан
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
        ? `запись ${formatShortDateRu(mark.date)} не закрыта`
        : mark.kind === "ahead"
          ? `записан ${formatShortDateRu(mark.date)}`
          : `последняя запись ${formatShortDateRu(mark.date)}`,
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
        className={`flex-1 flex-row items-center py-2.5 pl-4 active:opacity-60 ${(phoneDigits || hasInstagram) && !selectionMode ? "" : "pr-4"}`}
        // Строка списка — одна роль на продукт (`LIST_ROW`): имя 15, подпись 13, 52.
        style={{ minHeight: LIST_ROW.minHeight }}
      >
        {/* БЕЗ КРУЖКА С ИНИЦИАЛАМИ: компактнее. Инициалы по хешу имени не несли
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
            {picked ? <Check color={t.onAccent} size={14} strokeWidth={3} /> : null}
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
              className="shrink"
              style={{ ...LIST_ROW.name, color: t.ink }}
              numberOfLines={1}
            >
              {client.full_name || "Без имени"}
            </Text>
          </View>
          {/* НОМЕР И ДАТА ОДНОЙ СТРОКОЙ ПОД ИМЕНЕМ.
              Номер — то, по чему ищут, в том же виде, что на карточке: в базе
              номера лежат как их когда-то ввели, и «+357 97469998» рядом с
              «+357 97 469998» читались как два разных человека. */}
          {/* НОМЕР И ДАТА — КОЛОНКАМИ: у номера место одной ширины под самый
              длинный номер («+357 99 999 999», «+7 916 123 45 67»), и дата
              начинается за ним в одной точке у каждой строки с номером. У
              клиента без номера колонки нет: подпись идёт от края, как у
              соседних строк (шторка выбора, агенда), а не висит посреди. */}
          {phoneShown || mark ? (
            <View className="mt-0.5 flex-row items-center">
              {phoneShown ? (
                <View style={{ width: phoneColumn }}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ ...LIST_ROW.sub, color: t.sub, fontVariant: ["tabular-nums"] }}
                  >
                    {formatPhoneForDisplay(client.phone, country)}
                  </Text>
                </View>
              ) : null}
              {mark ? (
                <View className="shrink flex-row items-center gap-1">
                  <MarkIcon color={markColor} size={12} strokeWidth={2} />
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ ...LIST_ROW.sub, color: markColor, fontVariant: ["tabular-nums"] }}
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
      {/* ТАП ЗВОНИТ, УДЕРЖАНИЕ — СПОСОБЫ СВЯЗИ: та же кнопка и тот же лист,
          что у номера в карточке и в записи. Тап через лист со звонком
          первым пунктом сделал бы самое частое действие двухтапным;
          WhatsApp и остальное — за удержанием. */}
      {trailing ? (
        <View className="mx-4 my-3 self-center">{trailing}</View>
      ) : (phoneDigits || hasInstagram) && !selectionMode ? (
        <View className="mx-4 my-3 self-center">
          <PhoneChannelButton
            number={client.phone}
            telegramUsername={client.telegram_username}
            instagramUsername={client.instagram_username}
            label={client.full_name || undefined}
            teamId={client.team_id ?? null}
            source={source}
          />
        </View>
      ) : null}
    </View>
  );

  // ЖЕСТЫ СТРОКИ.
  //
  // Связь на свайпах держать нельзя: она уже есть в листе long-press и в
  // зелёной кнопке, а действия, ради которых список существует
  // («Напомнить», «Удалить»), без жеста остались бы. Хуже того, свайп ВЛЕВО —
  // то место, где во всех приложениях iPhone лежит «Удалить»: заученный
  // флик «убери» звонил бы клиенту, а звонок не отменить. Поэтому:
  //   вправо = отложить → «Напомнить»
  //   влево  = убрать   → «Удалить», там же, где во всех приложениях iPhone
  // «Записать» осталась в меню долгого нажатия. Связи в жестах нет вовсе:
  // она в зелёной кнопке — единственной поверхности, которая читает
  // настройку «Способы связи» и её порядок. Свайп не зависит от наличия
  // телефона: ни один из глаголов номера не требует.
  // Без глаголов свайпа (корзина, нет прав) строка остаётся просто строкой.
  if (selectionMode || (!onRemind && !onDelete)) return row;
  // Кромки — общий `SwipeRow`: тот же жест, ширина и подпись, что у всех
  // строк продукта, и «открыт один ряд на экран» держит он сам.
  return (
    <SwipeRow
      label={onDelete ? "Удалить" : undefined}
      color={t.danger}
      icon={Trash2}
      accessibilityLabel={`Удалить — ${client.full_name || client.phone}`}
      // Удаление спрашивает подтверждение само — поэтому оно допустимо
      // у пальца, а полного свайпа здесь нет вовсе.
      onAction={
        onDelete
          ? () => {
              haptics.warning();
              onDelete();
            }
          : undefined
      }
      leading={
        onRemind
          ? {
              label: "Напомнить",
              color: t.warning,
              icon: Bell,
              accessibilityLabel: `Напомнить — ${client.full_name || client.phone}`,
              onAction: onRemind,
            }
          : undefined
      }
    >
      {row}
    </SwipeRow>
  );
}

type ClientRowProps = Parameters<typeof ClientRowView>[0];

/** Строки не перерисовываются, пока не поменялись их данные: список пересоздаёт обработчики на каждой перерисовке — буква в
 *  поиске, выбор, обновление данных, — и каждая строка с её кнопкой связи,
 *  свайпом и разбором номера рисовалась заново. Обработчики сравниваются по
 *  наличию; их смысл меняет `memoKey`. */
function sameRow(a: ClientRowProps, b: ClientRowProps): boolean {
  for (const key of Object.keys({ ...a, ...b }) as (keyof ClientRowProps)[]) {
    const x = a[key];
    const y = b[key];
    if (typeof x === "function" || typeof y === "function") {
      if (typeof x !== typeof y) return false;
      continue;
    }
    if (!Object.is(x, y)) return false;
  }
  return true;
}

const ClientRow = memo(ClientRowView, sameRow);
export default ClientRow;
