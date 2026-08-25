import { useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeftRight, Settings2 } from "lucide-react-native";
import { useIsFetching } from "@tanstack/react-query";
import { money, moneySign } from "@babun/shared/common/utils/money";
import {
  FORMS_SCHET,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import { getStorage } from "@babun/shared/storage";
import { useIsOnline } from "@babun/shared/sync";
import type { AccountWithBalance } from "@/features/finances/accounts";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { AccountCreateSheet } from "@/features/finances/AccountCreateSheet";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { CashCountSheet } from "@/features/finances/CashCountSheet";
import { useLastCashCounts } from "@/features/finances/cash-counts";
import {
  snapshotNote,
  useAccountsSnapshot,
  type AccountsSnapshotData,
} from "@/features/finances/accounts-snapshot";
import { accountIcon, accountSubtitle } from "@/features/finances/account-ui";
import { TRANSFER_NEEDS_SECOND_ACCOUNT } from "@/features/finances/account-alerts";
import {
  accountsTeamChips,
  isSelfNamedTeam,
  NO_TEAM,
  sumAccountBalances,
  teamAccounts,
} from "@/features/finances/accounts-sections";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { AddRow } from "@/components/ui/AddRow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { RowCaption, RowGroup, RowGroupBody } from "@/components/ui/card-rows";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { chooseOption } from "@/lib/choose";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import { useTenantId } from "@/lib/tenant";

// ЭКРАН СЧЕТОВ — ОДНА КОМАНДА ЗА РАЗ (владелец 2026-08-11).
//
// Шапка → лента команд → сумма выбранной → её счета → «Добавить счёт». Всё.
// Сумма считается по ТОМУ ЖЕ списку, который нарисован ниже, и подписана его
// именем: цифру можно проверить пальцем, а подпись не может соврать о том,
// что просуммировано.
//
// УБРАНО 2026-08-11 (иначе через месяц вернут как «забытое»):
//   • чип «Все» — «хочешь посмотреть команду, переключайся». Активной всегда
//     является конкретная команда, первая в справочнике по умолчанию;
//   • период целиком («Пришло за август», выбор периода, наличные на руках) —
//     «на счету столько-то денег, вот и всё». Сводку «сколько зашло/ушло»
//     владелец делает отдельно, на экране «Финансы»;
//   • секция «Счёт компании» и само понятие: счёт принадлежит ровно одной
//     команде (владелец 2026-08-15), а наследие старой схемы — счета без
//     команды — стоит под псевдо-чипом «Без команды»;
//   • секции «Команда в архиве» и «Команда удалена». Деньги таких команд при
//     этом остались на экране: у команды с активными счетами чип есть всегда,
//     даже если её самой уже нет в справочнике (см. `accountsTeamChips`);
//   • строка «Все операции · Финансы» под списком;
//   • футеры-объяснялки под группами — «постоянно читать надо». Единственная
//     подсказка (про свайп) показывается ОДИН раз и гаснет навсегда после
//     первого же успешного свайпа.

/** Крупный системный шрифт: строка счёта перестраивается в стопку, иначе
 *  сумма справа обрезается первой. */
const STACK_ABOVE_FONT_SCALE = 1.35;

/** Подсказка про свайп живёт до первого удавшегося свайпа — ровно как в
 *  подсказке пустого календаря (MMKV, ключ под общим префиксом `babun:`,
 *  значит смена учётки уносит её вместе со всем остальным). */
const SWIPE_HINT_KEY = "babun:hint-accounts-swipe";

/** Подпись обязана называть ровно то множество, которое просуммировано.
 *  «Команда 2 на счетах», а не «У команды Команда 2 на счетах»: имя, которое
 *  уже называет команду, вторым таким же словом не подписывают. */
function heroLabelFor(chip: { id: string; name: string }): string {
  // Псевдо-чип «Без команды» уже сам себя называет: «У команды Без команды» —
  // удвоение того же слова, только через отрицание.
  if (chip.id === NO_TEAM) return "Без команды на счетах";
  return isSelfNamedTeam(chip.name)
    ? `${chip.name} на счетах`
    : `У команды ${chip.name} на счетах`;
}

export default function AccountsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const tenantId = useTenantId();
  const online = useIsOnline();
  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  // ВСЕ команды, включая архивные: счёт живёт дольше своей команды, и её имя
  // нужно и листу перевода, и подписи пересчёта.
  const teamsQuery = useTeams({ includeInactive: true });
  // Сверки касс — тоже подпись, и тоже не гейтит: пока ответа нет, строка
  // молчит о сверке, а не объявляет кассу непересчитанной.
  const cashCounts = useLastCashCounts();

  // ЖИВЫЕ ДАННЫЕ — ТОЛЬКО КОГДА ПРИЕХАЛИ ОБЕ ПОЛОВИНЫ. Счета с сервера и
  // команды из снимка (или наоборот) нарисовали бы чужой список под чипом
  // живой команды — экран о деньгах врать не имеет права даже формой.
  const live = useMemo<AccountsSnapshotData | null>(
    () =>
      accountsQuery.data && teamsQuery.data
        ? { accounts: accountsQuery.data, teams: teamsQuery.data }
        : null,
    [accountsQuery.data, teamsQuery.data],
  );
  const view = useAccountsSnapshot(tenantId, live);

  const allTeams = useMemo(() => view.data?.teams ?? [], [view.data]);
  const teams = useMemo(() => allTeams.filter((x) => x.is_active), [allTeams]);
  const teamById = useMemo(
    () => new Map(allTeams.map((team) => [team.id, team])),
    [allTeams],
  );

  const all = useMemo(() => view.data?.accounts ?? [], [view.data]);
  const accounts = useMemo(() => all.filter((a) => a.is_active), [all]);

  // ЛЕНТА: активные команды плюс те, чьи счета иначе не видно нигде. Правило
  // живёт в `accounts-sections.ts` и покрыто тестом.
  const chips = useMemo(
    () => accountsTeamChips({ accounts, teams: allTeams }),
    [accounts, allTeams],
  );

  // ВЫБРАННАЯ КОМАНДА ВСЕГДА КОНКРЕТНАЯ. Держим её ВЫВЕДЕННОЙ, а не в
  // эффекте: справочник приезжает асинхронно, и первая команда обязана
  // появиться в том же кадре, что и лента. Заодно чинится случай «команду
  // заархивировали с другого экрана, пока чип стоял на ней».
  const [picked, setPicked] = useState<string | null>(null);
  // `?team=` — с кем сюда пришли: тост «команде созданы счета» ведёт на счета
  // ИМЕННО ЭТОЙ команды. Параметр читается ВЫВЕДЕННО, тем же правилом, что и
  // сам чип: положить его в состояние эффектом значило бы показать кадр с
  // чужой командой, пока эффект не отработал.
  const { team: wantedTeam } = useLocalSearchParams<{ team?: string }>();
  const chip =
    (picked ? chips.find((x) => x.id === picked) : null)
    ?? (wantedTeam ? chips.find((x) => x.id === wantedTeam) : null)
    ?? chips[0]
    ?? null;
  const teamId = chip?.id ?? null;

  // ЕДИНСТВЕННОЕ МНОЖЕСТВО ЭКРАНА: строки и сумма считаются по нему, поэтому
  // разойтись им негде.
  const rows = useMemo(
    () => (teamId ? teamAccounts(accounts, teamId) : []),
    [accounts, teamId],
  );
  const total = useMemo(() => sumAccountBalances(rows), [rows]);

  const [createOpen, setCreateOpen] = useState(false);
  /** Кому заводим счёт — команда, выбранная чипом в момент открытия листа.
   *  Лист сам перепроверит её по живому справочнику. */
  const [createTeamId, setCreateTeamId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  /** Источник перевода. `null` — вошли иконкой ⇄ из шапки, стороны не выбраны. */
  const [transferFromId, setTransferFromId] = useState<string | null>(null);
  /** Пересчитываемая касса. Держим ID, а не строку: пока лист открыт, список
   *  дообновляется, и остаток в листе обязан ехать за сервером. */
  const [countingId, setCountingId] = useState<string | null>(null);
  const counting = countingId
    ? (accounts.find((a) => a.id === countingId) ?? null)
    : null;
  const [swipeLearned, setSwipeLearned] = useState(
    () => getStorage().getRaw(SWIPE_HINT_KEY) === "1",
  );

  const openCreate = () => {
    setCreateTeamId(teamId);
    setCreateOpen(true);
  };

  // ДЕНЬГИ ДВИГАЮТСЯ ОТ СТРОКИ СЧЁТА. Единственная точка открытия листа:
  // свайп, меню долгого нажатия, ротор VoiceOver и иконка в шапке ведут сюда,
  // и потому не могут разойтись в поведении.
  //
  // При единственном счёте лист открылся бы пустым шагом «Куда» (перевод —
  // движение между двумя счетами), поэтому та же единственная точка вместо
  // тупика называет причину и предлагает завести второй счёт.
  const openTransfer = (account: AccountWithBalance | null) => {
    if (accounts.length < 2) {
      const text = TRANSFER_NEEDS_SECOND_ACCOUNT;
      Alert.alert(text.title, text.message, [
        { text: "Отмена", style: "cancel" },
        { text: text.confirm, onPress: openCreate },
      ]);
      return;
    }
    setTransferFromId(account?.id ?? null);
    setTransferOpen(true);
  };

  // Смена команды называет результат вслух: без объявления VoiceOver слышит
  // только «выбрано» и не знает, что стало с деньгами.
  const selectTeam = (id: string) => {
    setPicked(id);
    const next = teamAccounts(accounts, id);
    const picked = chips.find((x) => x.id === id) ?? { id, name: "" };
    AccessibilityInfo.announceForAccessibility(
      `${heroLabelFor(picked)}: ${money(sumAccountBalances(next))}, ${formatCountRu(
        next.length,
        FORMS_SCHET,
      )}`,
    );
  };

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending. Без сети запрос стоит в
  // paused и остаётся pending навсегда — экран крутил вечный спиннер без
  // единого слова. Данные — это ответ сервера ИЛИ снимок с этого телефона.
  const hasData = view.data !== null;
  const loadError = hasData
    ? null
    : (accountsQuery.error ?? teamsQuery.error ?? null);
  const refreshAll = () =>
    Promise.all([
      accountsQuery.refetch(),
      teamsQuery.refetch(),
      cashCounts.refetch(),
    ]);
  // Контрол тянут пальцем — он обязан отпустить. Без сети `refetch` у
  // paused-запроса не резолвится вовсе, и вертушка крутилась бы до появления
  // связи; про офлайн человеку уже сказано меткой в шапке.
  const pull = usePullRefresh(() => (online ? refreshAll() : Promise.resolve()));
  const busy = useIsFetching({ queryKey: ["accounts"] });
  // Фоновое дообновление — полоска под шапкой; контент при этом на месте и
  // ни одна строка не двигается.
  const backgroundBusy = hasData && !pull.refreshing && busy > 0;

  const title = "Счета";
  // Вторая строка шапки — ТОЛЬКО при несвежих данных: «Данные на 14:32 · нет
  // сети». На живых данных её нет вовсе, а пока обновление в полёте — молчит:
  // на тёплом старте она моргнула бы на кадр и сдвинула контент.
  const staleNote =
    view.at === null || backgroundBusy || pull.refreshing
      ? undefined
      : snapshotNote(view.at, new Date(), online);

  // ─── Строка счёта ────────────────────────────────────────────────────────

  // ПОДПИСЕЙ ПОД ИМЕНЕМ СЧЁТА БОЛЬШЕ НЕТ (владелец 2026-08-17: «касса — на
  // руках 21 день, что за хуйня… убирайте подсказки, просто счёт»). Строка
  // счёта отвечает на один вопрос — сколько там денег. Возраст остатка и
  // давность сверки живут на самом счёте, где их и правят: строка «Пересчитать»
  // печатает «Сверяли во вторник», и это ответ на месте действия, а не
  // напоминание в списке.

  // ДУБЛЁРЫ ЖЕСТА. Свайпа для VoiceOver не существует вовсе, поэтому у него
  // есть меню по долгому нажатию и действия ротора — те же и в том же
  // порядке. Ни одно денежное действие не живёт только в жесте.
  //
  // «Пересчитать» стоит только у наличных: на карте и в банке остаток считает
  // банк, и сервер такую сверку отобьёт. Свайп при этом остаётся ОДНИМ
  // действием — второе на кромку не вешаем: у кромки нет подписи, которую
  // можно прочитать до того, как палец её выберет.
  const rowActions = (a: AccountWithBalance) =>
    a.kind === "cash"
      ? [
          { name: "transfer", label: "Перевести" },
          { name: "count", label: "Пересчитать" },
          { name: "settings", label: "Настройки счёта" },
        ]
      : [
          { name: "transfer", label: "Перевести" },
          { name: "settings", label: "Настройки счёта" },
        ];

  const runRowAction = (a: AccountWithBalance, name: string) => {
    if (name === "transfer") openTransfer(a);
    else if (name === "count") setCountingId(a.id);
    else if (name === "settings") router.push(`/accounts/${a.id}/settings`);
  };

  const openRowMenu = (a: AccountWithBalance) => {
    const actions = rowActions(a);
    void chooseOption(a.name, actions).then((index) => {
      if (index === null) return;
      // Меню — тоже нижний лист: своё окно поверх него не появится, пока оно
      // не уедет. Тот же SHEET_EXIT_MS, что и в остальных листах выбора.
      setTimeout(() => runRowAction(a, actions[index].name), SHEET_EXIT_MS);
    });
  };

  /** Свайп удался — подсказка своё отработала и больше не показывается. */
  const rememberSwipe = () => {
    if (swipeLearned) return;
    getStorage().setRaw(SWIPE_HINT_KEY, "1");
    setSwipeLearned(true);
  };

  /** Строка списка: свайп влево = «Перевести» на ЛЮБОМ виде счёта. Одна
   *  кромка — одно слово, и действие обратимо (оно только открывает лист),
   *  поэтому размашистый свайп срабатывает сразу. */
  const renderRow = (a: AccountWithBalance) => {
    const negative = moneySign(a.balance) < 0;
    // Пустой счёт печатается тише живого: «€0» у кассы и «€5» на карте были
    // набраны одинаково громко, и глаз не находил, где лежат деньги. «Ноль» —
    // по округлённым центам (moneySign): сравниваем ровно то, что напечатано.
    const empty = moneySign(a.balance) === 0;
    return (
      <SwipeRow
        label="Перевести"
        color={t.accent}
        icon={ArrowLeftRight}
        accessibilityLabel={`Перевести со счёта ${a.name}`}
        fullSwipe
        onAction={() => {
          rememberSwipe();
          openTransfer(a);
        }}
      >
        <SettingsRow
          // Значок и цвет счёта — то, чем его узнают пальцем; не выбраны —
          // глиф по виду счёта и без цветного диска.
          icon={accountIcon(a)}
          tile={a.color ?? "neutral"}
          title={a.name}
          value={money(a.balance)}
          valueColor={negative ? t.danger : undefined}
          valueQuiet={empty}
          stacked={fontScale > STACK_ABOVE_FONT_SCALE}
          // Озвучка собирается из смысла: минус на счёте — это долг, а не
          // «минус четыреста десять».
          a11yLabel={[
            a.name,
            negative
              ? `долг ${money(Math.abs(a.balance))}`
              : `остаток ${money(a.balance)}`,
          ]
            .filter(Boolean)
            .join(", ")}
          a11yActions={rowActions(a)}
          onA11yAction={(name) => runRowAction(a, name)}
          onPress={() => router.push(`/accounts/${a.id}`)}
          onLongPress={() => openRowMenu(a)}
        />
      </SwipeRow>
    );
  };

  // ─── Состояния ───────────────────────────────────────────────────────────
  // Порядок один на весь экран: сперва ошибка (сервер ответил и отказал),
  // потом офлайн без снимка (спрашивать некого), и только потом загрузка.
  // Бесконечного спиннера не остаётся ни в одном сценарии.

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          // Текст сервера идёт как есть: owner-only функции отвечают
          // по-русски и знают то, чего клиент не знает.
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: () => void refreshAll() }}
        />
      </Screen>
    );
  }

  if (!hasData) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        {online ? (
          <EmptyState state="loading" fill title="Загружаем счета" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счета ещё не загружены на это устройство"
            action={{ label: "Повторить", onPress: () => void refreshAll() }}
          />
        )}
      </Screen>
    );
  }

  // ─── Сумма выбранной команды ─────────────────────────────────────────────

  const heroLabel = chip ? heroLabelFor(chip) : "";
  const heroCount = formatCountRu(rows.length, FORMS_SCHET);
  const hero = (
    // ЗАЗОР ПОД ИТОГОМ — АБЗАЦНЫЙ (20 против 8 между счетами, 2.5:1): «сколько
    // всего» и «где лежит» — два разных вопроса, и граница между ними держится
    // воздухом, а не линией.
    <Card
      style={{
        marginHorizontal: GUTTER,
        marginTop: 12,
        marginBottom: 20,
        paddingHorizontal: 16,
        paddingVertical: 20,
      }}
    >
      {/* Карточка — ОДИН элемент VoiceOver: деньги читаются одной фразой, а
          не двумя обрывками. */}
      <View accessible accessibilityLabel={`${heroLabel}: ${money(total)}, ${heroCount}`}>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 11,
            lineHeight: 14,
            fontWeight: "700",
            letterSpacing: 0.8,
            textTransform: "uppercase",
            // Подпись НАЗЫВАЕТ число, но сама числом не является: полным ink
            // она несла 431 pt² чернил против 269 pt² у «€5» — была в 1.6 раза
            // тяжелее того, что подписывает.
            color: t.caption,
          }}
        >
          {heroLabel}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginTop: 2,
            // Display 34/40/800 — дизайн-система сама держит этот набор под
            // главное число экрана, а герой был недонабран собственной
            // системой (26/32/700) и весил меньше своей подписи.
            fontSize: 34,
            lineHeight: 40,
            fontWeight: "800",
            letterSpacing: -0.8,
            // Знак считается по ОКРУГЛЁННЫМ центам, иначе обнулённая касса
            // печаталась бы красным «€0».
            color: moneySign(total) < 0 ? t.danger : t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {money(total)}
        </Text>
        {/* СЧЁТ СТРОК НЕ ПЕЧАТАЕМ: «2 счёта» стояло прямо над двумя строками
            счетов (владелец 2026-08-17: «на хуя писать два счёта, если это и
            так видно»). Число живёт только в озвучке карточки — там списка
            под пальцем нет, и сказать, сколько их, нужно словами. */}
      </View>
    </Card>
  );

  return (
    <Screen edges={["top"]}>
      {/* Шов ОДИН, и несёт его ШАПКА: лента команд лежит на канве (`onCanvas`)
          и своей заливки не имеет. Белая полоса под шапкой, которая сама
          стоит на канве, читалась как вторая, лишняя панель. */}
      <ScreenHeader
        title={title}
        subtitle={staleNote}
        right={
          // ДВА ДЕЙСТВИЯ, И ШЕСТЕРЁНКА ПОСЛЕДНЯЯ. На корневых экранах табов
          // она стоит слева, но здесь левый слот занят «Назад», поэтому
          // правило pushed-страницы — справа и всегда крайней.
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {/* Иконка ⇄ рисуется ВСЕГДА — в том числе при единственном
                счёте: тогда тап называет причину и предлагает завести второй
                счёт (см. `openTransfer`). Исчезающая кнопка не отвечает ни
                на один вопрос. */}
            <Pressable
              onPress={() => openTransfer(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Перевод между счетами"
              style={({ pressed }) => ({
                height: 40,
                width: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <ArrowLeftRight color={t.accent} size={ICON.md} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/accounts/settings")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Настройки счетов"
              style={({ pressed }) => ({
                height: 40,
                width: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              {/* Нейтральные чернила, а не кобальт: настройка — не денежное
                  действие, и спорить за внимание с ⇄ она не должна. */}
              <Settings2 color={t.body} size={ICON.md} />
            </Pressable>
          </View>
        }
      />
      {/* Лента рисуется, только если команд ≥ 2: у бригадира с одной командой
          переключать не на что. */}
      {chips.length >= 2 ? (
        <ScopeChips
          items={chips.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
          activeId={teamId}
          onCanvas
          onSelect={selectTeam}
        />
      ) : null}
      <LoadingBar visible={backgroundBusy} />

      {!chip ? (
        <EmptyState
          fill
          title="Команд пока нет"
          subtitle="Счёт заводится на команду — сперва добавьте команду"
          action={{
            label: "Добавить команду",
            onPress: () => router.push("/cabinet/teams"),
          }}
        />
      ) : rows.length === 0 ? (
        // Чья команда — уже сказано выбранным чипом наверху (а при одной
        // команде вопроса нет вовсе), поэтому имя во фразу не вставляем: у
        // «Команды Юра» и «Команды 2» разные падежи, и склеенная фраза
        // ломается на одном из них.
        <EmptyState
          fill
          title="Пока нет счетов"
          action={{ label: "Добавить счёт", onPress: openCreate }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={hero}
          // КАЖДЫЙ СЧЁТ — ОТДЕЛЬНАЯ КАРТОЧКА, А НЕ СТРОКА В ОБЩЕЙ (владелец
          // 2026-08-11: «сделай разделитель между счетами»). Раньше строки
          // склеивались в одну карточку с волосяной линией от 56pt, и список
          // читался как один объект с подпунктами. Но счёт — это отдельная
          // ёмкость с деньгами: касса лежит в машине у одной команды, карта —
          // в кармане у другой, и потерять их можно по отдельности. Зазор
          // между карточками говорит это без единого слова.
          renderItem={({ item }) => (
            <View style={{ marginBottom: 8 }}>
              <RowGroupBody first last>
                {renderRow(item)}
              </RowGroupBody>
            </View>
          )}
          ListFooterComponent={
            <View>
              {/* Подсказка живёт до первого удавшегося свайпа — «она должна
                  как-то один раз показаться» (владелец 2026-08-11). */}
              {swipeLearned ? null : (
                <RowCaption text="Проведите по строке влево, чтобы перевести деньги." />
              )}
              {/* СОЗДАНИЕ — ОДНА ДВЕРЬ И ВНИЗУ. Плюса в шапке нет: там уже два
                  значка, а универсального глифа «плюс» в продукте не заведено
                  вовсе — создание везде выглядит строкой со словом (AddRow).
                  Второй такой же вход сверху был бы просто вторым способом
                  сделать то же самое.
                  У команды, которой нет в справочнике, двери нет: её счета
                  дочитывают и разгружают, а заводить новые не на кого. */}
              {chip?.orphan ? null : (
                <RowGroup>
                  <AddRow label="Добавить счёт" onPress={openCreate} />
                </RowGroup>
              )}
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={t.accent}
            />
          }
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          }}
        />
      )}

      <AccountCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        teams={teams}
        accounts={all}
        presetTeamId={createTeamId}
      />
      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={accounts}
        teamById={teamById}
        presetFromId={transferFromId}
      />
      <CashCountSheet
        visible={counting !== null}
        onClose={() => setCountingId(null)}
        account={counting}
        subtitle={
          counting
            ? accountSubtitle(counting, (id) => teamById.get(id)?.name ?? null)
            : ""
        }
      />
    </Screen>
  );
}
