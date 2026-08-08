import { useRef } from "react";
import type React from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  Archive,
  Ban,
  Bell,
  CalendarPlus,
  Check,
  Clock,
  Pin,
} from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  getAvatarHue,
  getInitials,
} from "@babun/shared/common/utils/avatar-color";
import { haptics } from "@/lib/haptics";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { clientDebt } from "@/features/clients/filter";
import { formatShortDateRu, reminderBadge } from "@/features/clients/format";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import type { CardFieldPrefs } from "@/features/clients/card-prefs";

// СТРОКА КЛИЕНТА — ОДНА НА ВСЕ СПИСКИ.
//
// Жила внутри экрана списка, поэтому архив рисовал свою карточку с рамкой и
// кнопкой внутри: другой рост, другая типографика, ни денег, ни последнего
// визита. Владелец 2026-08-08: «чтоб выглядело как клиент полноценный с
// историей». По закону «один дизайн на все списки» вёрстка живёт здесь, а
// экраны отличаются только тем, ЧТО показывают и что делают жесты.

export default function ClientRow({
  client,
  stats,
  teamName,
  tags,
  cardFields,
  evidence,
  selectionMode,
  picked,
  onPress,
  onLongPress,
  onBook,
  onRemind,
  onArchive,
  onSwipeOpen,
  trailing,
}: {
  client: Client;
  stats: ClientStats | undefined;
  teamName: string | null;
  tags: ClientTag[];
  cardFields: CardFieldPrefs;
  /** Почему этот человек попал в выбранный статус («не был 87 дн.»).
   *  Печатается первым в мете — доказательство должно попадаться на глаза
   *  раньше справочных полей. */
  evidence: string | null;
  selectionMode: boolean;
  picked: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** Свайп вправо: открыть запись для этого клиента. Жесты НЕОБЯЗАТЕЛЬНЫ:
   *  в архиве и корзине глаголы другие («Восстановить», «Стереть»), и
   *  привычный флик «убери» там означал бы не то. Без обработчиков строка
   *  просто не оборачивается в свайп. */
  onBook?: () => void;
  /** Свайп влево: лист «Напомнить». */
  onRemind?: () => void;
  /** Свайп влево: архив (спрашивает подтверждение сам). */
  onArchive?: () => void;
  /** Открылся свайп этой строки — список закрывает предыдущий. */
  onSwipeOpen?: (row: SwipeableMethods | null) => void;
  /** Хвост строки ВМЕСТО кнопки связи: «через 27 дней» в корзине. */
  trailing?: React.ReactNode;
}) {
  const t = useThemeColors();
  const country = useDefaultCountry();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const exp = Math.round(stats?.expectedRevenue ?? 0);
  const income = Math.round(stats?.totalSpent ?? 0);
  // Одна формула долга на карточку, сортировку и статус «Должники».
  const debt = clientDebt(client, stats);
  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";
  const avatarColor = getAvatarHue(client.full_name);

  // Порядок долг → доход → ожидается: должник — самый срочный сигнал,
  // читается первым. «долг €450» словом (не голым цветом): золото без
  // подписи в списке не читается, должника ищут по слову, не по памяти.
  const figs: { key: string; text: string; color: string }[] = [];
  if (cardFields.debt && debt > 0)
    figs.push({
      key: "debt",
      text: `долг ${formatEUR(debt)}`,
      color: t.warning,
    });
  if (cardFields.inc && income > 0)
    figs.push({ key: "inc", text: formatEUR(income), color: t.success });
  if (cardFields.exp && exp > 0)
    figs.push({ key: "exp", text: formatEUR(exp), color: t.sub });

  // Мета — ОДНА строка с эллипсисом: [🔔 напоминание] · [🕐 посл. визит] ·
  // команда · город · теги (первые 2 + «+N»). Иконки-сигналы (напоминание,
  // визит) идут ведущими и не сжимаются; хвост (команда/город/теги) —
  // единый обрезаемый текст, чтобы ряд не пух в 3 строки и ничего не
  // наезжало. Напоминание не гейтится тогглами: сигнал, поставленный
  // руками, — красный, когда пора (сегодня/прошло), серый — когда впереди.
  const reminder = reminderBadge(client.reminder_at);
  const metaLead: { key: string; node: React.ReactNode }[] = [];
  // УЛИКА ВЫБРАННОГО СТАТУСА — первой: список, собранный фильтром, должен
  // сам объяснять, за что сюда попал каждый человек (владелец 2026-08-07:
  // «как убеждаться, что это правильные статусы»).
  if (evidence) {
    metaLead.push({
      key: "evidence",
      node: (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          className="text-[11px] font-semibold"
          // Полные чернила: доказательство статуса не может быть бледнее
          // справочного хвоста меты (город, команда, теги) — иначе главное
          // на строке тише второстепенного.
          style={{ color: t.ink }}
        >
          {evidence}
        </Text>
      ),
    });
  }
  if (reminder) {
    metaLead.push({
      key: "reminder",
      node: (
        <View className="flex-row items-center gap-1">
          <Bell
            color={reminder.due ? t.danger : t.sub}
            size={12}
            strokeWidth={2}
          />
          <Text
            maxFontSizeMultiplier={1.3}
            className={`text-[11px] ${reminder.due ? "font-semibold" : ""}`}
            style={{ color: reminder.due ? t.danger : t.ink }}
          >
            {reminder.label}
          </Text>
        </View>
      ),
    });
  }
  if (cardFields.last) {
    metaLead.push({
      key: "last",
      node: stats?.lastVisitDate ? (
        <View className="flex-row items-center gap-1">
          <Clock color={t.sub} size={12} strokeWidth={2} />
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-[11px]"
            style={{ color: t.ink }}
          >
            {formatShortDateRu(stats.lastVisitDate)}
          </Text>
        </View>
      ) : stats?.nextApt ? (
        // Визитов ещё не было, но человек ЗАПИСАН — «нет записей» было
        // прямой ложью в самый нужный момент.
        <View className="flex-row items-center gap-1">
          <Clock color={t.accent} size={12} strokeWidth={2} />
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-[11px]"
            style={{ color: t.accent }}
          >
            {`записан ${formatShortDateRu(stats.nextApt.date)}`}
          </Text>
        </View>
      ) : (
        <Text
          maxFontSizeMultiplier={1.3}
          className="text-[11px]"
          style={{ color: t.faint }}
        >
          нет записей
        </Text>
      ),
    });
  }
  const tagNames = cardFields.meta
    ? (client.tag_ids
        .map((tid) => tags.find((x) => x.id === tid)?.name)
        .filter(Boolean) as string[])
    : [];
  let metaTail = "";
  if (cardFields.meta) {
    const parts: string[] = [];
    if (teamName) parts.push(teamName);
    const city = (client.city ?? "").trim();
    if (city) parts.push(city);
    parts.push(...tagNames.slice(0, 2));
    if (tagNames.length > 2) parts.push(`+${tagNames.length - 2}`);
    metaTail = parts.join(" · ");
  }

  // VoiceOver: строка зачитывает реально показанные бизнес-сигналы в
  // порядке экрана, а не только имя+телефон.
  const a11yLabel = [
    client.full_name || "Без имени",
    client.pinned_at ? "закреплён" : "",
    client.blacklisted ? "чёрный список" : "",
    cardFields.debt && debt > 0 ? `долг ${formatEUR(debt)}` : "",
    cardFields.inc && income > 0 ? `доход ${formatEUR(income)}` : "",
    cardFields.exp && exp > 0 ? `ожидается ${formatEUR(exp)}` : "",
    reminder ? `напоминание ${reminder.label}` : "",
    cardFields.last
      ? stats?.lastVisitDate
        ? `последний визит ${formatShortDateRu(stats.lastVisitDate)}`
        : "нет записей"
      : "",
    metaTail,
    client.phone ?? "",
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
        className={`min-h-[68px] flex-1 flex-row items-center py-3 pl-4 active:opacity-60 ${phoneDigits && !selectionMode ? "" : "pr-4"}`}
      >
        {selectionMode ? (
          // Чекбокс замещает аватар (web parity) — ряд не разъезжается.
          <View
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{
              backgroundColor: picked ? t.accent : t.fill,
              borderWidth: picked ? 0 : 2,
              borderColor: t.separator,
            }}
          >
            {picked ? <Check color="#fff" size={20} strokeWidth={3} /> : null}
          </View>
        ) : (
          // Мягкий аватар: заливка = цвет клиента при ~18%, инициалы —
          // чёрные (ink). Насыщенный круг был самым громким элементом
          // экрана и не нёс смысла (просто хеш имени); тихий тон даёт
          // идентичность, не перебивая имя и деньги. Зелёным на строке
          // остаётся только кнопка звонка = действие.
          <View
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: `${avatarColor}2e` }}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              className="text-sm font-bold"
              style={{ color: t.ink }}
            >
              {getInitials(client.full_name || "?")}
            </Text>
          </View>
        )}
        {/* ml-2: аватар16+44+8 = 68 → колонка текста совпадает с инсетом
            разделителя (ml-[68px]) и DS-инсетом avatar-рядов. */}
        <View className="ml-2 flex-1">
          <View className="flex-row items-center gap-1.5">
            {client.pinned_at ? (
              <Pin color={t.accent} size={12} strokeWidth={2.5} />
            ) : null}
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
          {/* НОМЕР ПОД ИМЕНЕМ (владелец 2026-08-06: «хочу, чтоб сразу было
              видно номер телефона»). Он же — то, по чему ищут: поиск и так
              понимает цифры, но раньше найденный номер нигде не показывался,
              и совпадение приходилось проверять, открывая карточку. */}
          {cardFields.phone && client.phone.trim() ? (
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              className="mt-0.5 text-[13px]"
              style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
            >
              {/* Тот же формат, что на карточке: в базе номера лежат как их
                  когда-то ввели или как пришли из импорта, и рядом стояли
                  «+357 97469998» и «+357 97 469998» — два вида одного
                  номера читаются как два разных человека. */}
              {formatPhoneAsYouType(client.phone, country)}
            </Text>
          ) : null}
          {figs.length > 0 ? (
            <View className="mt-1 flex-row items-center gap-2.5">
              {figs.map((f) => (
                <Text
                  maxFontSizeMultiplier={1.3}
                  key={f.key}
                  className="text-[13px] font-semibold"
                  style={{ color: f.color, fontVariant: ["tabular-nums"] }}
                >
                  {f.text}
                </Text>
              ))}
            </View>
          ) : null}
          {metaLead.length > 0 || metaTail ? (
            <View className="mt-0.5 flex-row items-center">
              {metaLead.map((seg, i) => (
                <View key={seg.key} className="flex-row items-center">
                  {i > 0 ? (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      className="mx-[5px] text-[11px]"
                      style={{ color: t.faint }}
                    >
                      ·
                    </Text>
                  ) : null}
                  {seg.node}
                </View>
              ))}
              {metaTail ? (
                <View className="flex-1 flex-row items-center">
                  {metaLead.length > 0 ? (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      className="mx-[5px] text-[11px]"
                      style={{ color: t.faint }}
                    >
                      ·
                    </Text>
                  ) : null}
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    className="flex-1 text-[11px]"
                    style={{ color: t.ink }}
                  >
                    {metaTail}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
      {/* КАК СВЯЗАТЬСЯ, а не «позвонить» (владелец 2026-08-06): та же кнопка
          и тот же лист, что у номера в карточке. Звонок остался внутри листа
          первым пунктом — тем, кто звонит всегда, это по-прежнему один тап
          после открытия, а остальным больше не нужно заходить в карточку
          ради WhatsApp. */}
      {trailing ? (
        <View className="mx-4 my-3 self-center">{trailing}</View>
      ) : phoneDigits && !selectionMode ? (
        <View className="mx-4 my-3 self-center">
          <PhoneChannelButton
            number={client.phone}
            telegramUsername={client.telegram_username}
            label={client.full_name || undefined}
            size={44}
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
  // СТАЛО, по закону направления (он же в соседних «Чатах»):
  //   вправо = продвинуть  → «Записать»
  //   влево  = отложить/убрать → «Напомнить» + «Архив»
  // Связи в жестах нет вовсе: она в зелёной кнопке — единственной
  // поверхности, которая читает настройку «Способы связи» и её порядок.
  // Свайп больше не зависит от наличия телефона: ни один из глаголов номера
  // не требует (раньше у клиента без номера жеста не было совсем).
  // Без глаголов свайпа (архив, корзина) строка остаётся просто строкой.
  if (selectionMode || !onBook || !onRemind || !onArchive) return row;
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
      renderLeftActions={() => (
        <Pressable
          onPress={() => {
            closeSwipe();
            haptics.tap();
            onBook();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Записать — ${client.full_name || client.phone}`}
          className="w-[88px] items-center justify-center gap-1"
          style={{ backgroundColor: t.accent }}
        >
          <CalendarPlus color="#fff" size={ICON.sm} />
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-[11px] font-semibold"
            style={{ color: "#fff" }}
          >
            Записать
          </Text>
        </Pressable>
      )}
      renderRightActions={() => (
        <View className="flex-row">
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
          {/* Архив спрашивает подтверждение (см. confirmArchiveOne) — поэтому
              он допустим у пальца, а полного свайпа здесь нет вовсе. */}
          <Pressable
            onPress={() => {
              closeSwipe();
              haptics.warning();
              onArchive();
            }}
            accessibilityRole="button"
            accessibilityLabel={`В архив — ${client.full_name || client.phone}`}
            className="w-[88px] items-center justify-center gap-1"
            style={{ backgroundColor: t.danger }}
          >
            <Archive color="#fff" size={ICON.sm} />
            <Text
              maxFontSizeMultiplier={1.3}
              className="text-[11px] font-semibold"
              style={{ color: "#fff" }}
            >
              В архив
            </Text>
          </Pressable>
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}
