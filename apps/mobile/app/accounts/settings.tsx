import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { useIsOnline } from "@babun/shared/sync";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import {
  NavRow,
  RowCaption,
  RowGroup,
  RowGroupHeader,
} from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import { notify } from "@/lib/notify";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import {
  ACCOUNT_ROW_H,
  AccountRow,
} from "@/features/finances/accounts-page/AccountRow";
import {
  accountEditParam,
  presetTeamFor,
} from "@/features/finances/accounts-page/page-rules";
import { useHideAccount } from "@/features/finances/accounts-page/use-hide-account";
import {
  useAccountsWithBalances,
  useReorderAccounts,
  useUnassignedMoney,
} from "@/features/finances/accounts";
import {
  accountOrderGroups,
  closedCountValue,
  financeAccountsHref,
} from "@/features/finances/accounts-sections";
import { useTeams } from "@/features/reference/queries";

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
  const router = useRouter();
  const online = useIsOnline();
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
  const { edit } = useLocalSearchParams<{ edit?: string | string[] }>();
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
  const closedCount = all.filter((account) => !account.is_active).length;
  const groups = useMemo(
    () =>
      accountOrderGroups({
        accounts: all.filter((account) => account.is_active),
        teams,
      }),
    [all, teams],
  );
  const hider = useHideAccount({ accounts: all, teamById });

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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Счета"
        // Холодная ссылка прямо сюда: «назад» ведёт к панели «Счета», откуда
        // сюда и заходят, а не на календарь, куда примитив уводит пустую
        // историю.
        fallbackHref={financeAccountsHref() as Href}
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
          {groups.length === 0 ? (
            <RowCaption text="Открытых счетов нет" />
          ) : null}
          {groups.map((group) => (
            <View key={group.key} style={{ marginTop: 12 }}>
              {group.title ? <RowGroupHeader title={group.title} /> : null}
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
                      handle={handle}
                      onPress={() => setEditor({ open: true, id: account.id })}
                      onHide={() => hider.hide(account)}
                    />
                  )}
                </ReorderList>
              </View>
            </View>
          ))}
          <RowGroup>
            <NavRow
              label="Закрытые счета"
              // То же слово, что в подписи двери сюда (`accountsDoorLine`).
              value={closedCountValue(closedCount)}
              onPress={() => router.push("/accounts/archive")}
            />
          </RowGroup>
          {/* ДЕНЬГИ БЕЗ СЧЁТА — СЛОВАМИ, А НЕ МОЛЧАНИЕМ (аудит 2026-09-10).
              Сервер считает операции, у которых счёта нет вовсе, и в остатки
              они не попадают. Одно слово с суммой (вкус владельца
              2026-09-06), без инструкции: откуда эти деньги, он знает сам. */}
          {moneySign(unassigned) !== 0 ? (
            <RowCaption text={`Без счёта ${money(unassigned)}`} />
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
        presetTeamId={presetTeamFor(teams)}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {hider.sheet}
    </Screen>
  );
}
