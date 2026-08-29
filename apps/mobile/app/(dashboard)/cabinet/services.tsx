import { useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  Briefcase,
  Copy,
  EyeOff,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react-native";
import { formatEURExact, moneySymbol } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { RowCaption } from "@/components/ui/card-rows";
import { FieldLabel } from "@/components/ui/Field";
import { WEEKDAY_LABELS } from "@babun/shared/local/services";
import { GUTTER, ICON } from "@/components/ui/tokens";
import {
  ServiceLadder,
  type LadderStep,
} from "@/features/services/ServiceLadder";
import { useThemeColors } from "@/theme/colors";
import { getStorage } from "@babun/shared/storage";
import { useToast } from "@/components/ui/Toast";
import {
  useDeleteService,
  usePurgeService,
  useServiceUsageCount,
  useTeams,
  useUpdateService,
} from "@/features/reference/queries";
import { useTenant } from "@/features/settings/tenant";
import {
} from "@babun/shared/local/services-pricing";
import {
  type VariantDraft,
} from "@/features/services/ServiceEditorParts";
import {
  useSaveServiceVariants,
  useServiceVariants,
  type ServiceVariant,
} from "@/features/services/variant-queries";
import {
  useCreateService,
  useReorderServices,
  useAllServices,
  useServices,
  type Service,
  type ServiceInput,
} from "@/features/services/queries";
import { ColorDot, NameColorField } from "@/components/ui/picker-fields";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { durationLabel } from "@/features/services/format";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  roundToStep,
} from "@/features/services/ServiceBlocks";
import {
  displayValue,
  draftValue,
  createTierDraft,
  economicsDraftFromService,
  parsePriceTiers,
  validateServiceEconomics,
  type ServiceEconomicsDraft,
  type ServiceEconomicsErrors,
  type PriceEntryMode,
} from "@/features/services/economics";

// УСЛУГИ — ПРАЙС-ЛИСТ, А НЕ КАРТОТЕКА (переделано 2026-08-17 по владельцу:
// «мне не нравится вот этот цвет, как оно слева показывает… категории услуг —
// они вообще не нужны, просто выбирается услуга и всё… то же самое свайп
// вправо, свайп влево»).
//
// КАТЕГОРИЙ БОЛЬШЕ НЕТ. Проверено по проду: `service_categories` — НОЛЬ строк
// у всех тенантов за пять месяцев, а читал их ровно один экран — этот. Это
// была вторая таксономия поверх работающей первой: услуги уже делятся тем,
// КТО их делает (`brigade_ids`), и вот её выбор услуги при записи реально
// использует. Ориентир в длинном прайсе даёт не коробка, а порядок, который
// человек задаёт сам — перетаскиванием (`position`).
//
// ЦВЕТА У УСЛУГИ БОЛЬШЕ НЕТ. Полоса 4×36 слева красила поле, которое не читает
// ни одна поверхность: блок в календаре берёт цвет записи, команды и статуса
// (`status-colors.ts`), инвойс цвет услуги не открывает вовсе. Подпись «Цвет
// на календаре» была прямой неправдой. Колонка в базе жива ради легаси-веба,
// продукт её не пишет.
//
// Экран переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/services — весь прайс,
//  · per-team /cabinet/teams/[id]/services — услуги одной команды.

/** Команда, чей прайс человек смотрел в прошлый раз. Свой ключ, а не запись в
 *  `calendar.view`: тап по чипу здесь не должен переключать чужой календарь. */
/** Тот же ключ, которым календарь помнит свою активную команду. ЧИТАЕМ, но
 *  НИКОГДА не пишем: из шестерёнки календаря человек приходит настраивать ту
 *  команду, которую там и смотрит. */
const CAL_VIEW_KEY = "calendar.view";

/** Высота строки фиксирована: по ней перетаскивание считает, через сколько
 *  соседей перелетел палец. Две строки текста + воздух. */
const ROW_H = 60;

/** «1 вариант · 2 варианта · 5 вариантов» — склонение как во всём продукте. */
const FORMS_VARIANT: [string, string, string] = ["вариант", "варианта", "вариантов"];

type ServiceEditing =
  // `copy` — источник из ДРУГОЙ команды: имя не получает «копия» (в новой
  // команде это не копия, а своя услуга) и пишется связь для отчётов.
  | { mode: "create"; from?: Service; copy?: boolean }
  | { mode: "edit"; service: Service };

export default function ServicesScreen() {
  // КОМАНДА ПРИХОДИТ АДРЕСОМ И ЭТО ГЛАВНАЯ ДВЕРЬ. Дверь из настроек календаря
  // открывается уже с командой, чьи настройки человек и правит: без этого он
  // выбирал Команду 2 в ленте календаря, тапал «Услуги» и попадал в прайс
  // Команды 1 — а заведённая там услуга уезжала чужой команде.
  const params = useLocalSearchParams<{ team?: string | string[] }>();
  const team = Array.isArray(params.team) ? params.team[0] : params.team;
  return <ServicesList teamId={team?.trim() || undefined} />;
}

export function ServicesList({ teamId }: { teamId?: string } = {}) {
  const t = useThemeColors();
  const toast = useToast();
  const servicesQuery = useServices();
  const teamsQuery = useTeams();
  const allServices = useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data],
  );
  // Полный справочник, ВКЛЮЧАЯ убранные: `useServices` их фильтрует, и без
  // второго списка вернуть убранную услугу было нечем.
  const everyServiceQuery = useAllServices();
  const everyService = useMemo<Service[]>(
    () => everyServiceQuery.data ?? [],
    [everyServiceQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const create = useCreateService();
  const update = useUpdateService();
  const del = useDeleteService();
  const purge = usePurgeService();
  const countUsage = useServiceUsageCount();
  const saveVariants = useSaveServiceVariants();
  const reorder = useReorderServices();

  const [editing, setEditing] = useState<ServiceEditing | null>(null);
  const [dragging, setDragging] = useState(false);
  // ПРАЙС ВСЕГДА ЧЕЙ-ТО. Услуга принадлежит ровно одной команде, поэтому
  // экран и показывает прайс ОДНОЙ команды: маршрут команды берёт её из
  // адреса, общая дверь — из ленты сверху (тот же контрол, что на «Счетах» и
  // в календаре). Так исчезает вопрос «чья услуга» в форме: владелец — это
  // место, куда человек уже зашёл (владелец 2026-08-17: «на хуя мне в услугах
  // выбирать, чья услуга, если она и так зависит исключительно к этой
  // команде»).
  // ЭКРАН НЕ ОТКРЫВАЕТСЯ ТАМ, ГДЕ ЗАВЕДОМО ПУСТО (аудит 2026-08-21). Прежняя
  // цепочка кончалась на `teams[0]`, а на живом тенанте первая команда — ровно
  // та, у которой ноль услуг: человек, только что назвавший команду в
  // календаре, попадал на чужой пустой прайс и делал вывод «у меня нет услуг».
  //
  // Порядок читается сверху вниз как «чей это выбор»: адрес команды → команда,
  // открытая в календаре (её же человек и настраивает, входя сюда) → и только
  // последней, когда не выбрано ничего, — команда, у которой прайс есть.
  // Памяти «что выбирали в прошлый раз» здесь больше нет: выбирать на этом
  // экране нечем, лента снесена 2026-08-24.
  const fromCalendar =
    getStorage().get<{ teamId?: string | null }>(CAL_VIEW_KEY)?.teamId ?? null;
  const calendarTeam =
    fromCalendar && teams.some((tm) => tm.id === fromCalendar)
      ? fromCalendar
      : null;
  const firstWithServices =
    teams.find((tm) => allServices.some((s) => s.team_id === tm.id))?.id ?? null;
  const activeTeamId =
    teamId ??
    calendarTeam ??
    firstWithServices ??
    teams[0]?.id ??
    null;

  const activeTeam = teams.find((tm) => tm.id === activeTeamId) ?? null;
  /** Справочник команд ещё не ответил: «команд нет» и «команды не спросили» —
   *  разные вещи, и путать их нельзя ни в кнопке, ни в пустом состоянии. */
  const teamsUnknown = teamsQuery.isLoading;

  // ВЫКЛЮЧЕННЫЕ ОСТАЮТСЯ В СПИСКЕ, СЕРЫМИ И В ХВОСТЕ (владелец 2026-08-29:
  // «смахнул вправо — и она просто выключена, серая, не используется»).
  //
  // Раньше выключенная услуга исчезала из списка и жила за иконкой архива в
  // шапке. Прайс от этого выглядел полным, хотя половина работ была снята, —
  // и вспомнить, что именно ты выключил, можно было только зайдя в архив.
  // Теперь виден весь каталог: живые сверху, выключенные под ними серыми.
  //
  // Имя выключенной услуги в ИСТОРИИ не теряется: календарь и лист записи
  // читают полный справочник (`useAllServices`). Фильтр по активным остался
  // там, где он и нужен, — в выборе при записи и в «повторить как в прошлый
  // раз»: предлагать снятую работу нельзя.
  const services = useMemo(() => {
    if (!activeTeamId) return [];
    const mine = everyService.filter((s) => s.team_id === activeTeamId);
    return [
      ...mine.filter((s) => s.is_active),
      ...mine.filter((s) => !s.is_active),
    ];
  }, [everyService, activeTeamId]);
  /** Убранные услуги ЭТОЙ команды — полный справочник минус живой. */
  /** Варианты всех услуг — нужны и списку (диапазон цен в строке), и листу. */
  const variantsQuery = useServiceVariants();
  const variantsByService = useMemo(() => {
    const map = new Map<string, ServiceVariant[]>();
    for (const variant of variantsQuery.data ?? []) {
      map.set(variant.service_id, [
        ...(map.get(variant.service_id) ?? []),
        variant,
      ]);
    }
    return map;
  }, [variantsQuery.data]);

  const alertError = (e: unknown) =>
    notify("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  /** УДАЛЕНИЕ НАСОВСЕМ — с честным пересчётом последствий.
   *
   *  `appointments.service_ids` это jsonb-массив, а не связь с таблицей: база
   *  удалению не помешает и ничего не спросит. Значит спросить обязан
   *  продукт — иначе человек сотрёт услугу и молча обнулит имя работы в
   *  собственной истории, а вернуть его будет неоткуда.
   *
   *  Поэтому перед вопросом считаем, в скольких записях услуга стоит, и
   *  говорим ЧИСЛО. «Может повлиять на историю» — не предупреждение; «стоит
   *  в 47 записях» — предупреждение. */
  const handlePurge = async (svc: Service) => {
    let used = 0;
    try {
      used = await countUsage(svc.id);
    } catch {
      // Счёт не сошёлся — не повод молчать о самом удалении. Предупреждаем
      // без числа: неизвестность здесь хуже завышенной оценки.
      used = -1;
    }
    confirmThen(
      "Удалить услугу навсегда?",
      {
        message:
          used === 0
            ? `«${svc.name}» ещё не стоит ни в одной записи — удалить её можно без следа.`
            : used > 0
              ? `«${svc.name}» стоит в ${formatCountRu(used, ["записи", "записях", "записях"])}. После удаления имя работы там пропадёт, и вернуть его будет неоткуда. Если нужно просто убрать её из выбора — скройте.`
              : `«${svc.name}» может стоять в уже сделанных записях. После удаления имя работы в них пропадёт безвозвратно. Если нужно просто убрать её из выбора — скройте.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await purge.mutateAsync(svc.id);
          setEditing(null);
          toast("Услуга удалена");
        } catch (e) {
          alertError(e);
        }
      },
    );
  };

  const handleSave = async (
    draft: ServiceInput,
    serviceId?: string,
    variants?: { name: string; price: number; duration_min: number }[],
  ) => {
    try {
      // РАСХОД ЧИТАЕТСЯ ИЗ ЖИВОГО КАТАЛОГА, А НЕ ИЗ СНИМКА ЗАПИСИ. Значит
      // первое же ненулевое число немедленно уменьшит показанную прибыль ВСЕХ
      // прошлых записей с этой услугой — в Финансах, в сводке дня, в разборе
      // прибыли. Снимок при этом не меняется ни на байт и сторож оплаченной
      // записи не просыпается. Молчать об этом нельзя, объяснять абзацем —
      // тоже: одна фраза ровно в момент, когда риск возник.
      const before = allServices.find((x) => x.id === serviceId);
      const costChanged =
        !!serviceId &&
        draft.cost_per_unit !== undefined &&
        Number(before?.cost_per_unit ?? 0) !== draft.cost_per_unit;
      let savedId = serviceId;
      if (serviceId) {
        await update.mutateAsync({ id: serviceId, patch: { ...draft } });
      } else {
        const created = await create.mutateAsync({
          ...draft,
          position: allServices.length,
        });
        savedId = created?.id;
      }
      // ВАРИАНТЫ СОХРАНЯЮТСЯ ПОСЛЕ САМОЙ УСЛУГИ И ТОЛЬКО ДЛЯ СВОЕГО ТИПА: у
      // «количества» их не бывает, и пустой список туда пишется явно —
      // сменили тип, значит старые варианты обязаны уйти.
      if (savedId && variants) {
        await saveVariants.mutateAsync({ serviceId: savedId, variants });
      }
      setEditing(null);
      toast(
        costChanged ? "Расход учтён и в прошлых записях" : "Услуга сохранена",
      );
    } catch (e) {
      alertError(e); // лист остаётся открытым — набранное не теряется
    }
  };

  // ОДНА ДВЕРЬ УДАЛЕНИЯ. Ветки «убрать из команды» больше нет: услуга и так
  // принадлежит одной команде, а прежняя ветка при пустом `brigade_ids`
  // молча уносила услугу у ВСЕХ команд (владелец правил одну, ломал три).
  const handleDelete = (svc: Service) => {
    // СКРЫТЬ ≠ УДАЛИТЬ (владелец 2026-08-29: «удалить услугу, чтоб её вообще
    // не было, и выключить — это разные вещи»). Здесь — скрытие: строка
    // остаётся в базе и на экране серой, история цела. Удаление живёт
    // отдельно, за другой кромкой свайпа.
    confirmThen(
      "Скрыть услугу?",
      {
        // ЧЕСТНЫЙ ТЕКСТ (аудит 2026-08-21). Здесь стояло «Записи, где она уже
        // стоит, не изменятся» — прямая неправда: все читатели имени услуги
        // ходят через `useServices()` с фильтром `is_active = true`, и убранная
        // услуга теряет ИМЯ везде — в записи, в наряде команды, в ленте клиента,
        // в счёте, — печатаясь заглушкой «Услуга». Деньги и правда не меняются,
        // и обещать надо ровно это.
        message: `«${svc.name}» перестанет предлагаться при записи и станет серой в списке. Уже сделанные записи и счета не изменятся.`,
        confirmLabel: "Скрыть",
        destructive: true,
      },
      async () => {
        try {
          await del.mutateAsync(svc.id);
          setEditing(null);
          toast("Услуга скрыта");
        } catch (e) {
          alertError(e);
        }
      },
    );
  };

  const busy = create.isPending || update.isPending || del.isPending;

  return (
    <Screen edges={["top"]}>
      {/* ПРАЙС ОДНОЙ КОМАНДЫ, И ПЕРЕКЛЮЧАТЬ ЕГО ЗДЕСЬ НЕЧЕМ (владелец
          2026-08-24: «мне не нравится, что в услугах можно выбирать команда
          один, команда два, команда три… можно ошибиться очень легко»).
          Лента чипов снесена: она предлагала сменить владельца прайса на том
          же экране, где его правят, — и услуга уезжала не в ту команду одним
          промахом пальца. Команда теперь приходит СНАРУЖИ: из адреса
          (Кабинет → Команды → услуги) или из той, что открыта в календаре.
          Имя команды стоит подзаголовком — «какой команде принадлежат
          услуги» видно, но тронуть его отсюда нельзя. */}
      {/* ИКОНКИ АРХИВА В ШАПКЕ БОЛЬШЕ НЕТ. Она вела на отдельный экран
          убранных услуг — он был нужен, пока выключенная услуга исчезала из
          списка совсем. Теперь она остаётся на месте серой, и включают её тем
          же свайпом, каким выключили: дверь во второй экран стала дверью в
          пустую комнату. */}
      <ScreenHeader
        title="Услуги"
        subtitle={activeTeam?.name ?? undefined}
      />

      {servicesQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : servicesQuery.isError ? (
        // Падение справочника КОМАНД экран больше не гасит: команды нужны
        // только для подписи строки и чипов, а прайс читается и без них.
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить услуги"
          subtitle={
            servicesQuery.error instanceof Error
              ? servicesQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void servicesQuery.refetch(),
          }}
        />
      ) : services.length === 0 ? (
        // ПУСТО — КАК ВЕЗДЕ (владелец 2026-08-27: «сделай то же самое,
        // красиво, маленькое: „услуг пока нет" — как в метках»).
        //
        // Было своей вёрсткой: текст 15/faint по центру, без значка, мимо
        // примитива. И с именем команды в самой фразе («У „Мой календарь"
        // пока пусто») — оно отвечало на вопрос «чей прайс пустой», но
        // ОТВЕТ УЖЕ СТОИТ В ШАПКЕ подзаголовком, двумя строками выше.
        //
        // Подписи под заголовком нет: пустое состояние говорит ровно одно —
        // чего здесь нет (LOCKED 2026-08-27, §5).
        <EmptyState fill icon={<Briefcase color={t.accent} size={28} />} title="Услуг пока нет" />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          scrollEnabled={!dragging}
        >
          {/* КАЖДАЯ УСЛУГА — СВОЯ СТРОКА, А НЕ ПОЛОСА В ОБЩЕЙ КАРТОЧКЕ
              (владелец 2026-08-22: «разделение не волосины между услугами…
              сделай именно чтобы услуги было каждая своя строка, на хера ты
              вот это вот всё в одну группировку»). Общая карточка склеивала
              прайс в одно полотно, а волосяной шов между строками при свайпе и
              перетаскивании давал те самые перепады: у одной строки фон уезжал,
              у соседней оставался, и линия висела между ними ничьей. Теперь
              строка сама себе поверхность — свой радиус, свой фон, свой зазор,
              — и разделять их нечем, потому что они и так раздельные. */}
          <View style={{ marginHorizontal: GUTTER, marginTop: 8 }}>
            <ReorderList
              items={services}
              rowHeight={ROW_H}
              spaced
              handleInside
              labelFor={(s) => s.name}
              // ПЕРЕТАСКИВАНИЕ РАЗРЕШЕНО (владелец 2026-08-29: «хочу шесть
              // точек справа, чтоб можно было менять услуги местами»).
              //
              // Запрет стоял не зря: список был ОТФИЛЬТРОВАН по `is_active`, и
              // записать позиции 0..n только видимым значило перемешать
              // невидимых. Теперь фильтра нет — скрытые лежат тут же серыми,
              // то есть на экране весь прайс команды целиком, и позиции
              // пишутся полному набору.
              rangeFor={() => [0, services.length - 1]}
              onReorder={(ids) => reorder.mutate(ids, { onError: alertError })}
              onDraggingChange={setDragging}
            >
              {(svc, _index, handle) => {
                // Владельца в строке не печатаем: весь список принадлежит
                // одной команде, и её имя стоит лентой над списком.
                // СТРОКА ПРАЙСА НЕ МОЛЧИТ О ЛЕСТНИЦЕ. «A/C Cleaning · €50»
                // выглядела услугой с одной ценой, а внутри лежали ещё «от 2 —
                // €100» и «от 3 — €135». По этому прайсу диктуют цену по
                // телефону, и он обязан сказать, что цена не одна.
                // СТРОКА ГОВОРИТ ТО, ЧТО РЕШАЕТ ТИП УСЛУГИ. У «количества» —
                // есть ли лестница; у «вариантов» — сколько их и в каком
                // разбросе цены. Дублировать «€50 · 30 мин» рядом с ценой
                // справа незачем: это одно и то же число дважды.
                const tierCount = parsePriceTiers(svc.price_tiers).length;
                const rowVariants = variantsByService.get(svc.id) ?? [];
                const sub =
                  svc.service_type === "variant"
                    ? `${formatCountRu(rowVariants.length, FORMS_VARIANT)}`
                    : tierCount > 0
                      ? `${durationLabel(svc.duration_minutes)} · цена от количества`
                      : durationLabel(svc.duration_minutes);
                // ЦЕНА С КОПЕЙКАМИ. `formatEUR` округляет до целых евро
                // (`money(Math.round(...))`), и услуга за 49,50 печаталась в
                // прайсе как «€50» — прайс обязан говорить ровно ту цену,
                // которая уедет в запись и в счёт.
                const variantPrices = (variantsByService.get(svc.id) ?? []).map(
                  (variant) => Number(variant.price),
                );
                const price =
                  svc.service_type === "variant" && variantPrices.length > 0
                    ? variantPrices.length === 1 ||
                      Math.min(...variantPrices) === Math.max(...variantPrices)
                      ? formatEURExact(variantPrices[0])
                      : `${formatEURExact(Math.min(...variantPrices))}–${formatEURExact(
                          Math.max(...variantPrices),
                        )}`
                    : formatEURExact(Number(svc.price));
                const off = !svc.is_active;
                return (
                  <SwipeRow
                    // СПРАВА — УДАЛИТЬ, СЛЕВА — СКРЫТЬ (владелец 2026-08-29:
                    // «удалить справа, скрыть слева, а не наоборот»).
                    //
                    // Стороны, а не направления: правая кромка у SwipeRow —
                    // главная (`label`), левая — вторая (`leading`). Прошлый
                    // заход развесил их наоборот, потому что я прочитал
                    // «влево/вправо» как СВАЙП, а сказано было про сторону,
                    // где появляется кнопка.
                    //
                    // Правая всегда одна и та же — «Удалить»; левая меняется
                    // вместе со строкой: скрытая предлагает показать. Так
                    // разрушительное действие живёт на постоянном месте и не
                    // подменяется под пальцем.
                    label="Удалить"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить услугу ${svc.name} навсегда`}
                    onAction={() => void handlePurge(svc)}
                    // `fullSwipe` НЕ включён и включён не будет: закон канона —
                    // размашистый свайп не носит разрушительного, а здесь оно
                    // необратимо.
                    leading={{
                      label: off ? "Показать" : "Скрыть",
                      color: off ? t.success : t.warning,
                      icon: off ? RotateCcw : EyeOff,
                      accessibilityLabel: off
                        ? `Показать услугу ${svc.name}`
                        : `Скрыть услугу ${svc.name}`,
                      onAction: () =>
                        off
                          ? update.mutate(
                              { id: svc.id, patch: { is_active: true } },
                              {
                                onSuccess: () => toast("Услуга показана"),
                                onError: alertError,
                              },
                            )
                          : handleDelete(svc),
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        // Выключенная не исчезает и не кричит — она просто
                        // тише живых. Полупрозрачность гасит и цветную точку
                        // услуги, и цену: строка целиком уходит на второй план.
                        opacity: off ? 0.45 : 1,
                        backgroundColor: t.surface,
                      }}
                    >
                      <Pressable
                        onPress={() =>
                          setEditing({ mode: "edit", service: svc })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${svc.name}, ${price}, ${sub}`}
                        accessibilityHint="Открыть редактор услуги"
                        style={({ pressed }) => ({
                          flex: 1,
                          height: ROW_H,
                          flexDirection: "row",
                          alignItems: "center",
                          paddingLeft: 16,
                          backgroundColor: pressed ? t.pressed : t.surface,
                        })}
                      >
                        <ColorDot value={svc.color} size={12} />
                        <View
                          style={{ flex: 1, paddingLeft: 12, paddingRight: 12 }}
                        >
                          <Text
                            maxFontSizeMultiplier={1.3}
                            numberOfLines={1}
                            style={{
                              fontSize: 16,
                              fontWeight: "600",
                              color: t.ink,
                            }}
                          >
                            {svc.name}
                          </Text>
                          <Text
                            maxFontSizeMultiplier={1.3}
                            numberOfLines={1}
                            style={{ fontSize: 13, color: t.sub }}
                          >
                            {sub}
                          </Text>
                        </View>
                        <Text
                          maxFontSizeMultiplier={1.3}
                          numberOfLines={1}
                          // Столбец цен обязан быть моноширинным. Класс
                          // `tabular-nums` в NativeWind — no-op (ДС §2):
                          // работает только это свойство.
                          style={{
                            fontSize: 16,
                            fontWeight: "600",
                            color: t.ink,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {price}
                        </Text>
                      </Pressable>
                      {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь,
                          она отдавала бы короткий тап строке. */}
                      {handle}
                    </View>
                  </SwipeRow>
                );
              }}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* НИЖНЯЯ КНОПКА — общий рецепт продукта: «Финансы» так добавляют
          операцию, «Клиенты» — клиента. Она стоит всегда, а не только на
          пустом экране: заводить услуги приходят пачкой. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        {/* ПРАЙС БЕЗ БРИГАДЫ ВЕДЁТ НЕ В СТЕНУ. Услуга принадлежит ровно одной
            команде, а команд нет у 17 тенантов из 19: человек набирал имя,
            цену и минуты и упирался в серую кнопку «Создать», которая не
            сработает НИКОГДА и не говорит почему. Теперь кнопка ведёт туда,
            где эта дорога начинается. */}
        {/* ПОКА КОМАНДЫ ГРУЗЯТСЯ — НЕ ВРАТЬ ПРО ИХ ОТСУТСТВИЕ (аудит
            2026-08-21). `teams.length === 0` истинно и в первую секунду
            загрузки справочника, поэтому владельцу с тремя командами экран
            успевал предложить «Создать команду». Ждать ответа справочника
            дешевле, чем показать неправду. */}
        <GradientButton
          label={teamsUnknown || teams.length > 0 ? "Создать услугу" : "Создать команду"}
          disabled={teamsUnknown}
          onPress={() => {
            if (teams.length === 0) {
              router.push("/cabinet/teams");
              return;
            }
            // ВСЕГДА С НУЛЯ (владелец 2026-08-27: «что значит „создать с
            // нуля"? Убираем, всегда создаётся с нуля — лучше один раз
            // пересоздать, чем это»). Раньше здесь вставал лист «Создать с
            // нуля / или взять готовую» — лишний экран между намерением и
            // формой, и вставал он ТОЛЬКО когда в других командах что-то
            // было, то есть кнопка вела себя по-разному в разные дни.
            // Копирование готовой никуда не делось: у каждой услуги есть
            // «дублировать» в её собственном редакторе.
            setEditing({ mode: "create" });
          }}
        />
      </View>

      <ServiceSheet
        editing={editing}
        lockedTeamId={activeTeamId ?? undefined}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onDelete={handleDelete}
        onDuplicate={(svc) => setEditing({ mode: "create", from: svc })}
        variantsByService={variantsByService}
      />


    </Screen>
  );
}

// ─── Редактор услуги ─────────────────────────────────────────────────
// Канонический нижний лист, а не самописный `Modal animationType="slide"`: та
// самая «серая плашка, которая поднимается вверх», забракованная владельцем на
// метках 2026-08-17.
function ServiceSheet({
  editing,
  lockedTeamId,
  busy,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  variantsByService,
}: {
  editing: ServiceEditing | null;
  /** Per-team-контекст: новая услуга сразу привязана к этой команде. */
  lockedTeamId?: string;
  busy: boolean;
  onClose: () => void;
  onSave: (
    draft: ServiceInput,
    serviceId?: string,
    variants?: { name: string; price: number; duration_min: number }[],
  ) => void;
  onDelete: (svc: Service) => void;
  /** Дубль из шапки листа — вторая дверь к тому же, что делает свайп вправо
   *  по строке прайса (который перехватывает системный жест «назад»). */
  onDuplicate: (svc: Service) => void;
  /** Варианты по услуге — читаются один раз списком, лист берёт готовое. */
  variantsByService: Map<string, ServiceVariant[]>;
}) {
  const t = useThemeColors();
  // ЗНАК ВАЛЮТЫ — ИЗ ТЕНАНТА, а не зашитый «€»: у компании в другой валюте
  // прайс печатался бы в чужой.
  const currencySymbol = moneySymbol(useTenant().data?.currency);
  const service = editing?.mode === "edit" ? editing.service : null;
  /** Источник дубля: лист открыт на СОЗДАНИЕ, но поля засеяны чужими. */
  const source = editing?.mode === "create" ? editing.from : undefined;

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  /** Расход за одну у первой строки — колонка `cost_per_unit`. Пустым не
   *  бывает: он не доходит до клиента и живёт только в прибыли. */
  const [cost, setCost] = useState("0");
  const [color, setColor] = useState<string>(PRESET_COLOR_CYCLE[0].value);
  const [description, setDescription] = useState("");
  /** Карточка описания заведена: пустая строка и «нет описания» — разные вещи,
   *  и снятое описание уезжает в базу явным `null`. */
  const [hasDescription, setHasDescription] = useState(false);
  /** Раскрыт РОВНО ОДИН барабан на весь лист: `"base"` или id строки.
   *  Состояние живёт здесь, а не в таблице: лист всегда в дереве и лишь
   *  гасится пропом `visible`, поэтому чужой `useState` переезжал бы от
   *  услуги к услуге. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Единица измерения услуги — одна на все блоки. `null` = «продаём штуками
   *  и слово лишнее»: тогда всё печатается голым числом, как раньше. */
  const [unit, setUnit] = useState<string | null>(null);
  /** Линза показа чисел: «за всё» или «за одну». Хранение не меняет. */
  // ЗА ЕДИНИЦУ ПО УМОЛЧАНИЮ (владелец 2026-08-27, согласившись с разбором):
  // тогда лесенка значит «сколько стоит одна единица при таком объёме», и
  // промежуточный объём считается сам. При «за всё» таблица становится
  // справочником, и на 13 м² между ступенями 10 и 20 продукт обязан гадать.
  // У уже заведённых услуг режим свой — он лежит в колонке `price_entry`.
  const [priceEntry, setPriceEntry] = useState<PriceEntryMode>("unit");
  // РЕЖИМ РАСХОДА КОЛОНКИ В БАЗЕ НЕ ИМЕЕТ. Расход хранится ЗА ЕДИНИЦУ всегда
  // (`cost_per_unit`), а этот флаг — только способ ввода: «за всё» делит
  // напечатанное на количество. Поэтому он не переживает переоткрытие листа,
  // и это честно: само ЧИСЛО в базе от режима не зависит и не портится.
  // Долг: колонка `cost_entry`, чтобы режим запоминался.
  const [costEntry, setCostEntry] = useState<PriceEntryMode>("unit");
  /** Дни недели ISO 1..7. Пустой массив — делаем в любой день. */
  const [weekdays, setWeekdays] = useState<number[]>([]);
  // РАБОЧИЕ ДНИ — НЕОБЯЗАТЕЛЬНЫЙ ПАРАМЕТР, А НЕ ЧАСТЬ ФОРМЫ (владелец
  // 2026-08-29: «это исключительно для тех, кому нужно; случайно нажмёшь — и
  // он просто не будет работать»). Семь всегда зажжённых плиток были
  // приглашением погасить день мимоходом и тихо сломать услугу: она бы
  // перестала предлагаться, а причина осталась бы в форме, куда больше не
  // заходят. Пустой список = «любой день», и пока он пуст, блока нет вовсе.
  const [hasWeekdays, setHasWeekdays] = useState(false);
  // ПЕРЕРЫВ ПОСЛЕ УСЛУГИ — тоже добавляемый параметр (владелец 2026-08-29:
  // «можно добавить, сделать более автоматически — плюс добавить перерыв
  // после услуги»). Это дорога до следующего объекта и уборка после работы:
  // время, которое сейчас не считает никто, и поэтому в день влезает меньше
  // работ, чем обещает сетка.
  const [hasBufferAfter, setHasBufferAfter] = useState(false);
  /** Столбец расхода показан. У всех услуг прода он нулевой, поэтому по
   *  умолчанию его на экране нет — приходит по команде из «Как считаем». */
  // Расход показан ВСЕГДА своим блоком — флага «показывать ли его»
  // больше нет. Сеттер остался только у сеялки из шаблона.
  const [, setCostShown] = useState(false);
  /** ТИП УСЛУГИ решает всё устройство листа: «количество» считает лестницей,
   *  «варианты» — плоским списком без единой формулы. */
  const [serviceType, setServiceType] = useState<"quantity" | "variant">("quantity");
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  /** Время вокруг работы: дорога до адреса и уборка за собой. */
  const [bufferBefore, setBufferBefore] = useState("0");
  const [bufferAfter, setBufferAfter] = useState("0");
  const [requiredStaff, setRequiredStaff] = useState("1");
  /** Правило за последним порогом — «свыше N: +X и +M мин за каждую». */
  const [overflowPrice, setOverflowPrice] = useState("");
  const [overflowDuration, setOverflowDuration] = useState("");
  const [minQty, setMinQty] = useState("1");
  const [maxQty, setMaxQty] = useState("");
  /** Количество в блоке «Проверка» — живой калькулятор, не данные услуги. */
  const [economics, setEconomics] = useState<ServiceEconomicsDraft>(() =>
    economicsDraftFromService(),
  );
  const [economicsErrors, setEconomicsErrors] =
    useState<ServiceEconomicsErrors>();
  const [baseErrors, setBaseErrors] = useState<{
    price?: string;
    duration?: string;
  }>({});
  const [seeded, setSeeded] = useState<ServiceEditing | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (editing !== seeded) {
    // Новый показ листа — засеять поля (render-time reset).
    setSeeded(editing);
    const from = service ?? source ?? null;
    setName(
      service
        ? service.name
        : source
          ? editing?.mode === "create" && editing.copy
            ? source.name
            : `${source.name} копия`
          : "",
    );
    setPrice(from ? String(Number(from.price)) : "");
    // ОКРУГЛЕНИЕ К ПЯТИМИНУТКЕ ИДЁТ В ЧЕРНОВИК, А НЕ НА ВИД. Барабан ходит
    // шагом 5, и услуга с 47 минутами покажется как 45 — значит 45 и должно
    // лечь в черновик СРАЗУ. Иначе строка говорит одно, а база хранит другое:
    // ровно та тихая ложь, на которой в этом продукте уже обжигались.
    setDuration(String(roundToStep(from ? from.duration_minutes : 60)));
    setCost(String(Number(from?.cost_per_unit ?? 0) || 0));
    setEconomics(economicsDraftFromService(from));
    setEconomicsErrors(undefined);
    setBaseErrors({});
    // Владелец: у правки — свой, у дубля — тот же, у новой из хаба команды —
    // эта команда, иначе первая в списке. Услуга без команды не существует.
    setColor(from?.color || PRESET_COLOR_CYCLE[0].value);
    setDescription(from?.description ?? "");
    setHasDescription(!!from?.description?.trim());
    setUnit(typeof from?.unit === "string" && from.unit ? from.unit : null);
    setCostShown(Number(from?.cost_per_unit ?? 0) > 0);
    setServiceType(from?.service_type === "variant" ? "variant" : "quantity");
    setVariants(
      (from ? variantsByService.get(from.id) ?? [] : []).map((variant) => ({
        id: variant.id,
        name: variant.name,
        price: String(Number(variant.price)),
        duration: String(variant.duration_min),
      })),
    );
    setBufferBefore(String(from?.buffer_before_min ?? 0));
    setBufferAfter(String(from?.buffer_after_min ?? 0));
    setRequiredStaff(String(from?.required_staff ?? 1));
    setOverflowPrice(
      from?.overflow_price == null ? "" : String(Number(from.overflow_price)),
    );
    setOverflowDuration(
      from?.overflow_duration_min == null
        ? ""
        : String(from.overflow_duration_min),
    );
    setMinQty(String(from?.min_qty ?? 1));
    setMaxQty(from?.max_qty == null ? "" : String(Number(from.max_qty)));
    setPriceEntry(from?.price_entry === "total" ? "total" : "unit");
    setCostEntry("unit");
    setWeekdays(
      Array.isArray(from?.available_weekdays)
        ? (from.available_weekdays as unknown[]).filter(
            (day): day is number =>
              typeof day === "number" && day >= 1 && day <= 7,
          )
        : [],
    );
    // Блок показывается, только если у услуги ДЕЙСТВИТЕЛЬНО есть ограничение.
    // Пустой список — «любой день», показывать нечего.
    setHasWeekdays(
      Array.isArray(from?.available_weekdays) &&
        (from.available_weekdays as unknown[]).length > 0,
    );
    setHasBufferAfter(Number(from?.buffer_after_min ?? 0) > 0);
    setOpenRow(null);
  }

  // Владелец услуги — команда, чей прайс открыт. Спрашивать её в форме
  // незачем: человек уже стоит в её списке.
  //
  // У КОПИИ ИЗ ЧУЖОЙ КОМАНДЫ ВЛАДЕЛЕЦ — ТА, КУДА КОПИРУЮТ. Команда источника
  // здесь перебивала открытый прайс, и «взять готовую» молча заводило вторую
  // услугу в ЧУЖОЙ команде: человек копировал в Команду 1, а услуга уезжала
  // обратно в Команду 2. У дубля внутри команды источник верен — он и есть
  // эта команда.
  const isForeignCopy = editing?.mode === "create" && !!editing.copy;
  const ownerTeam =
    service?.team_id ??
    (isForeignCopy ? lockedTeamId : source?.team_id ?? lockedTeamId) ??
    null;
  const canSubmit = name.trim().length > 0 && !!ownerTeam && !busy;

  const updateEconomics = (next: ServiceEconomicsDraft) => {
    setEconomics(next);
    if (economicsErrors) {
      setEconomicsErrors(validateServiceEconomics(next).errors);
    }
  };

  // ЛЕСЕНКА ОДНИМ СПИСКОМ: базовая строка (количество 1) плюс ступени.
  // Четыре блока рисуют ОДИН И ТОТ ЖЕ список — иначе они разъехались бы по
  // столбцам, и цена оказалась бы у количества, которого нет.
  // ЧТО ЛЕЖИТ В ЧЕРНОВИКЕ И ЧТО ВИДИТ ЧЕЛОВЕК — РАЗНЫЕ ЧИСЛА, и направление
  // пересчёта у цены и расхода ПРОТИВОПОЛОЖНОЕ:
  //   цена   хранится ЗА ВСЮ строку  → в режиме «за единицу» делим на кол-во;
  //   расход хранится ЗА ЕДИНИЦУ     → в режиме «за всё» умножаем на кол-во.
  // Перепутать их местами — значит показать человеку число в десять раз
  // больше или меньше, и он не заметит, пока не выставит счёт.
  const qtyOf = (raw: string) => {
    const n = Number(String(raw).trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const showCost = (raw: string, qty: number) => {
    if (costEntry === "unit" || raw.trim() === "" || qty <= 1) return raw;
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? String(Math.round(n * qty * 100) / 100) : raw;
  };
  const storeCost = (typed: string, qty: number) => {
    if (costEntry === "unit" || typed.trim() === "" || qty <= 1) return typed;
    const n = Number(typed.trim().replace(",", "."));
    return Number.isFinite(n) ? String(Math.round((n / qty) * 100) / 100) : typed;
  };

  const ladderSteps: LadderStep[] = [
    {
      tier: null,
      qty: "1",
      price,
      cost,
      duration,
    },
    ...economics.tiers.map((tier) => {
      const q = qtyOf(tier.minQuantity);
      return {
        tier,
        qty: tier.minQuantity,
        price: displayValue(tier.rowPrice, q, priceEntry),
        cost: showCost(tier.rowCost, q),
        duration: tier.totalDuration,
      };
    }),
  ];

  const submit = () => {
    // У ВАРИАНТОВ СВОЕЙ ЦЕНЫ И ДЛИТЕЛЬНОСТИ НЕТ — они у каждого варианта. Но
    // колонки `price`/`duration_minutes` читают строка прайса, каталог выбора
    // и старые записи, поэтому в них уезжает ПЕРВЫЙ вариант: «от €50» в
    // списке честнее пустоты, и ни один читатель не падает.
    const firstVariant = variants.find((v) => v.name.trim() !== "");
    const effectivePrice =
      serviceType === "variant" ? (firstVariant?.price ?? "0") : price;
    const effectiveDuration =
      serviceType === "variant" ? (firstVariant?.duration ?? "60") : duration;
    const parsedPrice = Number(effectivePrice.trim().replace(",", "."));
    const parsedDuration = Number(effectiveDuration.trim());
    const nextBaseErrors: { price?: string; duration?: string } = {};
    // ПУСТО — ЭТО НЕ НОЛЬ. `Number("")` даёт 0, и услуга молча уезжала в
    // прайс бесплатной, запекалась в снимок записи и всплывала у клиента в
    // счёте. Напечатанный руками «0» законен: гарантийный выезд бесплатен.
    if (effectivePrice.trim() === "") {
      nextBaseErrors.price = "Впишите цену";
    } else if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      nextBaseErrors.price = "Цена от 0";
    }
    // НОЛЬ ЗАПРЕЩЁН ВАЛИДАЦИЕЙ, А НЕ БАРАБАНОМ: кольцо проносит через 00:00, и
    // это нормально — недопустимо СОХРАНИТЬ. Услуга нулевой длины ломает
    // календарь молча.
    if (!Number.isSafeInteger(parsedDuration) || parsedDuration <= 0) {
      nextBaseErrors.duration = "Поставьте время";
    }
    // У ВАРИАНТОВ СВОЯ ПРОВЕРКА: лестницы нет, зато список не может быть
    // пустым и имена в нём не повторяются — иначе в записи два одинаковых
    // чипа, и выбрать между ними нечем.
    if (serviceType === "variant") {
      const named = variants.filter((v) => v.name.trim() !== "");
      if (named.length === 0) {
        setBaseErrors({ price: "Добавьте хотя бы один вариант" });
        return;
      }
      const names = named.map((v) => v.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) {
        setBaseErrors({ price: "Названия вариантов повторяются" });
        return;
      }
      const priceless = named.find(
        (v) => v.price.trim() === "" || !Number.isFinite(Number(v.price.replace(",", "."))),
      );
      if (priceless) {
        setBaseErrors({ price: `Впишите цену: ${priceless.name.trim()}` });
        return;
      }
    }
    const validated = validateServiceEconomics(economics);
    setBaseErrors(nextBaseErrors);
    setEconomicsErrors(validated.errors);
    if (Object.keys(nextBaseErrors).length > 0 || !validated.value) return;

    // СНЯТОЕ ОПИСАНИЕ — ТОЖЕ ЗАПИСЬ, А НЕ МОЛЧАНИЕ: обновление услуги шлёт
    // ЧАСТИЧНЫЙ патч, и без явного `null` стёртый текст остался бы в базе.
    onSave(
      {
        name: name.trim(),
        team_id: ownerTeam as string,
        color,
        description: description.trim() || null,
        cost_per_unit: Math.max(0, Number(cost.trim().replace(",", ".")) || 0),
        price: parsedPrice,
        duration_minutes: parsedDuration,
        // Уезжают ВСЕГДА, а не по «если заполнено»: снятая единица обязана
        // писаться явным `null`, снятые дни — явным пустым массивом.
        unit,
        price_entry: priceEntry,
        available_weekdays: weekdays,
        service_type: serviceType,
        ...(editing?.mode === "create" && editing.copy && source
          ? { copied_from_service_id: source.id }
          : {}),
        buffer_before_min: Math.max(0, Number(bufferBefore) || 0),
        buffer_after_min: Math.max(0, Number(bufferAfter) || 0),
        required_staff: Math.max(1, Number(requiredStaff) || 1),
        overflow_price:
          overflowPrice.trim() === "" ? null : Number(overflowPrice.replace(",", ".")),
        overflow_duration_min:
          overflowDuration.trim() === "" ? null : Number(overflowDuration),
        min_qty: Math.max(1, Number(minQty) || 1),
        max_qty: maxQty.trim() === "" ? null : Number(maxQty),
        ...validated.value,
      },
      service?.id,
      serviceType === "variant"
        ? variants
            .filter((variant) => variant.name.trim() !== "")
            .map((variant) => ({
              name: variant.name.trim(),
              price: Number(variant.price.replace(",", ".")) || 0,
              duration_min: Math.max(1, Number(variant.duration) || 60),
            }))
        : [],
    );
  };

  const addTier = () => {
    const number = (raw: string) => {
      const parsed = Number(raw.trim().replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    // Количество и время приезжают заполненными, цена — пустой: см.
    // `createTierDraft`. Зерно времени клампится к потолку барабана ВИДИМО:
    // показано — значит сказано, молчаливого исправления нет.
    // Новая строка наследует расход строки выше: у материалов на единицу от
    // количества скидки нет — та же химия на ту же штуку.
    // Расход наследуется ЗА ОДНУ и подставляется за всё — пересчёт живёт в
    // `createTierDraft`, которому для этого достаточно первой строки: у неё
    // количество 1, значит её расход и есть расход на единицу.
    const tier = createTierDraft(economics.tiers, number(duration), cost);
    const seeded = {
      ...tier,
      totalDuration: String(roundToStep(Number(tier.totalDuration))),
    };
    updateEconomics({ ...economics, tiers: [...economics.tiers, seeded] });
    setOpenRow(null);
    // Строка приезжает вниз — лист обязан САМ довести её до глаза, иначе
    // «＋ Количество» снаружи выглядит не сделавшей ничего.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  };

  // Одна красная строка ПОД таблицей: три подписи под тремя колонками сломали
  // бы выравнивание, ради которого таблица и затевалась.

  const firstError =
    baseErrors.price ??
    baseErrors.duration ??
    Object.values(economicsErrors?.tiers ?? {})
      .flatMap((tier) => [
        tier.minQuantity,
        tier.rowPrice,
        tier.rowCost,
        tier.totalDuration,
        // `row` — ошибка не КЛЕТКИ, а всей строки («впишите цену или время»).
        // Её забыли внести в цепочку, и она была недостижима: строка без цены
        // и без времени не сохранялась, а человек не получал ни слова —
        // «Сохранить» просто ничего не делала. Молчащая кнопка хуже отказа.
        tier.row,
      ])
      .find(Boolean);

  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      // ЗАГОЛОВОК НАЗЫВАЕТ УСЛУГУ, А НЕ ЖАНР (аудит 2026-08-21). «Услуга» —
      // это то, что человек и так видит: он тапнул по строке прайса. Имя в
      // шапке отвечает на другой вопрос — «ту ли я открыл», — который в списке
      // из сорока строк задают всерьёз.
      title={service ? service.name : "Новая услуга"}
      scroll
      scrollRef={scrollRef}
      avoidKeyboard
      padded={false}
      // Опасное действие — значком в шапке, а не второй кнопкой под
      // «Сохранить»: две кнопки внизу стояли вплотную к большому пальцу и
      // читались как равноправные выходы.
      headerAction={
        service ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* ДУБЛЬ ЖЕСТОМ БЫЛ НЕДОСТИЖИМ: свайп ВПРАВО по строке съедает
              системный жест «назад», и до кромки «Дубль» палец не доходил.
              Вторая дверь — здесь, словом и значком. */}
          <Pressable
            onPress={() => onDuplicate(service)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Дублировать услугу ${service.name}`}
            className="h-11 w-11 items-center justify-center active:opacity-60"
          >
            <Copy color={t.sub} size={ICON.sm} strokeWidth={2} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(service)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Скрыть услугу ${service.name}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Trash2 color={t.danger} size={ICON.sm} strokeWidth={2} />
          </Pressable>
          </View>
        ) : undefined
      }
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
        <Button
          label={service ? "Сохранить" : "Создать"}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
        />
        </View>
      }
    >
      {/* ИМЯ — ОНО ЖЕ ИМЯ В СЧЁТЕ. Второго имени «для документов» у услуги
          нет и не будет: его заводили дважды («Название в счёте», «Имя для
          клиента»), оба раза не заполнил никто, и оба раза владелец не понял
          строку. Подпись честно называет последствие — а формулировку для
          конкретного счёта правят в самом счёте, где она и замерзает. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        <NameColorField
          label="Название"
          name={name}
          onNameChange={setName}
          color={color}
          onColorChange={setColor}
          autoFocus={!service}
          // «＋ Описание» переехало К ПОДПИСИ (владелец 2026-08-24: «название,
          // а с правой стороны — плюс описание; топаю — и внизу открывается
          // блок»). Под полем кнопка читалась как продолжение самого поля и
          // отодвигала цену; у ярлыка она читается как то, чем она является, —
          // необязательной припиской к имени.
          labelAction={
            hasDescription ? undefined : (
              <Pressable
                onPress={() => {
                  setOpenRow(null);
                  setHasDescription(true);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Добавить описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  paddingLeft: 12,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 14, fontWeight: "500", color: t.accent }}
                >
                  ＋ Описание
                </Text>
              </Pressable>
            )
          }
        />

        {/* ОПИСАНИЕ ЖИВЁТ ПРИ ИМЕНИ, А НЕ ОТДЕЛЬНОЙ КАРТОЧКОЙ (владелец
            2026-08-21: «это должна быть маленькая кнопочка добавить описание
            под самим названием, типа плюсик»). Оно описывает именно ИМЯ, и
            карточка во всю ширину обещала блок там, где нужна приписка.
            Пустое — маленькая накладка в одну строку; заведённое — такое же
            поле, как имя, только в три строки высотой.
            ДОХОДИТ ДО КЛИЕНТА: текст печатается второй строкой ПОД названием
            позиции в счёте и в PDF. */}
        {hasDescription ? (
          <View style={{ marginTop: -6, marginBottom: 16 }}>
            {/* ДВЕРЬ ОТКРЫВАЕТСЯ В ОБЕ СТОРОНЫ (аудит 2026-08-21). Раньше
                `hasDescription` обратно не снимался: тапнул «＋ Описание» по
                ошибке — и блок оставался до закрытия листа. Крестик убирает
                и блок, и текст: снятое описание уезжает в базу явным `null`,
                об этом заботится `submit`. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <FieldLabel text="Описание в счёте" />
              <Pressable
                onPress={() => {
                  setHasDescription(false);
                  setDescription("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Убрать описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  opacity: pressed ? 0.4 : 1,
                })}
              >
                <X color={t.faint} size={16} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              autoFocus={!description}
              accessibilityLabel="Описание в счёте"
              selectionColor={t.accent}
              keyboardAppearance="light"
              style={{
                minHeight: 76,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: t.radius.input,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: t.separator,
                fontSize: 16,
                lineHeight: 22,
                color: t.ink,
                textAlignVertical: "top",
              }}
            />
          </View>
        ) : null}
      </View>

      {/* ЧЕТЫРЕ БЛОКА ВМЕСТО ВСЕГО, ЧТО ЗДЕСЬ БЫЛО (владелец 2026-08-27:
          «всё, что ниже названия, удаляем; первый блок — количество, второй —
          цена, третий — расход, четвёртый — время»).

          ЧТО УБРАНО ИЗ ИНТЕРФЕЙСА:
            • «Тип услуги» и ветка «Варианты» — плоский список именованных
              опций;
            • «Проверка» — живой калькулятор «что получится на N штуках»;
            • «Время вокруг работы» (дорога, после, людей) и «Ограничения»
              (минимум, максимум);
            • «Работаем по дням» — семь плиток.

          НИ ОДНО ПОЛЕ БАЗЫ НЕ ТРОНУТО. Состояние живо, `submit` пишет те же
          колонки прежними значениями, уже заведённые услуги ничего не теряют
          при сохранении. Убран ТОЛЬКО интерфейс — вернуть его можно, не
          трогая данные. */}
      {/* УСЛУГА С ВАРИАНТАМИ РЕДАКТИРУЕТСЯ НЕ ЗДЕСЬ, И ОБ ЭТОМ СКАЗАНО ВСЛУХ.
          Ветку «Варианты» убрали 27 августа по просьбе владельца; проверяя
          перед сносом, я посмотрел ОДИН календарь (в нём услуг не было) и
          решил, что таких услуг нет вовсе. Они есть — «Flat cleaning,
          2 варианта» в другом календаре.

          Без этой заглушки такая услуга открывалась обычной лесенкой, и
          цена в ней была цифрой ПЕРВОГО варианта: правка в поле уезжала в
          никуда — `submit` для вариантных услуг берёт цену у варианта, а не
          из этого поля. То есть человек менял 50 на 60, жал «Сохранить» и не
          получал ничего, без единого слова.

          Данные целы: `submit` пишет варианты прежними. Здесь закрыт только
          путь к молчаливой потере правки. */}
      {serviceType === "variant" ? (
        <View style={{ paddingHorizontal: GUTTER }}>
          <View
            style={{
              padding: 16,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              backgroundColor: t.fill,
            }}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {formatCountRu(variants.length, ["вариант", "варианта", "вариантов"])}
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 14, lineHeight: 20, color: t.sub, marginTop: 4 }}
            >
              Цену и время задают варианты. Здесь они не правятся — имя и
              описание сохранятся, варианты останутся как есть.
            </Text>
          </View>
        </View>
      ) : (
      <ServiceLadder
        steps={ladderSteps}
        currencySymbol={currencySymbol}
        priceEntry={priceEntry}
        costEntry={costEntry}
        onPriceEntryChange={setPriceEntry}
        onCostEntryChange={setCostEntry}
        openTimeId={openRow}
        onOpenTime={(id) => {
          setOpenRow(id);
          // Барабан раскрывается ПОД строкой и в блоке «Время», то есть у
          // самого низа листа — за кнопкой «Создать». Лист обязан сам довести
          // его до глаза, иначе тап по времени выглядит не сделавшим ничего.
          if (id) {
            requestAnimationFrame(() =>
              scrollRef.current?.scrollToEnd({ animated: true }),
            );
          }
        }}
        onQtyChange={(id, v) =>
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id ? { ...x, minQuantity: v } : x,
            ),
          })
        }
        onPriceChange={(id, v) => {
          if (id === "base") return setPrice(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id
                ? { ...x, rowPrice: draftValue(v, qtyOf(x.minQuantity), priceEntry) }
                : x,
            ),
          });
        }}
        onCostChange={(id, v) => {
          if (id === "base") return setCost(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id
                ? { ...x, rowCost: storeCost(v, qtyOf(x.minQuantity)) }
                : x,
            ),
          });
        }}
        onDurationChange={(id, v) => {
          if (id === "base") return setDuration(v);
          updateEconomics({
            ...economics,
            tiers: economics.tiers.map((x) =>
              x.id === id ? { ...x, totalDuration: v } : x,
            ),
          });
        }}
        onAdd={addTier}
        onRemove={(id) =>
          updateEconomics({
            ...economics,
            tiers: economics.tiers.filter((x) => x.id !== id),
          })
        }
      />
      )}

      {/* РАБОЧИЕ ДНИ — ПАРАМЕТР, КОТОРЫЙ ДОБАВЛЯЮТ, А НЕ ФОРМА, КОТОРУЮ
          ЗАПОЛНЯЮТ (владелец 2026-08-29). Пока его нет — одна строчка-кнопка,
          как «＋ Описание» у названия. Заведён — семь плиток и крестик,
          который снимает ограничение целиком.

          Ограничение не про график команды: команда выезжает всю неделю, а
          чистку кондиционеров в воскресенье не ставят, потому что поставщик
          закрыт. Поэтому все семь зажжены сразу после добавления — гасят из
          них лишние, а не набирают нужные.

          КРЕСТИК ВОЗВРАЩАЕТ «ЛЮБОЙ ДЕНЬ», а не пустой набор дней: услуга без
          единого дня не предлагалась бы никогда, и это была бы поломка,
          выглядящая как настройка. */}
      {hasWeekdays ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="Работаем по дням" />
            <Pressable
              onPress={() => {
                setHasWeekdays(false);
                setWeekdays([]);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать ограничение по дням"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
              const on = weekdays.length === 0 || weekdays.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => {
                    // Гашение первого дня разворачивает «пусто = все» в явный
                    // список: иначе снять один день было бы нечем.
                    const current =
                      weekdays.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : weekdays;
                    const next = current.includes(day)
                      ? current.filter((x) => x !== day)
                      : [...current, day].sort((a, b) => a - b);
                    setWeekdays(next.length === 7 ? [] : next);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${WEEKDAY_LABELS[day]} — ${on ? "делаем" : "не делаем"}`}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    borderCurve: "continuous",
                    backgroundColor: on ? t.accent : t.fill,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "500",
                      color: on ? t.onAccent : t.faint,
                    }}
                  >
                    {WEEKDAY_LABELS[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 14 }}>
          <Pressable
            onPress={() => setHasWeekdays(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить ограничение по дням недели"
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              paddingVertical: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
            >
              ＋ Работаем по дням
            </Text>
          </Pressable>
        </View>
      )}

      {/* ПЕРЕРЫВ ПОСЛЕ УСЛУГИ. Не часть работы, а то, что идёт ПОСЛЕ неё:
          дорога до следующего объекта, уборка, мойка инструмента. В сетку
          он встаёт вместе с записью, поэтому следующая работа не садится
          вплотную — а раньше садилась, и день оказывался плотнее, чем он
          есть на самом деле.

          Пресеты, а не поле ввода: перерыв — это «пятнадцать минут» или
          «полчаса», а не 17. Клавиатура ради двух цифр здесь лишняя.
          «Нет» снимает параметр целиком — то же, что крестик. */}
      {hasBufferAfter ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="Перерыв после услуги" />
            <Pressable
              onPress={() => {
                setHasBufferAfter(false);
                setBufferAfter("0");
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать перерыв после услуги"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {[10, 15, 20, 30, 45, 60].map((min) => {
              const on = Number(bufferAfter) === min;
              return (
                <Pressable
                  key={min}
                  onPress={() => setBufferAfter(String(min))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${min} минут после услуги`}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    borderCurve: "continuous",
                    backgroundColor: on ? t.accent : t.fill,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "500",
                      color: on ? t.onAccent : t.faint,
                    }}
                  >
                    {min}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, marginTop: 10 }}>
          <Pressable
            onPress={() => {
              setHasBufferAfter(true);
              // Пятнадцать минут — самый частый перерыв: дорога внутри города
              // и разгрузка. Ноль означал бы «параметр есть, но не работает».
              if (Number(bufferAfter) <= 0) setBufferAfter("15");
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить перерыв после услуги"
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              paddingVertical: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
            >
              ＋ Перерыв после услуги
            </Text>
          </Pressable>
        </View>
      )}

      {/* ОНЛАЙН-ЗАПИСЬ — ЗАГЛУШКА, И ОНА ЧЕСТНАЯ (владелец 2026-08-29:
          «пока не включаем, ставим заглушку — скоро»).

          Строка НЕ ПЕРЕКЛЮЧАЕТСЯ намеренно. Живой тумблер над невыполненной
          функцией — худший вид вранья в продукте: человек его включает,
          уходит уверенный, что клиенты записываются сами, и узнаёт правду
          пустым календарём. Поэтому здесь нет тумблера вовсе — только
          название и слово «Скоро».

          Колонка `online_enabled` в базе есть и по умолчанию `true`; когда
          функция появится, эта строка станет настоящим переключателем без
          миграции. */}
      <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
        <View
          className="flex-row items-center"
          style={{
            minHeight: 52,
            paddingHorizontal: 16,
            gap: 12,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            backgroundColor: t.fill,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 16, color: t.sub }}
          >
            Онлайн-запись
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, fontWeight: "600", color: t.faint }}
          >
            Скоро
          </Text>
        </View>
      </View>

      {/* ПОД ТАБЛИЦЕЙ — ТОЛЬКО ОШИБКА (владелец 2026-08-21: «внизу не нужно
          писать, это полная хуета»). Тихая строка-проверка «а что будет на
          семи» отвечала на вопрос, которого человек не задавал, и висела под
          карточкой ещё одной серой строкой. Ответ и так виден: за последней
          заведённой строкой цена и время идут по её правилу. */}
      {firstError ? <RowCaption text={firstError} tone="danger" /> : null}

      {/* Воздух под последним блоком: без него «＋ Добавить» прижимается к
          кнопке футера и читается как её часть. */}
      <View style={{ height: 12 }} />

    </BottomSheet>
  );
}
