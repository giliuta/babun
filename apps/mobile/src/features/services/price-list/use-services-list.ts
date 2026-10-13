import { useMemo, useState } from "react";
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
  useServicesPageTable,
  type Service,
  type ServiceInput,
} from "@/features/services/queries";
import { useDataRole } from "@/session/tenant";
import { useTeamSettingLevel } from "@/session/team-setting-level";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { type ServiceEditing } from "@/features/services/ServiceSheet";
import { pickPriceListTeam, purgeMessage, teamPriceList, templateCandidates } from "./price-list-rules";

/** Команда, чей прайс человек смотрел в прошлый раз. Свой ключ, а не запись в
 *  `calendar.view`: тап по чипу здесь не должен переключать чужой календарь. */
/** Тот же ключ, которым календарь помнит свою активную команду. ЧИТАЕМ, но
 *  НИКОГДА не пишем: из шестерёнки календаря человек приходит настраивать ту
 *  команду, которую там и смотрит. */
const CAL_VIEW_LEGACY_KEY = "calendar.view";

/** Queries, the open team and the actions of the price list. */
export function useServicesList(teamId: string | undefined) {
  const toast = useToast();
  // СОТРУДНИК ЧИТАЕТ САМУ ТАБЛИЦУ (30.09): его проекция услуг — только
  // услуги его записей, с нулём вместо цены, а здесь нужен весь прайс
  // команды. Сервер отдаёт строки тех команд, где «Услуги» ему открыты.
  const isMaster = useDataRole().data === "master";
  const pageTable = useServicesPageTable(isMaster);
  const ownerLive = useServices();
  const servicesQuery = isMaster ? pageTable : ownerLive;
  const teamsQuery = useTeams();
  const allServices = useMemo(
    () =>
      isMaster
        ? (pageTable.data ?? []).filter((s) => s.is_active)
        : ownerLive.data ?? [],
    [isMaster, pageTable.data, ownerLive.data],
  );
  // Полный справочник, ВКЛЮЧАЯ убранные: `useServices` их фильтрует, и без
  // второго списка вернуть убранную услугу было нечем.
  const everyServiceQuery = useAllServices();
  const everyService = useMemo<Service[]>(
    () => (isMaster ? pageTable.data : everyServiceQuery.data) ?? [],
    [isMaster, pageTable.data, everyServiceQuery.data],
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
  const activeTeamId = pickPriceListTeam(teamId, fromCalendar, teams, allServices);

  const activeTeam = teams.find((tm) => tm.id === activeTeamId) ?? null;
  // «ТОЛЬКО ВИДИТ» — ПРАЙС БЕЗ ПРАВКИ (владелец 30.09): ни кнопки внизу, ни
  // свайпов, ни ручек, строка не открывает редактор. Владельцу — всегда
  // правка.
  const readOnly = useTeamSettingLevel("calendar.services", activeTeamId) !== "write";
  /** Справочник команд ещё не ответил: «команд нет» и «команды не спросили» —
   *  разные вещи, и путать их нельзя ни в кнопке, ни в пустом состоянии. */
  const teamsUnknown = teamsQuery.isLoading;

  // ГОТОВЫЕ УСЛУГИ ИЗ ДРУГИХ КОМАНД — ШАБЛОНЫ В ЛИСТЕ «НОВАЯ УСЛУГА»
  // (владелец 11.10: «в другой команде сразу добавить услугу, которая есть в
  // той команде… выбор по готовым услугам, которые делал лично я со своего
  // аккаунта»; вторым заходом: «значок в самой шторке справа — нажимаю
  // шаблон, и в этой же шторке появляется вся услуга»). Только у владельца
  // аккаунта: партнёр в чужом аккаунте свои услуги туда не носит. Уже
  // заведённые здесь по имени — не предлагаются. Список и заполнение формы —
  // в `ServiceSheet`.
  const isOwner = useDataRole().data === "owner";
  const copyCandidates = useMemo(
    () => templateCandidates(isOwner, activeTeamId, allServices),
    [isOwner, activeTeamId, allServices],
  );
  const templates = useMemo(
    () =>
      copyCandidates.map((service) => ({
        service,
        teamName: teams.find((tm) => tm.id === service.team_id)?.name ?? "",
      })),
    [copyCandidates, teams],
  );

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
  const services = useMemo(
    () => teamPriceList(everyService, activeTeamId),
    [everyService, activeTeamId],
  );

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
      // Сотрудник видит не все записи компании — его счёт занизил бы число.
      // Честнее сказать без числа.
      used = isMaster ? -1 : await countUsage(svc.id);
    } catch {
      // Счёт не сошёлся — не повод молчать о самом удалении. Предупреждаем
      // без числа: неизвестность здесь хуже завышенной оценки.
      used = -1;
    }
    confirmThen(
      "Удалить услугу навсегда?",
      {
        message: purgeMessage(svc.name, used),
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

  return {
    toast,
    servicesQuery,
    teams,
    update,
    reorder,
    editing,
    setEditing,
    dragging,
    setDragging,
    activeTeamId,
    activeTeam,
    readOnly,
    teamsUnknown,
    templates,
    services,
    alertError,
    handlePurge,
    handleSave,
    handleDelete,
    busy,
  };
}

export type ServicesListState = ReturnType<typeof useServicesList>;
