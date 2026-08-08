import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Ban,
  Archive,
  BarChart3,
  Bell,
  CalendarPlus,
  Check,
  Clock,
  Pin,
  Search,
  Settings,
  Users,
} from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import {
  buildStatsMap,
  type ClientStats,
} from "@babun/shared/local/selectors/client-stats";
import {
  getAvatarHue,
  getInitials,
} from "@babun/shared/common/utils/avatar-color";
import { formatEUR } from "@babun/shared/common/utils/money";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { usePullRefresh } from "@/lib/pull-refresh";
import {
  useClients,
  useClientTags,
  useArchiveClients,
  useUpdateClientById,
} from "@/features/clients/queries";
import {
  clientDebt,
  EMPTY_FILTER,
  resetFilters,
  segmentEvidence,
  type ActiveToken,
  type ClientsFilter,
} from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import {
  loadDayFilter,
  saveDayFilter,
} from "@/features/clients/filter-pref";
import {
  useClientsSort,
  useSetClientsSort,
} from "@/features/clients/sort-pref";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
  type CardFieldPrefs,
} from "@/features/clients/card-prefs";
import {
  formatShortDateRu,
  reminderBadge,
} from "@/features/clients/format";
import { ClientActionsSheet } from "@/features/clients/ClientActionsSheet";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { ClientsFilterBar } from "@/features/clients/ClientsFilterBar";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportWizardSheet } from "@/features/clients/import/ImportWizardSheet";
import { ContactsImportSheet } from "@/features/clients/import/ContactsImportSheet";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { BulkSmsSheet } from "@/features/clients/BulkSmsSheet";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useAppointments } from "@/features/calendar/queries";
import { useCities, useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги).
// Field visibility is driven by the «Что показывать» prefs (cardFields).
//
// Bulk-mode (web-parity): long-press ENTERS selection mode; in it the avatar
// becomes a checkbox, the contact button hides, and a tap toggles the pick
// instead of opening the card.
//
// СВАЙПЫ (2026-08-06): вправо — «Записать», влево — «Напомнить» и «В архив».
// Телефон для них не нужен; в режиме выбора свайпы отключены целиком.
function ClientRow({
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
  /** Свайп вправо: открыть запись для этого клиента. */
  onBook: () => void;
  /** Свайп влево: лист «Напомнить». */
  onRemind: () => void;
  /** Свайп влево: архив (спрашивает подтверждение сам). */
  onArchive: () => void;
  /** Открылся свайп этой строки — список закрывает предыдущий. */
  onSwipeOpen: (row: SwipeableMethods | null) => void;
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
      {phoneDigits && !selectionMode ? (
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
  if (selectionMode) return row;
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
        onSwipeOpen(swipeRef.current);
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

export default function ClientsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const { data: role } = useCurrentRole();
  // Экран настроек возвращается сюда с nonce-параметром:
  // «Импорт из CSV» → openImport.
  const params = useLocalSearchParams<{
    openImport?: string;
    /** «Из контактов телефона» → openContacts. */
    openContacts?: string;
  }>();
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  // Контрол обновления отражает ЖЕСТ, а не любое дообновление: иначе список
  // сам уезжал вниз с застывшей системной вертушкой.
  const pull = usePullRefresh(refetch);
  const { data: tags = [] } = useClientTags();
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const { data: cities = [] } = useCities();
  const { data: cardFields = DEFAULT_CARD_FIELDS } = useCardFields();
  // Сортировка — персистентная настройка списка (первая строка листа
  // «Фильтры»), не фильтр: «Сбросить» её не трогает.
  const { data: sort = "recent" } = useClientsSort();
  const setSort = useSetClientsSort();
  const archiveClients = useArchiveClients();
  const updateById = useUpdateClientById();
  const [query, setQuery] = useState("");
  // Набор живёт до конца дня: звонок/SMS выбрасывают из приложения, и
  // собирать шесть условий заново каждый круг обзвона — потеря времени.
  const [filter, setFilter] = useState<ClientsFilter>(
    () => loadDayFilter() ?? EMPTY_FILTER,
  );
  useEffect(() => {
    saveDayFilter(filter);
  }, [filter]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // С какого измерения открыть лист (тап по телу токена в баре).
  const [initialFacet, setInitialFacet] = useState<
    "segment" | "city" | "tag" | "team" | "source" | "property" | null
  >(null);
  const [importOpen, setImportOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  // ── Bulk-mode (multi-select) ──────────────────────────────────────
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);

  useEffect(() => {
    if (params.openContacts) setContactsOpen(true);
    if (params.openImport) setImportOpen(true);
  }, [params.openImport, params.openContacts]);

  const clients = useMemo(() => data ?? [], [data]);

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  // Первая и последняя (не отменённые) записи — сплит периода в фильтрах
  // показывает у «Всего времени» честный охват данных в обе стороны.
  const dataSpan = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const a of appointments) {
      if (a.status === "cancelled" || !a.date) continue;
      if (!min || a.date < min) min = a.date;
      if (!max || a.date > max) max = a.date;
    }
    return { from: min, to: max };
  }, [appointments]);

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  const result = useClientFilters(
    clients,
    appointments,
    teams,
    cities,
    tags,
    statsMap,
    sort,
    filter,
    query,
    sheetOpen, // счётчики попапов считаем только при открытом листе
  );

  // Прунинг «призрачных» фильтров: если тег/команду/метку удалили, пока
  // фильтр по ним активен, список схлопнулся бы в ноль без токена для
  // снятия. Держим выбранное подмножеством живых опций.
  const { teamOptions, cityOptions, tagOptions } = result;
  useEffect(() => {
    setFilter((f) => {
      const teamSet = new Set(teamOptions.map((o) => o.value));
      const tagSet = new Set(tagOptions.map((o) => o.value));
      const citySet = new Set(cityOptions.map((o) => o.value));
      const selectedTeams = f.selectedTeams.filter((x) => teamSet.has(x));
      const activeTags = f.activeTags.filter((x) => tagSet.has(x));
      const selectedCities = f.selectedCities.filter((x) => citySet.has(x));
      if (
        selectedTeams.length === f.selectedTeams.length &&
        activeTags.length === f.activeTags.length &&
        selectedCities.length === f.selectedCities.length
      )
        return f;
      return { ...f, selectedTeams, activeTags, selectedCities };
    });
  }, [teamOptions, cityOptions, tagOptions]);

  const removeToken = (token: ActiveToken) => {
    if (token.key === "team")
      setFilter((f) => ({
        ...f,
        selectedTeams: f.selectedTeams.filter((x) => x !== token.val),
      }));
    else if (token.key === "city")
      setFilter((f) => ({
        ...f,
        selectedCities: f.selectedCities.filter((x) => x !== token.val),
      }));
    else if (token.key === "tag")
      setFilter((f) => ({
        ...f,
        activeTags: f.activeTags.filter((x) => x !== token.val),
      }));
    else if (token.key === "period") setFilter((f) => ({ ...f, period: null }));
    else if (token.key === "segment")
      setFilter((f) => ({
        ...f,
        segments: f.segments.filter((x) => x !== token.val),
      }));
    else if (token.key === "source")
      setFilter((f) => ({
        ...f,
        sources: f.sources.filter((x) => x !== token.val),
      }));
    else if (token.key === "property")
      setFilter((f) => ({
        ...f,
        propertyTypes: f.propertyTypes.filter((x) => x !== token.val),
      }));
  };

  // Один сброс на все три кнопки (лист, бар, пустой экран): чистит и
  // фильтры, и поиск — иначе «Сбросить» на баре оставлял запрос и список
  // оставался пустым без видимой причины.
  const resetAll = () => {
    haptics.tap();
    setFilter(resetFilters());
    setQuery("");
  };

  const filtering = result.activeCount > 0 || query.trim().length > 0;

  // ── Long-press меню клиента (web v313 parity) — нижний лист
  // ClientActionsSheet; здесь только состояние и обработчики.
  const [menuClient, setMenuClient] = useState<Client | null>(null);

  // Напоминание — ТОТ ЖЕ лист, что на карточке: одно действие не может
  // выглядеть по-разному в двух местах (раньше здесь был системный Alert).
  const [remindClient, setRemindClient] = useState<Client | null>(null);
  const openRemindMenu = (c: Client) => setRemindClient(c);

  // ЗАПИСАТЬ ПРЯМО ИЗ СПИСКА (свайп вправо и лист действий). Строка уже знает
  // и основной объект, и последнюю бригаду — те же два поля, что подставляет
  // карточка, поэтому лишний заход в карточку ради «Записать» больше не
  // нужен. Чёрный список спрашивает через тот же общий гейт.
  // Ссылка на открытую свайпом строку — чтобы закрыть её, когда открывают
  // соседнюю.
  const openSwipe = useRef<SwipeableMethods | null>(null);
  const guardedBook = useGuardedBookingNav();
  const bookFor = (c: Client) => {
    const primary =
      (c.locations ?? []).find((l) => l.isPrimary)?.id ??
      (c.locations ?? [])[0]?.id ??
      null;
    guardedBook(c, {
      locationId: primary,
      teamId: statsMap.get(c.id)?.lastTeamId ?? null,
    });
  };

  const confirmArchiveOne = (c: Client) => {
    Alert.alert(
      "Архивировать клиента?",
      `${c.full_name || "Клиент"} исчезнет из рабочего списка. Вся история сохранится, клиента можно будет восстановить.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Архивировать",
          style: "destructive",
          onPress: async () => {
            try {
              const { archived } = await archiveClients.mutateAsync([c.id]);
              if (archived > 0) toast("Клиент перемещён в архив", "success");
            } catch (e) {
              Alert.alert("Не удалось архивировать", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  const onTogglePin = (c: Client) =>
    updateById.mutate({
      id: c.id,
      patch: { pinned_at: c.pinned_at ? null : new Date().toISOString() },
    });

  // ── Bulk-mode helpers ─────────────────────────────────────────────
  const visible = result.filtered; // «Выбрать всё» = всё, что сейчас в списке
  // Считаем ВИДИМЫХ выбранных: массовое действие работает по ним же,
  // а selectedIds может помнить исчезнувших из выдачи.
  const pickedCount = visible.reduce(
    (n, c) => (selectedIds.has(c.id) ? n + 1 : n),
    0,
  );
  const allSelected =
    visible.length > 0 && visible.every((c) => selectedIds.has(c.id));

  const enterSelection = (seedId?: string) => {
    setSelecting(true);
    setSelectedIds(seedId ? new Set([seedId]) : new Set());
  };
  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((c) => c.id)));

  // Массовые действия — строго по ВИДИМОМУ списку: если фильтр изменился
  // после выбора, «Архивировать 12» не должно задеть невидимых.
  const selectedClients = useMemo(
    () => result.filtered.filter((c) => selectedIds.has(c.id)),
    [result.filtered, selectedIds],
  );

  const onExport = async () => {
    if (selectedClients.length === 0) return;
    try {
      const shared = await shareClientsCsv(selectedClients, tags);
      if (shared) {
        toast(`CSV выгружен (${selectedClients.length})`, "success");
        exitSelection();
      }
    } catch (e) {
      Alert.alert("Не удалось выгрузить", (e as Error).message);
    }
  };

  const onArchive = () => {
    const n = selectedClients.length;
    if (n === 0) return;
    const word = countWordRu(n, "клиента", "клиента", "клиентов");
    Alert.alert(
      `Архивировать ${n} ${word}?`,
      "Клиенты исчезнут из рабочего списка. Заявки, инвойсы и финансовая история сохранятся; клиентов можно восстановить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Архивировать",
          style: "destructive",
          onPress: async () => {
            try {
              const { archived, failed } = await archiveClients.mutateAsync(
                selectedClients.map((c) => c.id),
              );
              if (failed > 0 && archived > 0) {
                toast(`В архиве: ${archived}, не удалось: ${failed}`, "error");
              } else if (failed > 0) {
                Alert.alert(
                  "Не удалось архивировать",
                  `Ни один из ${failed} клиентов не архивирован. Проверьте соединение и попробуйте ещё раз.`,
                );
                return;
              } else {
                toast(`Перемещено в архив: ${archived}`, "success");
              }
              exitSelection();
            } catch (e) {
              Alert.alert("Не удалось архивировать", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  return (
    // edges top-only: экран внутри Tabs — нижний safe-area держит таб-бар,
    // иначе двойной инсет (~34pt зазор над CTA). Паттерн chats/(dashboard).
    <Screen edges={["top"]}>
      {selecting ? (
        // Селекшн-хедер: Отмена · «Выбрано N» · Выбрать всё/Снять.
        <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
          <Pressable
            onPress={exitSelection}
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор"
            className="min-h-11 justify-center px-1 active:opacity-60"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: t.accent }}
            >
              Отмена
            </Text>
          </Pressable>
          <Text className="text-base font-semibold" style={{ color: t.ink }}>
            {pickedCount > 0
              ? `Выбрано ${pickedCount}`
              : "Выберите клиентов"}
          </Text>
          <Pressable
            onPress={toggleAll}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? "Снять всё" : "Выбрать всё"}
            className="min-h-11 justify-center px-1 active:opacity-60"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: t.accent }}
            >
              {allSelected ? "Снять" : "Всё"}
            </Text>
          </Pressable>
        </View>
      ) : (
        // Шапка в анатомии CalendarHeader (правило единого стиля): полоса
        // на surface с нижним разделителем, шестерёнка СЛЕВА (44×44,
        // t.sub 21/2), по центру — поиск (заголовок-дубль «Клиенты»
        // убран: имя вкладки уже в таб-баре), справа — аналитика и «+».
        // Вход в мультивыбор переехал в long-press меню строки (web v313).
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            minHeight: 48,
            backgroundColor: t.surface,
            borderBottomWidth: 1,
            borderBottomColor: t.separator,
          }}
        >
          <Pressable
            onPress={() => router.push("/clients/settings")}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Настройки клиентов"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Settings color={t.sub} size={21} strokeWidth={2} />
          </Pressable>

          <View
            className="h-9 flex-1 flex-row items-center gap-1.5 px-2.5"
            style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
          >
            <Search color={t.faint} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              // Приём Jobber: активные фильтры меняют плейсхолдер — статус
              // «список отфильтрован» виден даже без открытия панели.
              placeholder={
                result.activeCount > 0
                  ? "Поиск среди отфильтрованных"
                  : "Имя, телефон, адрес"
              }
              accessibilityLabel="Поиск клиентов"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              maxFontSizeMultiplier={1.3}
              className="flex-1 text-[15px]"
              style={{ color: t.ink, paddingVertical: 0 }}
            />
          </View>

          {role === "owner" ? (
            <Pressable
              onPress={() => router.push("/cabinet/insights")}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Аналитика по клиентам"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 22,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <BarChart3 color={t.sub} size={21} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Фильтры прячем в режиме выбора — фокус на наборе. Пока грузим
          или упали — бара нет: он печатал «Всего 0 клиентов» поверх
          спиннера и поверх экрана ошибки. */}
      {!selecting && !isLoading && !error ? (
        <ClientsFilterBar
          totalCount={clients.length}
          foundCount={result.filtered.length}
          activeCount={result.activeCount}
          tokens={result.activeTokens}
          onOpen={() => {
            setInitialFacet(null);
            setSheetOpen(true);
          }}
          onOpenToken={(tok) => {
            // «Период» — не фасет-попап (у него свои пресеты/колёса):
            // открываем лист как обычно, остальное — сразу на измерении.
            setInitialFacet(tok.key === "period" ? null : tok.key);
            setSheetOpen(true);
          }}
          onRemoveToken={removeToken}
          onReset={resetAll}
        />
      ) : null}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={30} label="Загрузка клиентов" />
        </View>
      ) : error ? (
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить клиентов"
          message={
            (error as Error).message ||
            "Проверьте соединение и повторите попытку."
          }
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <>
        {/* Дообновление в фоне: данные на экране уже есть, поэтому индикация
            не имеет права сдвигать список. */}
        <LoadingBar visible={isRefetching && !pull.refreshing} />
        <FlatList
          style={{ flex: 1 }}
          accessibilityLabel="Список клиентов"
          data={result.filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          // Низ списка не должен прятаться под нижней панелью массовых
          // действий в режиме выбора; вне выбора — небольшой отступ.
          contentContainerStyle={{
            paddingBottom: selecting ? 108 : 24,
          }}
          renderItem={({ item }) => {
            const stats = statsMap.get(item.id);
            const teamName = stats?.lastTeamId
              ? (teams.find((tm) => tm.id === stats.lastTeamId)?.name ?? null)
              : null;
            return (
              <ClientRow
                client={item}
                stats={stats}
                teamName={teamName}
                tags={tags}
                cardFields={cardFields}
                selectionMode={selecting}
                picked={selectedIds.has(item.id)}
                onPress={() =>
                  selecting
                    ? toggleId(item.id)
                    : router.push(`/clients/${item.id}`)
                }
                evidence={segmentEvidence(item, filter.segments, stats)}
                onSwipeOpen={(row) => {
                  if (openSwipe.current && openSwipe.current !== row) {
                    openSwipe.current.close();
                  }
                  openSwipe.current = row;
                }}
                onBook={() => bookFor(item)}
                onRemind={() => setRemindClient(item)}
                onArchive={() => confirmArchiveOne(item)}
                onLongPress={() =>
                  selecting ? toggleId(item.id) : setMenuClient(item)
                }
              />
            );
          }}
          ItemSeparatorComponent={() => (
            <View
              className="ml-[68px] h-px"
              style={{ backgroundColor: t.separator }}
            />
          )}
          refreshControl={
            // В режиме выбора pull-to-refresh отключаем — refetch мог бы
            // выронить выбранные строки из-под чекбоксов.
            selecting ? undefined : (
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={t.accent}
              />
            )
          }
          ListEmptyComponent={
            filtering ? (
              <EmptyState
                title="Ничего не найдено"
                subtitle="Измените запрос или сбросьте фильтры"
                action={{
                  label: "Сбросить",
                  onPress: () => {
                    setQuery("");
                    setFilter(resetFilters());
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={<Users color={t.faint} size={40} strokeWidth={1.5} />}
                title="Пока нет клиентов"
                subtitle="Телефон — и клиент в базе, остальное добавите на карточке"
                action={{
                  label: "Добавить клиента",
                  onPress: () => router.push("/clients/new"),
                }}
              />
            )
          }
        />
        </>
      )}

      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу (стандарт «Добавить»: как
          «Добавить операцию» в Финансах, вместо отдельной иконки в шапке). */}
      {selecting ? (
        <BulkActionBar
          count={pickedCount}
          onSms={() => setSmsOpen(true)}
          onExport={onExport}
          onArchive={onArchive}
        />
      ) : (
        <View
          style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}
        >
          <GradientButton
            label="Добавить клиента"
            onPress={() => router.push("/clients/new")}
          />
        </View>
      )}

      <RemindSheet
        visible={remindClient !== null}
        clientName={remindClient?.full_name}
        hasReminder={!!remindClient?.reminder_at}
        onPick={(reminder_at) => {
          if (remindClient) {
            updateById.mutate({
              id: remindClient.id,
              patch: { reminder_at },
            });
          }
        }}
        onClose={() => setRemindClient(null)}
      />
      <ClientActionsSheet
        client={menuClient}
        onBook={bookFor}
        onClose={() => setMenuClient(null)}
        onSelectMany={(c) => enterSelection(c.id)}
        onTogglePin={onTogglePin}
        onRemind={openRemindMenu}
        onArchive={confirmArchiveOne}
      />
      <ClientsFilterSheet
        visible={sheetOpen}
        filter={filter}
        result={result}
        dataFrom={dataSpan.from}
        dataTo={dataSpan.to}
        search={query}
        onClearSearch={setQuery}
        initialFacet={initialFacet}
        sort={sort}
        onSortChange={(s) => setSort.mutate(s)}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
      />
      <ImportWizardSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <ContactsImportSheet
        visible={contactsOpen}
        onClose={() => setContactsOpen(false)}
      />
      <BulkSmsSheet
        visible={smsOpen}
        recipients={selectedClients}
        onClose={() => setSmsOpen(false)}
        onSent={() => {
          setSmsOpen(false);
          exitSelection();
        }}
      />
    </Screen>
  );
}
