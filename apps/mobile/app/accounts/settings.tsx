import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { settingsTeamId } from "@/features/finances/team-settings-lines";
import { useClosedAccountActions } from "@/features/finances/accounts-page/use-closed-account-actions";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { useIsOnline } from "@babun/shared/sync";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { ReorderList } from "@/components/ui/ReorderList";
import { RowCaption, RowGroupHeader } from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import { notify } from "@/lib/notify";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import {
  ACCOUNT_ROW_H,
  AccountRow,
} from "@/features/finances/accounts-page/AccountRow";
import {
  accountEditParam,
  accountRowMark,
  presetTeamFor,
} from "@/features/finances/accounts-page/page-rules";
import { useHideAccount } from "@/features/finances/accounts-page/use-hide-account";
import {
  useAccountsWithBalances,
  useDeletedAccounts,
  useReorderAccounts,
  useUnassignedMoney,
} from "@/features/finances/accounts";
import {
  accountOrderGroups,
  financeAccountsHref,
  sumAccountBalances,
} from "@/features/finances/accounts-sections";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// СЧЕТА — ОДНА СТРАНИЦА ЗА ДВУМЯ ДВЕРЯМИ (владелец 2026-09-15).
//
// «Когда я захожу в счета — есть счета, два; справа сделай строчки. Я нажимаю
// на эти строчки — перекидывается именно на страницу… оно открывается как
// услуга по сути; и влево свайп — скрыть; и можно их перетаскивать, менять
// местами; внизу кнопка „Добавить счёт“». И про шестерёнку: «эту настройку
// поставь в шестерёнку, и там счета, чтоб была одна и та же страница».
//
// Поэтому страница собрана по рецепту прайса услуг (`cabinet/services.tsx`):
// строка-карточка на команду, ручка справа, «Скрыть» на левой кромке, тап —
// правка, главное действие — кнопкой в футере. Правка и создание — ОДНА
// шторка (`AccountEditorSheet`): «ещё лучше не полноценная страница, а
// шторка… я могу также тапнуть на тот же созданный и то же самое
// редактировать».
//
// ОСТАТКИ В СТРОКАХ ЕСТЬ: шестерёнка ведёт сюда мимо панели, и другого места
// увидеть деньги счёта у этой двери нет.
//
// ДЕНЬГИ АРХИВНОЙ КОМАНДЫ ЗДЕСЬ ВИДНЫ (критика плана, блокер 2): «Финансы»
// показывают только живые команды, и у этих счетов нет другой двери. Группа у
// них своя, см. `accountOrderGroups`.
//
// ПРАВА: счета заводит, правит, двигает и закрывает только владелец (RLS
// `accounts_owner_all`); обе двери сюда — ползунки «Счетов» и шестерёнка —
// стоят только у владельца.

/** Въезд страницы и отъезд листа, с которого на неё пришли. */
const EDIT_AFTER_PUSH_MS = SHEET_EXIT_MS + 350;

export default function AccountsScreen() {
  const online = useIsOnline();
  const t = useThemeColors();
  const router = useRouter();
  const deletedQuery = useDeletedAccounts();
  // Полный список: закрытые нужны счётчику двери в архив и шторке правки.
  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  // ВСЕ команды, включая архивные: по ним называются группы осиротевших
  // счетов и строится подпись команды в листе перевода.
  const teamsQuery = useTeams({ includeInactive: true });
  const unassigned = useUnassignedMoney();
  const reorder = useReorderAccounts();
  const [dragging, setDragging] = useState(false);
  // Оптимистичные позиции: после отпускания пальца строка обязана остаться
  // там, куда её положили, а не прыгнуть обратно на те 300 мс, пока сервер
  // подтверждает запись. Ключ — id счёта, значение — новая позиция.
  const [moved, setMoved] = useState<Record<string, number>>({});

  // ШТОРКА ПРАВКИ ПО АДРЕСУ `?edit=<uuid>`: старый `/accounts/<id>/settings` и
  // лист операции приводят сюда уже с открытым счётом. Читается при входе и
  // ещё раз, только если адрес назвал ДРУГОЙ счёт — закрытая шторка не
  // всплывает снова от повторного рендера. `id` живёт отдельно от `open`,
  // чтобы уезжающая шторка не меняла содержимое на полпути.
  const { edit, team: teamParam } = useLocalSearchParams<{
    edit?: string | string[];
    team?: string;
  }>();
  const editParam = accountEditParam(edit);
  // Шторка по адресу поднимается ПОСЛЕ въезда страницы: открытая в первом
  // рендере, она попадала на анимацию перехода (а из листа операции — ещё и
  // на его отъезд) и не появлялась вовсе (ревью 2026-09-15).
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>(
    () => ({ open: false, id: editParam }),
  );
  const appliedEdit = useRef<string | null>(null);
  useEffect(() => {
    if (!editParam || appliedEdit.current === editParam) return;
    appliedEdit.current = editParam;
    const timer = setTimeout(
      () => setEditor({ open: true, id: editParam }),
      EDIT_AFTER_PUSH_MS,
    );
    return () => clearTimeout(timer);
  }, [editParam]);

  const all = useMemo(
    () =>
      (accountsQuery.data ?? []).map((account) =>
        account.id in moved
          ? { ...account, position: moved[account.id] }
          : account,
      ),
    [accountsQuery.data, moved],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  // ЗАКРЫТЫЕ — В ТОЙ ЖЕ ГРУППЕ, ВНИЗУ (владелец 2026-09-29: «убери вкладку
  // „Закрытые счета“»). Как скрытая категория: серая строка под открытыми,
  // «Открыть» слева, «Удалить» пустого справа. Группа команды держит и те и
  // другие; итог над группой — только открытые: закрытый счёт не входит ни в
  // один итог.
  // Закрытый счёт стёртой или архивной команды не показываем вовсе: деньги
  // архива в живых финансах не существуют (владелец 2026-09-21), и группа
  // «Команда удалена» из одних серых строк по €0 — шум.
  const groups = useMemo(
    () =>
      accountOrderGroups({
        accounts: all.filter(
          (account) =>
            account.is_active ||
            (!!account.brigade_id && !!teamById.get(account.brigade_id)?.is_active),
        ),
        teams,
      }).map((group) => ({
        ...group,
        accounts: [
          ...group.accounts.filter((account) => account.is_active),
          ...group.accounts.filter((account) => !account.is_active),
        ],
      })),
    [all, teams, teamById],
  );
  const closedActions = useClosedAccountActions();
  const hider = useHideAccount({ accounts: all, teamById });
  // ОДНА КОМАНДА ПО АДРЕСУ (`?team=`, владелец 2026-09-24: «настройки
  // финансов по каждой команде»). Из «Настроек финансов» страница приходит на
  // команде — сверху лента, ниже только её счета, и новый счёт заводится ей.
  // Из панели «Счета» адреса нет, и страница прежняя: все команды группами.
  const liveTeams = useMemo(() => teams.filter((team) => team.is_active), [teams]);
  const teamId = teamParam ? settingsTeamId(liveTeams, teamParam) : null;
  const shownGroups = teamId ? groups.filter((group) => group.key === teamId) : groups;
  // «УДАЛЁННЫЕ СЧЕТА» — ДВЕРЬ ПОД СПИСКОМ, ТОЛЬКО КОГДА ТАМ ЧТО-ТО ЛЕЖИТ
  // (владелец 03.10: «попадают в папку „Удалённые счета"»). Страница сама за
  // шестерёнкой, поэтому дверь здесь, а не ещё одной строкой настроек.
  const deletedCount = (deletedQuery.data ?? []).filter(
    (account) => !teamId || account.brigade_id === teamId,
  ).length;

  /** Новый порядок строк группы: пишем позиции 0, 1, 2… по списку id. */
  const applyOrder = (ids: string[]) => {
    // Снимать оптимистичный порядок после успеха не нужно: он совпадает с
    // тем, что вернёт рефетч, и снятие дало бы лишний кадр старого порядка.
    setMoved((current) => {
      const next = { ...current };
      ids.forEach((id, index) => {
        next[id] = index;
      });
      return next;
    });
    // `mutateAsync`, а не `mutate(…, { onError })`: второй перенос до ответа
    // на первый отцеплял бы колбэки первого, и его отказ прошёл бы молча (та же
    // ловушка react-query 5, что в `accountSaver`).
    void reorder.mutateAsync(ids).catch((e: unknown) => {
      // Сервер не принял — снимаем оптимистичный порядок целиком: показывать
      // порядок, которого нет в базе, значит соврать при следующем входе.
      setMoved({});
      notify(
        "Не удалось сохранить порядок",
        online && e instanceof Error
          ? e.message
          : "Без сети порядок не сохранится — он живёт на сервере.",
      );
    });
  };

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending (§8): без сети запрос стоит
  // в paused и остаётся pending навсегда — экран крутил бы спиннер вечно.
  const hasData =
    accountsQuery.data !== undefined && teamsQuery.data !== undefined;
  const loadError = hasData
    ? null
    : (accountsQuery.error ?? teamsQuery.error ?? null);
  const retry = () => {
    void accountsQuery.refetch();
    void teamsQuery.refetch();
  };

  // Страница стоит НАД вкладками: таб-бара под ней нет, и нижний край держит
  // сам экран — иначе «Добавить счёт» садилась на полоску «домой» (владелец
  // 03.10: «как будто слишком низко»). Та же высота, что у «Записать клиента»
  // поверх записи.
  return (
    <Screen>
      <ScreenHeader
        title="Счета"
        // Холодная ссылка прямо сюда: «назад» ведёт к панели «Счета», откуда
        // сюда и заходят, а не на календарь, куда примитив уводит пустую
        // историю.
        fallbackHref={financeAccountsHref() as Href}
        // Команду выбрали в «Настройках финансов» — страница её и только её
        // (владелец 2026-09-30: «когда захожу в счета, там не должно быть
        // переключения команд»). Имя команды называет шапка группы счетов —
        // второй раз под заголовком оно не повторяется.
      />
      {!hasData && !loadError ? (
        online ? (
          <EmptyState state="loading" fill title="Загружаем счета" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счета ещё не загружены на это устройство"
            action={{ label: "Повторить", onPress: retry }}
          />
        )
      ) : loadError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          scrollEnabled={!dragging}
        >
          {/* Пусто — словами, без кнопки (владелец 2026-09-15: «никаких
              кнопок внутри»). Добавить — футером, закрытые — строкой ниже. */}
          {shownGroups.length === 0 ? (
            <RowCaption text="Счетов нет" />
          ) : null}
          {shownGroups.map((group) => (
            <View key={group.key} style={{ marginTop: 12 }}>
              {/* ПОДЫТОГ СТОИТ НАД ГРУППОЙ, А НЕ ПОД НЕЙ: это заголовок
                  раздела с числом, как везде в продукте. У компании с одной
                  командой имени нет — тогда строку называет слово «На
                  счетах»: сумма без подписи читается как чей-то остаток. */}
              <RowGroupHeader
                title={group.title ?? "На счетах"}
                value={money(
                  sumAccountBalances(group.accounts.filter((account) => account.is_active)),
                )}
              />
              {/* ПОРЯДОК — РУЧКОЙ, КАК ВЕЗДЕ (владелец 2026-09-12: «шесть
                  точек справа для передвижения… везде одно и то же»). Каждая
                  группа — свой список: `position` нумеруется внутри команды,
                  и строка чужой команды между ними ничего не значит.
                  ПОРЯДОК НЕ ПЕРЕАДРЕСУЕТ ДЕНЬГИ: маршрут оплаты держит
                  «Основной счёт команды» в правке счёта. */}
              <View style={{ paddingHorizontal: GUTTER }}>
                <ReorderList
                  items={group.accounts}
                  rowHeight={ACCOUNT_ROW_H}
                  spaced
                  handleInside
                  labelFor={(account) => account.name}
                  onReorder={applyOrder}
                  onDraggingChange={setDragging}
                >
                  {(account, _index, handle) => (
                    <AccountRow
                      account={account}
                      mark={
                        account.is_active ? accountRowMark(account) : "Скрыт"
                      }
                      handle={handle}
                      onPress={() => setEditor({ open: true, id: account.id })}
                      onHide={() => hider.hide(account)}
                      onDelete={() => hider.remove(account)}
                      closed={
                        account.is_active
                          ? null
                          : { onReopen: () => closedActions.openAgain(account) }
                      }
                    />
                  )}
                </ReorderList>
              </View>
            </View>
          ))}
          {/* ДЕНЬГИ БЕЗ СЧЁТА — СЛОВАМИ, А НЕ МОЛЧАНИЕМ (аудит 2026-09-10).
              Сервер считает операции, у которых счёта нет вовсе, и в остатки
              они не попадают. Одно слово с суммой (вкус владельца
              2026-09-06), без инструкции: откуда эти деньги, он знает сам. */}
          {moneySign(unassigned) !== 0 ? (
            <RowCaption text={`Без счёта ${money(unassigned)}`} />
          ) : null}
          {deletedCount > 0 ? (
            <View style={{ marginTop: 16 }}>
              <SectionCard dense>
                <View style={{ paddingHorizontal: 2, paddingVertical: 2 }}>
                  <SelectRow
                    icon={Trash2}
                    color={t.danger}
                    plain
                    title="Удалённые счета"
                    value={String(deletedCount)}
                    accessibilityLabel={`Удалённые счета: ${deletedCount}`}
                    onPress={() =>
                      router.push(
                        (teamId ? `/accounts/trash?team=${encodeURIComponent(teamId)}` : "/accounts/trash") as Href,
                      )
                    }
                  />
                </View>
              </SectionCard>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — В ФУТЕРЕ, ВСЕГДА (AGENTS 7.1): список пуст,
          полон или ещё грузится — кнопка на том же месте. Шторка сама
          дочитывает, что ей нужно, и сама говорит про сеть. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="Добавить счёт"
          onPress={() => setEditor({ open: true, id: null })}
        />
      </View>

      <AccountEditorSheet
        visible={editor.open}
        accountId={editor.id}
        presetTeamId={teamId ?? presetTeamFor(teams)}
        // Страница на команде (`?team=`) — новый счёт ей, без выбора. На
        // общей странице всех команд команду выбирают в листе.
        teamLocked={teamId != null}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {hider.sheet}
    </Screen>
  );
}
