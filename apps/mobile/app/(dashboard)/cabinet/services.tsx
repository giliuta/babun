import { useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Briefcase, EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { readTenantPref } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { useToast } from "@/components/ui/Toast";
import {
  useDeleteService,
  usePurgeService,
  useServiceUsageCount,
  useTeams,
  useUpdateService,
} from "@/features/reference/queries";
import {
  useCreateService,
  useReorderServices,
  useAllServices,
  useServices,
  type Service,
  type ServiceInput,
} from "@/features/services/queries";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import { durationLabel } from "@/features/services/format";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";

import { parsePriceTiers } from "@/features/services/economics";
import { ServiceSheet, type ServiceEditing } from "@/features/services/ServiceSheet";

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
// ЦВЕТ У УСЛУГИ ЕСТЬ, И ЕГО ЧИТАЕТ КАЛЕНДАРЬ. Точка слева от имени — та же, что
// у метки и у команды (`NameColorField`), и она же становится цветом записи,
// когда в Кабинете → «Запись» выбран «Обычный цвет: Цвет услуги» (запись берёт
// цвет своей первой услуги). Второго места, где спрашивают цвет услуги, в
// продукте быть не должно.
//
// Прежний комментарий утверждал, что колонка мертва и «продукт её не пишет», —
// это была неправда уже тогда: экран её писал, рисовал точкой и показывал в
// каталоге выбора при записи. Читателя не хватало ровно одного.
//
// Экран переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/services — весь прайс,
//  · обёртка «услуги одной команды» снесена 2026-08-30 вместе с разделом
//    «Команды» в Кабинете; та же дверь есть в настройках календаря.

/** Команда, чей прайс человек смотрел в прошлый раз. Свой ключ, а не запись в
 *  `calendar.view`: тап по чипу здесь не должен переключать чужой календарь. */
/** Тот же ключ, которым календарь помнит свою активную команду. ЧИТАЕМ, но
 *  НИКОГДА не пишем: из шестерёнки календаря человек приходит настраивать ту
 *  команду, которую там и смотрит. */
const CAL_VIEW_LEGACY_KEY = "calendar.view";

/** Высота строки фиксирована: по ней перетаскивание считает, через сколько
 *  соседей перелетел палец. Две строки текста + воздух. */
const ROW_H = 60;


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
  const tenantId = useTenantId();
  // Порядок читается сверху вниз как «чей это выбор»: адрес команды → команда,
  // открытая в календаре (её же человек и настраивает, входя сюда) → и только
  // последней, когда не выбрано ничего, — команда, у которой прайс есть.
  // Памяти «что выбирали в прошлый раз» здесь больше нет: выбирать на этом
  // экране нечем, лента снесена 2026-08-24.
  const fromCalendar =
    (tenantId
      ? readTenantPref<{ teamId?: string | null }>(
          "calendar.view",
          tenantId,
          CAL_VIEW_LEGACY_KEY,
        )?.teamId
      : null) ?? null;
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

  const handleSave = async (draft: ServiceInput, serviceId?: string) => {
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
      if (serviceId) {
        await update.mutateAsync({ id: serviceId, patch: { ...draft } });
      } else {
        await create.mutateAsync({ ...draft, position: allServices.length });
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
                // СТРОКА ГОВОРИТ, ЕСТЬ ЛИ У УСЛУГИ ЛЕСТНИЦА. Дублировать
                // «€50 · 30 мин» рядом с ценой справа незачем: это одно и то
                // же число дважды.
                const tierCount = parsePriceTiers(svc.price_tiers).length;
                const sub =
                  tierCount > 0
                    ? `${durationLabel(svc.duration_minutes)} · цена от количества`
                    : durationLabel(svc.duration_minutes);
                // ЦЕНА С КОПЕЙКАМИ. `formatEUR` округляет до целых евро
                // (`money(Math.round(...))`), и услуга за 49,50 печаталась в
                // прайсе как «€50» — прайс обязан говорить ровно ту цену,
                // которая уедет в запись и в счёт.
                const price = formatEURExact(Number(svc.price));
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
                        // тише живых. Полупрозрачность гасит и заливку услуги,
                        // и цену: строка целиком уходит на второй план.
                        opacity: off ? 0.45 : 1,
                        backgroundColor: appearanceRowFill(svc.color, false, {
                          rest: t.surface,
                          pressed: t.pressed,
                        }),
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
                          gap: 12,
                          paddingLeft: 16,
                          // ЗАЛИВКУ ДЕРЖИТ ВСЯ СТРОКА, А НЕ ЕЁ ПОЛОВИНА: цвет
                          // стоит на внешней строке, здесь остаётся только
                          // отклик на палец. Иначе две заливки складывались, и
                          // колонка ручки выходила светлее остального.
                          backgroundColor: pressed ? t.pressed : "transparent",
                        })}
                      >
                        {/* ПЛИТКА ВИДА — как у тега, метки и типа объекта:
                            услуга узнаётся в прайсе тем же способом. */}
                        <AppearanceTile
                          color={svc.color || null}
                          icon={svc.icon}
                          size={28}
                        />
                        <View
                          style={{ flex: 1, paddingRight: 12 }}
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
              router.push("/calendar");
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
      />


    </Screen>
  );
}

