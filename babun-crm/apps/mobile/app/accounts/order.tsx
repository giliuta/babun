import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReorderList } from "@/components/ui/ReorderList";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { RowCaption, RowGroup } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { accountIcon } from "@/features/finances/account-ui";
import {
  accountOrderGroups,
  type SectionTeam,
} from "@/features/finances/accounts-sections";
import {
  useAccountsWithBalances,
  useReorderAccounts,
  type AccountWithBalance,
} from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { isOnline, useIsOnline } from "@babun/shared/sync";

// ПОРЯДОК СЧЕТОВ — ЭТО ЧТЕНИЕ, А НЕ МАРШРУТ ДЕНЕГ (ТЗ §11.5, §13/С7).
//
// Главное, что должна сказать эта страница: подняв строку повыше, вы НЕ
// переадресуете оплаты. Раньше это было не так — оба серверных резолвера
// брали первый счёт по позиции, и «подвинуть, чтобы удобнее читалось» и
// «отправить все карточные оплаты команды в другую кассу» были одним жестом.
// С 2026-08-10 маршрут держит отдельный признак `is_primary` («Основной счёт
// команды» в настройках счёта), и перетаскивание его не трогает. Строка,
// которая сейчас основная, подписана — чтобы правило было видно, а не
// прочитано в подписи под списком.
//
// ТЯНУТЬ МОЖНО ТОЛЬКО ВНУТРИ СВОЕЙ БРИГАДЫ И СВОЕГО ВИДА. Команда — потому
// что `position` нумеруется внутри (тенант, команда), и «перенести счёт в
// другую команду» — это не порядок, а смена владельца (она живёт в настройках
// счёта). Вид — потому что список счетов во всём продукте сортируется сначала
// по виду (наличные → карта → банк → другое), и перетаскивание карты выше
// наличных не изменило бы ни одного экрана: строка просто вернулась бы на
// место. Жест, который ничего не делает, хуже отсутствующего жеста, поэтому
// ручки у таких строк нет вовсе.

/** Границы блока строк одного вида: `data` уже отсортирована видом. */
function kindBlock(
  rows: readonly AccountWithBalance[],
  index: number,
): readonly [number, number] {
  const kind = rows[index].kind;
  let first = index;
  while (first > 0 && rows[first - 1].kind === kind) first -= 1;
  let last = index;
  while (last < rows.length - 1 && rows[last + 1].kind === kind) last += 1;
  return [first, last];
}

export default function AccountsOrderScreen() {
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const [dragging, setDragging] = useState(false);
  // Оптимистичные позиции: после отпускания пальца строка обязана остаться
  // там, куда её положили, а не прыгнуть обратно на те 300 мс, пока сервер
  // подтверждает запись. Ключ — id счёта, значение — новая позиция.
  const [moved, setMoved] = useState<Record<string, number>>({});

  const accountsQuery = useAccountsWithBalances();
  const teamsQuery = useTeams({ includeInactive: true });
  const reorder = useReorderAccounts();

  const accounts = useMemo(() => {
    const rows = accountsQuery.data ?? [];
    return rows.map((account) =>
      account.id in moved
        ? { ...account, position: moved[account.id] }
        : account,
    );
  }, [accountsQuery.data, moved]);

  const sectionTeams = useMemo<SectionTeam[]>(
    () =>
      (teamsQuery.data ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        color: team.color,
        is_active: team.is_active,
      })),
    [teamsQuery.data],
  );

  // Одна группа — одно пространство нумерации `position`, а сортировка внутри
  // общая с экраном списка: страница порядка обязана показывать ровно тот
  // порядок, который человек увидит на «Счетах», иначе она врёт о результате
  // собственного жеста.
  //
  // Счета архивных и вовсе неразрешимых команд сюда не попадают: делать с ними
  // надо не порядок, а сдать остаток и закрыть.
  const groups = useMemo(
    () => accountOrderGroups({ accounts, teams: sectionTeams }),
    [accounts, sectionTeams],
  );

  // Двигать есть что, только если хоть в одном виде хоть одной команды стоят
  // два счёта. У команды с «Наличными» и «Картой» переставлять нечего вовсе —
  // и честнее сказать это словами, чем показать список без единой ручки.
  const canOrder = useMemo(
    () =>
      groups.some((group) =>
        group.data.some((_, index) => {
          const [first, last] = kindBlock(group.data, index);
          return last > first;
        }),
      ),
    [groups],
  );

  const applyOrder = (ids: string[]) => {
    const next: Record<string, number> = {};
    ids.forEach((id, index) => {
      next[id] = index;
    });
    // Снимать оптимистичный порядок после успеха не нужно: он совпадает с
    // тем, что вернёт рефетч, и снятие дало бы лишний кадр старого порядка.
    setMoved((current) => ({ ...current, ...next }));
    reorder.mutate(ids, {
      onError: (e) => {
        // Сервер не принял — снимаем оптимистичный порядок целиком: показывать
        // порядок, которого нет в базе, значит соврать при следующем входе.
        setMoved({});
        // Перетаскивание не гасится — гасить нечего, тянут саму строку.
        // Поэтому причина приезжает ответом и человеческими словами.
        toast(
          isOnline()
            ? `Не удалось сохранить порядок: ${e.message}`
            : "Без сети порядок не сохранится — он живёт на сервере.",
          "error",
        );
      },
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
      <ScreenHeader title="Порядок счетов" />
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
      ) : !canOrder ? (
        <EmptyState
          fill
          title="Переставлять пока нечего"
          subtitle="Строки можно переставлять, когда у команды есть два счёта одного вида — например, две карты"
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          // Пока строку тянут, страница не должна уезжать под пальцем.
          scrollEnabled={!dragging}
        >
          {groups.map((group) => (
            <RowGroup key={group.key} title={group.title} accent={group.color}>
              <ReorderList
                items={group.data}
                // 64, а не 56: у строки бывает вторая строка («Основной
                // счёт»), и на крупном системном шрифте она не влезает в
                // высоту строки-переключателя. Высота фиксирована — по ней
                // считается, через сколько соседей перелетел палец.
                rowHeight={64}
                labelFor={(account) => account.name}
                rangeFor={(index) => kindBlock(group.data, index)}
                onReorder={applyOrder}
                onDraggingChange={setDragging}
              >
                {(account) => (
                  <SettingsRow
                    // Выбранные значок и цвет — как в списке счетов: страница
                    // порядка обязана показывать те же строки, что человек
                    // увидит на «Счетах».
                    icon={accountIcon(account)}
                    tile={account.color ?? "neutral"}
                    title={account.name}
                    // Единственная подпись на странице — и она про то самое
                    // правило, которое объясняет подпись под списком.
                    sub={account.is_primary ? "Основной счёт" : undefined}
                    onPress={() =>
                      router.push(`/accounts/${account.id}/settings`)
                    }
                  />
                )}
              </ReorderList>
            </RowGroup>
          ))}

          <RowCaption text="Порядок строк не решает, куда попадут деньги: за это отвечает «Основной счёт команды» в настройках счёта." />
          <RowCaption text="Счета одного вида идут подряд, поэтому тянуть строку можно внутри своего вида." />
        </ScrollView>
      )}
    </Screen>
  );
}
