// Client detail card — COMPOSER (mobile port of the web ClientCardPage,
// «Карта-диспетчер» LOCKED design).
//
// This screen does ALL data wiring; the blocks are presentational. It
// fetches the client + its appointments, computes the shared `stats`
// (client-stats selector) and `serviceDue` (service-due selector), then
// renders the page as ONE STACK OF ROWS (ЗАКОН СТРОКИ, DESIGN-SYSTEM.md):
//
//   Клиент (ClientHeader) · Заметка клиента · Люди · История · Объекты
//   · Файлы · Реквизиты · Метка | Тег · Личное (docs/BLOCKS.md §9.1)
//
// СОЗДАНИЕ = ЭТА ЖЕ СТРАНИЦА (решение владельца 2026-07-13, уточнено
// 2026-07-14): роут /clients/new попадает сюда с id="new" → карточка
// работает с ЧЕРНОВИКОМ (createBlankClient) через локальный update.
// Шапка НЕ подменяется формой — это тот же ClientHeader с `draft`:
// те же поля пустые, телефон с автофокусом и live-дедупом по phone_e164
// (clients-99 F1.5/F2.7). «Создать клиента» в футере создаёт его, и
// router.replace приводит на этот же экран уже с сервера.
//
// ЧТО ВИДНО В ЧЕРНОВИКЕ: ВСЯ страница (владелец 2026-07-26: «добавить
// клиента открывается чётко вся страница, как будет выглядеть в будущем»).
// Каждое поле этих блоков проходит белый список create_client_with_tags,
// то есть пишет в тот же объект, который уедет в базу по «Создать клиента».
// Единственное исключение — блок «Файлы»: путь в хранилище строится по id
// клиента, которого ещё нет. Действия, которым нужен реальный id
// («Записать»), не спрятаны, а пригашены с подписью-причиной.
//
// A top chrome row owns the back button + a ⋯ action menu (message via
// Linking sms:, share via RN Share, blacklist toggle via update) — the
// blocks stay free of screen-level concerns.

import { useFeatureOn } from "@/features/settings/company-features";
import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Archive, ChevronRight, Phone, UserPlus } from "lucide-react-native";
import {
  Stack,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
} from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { Button } from "@/components/ui/Button";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { NavRow } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import { useThemeColors } from "@/theme/colors";
import {
  useClient,
  useClientTags,
  useRestoreClient,
  useUpdateClient,
} from "@/features/clients/queries";
import { useArchiveWithUndo } from "@/features/clients/archive-undo";
import { archivedVisitTag } from "@/features/clients/archived-visit";
import { useTeams } from "@/features/reference/queries";
import { daysLeft, daysWordRu } from "@/features/clients/HiddenClientsScreen";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { useClientAppointments } from "@/features/clients/appointments";
import { useAllServices } from "@/features/services/queries";
import ClientHeader from "@/features/clients/ClientHeader";
import { clientSubParams } from "@/features/clients/clients-company";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import { ClientLabelTags } from "@/features/clients/ClientLabelTags";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { ClientDetailChrome } from "@/features/clients/ClientDetailChrome";
import { ClientScreenFooter } from "@/features/clients/ClientScreenFooter";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientDraftNotice } from "@/features/clients/ClientDraftNotice";
import { DuplicateNotice } from "@/features/clients/DuplicateNotice";
import { ClientProfileBlocks } from "@/features/clients/ClientProfileBlocks";
import {
  PEOPLE_ON_CARD,
  useClientPeople,
} from "@/features/clients/ClientPeopleDoor";
import { useMergeDuplicate } from "@/features/clients/use-merge-duplicate";
import { useSplitClient } from "@/features/clients/use-split-client";
import { parseSplit } from "@/features/clients/split-client";
import {
  draftLinkFromParams,
  useClientDraft,
  type DraftLinkParams,
  type DraftOpen,
} from "@/features/clients/useClientDraft";
import ClientContactRow from "@/features/clients/ClientContactRow";
import { useCurrentRole } from "@/features/settings/tenant";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { shareText } from "@/features/clients/client-share";
import {
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/features/clients/company-scope";
import { humanDay } from "@/features/appointments/helpers";
import { notify } from "@/lib/notify";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { deliverCreatedClient } from "@/features/appointments/pending-client";

// КАРТОЧКА ОТКРЫВАЕТСЯ В КОМПАНИИ СВОЕЙ СТРОКИ (STORY-082): `?tenant=` несёт
// компанию, ворота решают, чья она, и объявляют источник блокам.
export default function ClientDetailRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientDetailScreen />
    </ClientsCompanyRoute>
  );
}

/** Тело карточки без ворот: общий адрес `/client` оборачивает его своими —
 *  там компания всегда календарная. */
export function ClientDetailScreen() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    id,
    name: prefillName,
    phone: prefillPhone,
    open: openOnArrive,
    split: splitParam,
    ...linkParams
  } = useLocalSearchParams<{ id: string; open?: string; split?: string } & DraftLinkParams>();
  const router = useRouter();
  const pathname = usePathname();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const scope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();

  // «new» → черновик без запросов; иначе обычная карточка с сервера.
  const isDraft = id === "new";
  // Связь, с которой черновик открыла дверь «Создать клиента» в шторке людей
  // (ТЗ, сценарий г-б): она едет адресом и уходит в базу вместе с клиентом.
  const draftLink = isDraft ? draftLinkFromParams(linkParams) : null;
  // Черновик, открытый ПОВЕРХ записи (`/book/client`): «Создать клиента»
  // отдаёт клиента записи и уходит «назад», а не на карточку созданного. Режим
  // читается по маршруту, а не по флагу в памяти: флаг пережил бы уход с
  // экрана и подставил бы следующего клиента, заведённого уже из списка.
  // ОТДАТЬ СОЗДАННОГО ТОМУ, КТО ПОЗВАЛ. Карточка, открытая общим адресом
  // `/client`, лежит ПОВЕРХ звавшего (запись, шторка долга): «Создать» кладёт id
  // в ящик и уходит «назад», а не на карточку нового клиента. Открытая своим
  // маршрутом внутри вкладки «Клиенты» — ведёт себя как обычно.
  //
  // Читается по маршруту, а не по флагу в памяти: флаг пережил бы уход с
  // экрана и подставил бы следующего клиента, заведённого уже из списка.
  //
  // ЧЕРНОВИК СО СВЯЗЬЮ ЗВАВШЕМУ НЕ ОТДАЁТСЯ. Его открыла карточка-группа, а
  // не запись под ней: жилец Натальи, положенный в ящик, подставился бы
  // записи клиентом. Он возвращается к Наталье (`useClientDraft.save`).
  const handBack = isDraft && pathname === "/client" && !draftLink;
  const clientQuery = useClient(isDraft ? "" : id);
  const {
    data: client,
    isLoading,
    isError: clientFailed,
    error: clientError,
    isRefetching: clientRetrying,
    refetch: retryClient,
  } = clientQuery;
  const updateClient = useUpdateClient(isDraft ? "" : id);
  const archiveWithUndo = useArchiveWithUndo();
  const restoreClient = useRestoreClient();
  const appointmentsQuery = useClientAppointments(isDraft ? "" : id);
  const {
    data: appointments = [],
    isError: appointmentsFailed,
    isRefetching: appointmentsRetrying,
    refetch: retryAppointments,
  } = appointmentsQuery;
  const tagsQuery = useClientTags();
  const {
    data: tags = [],
    isError: tagsFailed,
    isRefetching: tagsRetrying,
    refetch: retryTags,
  } = tagsQuery;
  // Web parity: VisitsBlock resolves service NAMES from the catalog.
  // Лента истории и блок объектов зовут услугу по имени — читаем весь
  // справочник, включая убранное: карточка показывает прошлое.
  const servicesQuery = useAllServices();
  const {
    data: services = [],
    isError: servicesFailed,
    isRefetching: servicesRetrying,
    refetch: retryServices,
  } = servicesQuery;
  const [menuOpen, setMenuOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const {
    draft,
    updateDraft,
    duplicate,
    createError,
    e164,
    isDirty: isDraftDirty,
    canSave,
    linked: draftLinked,
    phoneTyped: draftPhoneTyped,
    isSaving,
    onPhoneChange: onDraftPhoneChange,
    onNameChange: onDraftNameChange,
    save: saveDraft,
    isSavingNow,
  } = useClientDraft(isDraft, {
    forBooking: handBack,
    name: prefillName,
    phone: prefillPhone,
    link: draftLink,
    // «Разделить клиента»: после создания номер уходит из исходной карточки.
    split: isDraft ? parseSplit(splitParam) : null,
  });

  // Единый persist-путь для блоков: черновик — локально, карточка — PATCH.
  const update = async (patch: Partial<Client>): Promise<boolean> => {
    if (isDraft) {
      updateDraft(patch);
      return true;
    }
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      // useUpdateClient owns the actionable alert. Returning false lets an
      // inline editor keep the user's draft open instead of discarding it.
      return false;
    }
  };

  // ПРИЧИНА, ПО КОТОРОЙ КНОПКА ЧЕРНОВИКА ПОГАШЕНА — словами, над ней.
  // Порядок тот же, что на экране: сперва имя, потом номер, потом дубль.
  //
  // Имя дубля стоит ПОСЛЕ двоеточия, в именительном: «у Павла Иванова»
  // требует склонять чужое имя, а склонять его нечем — «у Павел Иванов»
  // читалось бы поломкой.
  const duplicateName = duplicate?.full_name.trim() ?? "";
  const draftReason = !isDraft
    ? null
    : !draft.full_name.trim()
      ? "Впишите имя"
      : e164 === null && (!draftLinked || draftPhoneTyped)
        ? // Со связью номер необязателен (`draftCanSave`), но начатый и
          // не разобранный — ошибка набора: его дописывают или стирают.
          draftLinked
          ? "Допишите номер или сотрите его"
          : draftPhoneTyped
            ? // Цифры есть, а номера нет — проверка страны и длины
              // (владелец 22.09: «номер должен хоть как-то проверяться»).
              "Проверьте номер и код страны"
            : "Нужен номер телефона"
        : duplicate
          ? duplicateName
            ? `Такой номер уже есть: ${duplicateName}`
            : "Такой номер уже есть"
          : null;

  // Объект, который видят блоки (черновик или серверная строка).
  const c: Client | undefined = isDraft ? draft : client ?? undefined;

  // ЛЮДИ КАРТОЧКИ, ЖИЛЬЦЫ, СТРОКА «ЧЕЙ ОН» И ДВЕРЬ СВЯЗИ — одним куском
  // (`ClientPeopleDoor.tsx`); страница только расставляет их по местам.
  // ДВЕРЬ БЛОКА В НОВОМ КЛИЕНТЕ (владелец 22.09: «при создании — те же
  // самые блоки, что у созданного»): «Добавить человека», «Добавить файл»,
  // «Записать». Всё это живёт у id карточки, которого у черновика нет, — сперва
  // создать (гейт футера), потом на карточке сразу открыть нужное.
  // ЛЮБОЙ УХОД ИЗ НАБРАННОГО ЧЕРНОВИКА СПРАШИВАЕТ (аудит 22.09): стрелка,
  // жест, аппаратная «назад» Android и «Открыть» у найденного дубля. Раньше
  // спрашивала только стрелка, а остальные пути молча выбрасывали набранное.
  // Уход после «Создать клиента» и дверей черновика не спрашивает: клиент
  // уже создан.
  const navigation = useNavigation();
  const leavingRef = useRef(false);
  usePreventRemove(isDraft && isDraftDirty, ({ data }) => {
    if (leavingRef.current || isSavingNow()) {
      navigation.dispatch(data.action);
      return;
    }
    confirmThen(
      "Удалить черновик?",
      {
        message: "Введённые данные клиента ещё не сохранены.",
        confirmLabel: "Удалить черновик",
        destructive: true,
      },
      () => {
        leavingRef.current = true;
        navigation.dispatch(data.action);
      },
    );
  });
  const onDraftDoor = (open: DraftOpen) => {
    if (!canSave) {
      haptics.warning();
      notify(draftReason ?? "Сначала заполните клиента");
      return;
    }
    void saveDraft({ open });
  };
  // Люди и связи — функция компании (STORY-088): выключены — нет ни
  // «Людей», ни «Входит в», ни жильцов объекта, ни «Разделить».
  const peopleOn = useFeatureOn("client_people");
  const people = useClientPeople({
    id,
    // На карточке — первые трое и дверь «Все люди · N» (владелец 22.09).
    limit: PEOPLE_ON_CARD,
    client: c,
    isDraft,
    onDraftLinks: (memberships) => updateDraft({ memberships }),
    // «Человек» в новом клиенте: сперва создать (гейт футера), потом на
    // карточке сразу «Кто это». Не хватает имени или номера — говорим, чего.
    onDraftAddPerson: () => onDraftDoor("person"),
    openPersonOnArrive: !isDraft && openOnArrive === "person",
    onArrived: () => router.setParams({ open: undefined }),
  });
  // «Объединить с дублем» в «⋯» — вся проводка в `use-merge-duplicate.ts`.
  const onMerge = useMergeDuplicate({ client: c, isDraft, canManage: caps.manage, closeMenu: () => setMenuOpen(false) });
  // «Разделить клиента» в «⋯» — вся проводка в `use-split-client.ts`.
  const split = useSplitClient({ client: c, isDraft, canEdit: caps.edit, canLinks: caps.links && peopleOn, menuOpen });

  // Shared selectors — memoized so unrelated state changes don't re-scan
  // every appointment. Hooks must run unconditionally, hence the guards
  // before the early returns below.
  const stats = useMemo(
    () => (c ? buildStats(c, appointments) : undefined),
    [c, appointments],
  );

  // heroUnitId больше не нужен: состояния ТО ушли из «Что дальше» в свою
  // группу «Обслуживание» целиком — дублировать нечего.

  if (roleQuery.isPending) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Проверяем доступ" />
      </Screen>
    );
  }

  if (roleQuery.isError || !role) {
    return (
      <Screen>
        <ClientDataNotice
          fullScreen
          title="Доступ не подтверждён"
          message="Не удалось проверить роль сотрудника. Повторите попытку."
          onRetry={() => void roleQuery.refetch()}
          retrying={roleQuery.isRefetching}
        />
      </Screen>
    );
  }

  if (!isDraft && isLoading) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Загрузка карточки клиента" />
      </Screen>
    );
  }

  if (!isDraft && clientFailed && !c) {
    return (
      <Screen>
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить клиента"
          message={
            (clientError as Error | null)?.message ||
            "Проверьте соединение и повторите попытку."
          }
          onRetry={() => void retryClient()}
          retrying={clientRetrying}
        />
      </Screen>
    );
  }

  if (!c) {
    return (
      <Screen className="items-center justify-center px-6">
        <Text className="mb-3 text-sm" style={{ color: t.sub }}>
          Клиент не найден
        </Text>
        {/* КНОПКА ОДНА НА ПРОДУКТ (сведено 2026-09-10): здесь была своя,
            44pt с радиусом числом. */}
        <Button label="К списку" onPress={() => router.back()} />
      </Screen>
    );
  }

  // КЛИЕНТ СВОЕЙ ЗАПИСИ — СТАРАЯ ДОРОГА МАСТЕРА БЕЗ БАЗЫ. У него карточки в
  // продукте нет вовсе: он пришёл из своей заявки и видит только то, ради чего
  // её открыл, — как связаться и какие работы за человеком.
  //
  // СОТРУДНИК С «СМОТРИТ» СЮДА НЕ ПОПАДАЕТ (владелец 20.09: «визуал целой
  // страницы мы полностью сохраняем, а потом просто отключаем, что будет
  // работать»). Раньше попадал, и вместо карточки клиента ему открывалась
  // ДРУГАЯ страница — со своим кеглем, своими разделителями и своим языком.
  // Теперь он видит ту же карточку, только блоки в ней не правятся
  // (`canEdit`), денег в ней нет и хозяйство базы скрыто.
  if (scope ? scope.kind === "record" : role === "master") {
    return (
      <MasterClientOperationalView
        client={c}
        appointments={appointments}
        services={services}
        onBack={() => router.back()}
        onOpenAppointment={(appointment) =>
          router.push({
            pathname: "/",
            params: {
              appointmentId: appointment.id,
              date: appointment.date,
              ...(appointment.team_id
                ? { teamId: appointment.team_id }
                : {}),
            },
          })
        }
      />
    );
  }

  if (c.deleted_at) {
    return (
      <ArchivedClientView
        client={c}
        appointments={appointments}
        services={services}
        restoring={restoreClient.isPending}
        onBack={() => router.back()}
        onRestore={async () => {
          try {
            await restoreClient.mutateAsync(c);
          } catch (error) {
            notify(
              "Не удалось восстановить",
              (error as Error).message || "Проверьте соединение и повторите.",
            );
          }
        }}
      />
    );
  }

  // «Напомнить» живёт в меню ⋯ (с карточки кнопка убрана владельцем
  // 2026-07-26) и открывает ТОТ ЖЕ лист, что long-press в списке.
  // Паузу «второй лист ждёт, пока уедет первый» держит сам PickerSheet:
  // своего таймера здесь больше нет, иначе ожидание удваивается.
  const onRemind = () => {
    setMenuOpen(false);
    setRemindOpen(true);
  };

  const onShare = async () => {
    setMenuOpen(false);
    // Всё, что нужно бригаде: имя, телефон, каждый объект со ссылкой и
    // заметкой; реквизиты — по тому же праву, что их блок на странице.
    try {
      await Share.share({ message: shareText(c, { requisites: caps.money }) });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  };

  // «Закрепить» — тот же патч, что у долгого нажатия в списке
  // (`onTogglePin` в clients/index.tsx): метка времени или её снятие.
  const onTogglePin = () => {
    setMenuOpen(false);
    void update({ pinned_at: c.pinned_at ? null : new Date().toISOString() });
  };

  const onToggleBlacklist = () => {
    setMenuOpen(false);
    update({ blacklisted: !c.blacklisted });
  };


  // Страница объекта читает клиента по id — значит в черновике клиент должен
  // появиться раньше, чем откроется страница. Гейт тот же, что у футера
  // (имя + телефон). ДОБАВЛЕНИЕ этого шага больше не требует: оно живёт в
  // листе снизу и пишет объект в тот же черновик.
  
  const onBack = () => router.back();

  const onArchive = () => {
    setMenuOpen(false);
    confirmThen(
      "Архивировать клиента?",
      {
        message: "Клиент исчезнет из рабочего списка, но записи, инвойсы и финансовая история сохранятся. Вернуть его можно сразу — кнопкой «Отменить», а позже в Клиенты › шестерёнка › «Архив клиентов».",
        confirmLabel: "Архивировать",
        destructive: true,
      },
      async () => {
        try {
          // Экран закрывается, поэтому «Отменить» живёт в тосте: он
          // глобальный и переживает уход с карточки.
          const res = await archiveWithUndo([c]);
          if (res.archived > 0) router.back();
        } catch (e) {
          notify("Не удалось архивировать", (e as Error).message);
        }
      },
    );
  };

  // УДАЛИТЬ — не то же, что архив. Клиент едет в «Недавно удалённые» и
  // через 30 дней стирается насовсем.
  //
  // Но за клиентом с визитами стоит финансовая история, и база стереть его
  // не даст (guard_client_hard_delete_history). Честнее сказать это ДО
  // действия и предложить архив, чем дать нажать и показать ошибку.
  const onDelete = () => {
    setMenuOpen(false);
    // ЛЮБАЯ запись — уже история, даже будущая. База запрещает стирать
    // клиента с заявками (guard_client_hard_delete_history), поэтому такой
    // клиент лёг бы в корзину НАВСЕГДА: счётчик тикает, а ночная очистка
    // его пропускает — он застревает между полками.
    const hasHistory =
      (stats?.visits ?? 0) > 0 ||
      (stats?.totalSpent ?? 0) > 0 ||
      (stats?.unclosedVisits ?? 0) > 0 ||
      stats?.nextApt != null;
    if (hasHistory) {
      confirmThen(
        "Этого клиента нельзя удалить",
        {
          message: "За этим клиентом есть визиты и деньги — они останутся в отчётах и должны быть к кому-то привязаны. Такого клиента убирают в архив: из списка он исчезнет, история сохранится.",
          confirmLabel: "В архив",
        },
        onArchive,
      );
      return;
    }
    confirmThen(
      "Удалить клиента?",
      {
        message: `${c.full_name || "Клиент"} переедет в «Недавно удалённые» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть — там же, в шестерёнке.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          const res = await archiveWithUndo([c], true);
          if (res.archived > 0) router.back();
        } catch (e) {
          notify("Не удалось удалить", (e as Error).message);
        }
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !isDraftDirty }} />
      <Screen edges={["top"]}>
      {/* «Готово» из правого верхнего угла снесено: единственное действие
          черновика стоит внизу, в футере (`ClientScreenFooter`). */}
      <ClientDetailChrome
        draft={isDraft}
        saving={isSaving}
        menuOpen={menuOpen}
        blacklisted={c.blacklisted}
        onBack={onBack}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onRemind={() => void onRemind()}
        onShare={() => void onShare()}
        onToggleBlacklist={onToggleBlacklist}
        onArchive={onArchive}
        onDelete={onDelete}
        canEdit={caps.edit}
        canManage={caps.manage}
        onMerge={onMerge}
        onSplit={split.onSplit}
        onMenuExited={split.onMenuExited}
        pinned={!!c.pinned_at}
        // Список открывает меню со «Закрепить» только у строк своей компании —
        // здесь то же право (`manage` = своя компания).
        onTogglePin={!isDraft && caps.manage ? onTogglePin : undefined}
      />

      {/* ОТСТУП НА ВЫСОТУ ХРОМА. Без него нижние поля страницы уходили под
          клавиатуру: `padding` меряет расстояние от низа ОКНА, а карточка
          начинается ниже — на безопасной зоне сверху и своей шапке. Ровно эта
          ошибка уже ловилась на записи. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top}
      >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {!isDraft && clientFailed ? (
          <ClientDataNotice
            title="Показана сохранённая копия"
            message="Свежие изменения пока не удалось получить. Карточка остаётся доступной."
            onRetry={() => void retryClient()}
            retrying={clientRetrying}
          />
        ) : null}

        {tagsFailed || (!isDraft && (appointmentsFailed || servicesFailed)) ? (
          <ClientDataNotice
            title="Часть данных не загрузилась"
            message={
              isDraft
                ? "Каталог тегов пока недоступен. Остальные данные можно заполнить и сохранить."
                : "История визитов, финансы или справочники могут быть неполными."
            }
            onRetry={() => {
              if (isDraft) void retryTags();
              else void Promise.all([retryAppointments(), retryTags(), retryServices()]);
            }}
            retrying={
              tagsRetrying ||
              (!isDraft && (appointmentsRetrying || servicesRetrying))
            }
          />
        ) : null}

        {/* ОДНА карточка-идентичность на оба режима: в черновике те же
            поля пустые (телефон с автофокусом и ✓), «Из контактов» вместо
            бейджей, слот дедупа под номером. */}
        {/* key по id — обязателен. Экран /clients/[id] переиспользуется при
            смене параметра (дедуп «Открыть», переход на дубль, deep link), и
            без ключа локальное состояние строк переживает смену клиента:
            набранный, но не сохранённый номер закоммитился бы в ДРУГОГО
            клиента при уходе фокуса. */}
        <ClientHeader
          key={`header-${id}`}
          client={c}
          update={update}
          readOnly={!isDraft && !caps.edit}
          memberOf={peopleOn ? people.memberOfRows : undefined}
          // Заметка клиента — вторым блоком, под «Клиентом» (владелец 23.09:
          // «сначала идёт блок „Клиент", потом заметка клиента»).
          note={<NotesBlock client={c} update={update} />}
          people={
            peopleOn && (people.peopleRows || people.onAddPerson) ? (
              <SectionCard title="Люди">
                {people.peopleRows}
                {people.peopleHidden > 0 ? (
                  <NavRow
                    label="Все люди"
                    value={String(people.peopleTotal)}
                    separated
                    onPress={() =>
                      router.push({
                        pathname: "/clients/people",
                        params: clientSubParams(id, scope),
                      })
                    }
                  />
                ) : null}
                {people.onAddPerson ? (
                  <ChooseRow
                    compact
                    icon={UserPlus}
                    label="Добавить человека"
                    onPress={people.onAddPerson}
                  />
                ) : null}
              </SectionCard>
            ) : null
          }
          draft={
            isDraft
              ? {
                  valid: e164 !== null,
                  // Вставка «имя + номер» делится: номер — в телефон.
                  onNameChange: onDraftNameChange,
                  onPhoneChange: onDraftPhoneChange,
                  // КУРСОР — В ПЕРВОЕ ПУСТОЕ ПОЛЕ СВЕРХУ ВНИЗ (владелец
                  // 2026-07-26: «сначала имя»; 22.09 по скрину нового клиента:
                  // курсор стоял в номере под пустым именем, и страница
                  // начиналась «снизу»). Имя уже пришло из поиска — в номер.
                  focus: prefillName && !prefillPhone ? "phone" : "name",
                  footer: (
                    <ClientDraftNotice
                      duplicate={duplicate}
                      error={createError}
                      // Из записи дубль не открывают, а ВЫБИРАЮТ: это и есть
                      // тот клиент, ради которого пришли.
                      openLabel={handBack ? "Выбрать" : "Открыть"}
                      onOpenDuplicate={(duplicateId) => {
                        if (handBack) {
                          deliverCreatedClient(duplicateId);
                          // Выбрали существующего — черновик и не нужен.
                          leavingRef.current = true;
                          router.back();
                          return;
                        }
                        router.replace(`/clients/${duplicateId}`);
                      }}
                    />
                  ),
                }
              : undefined
          }
        />

        {/* Действия уровня человека. В черновике строка видна, но пригашена
            с подписью «Записать можно после сохранения» — владелец требует
            видеть страницу целиком, а мёртвого тапа быть не должно.
            «Обслуживание» гейта не требует: блок сам возвращает null, пока у
            клиента нет техники с датами ТО, и сети не касается. */}
        {/* Дубли ищутся не только при создании: карточка живёт годами, а
            второй «тот же человек» заводится позже — импортом или звонком с
            другого номера. */}
        {/* Слияние дублей двигает записи через активный календарь — у клиента
            чужой компании этой дороги нет. */}
        {!isDraft && caps.manage ? <DuplicateNotice client={c} /> : null}

        <ClientContactRow
          client={c}
          stats={stats}
          draft={isDraft}
          onDraftBook={() => onDraftDoor("book")}
          bookOnArrive={!isDraft && openOnArrive === "book"}
          onArrived={() => router.setParams({ open: undefined })}
          // Сводка в блоке «История» = вход в перечень записей. Записей нет — вести
          // некуда, и сводка остаётся просто текстом (мёртвых тапов не держим).
          // Визиты — история СВОЕЙ компании (`card-sub`): у клиента
          // работодателя такой двери нет, и шеврон не ведёт в отказ.
          onOpenHistory={
            !isDraft && caps.manage && appointments.length > 0
              ? () => {
                  router.push({
                    pathname: "/clients/visits",
                    params: clientSubParams(id, scope),
                  });
                }
              : undefined
          }
        />

        <ClientProfileBlocks
          key={`blocks-${id}`}
          client={c}
          appointments={appointments}
          draft={isDraft}
          update={update}
          // Инвойсы и чеки — деньги компании: у клиента работодателя их нет.
          showDocuments={caps.money}
          // Длинные списки — своими страницами, как история записей.
          onOpenObjects={() =>
            router.push({ pathname: "/clients/objects", params: clientSubParams(id, scope) })
          }
          onOpenRequisites={() =>
            router.push({ pathname: "/clients/requisites", params: clientSubParams(id, scope) })
          }
          labelTags={
            <ClientLabelTags client={c} update={update} tags={tags} readOnly={!caps.edit} />
          }
          onDraftFiles={() => onDraftDoor("files")}
          openFilesOnArrive={!isDraft && openOnArrive === "files"}
          onArrived={() => router.setParams({ open: undefined })}
          // ЖИЛЬЦЫ: под объектом на странице — показание, в листе объекта —
          // строки с ролью и единственная дверь заведения.
          {...(peopleOn ? people.residents : {})}
        />
      </ScrollView>

      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ, ПОД ПАЛЬЦЕМ, ВНЕ ПРОКРУТКИ.
          У сохранённой карточки футера НЕТ: контактная база не имеет одного
          действия, «Записать» понижена самим владельцем до обычной строки, а
          «Готово», которое ничего не пишет, дублировало бы стрелку «назад». */}
      {isDraft ? (
        <ClientScreenFooter
          label="Создать клиента"
          reason={draftReason}
          disabled={!canSave}
          onPress={() => void saveDraft()}
          // `/client` открыт поверх записи, вне вкладок — там таб-бара нет.
          overTabBar={pathname !== "/client"}
        />
      ) : null}
      </KeyboardAvoidingView>

      <RemindSheet
        visible={remindOpen}
        clientName={c.full_name}
        hasReminder={!!c.reminder_at}
        onPick={(reminder_at) => update({ reminder_at })}
        onClose={() => setRemindOpen(false)}
      />

      {people.door}
      {split.sheet}
    </Screen>
    </>
  );
}

function ArchivedClientView({
  client,
  appointments,
  services,
  restoring,
  onBack,
  onRestore,
}: {
  client: Client;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  restoring: boolean;
  onBack: () => void;
  onRestore: () => Promise<void>;
}) {
  const t = useThemeColors();
  // КОРЗИНА И АРХИВ — РАЗНЫЕ ПОЛКИ, и карточка обязана их различать.
  // Раньше она смотрела только на deleted_at и писала «В архиве» клиенту,
  // которого владелец только что удалил: страница противоречила экрану, с
  // которого на неё пришли, и умалчивала главное — что через N дней его
  // сотрут.
  const trashed = !!client.purge_at;
  const daysToPurge = trashed ? daysLeft(client.purge_at) : null;
  const archivedAt = client.deleted_at ? new Date(client.deleted_at) : null;
  const archivedLabel =
    archivedAt && !Number.isNaN(archivedAt.getTime())
      ? new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(archivedAt)
      : null;
  const serviceById = new Map(services.map((service) => [service.id, service.name]));
  const history = [...appointments].sort((a, b) =>
    `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`),
  );
  // Заявка архивного календаря называет свою команду (`archived-visit.ts`).
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = new Map(allTeams.map((team) => [team.id, team]));

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={trashed ? "Удалённый клиент" : "Архивный клиент"} onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="items-center px-5 pb-5 pt-5">
          <View
            className="h-14 w-14 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: t.fill }}
          >
            <Archive color={t.sub} size={26} />
          </View>
          <Text
            className="mt-3 text-center text-2xl font-bold"
            style={{ color: t.ink }}
          >
            {client.full_name || client.phone || "Клиент"}
          </Text>
          <Text
            className="mt-1 text-center text-[13px] leading-5"
            style={{ color: t.sub }}
          >
            {trashed
              ? `${archivedLabel ? `Удалён ${archivedLabel}. ` : "Удалён. "}${
                  daysToPurge === null
                    ? ""
                    : daysToPurge <= 0
                      ? "Будет стёрт сегодня. "
                      : `Будет стёрт через ${daysToPurge} ${daysWordRu(daysToPurge)}. `
                }`
              : archivedLabel
                ? `В архиве с ${archivedLabel}. `
                : "В архиве. "}
            Карточка доступна только для чтения; история записей и инвойсов сохранена.
          </Text>
        </View>

        <SectionCard title="Контакт">
          <View className="px-4 py-3">
            <Text className="text-xs" style={{ color: t.sub }}>Телефон</Text>
            <Text className="mt-1 text-base" style={{ color: t.ink }}>
              {client.phone || "Не указан"}
            </Text>
          </View>
        </SectionCard>

        <SectionCard title={`История записей · ${history.length}`}>
          {history.length === 0 ? (
            <Text className="px-4 py-4 text-sm" style={{ color: t.sub }}>
              Записей нет
            </Text>
          ) : (
            history.slice(0, 20).map((appointment, index) => {
              const names = appointment.service_ids
                .map((serviceId) => serviceById.get(serviceId))
                .filter((name): name is string => !!name);
              return (
                <View key={appointment.id}>
                  {index > 0 ? (
                    <View className="h-px" style={{ backgroundColor: t.separator }} />
                  ) : null}
                  <View className="px-4 py-3">
                    <Text className="text-sm font-semibold" style={{ color: t.ink }}>
                      {humanDay(appointment.date)} · {appointment.time_start}–{appointment.time_end}
                    </Text>
                    <Text className="mt-1 text-xs" style={{ color: t.sub }} numberOfLines={2}>
                      {[
                        archivedVisitTag(appointment.team_id, teamsById),
                        names.join(" · ") || STATUS_LABELS[appointment.status] || "Запись",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </SectionCard>

        <View className="px-4 pt-5">
          {/* КНОПКА ОДНА НА ПРОДУКТ: была своя, 48pt со значком внутри.
              Значка у канонической кнопки нет — слово и так называет
              действие, а спиннер ожидания она умеет сама. */}
          <Button
            label="Восстановить клиента"
            loading={restoring}
            onPress={() => void onRestore()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function MasterClientOperationalView({
  client,
  appointments,
  services,
  onBack,
  onOpenAppointment,
}: {
  client: Client;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  onBack: () => void;
  onOpenAppointment: (appointment: Appointment) => void;
}) {
  const t = useThemeColors();
  const phoneDigits = client.phone.replace(/[^+\d]/g, "");
  const serviceById = new Map(services.map((service) => [service.id, service.name]));
  const assigned = [...appointments].sort((a, b) =>
    `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`),
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Клиент" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pb-2 pt-3">
          <Text style={{ fontSize: 24, fontWeight: "700", color: t.ink }}>
            {client.full_name || "Клиент"}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}>
            Только рабочая информация по назначенным записям.
          </Text>
        </View>

        <SectionCard title="Контакт">
          {phoneDigits ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:${phoneDigits}`)}
              accessibilityRole="button"
              accessibilityLabel={`Позвонить ${client.phone}`}
              className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
            >
              <Phone color={t.accent} size={20} />
              <View className="flex-1">
                <Text style={{ fontSize: 12, color: t.sub }}>Телефон для выезда</Text>
                <Text style={{ marginTop: 2, fontSize: 16, color: t.ink }}>
                  {client.phone}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text style={{ padding: 16, fontSize: 14, color: t.sub }}>
              Телефон не указан
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Назначенные записи">
          {assigned.length === 0 ? (
            <Text style={{ padding: 16, fontSize: 14, color: t.sub }}>
              Доступных заявок нет
            </Text>
          ) : (
            assigned.map((appointment, index) => {
              const names = appointment.service_ids
                .map((serviceId) => serviceById.get(serviceId))
                .filter((name): name is string => !!name);
              return (
                <View key={appointment.id}>
                  {index > 0 ? (
                    <View style={{ height: 1, backgroundColor: t.separator }} />
                  ) : null}
                  <Pressable
                    onPress={() => onOpenAppointment(appointment)}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть заявку ${humanDay(appointment.date)} ${appointment.time_start}`}
                    className="min-h-[72px] flex-row items-center gap-3 px-4 py-3 active:opacity-70"
                  >
                    <View className="min-w-0 flex-1">
                      <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                        {humanDay(appointment.date)} · {appointment.time_start}–{appointment.time_end}
                      </Text>
                      <Text
                        style={{ marginTop: 3, fontSize: 13, color: t.sub }}
                        numberOfLines={2}
                      >
                        {[
                          STATUS_LABELS[appointment.status],
                          names.join(" · "),
                          appointment.address,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <ChevronRight color={t.chevron} size={20} />
                  </Pressable>
                </View>
              );
            })
          )}
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
