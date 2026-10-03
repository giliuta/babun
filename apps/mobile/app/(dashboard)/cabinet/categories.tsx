import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import type {
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ReorderList } from "@/components/ui/ReorderList";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { money } from "@babun/shared/common/utils/money";
import { useCurrency } from "@/features/settings/currency";
import {
  useDeleteCategory,
  useFinanceCategories,
  useSetCategoryHidden,
  useReorderFinanceCategories,
} from "@/features/finances/queries";
import { budgetLevel, budgetShort, hasBudget } from "@/features/finances/category-budget";
import {
  CategoryEditorSheet,
  type CategoryEditorTarget,
} from "@/features/finances/CategoryEditorSheet";
import { useCategoryMonthSpend } from "@/features/finances/use-category-budget";
import { useTeams } from "@/features/reference/queries";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useLocalSearchParams, useRouter } from "expo-router";
import { settingsTeamId } from "@/features/finances/team-settings-lines";
import { CategoryRow } from "@/features/finances/CategoryRow";
import { CATEGORY_KIND_ROW } from "@/features/finances/settings-levels";
import { useFinanceSettingLevelsOf } from "@/features/finances/use-finance-settings";
import { useCurrentRole } from "@/features/settings/tenant";

// КАТЕГОРИИ — ПО РЕЦЕПТУ «МЕТКИ» (сведено 2026-09-10).
//
// Экран рисовал себя сам: редактор — сырой `Modal animationType="slide"` со
// своей шапкой и своим нижним отступом, имя и цвет — двумя раздельными
// полями, удаление и скрытие — двумя кнопками ВНУТРИ строки (голая мусорка и
// «Скрыть» словом), кнопка добавления — строкой внутри списка, а под списком
// стоял объясняющий абзац.
//
// Теперь то же, что у меток, типов объектов, типов событий и тегов: строка
// 52pt с кружком цвета, действия — на кромках свайпа, редактор —
// канонический `BottomSheet` с `NameColorField`, главное действие — кнопкой
// внизу экрана.
//
// СПРАВА — «УДАЛИТЬ», СЛЕВА — «СКРЫТЬ» (владелец 2026-09-10: «свайп вправо —
// это удалить, а не скрыть»; «чтобы её скрыть, надо свайпнуть, и оно
// открывается с левой стороны»). Сторона закреплена за СМЫСЛОМ, а не за
// «самым сильным из доступного этой строке»: мышечная память не должна врать —
// на каждой строке справа удаление, слева скрытие.
//
// ТАП — ВСЕГДА ПРАВКА (владелец 2026-09-10: «тап на категорию — это идёт
// редактирование, а не оно скрыто»). Раньше тап по стандартной строке её
// скрывал: одно касание молча убирало категорию из списка — так у владельца
// пропали «Налоги и сборы». Скрыть теперь можно лишь намеренным жестом, у
// которого на кромке написано, что будет.
//
// СКРЫТАЯ ПАДАЕТ ВНИЗ (владелец 2026-09-10: «она больше не показывается в
// выборе категории и падает вниз»). В листах выбора её нет совсем — кроме
// той, что уже стоит в операции или шаблоне, иначе прошлая запись потеряла бы
// подпись. Здесь она остаётся, но в конце списка: исчезнувшая строка
// читалась бы как «категория удалена».

// КАТЕГОРИИ ТОЛЬКО СВОИ (владелец 2026-09-24: «категорий вообще не должно
// быть готовых — клиент сам должен их создавать»). Готовые общие выведены из
// продукта миграцией 20260924200000: те, что компания использовала, стали её
// собственными. Поэтому «стандартной» строки больше нет — каждая правится
// тапом, скрывается слева и удаляется справа. Служебные категории сервера
// («Услуги» оплаты записи, «Возврат») здесь не показываются:
// их не выбирают руками.
//
// ЧТО СПРАШИВАТЬ В ОПЕРАЦИИ (владелец 2026-09-24: «при добавлении категории
// надо понимать, что она должна делать — зарплата смотрит сотрудников, другая
// прикрепляет клиента»; «продумай, что ещё можно прикрепить»). Три
// независимых тумблера, а не выбор одного из трёх: у чаевых и клиент, и
// мастер; топливу нужен чек. Форма операции показывает ровно эти блоки.
//
// БЮДЖЕТ НА МЕСЯЦ (владелец 2026-09-24: «когда создам категорию, выставить
// бюджет, и она пришлёт уведомление, что перевалил лимит»). Только у расхода.
// Пусто — бюджета нет. В строке справочника — «€180 из €250» за этот месяц,
// жёлтым от 80%, красным при превышении; уведомление владельцу — на 80% и на
// 100% (`budget-notify.ts`).
//
// У КАЖДОЙ КОМАНДЫ СВОИ КАТЕГОРИИ (владелец 2026-09-24: «у каждой команды
// свой тип расходов, свой тип доходов и так далее»). Сверху — команды
// пилюлями, как во всём продукте; справочник, скрытие, порядок и бюджет —
// выбранной команды. Новая категория создаётся в ней, а тумблер «Во всех
// командах» заводит такую же каждой команде разом — «Топливо» не набирают
// руками дважды.
//
// УДАЛИТЬ МОЖНО ТОЛЬКО НЕИСПОЛЬЗОВАННУЮ. По категории с операциями сервер
// удаление отбивает (история не теряет подписей), и экран предлагает то, что
// можно, — скрыть её из выбора.

export default function CategoriesScreen() {
  const th = useThemeColors();
  const { data: cats = [], isLoading, isError, error, refetch } =
    useFinanceCategories();
  const del = useDeleteCategory();
  const setHidden = useSetCategoryHidden();
  const reorderCats = useReorderFinanceCategories();

  // Третья ступень — долги (владелец 2026-09-10: «под расход свои категории,
  // под доход свои, под долги свои, они не смешиваются»). В списке
  // поставщиков и займов «Бензину» делать нечего.
  // ОТДЕЛЬНАЯ СТРАНИЦА НА ВИД (владелец 2026-09-30: «категории отдельными
  // страницами — доходы, расходы, долги»). Настройки финансов открывают
  // `?kind=` — вид закреплён, переключателя нет. Без него (старые двери) —
  // прежний переключатель.
  const { kind: kindParam, team: pinnedTeam } = useLocalSearchParams<{
    kind?: string;
    team?: string;
  }>();
  const fixedKind: FinanceCategoryKind | null =
    kindParam === "income" || kindParam === "expense" || kindParam === "debt"
      ? kindParam
      : null;
  const [pickedType, setType] = useState<FinanceCategoryKind>("expense");
  const type = fixedKind ?? pickedType;
  // Правка своей категории (rename/цвет) — раньше единственным «редактором»
  // был деструктивный обход «удалить+создать», обнулявший category_id у
  // всей истории транзакций (аудит P1-8). Шторка — общая с шестерёнкой
  // «Финансов» (`CategoryEditorSheet`).
  const [editorTarget, setEditorTarget] = useState<CategoryEditorTarget | null>(null);
  const router = useRouter();
  // ПРАВО ВИДА (03.10): у партнёра у каждого вида категорий своё право в
  // каждой команде — «Скрыты» (команды нет в ленте, страницы нет), «Только
  // видит» (список без правки, кромок, порядка и «Добавить»), «Видит и
  // меняет». Владелец правит всё. Правку пускает сервер (политика вида).
  const owner = useCurrentRole().data === "owner";
  const levelsOf = useFinanceSettingLevelsOf();
  const allTeams = useTeams().data ?? [];
  const kindRow = CATEGORY_KIND_ROW[fixedKind ?? pickedType];
  const teams = owner ? allTeams : allTeams.filter((team) => levelsOf(team.id)[kindRow] !== "hidden");
  // КОМАНДА — В АДРЕСЕ (`?team=`): «Настройки финансов» открывают справочник
  // сразу на своей команде, а лента меняет её, не уводя со страницы. Команды
  // нет или она ушла в архив — первая, а не пустой список.
  const { team: teamParam } = useLocalSearchParams<{ team?: string }>();
  const teamId = settingsTeamId(teams, teamParam);
  const level = levelsOf(teamId)[kindRow];
  const canEdit = level === "write";
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const spend = useCategoryMonthSpend(type === "expense");

  const filtered = useMemo(
    // Скрытые в конец, дальше — ПОРЯДОК ТЕНАНТА (перетаскивание), дальше имя.
    // До 2026-09-10 порядка не было вовсе: список шёл как пришёл из базы.
    () =>
      cats
        .filter((c) => c.type === type && !c.is_system && c.team_id === teamId)
        .sort(
          (a, b) =>
            Number(a.hidden) - Number(b.hidden) ||
            a.position - b.position ||
            a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
        ),
    [cats, type, teamId],
  );

  const openCreate = () =>
    setEditorTarget({ mode: "create", kind: type, teamId });
  // Скрывает только левая кромка — тапом это не делается (см. закон в шапке).
  const [dragging, setDragging] = useState(false);

  // ПОРЯДОК — РУКА ВЛАДЕЛЬЦА И ТОЛЬКО ЕГО КОМПАНИИ: позиции лежат отдельной
  // таблицей на тенант (завели, когда категории ещё были общими).
  const reorder = (ids: string[]) =>
    reorderCats.mutate(ids, {
      onError: (e: Error) =>
        notify("Не удалось сохранить порядок", e.message),
    });

  const toggleHidden = (c: FinanceCategory) => {
    setHidden.mutate(
      { id: c.id, hidden: !c.hidden },
      { onError: (e) => notify("Ошибка", e.message) },
    );
  };

  const openEdit = (c: FinanceCategory) => setEditorTarget({ mode: "edit", category: c });

  const confirmDelete = (c: FinanceCategory) => {
    confirmThen(
      "Удалить категорию?",
      {
        message: `«${c.name}» исчезнет из списка насовсем.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        del.mutate(c.id, {
          onError: (e) => {
            // Категория уже в операциях: сервер удаление отбивает, чтобы
            // история не потеряла подписи. Предлагаем то, что можно.
            if (/используется/i.test(e.message) && !c.hidden) {
              confirmThen(
                "Категория уже в операциях",
                {
                  message: `Удалить «${c.name}» нельзя — прошлые операции потеряли бы подпись. Скрыть её из выбора?`,
                  confirmLabel: "Скрыть",
                },
                () => toggleHidden(c),
              );
              return;
            }
            notify("Ошибка", e.message);
          },
        }),
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={
          fixedKind === "income"
            ? "Категории доходов"
            : fixedKind === "expense"
              ? "Категории расходов"
              : fixedKind === "debt"
                ? "Категории долгов"
                : "Категории"
        }
        // Команда закреплена адресом — её имя под заголовком, ленты нет.
        subtitle={pinnedTeam ? teams.find((team) => team.id === teamId)?.name : undefined}
        seam={teams.length === 0 || !!pinnedTeam}
      />

      {/* КОМАНДЫ — ТА ЖЕ ЛЕНТА, ЧТО В НАСТРОЙКАХ КАЛЕНДАРЯ И ФИНАНСОВ. Пришли
          из настроек своей команды — страница её и только её (владелец
          2026-09-30: «перешёл в команду один — настройки чётко под неё»). */}
      {teams.length > 0 && !pinnedTeam ? (
        <ScopeChips
          items={teams}
          activeId={teamId}
          onSelect={(id) => router.setParams({ team: id })}
        />
      ) : null}

      {fixedKind ? null : (
        <SegmentedControl
          options={[
            { value: "expense", label: "Расходы", color: th.danger },
            { value: "income", label: "Доходы", color: th.success },
            { value: "debt", label: "Долги", color: th.warning },
          ]}
          value={type}
          onChange={setType}
          style={{ marginHorizontal: 16, marginTop: 12 }}
        />
      )}

      {level === "hidden" ? (
        // Вид закрыт правом — страница остаётся собой, тело словами (дверь
        // `FinanceSettingsRoute` закрывает его и раньше; общий адрес из листа
        // операции идёт сюда же).
        <EmptyState fill title="Настроек пока нет" />
      ) : isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          fill
          title={
            type === "expense"
              ? "Нет категорий расходов"
              : type === "income"
                ? "Нет категорий доходов"
                : "Нет категорий долгов"
          }
          subtitle={
            type === "debt"
              ? "Категории называют, за что висят деньги — «Поставщик», «Займ», «Аренда»"
              : "Своих категорий пока нет — создайте те, что нужны именно вам"
          }
          action={canEdit ? { label: "Добавить категорию", onPress: openCreate } : undefined}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ paddingHorizontal: GUTTER }}>
            {canEdit ? (
            <ReorderList
              items={filtered}
              rowHeight={52}
              spaced
              labelFor={(item) => item.name}
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(item, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={th.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить категорию ${item.name}`}
                  onAction={() => confirmDelete(item)}
                  leading={{
                    label: item.hidden ? "Показать" : "Скрыть",
                    color: item.hidden ? th.success : th.warning,
                    icon: item.hidden ? RotateCcw : EyeOff,
                    accessibilityLabel: `${
                      item.hidden ? "Показать" : "Скрыть"
                    } категорию ${item.name}`,
                    onAction: () => toggleHidden(item),
                  }}
                >
                  <CategoryRow
                    item={item}
                    budget={
                      hasBudget(item) && spend
                        ? {
                            text: budgetShort(spend.get(item.id) ?? 0, item.monthly_budget, fmt),
                            level: budgetLevel(spend.get(item.id) ?? 0, item.monthly_budget),
                          }
                        : null
                    }
                    handle={handle}
                    onEdit={() => openEdit(item)}
                    onToggleHidden={() => toggleHidden(item)}
                    onDelete={() => confirmDelete(item)}
                  />
                </SwipeRow>
              )}
            </ReorderList>
            ) : (
              // «Только видит»: тот же список, без ручек, кромок и правки.
              <View style={{ gap: 8 }}>
                {filtered.map((item) => (
                  <CategoryRow
                    key={item.id}
                    item={item}
                    budget={
                      hasBudget(item) && spend
                        ? {
                            text: budgetShort(spend.get(item.id) ?? 0, item.monthly_budget, fmt),
                            level: budgetLevel(spend.get(item.id) ?? 0, item.monthly_budget),
                          }
                        : null
                    }
                    handle={null}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {canEdit && !isLoading && !isError && filtered.length > 0 ? (
        <View
          style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}
        >
          <GradientButton label="Добавить категорию" onPress={openCreate} />
        </View>
      ) : null}

      <CategoryEditorSheet target={editorTarget} onClose={() => setEditorTarget(null)} />
    </Screen>
  );
}
