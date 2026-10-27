// Client detail card — COMPOSER (mobile port of the web ClientCardPage,
// «Карта-диспетчер» LOCKED design).
//
// This screen does ALL data wiring; the blocks are presentational. It
// fetches the client + its appointments, computes the shared `stats`
// (client-stats selector), then renders the page as ONE STACK OF ROWS
// (ЗАКОН СТРОКИ, DESIGN-SYSTEM.md):
//
//   Клиент (ClientHeader) · Заметка клиента · Люди · История · Объекты
//   · Файлы · Реквизиты · Метка | Тег · Личное (docs/BLOCKS.md §9.1)
//
// СОЗДАНИЕ = ЭТА ЖЕ СТРАНИЦА: роут /clients/new попадает сюда с id="new" → карточка
// работает с ЧЕРНОВИКОМ (createBlankClient) через локальный update.
// Шапка НЕ подменяется формой — это тот же ClientHeader с `draft`:
// те же поля пустые, телефон с автофокусом и live-дедупом по phone_e164
// (clients-99 F1.5/F2.7). «Создать клиента» в футере создаёт его, и
// router.replace приводит на этот же экран уже с сервера.
//
// ЧТО ВИДНО В ЧЕРНОВИКЕ: ВСЯ страница, как она будет выглядеть у созданного
// клиента. Каждое поле этих блоков проходит белый список create_client_with_tags,
// то есть пишет в тот же объект, который уедет в базу по «Создать клиента».
// Единственное исключение — блок «Файлы»: путь в хранилище строится по id
// клиента, которого ещё нет. Действия, которым нужен реальный id
// («Записать»), не спрятаны, а пригашены с подписью-причиной.
//
// A top chrome row owns the back button + a ⋯ action menu (message via
// Linking sms:, share via RN Share, blacklist toggle via update) — the
// blocks stay free of screen-level concerns.
//
// Wiring lives in `use-client-card.ts`; the page is `ClientCardPage.tsx`,
// the «⋯» menu `card-menu-actions.ts`. This file keeps the gates.

import { Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { notify } from "@/lib/notify";
import { ArchivedClientView } from "./ArchivedClientView";
import { cardMenuActions } from "./card-menu-actions";
import { ClientCardPage } from "./ClientCardPage";
import { MasterClientOperationalView } from "./MasterClientOperationalView";
import { useClientCard } from "./use-client-card";

/** Тело карточки без ворот: общий адрес `/client` оборачивает его своими —
 *  там компания всегда календарная. */
export function ClientDetailScreen() {
  const card = useClientCard();
  const {
    t,
    router,
    roleQuery,
    role,
    scope,
    isDraft,
    isLoading,
    clientFailed,
    clientError,
    clientRetrying,
    retryClient,
    restoreClient,
    appointments,
    services,
    c,
  } = card;
  if (roleQuery.isPending) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Проверяем доступ" />
      </Screen>
    );
  }

  // ЭКРАН ОШИБКИ — С ШАПКОЙ И НАЗАД: без шапки с него
  // уходили только таб-баром. Нижний край держит таб-бар, как у соседних
  // экранов: «Повторить» стоит на той же высоте, что их кнопки.
  if (roleQuery.isError || !role) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Клиент" />
        <ClientDataNotice
          fullScreen
          title="Нет связи с сервером"
          message="Не получилось проверить доступ к клиенту. Повторите через минуту."
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
      <Screen edges={["top"]}>
        <ScreenHeader title="Клиент" />
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
        {/* КНОПКА ОДНА НА ПРОДУКТ: своя, 44pt с радиусом числом, здесь не
            нужна. */}
        <Button label="К списку" onPress={() => router.back()} />
      </Screen>
    );
  }

  // КЛИЕНТ СВОЕЙ ЗАПИСИ — СТАРАЯ ДОРОГА МАСТЕРА БЕЗ БАЗЫ. У него карточки в
  // продукте нет вовсе: он пришёл из своей заявки и видит только то, ради чего
  // её открыл, — как связаться и какие работы за человеком.
  //
  // СОТРУДНИК С «СМОТРИТ» СЮДА НЕ ПОПАДАЕТ: визуал страницы сохраняется
  // целиком, а отключается только то, что не должно работать. Иначе вместо
  // карточки клиента ему открывалась бы ДРУГАЯ страница — со своим кеглем,
  // своими разделителями и своим языком. Он видит ту же карточку, только блоки в ней не правятся
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
              "Не удалось вернуть клиента",
              (error as Error).message || "Проверьте соединение и повторите.",
            );
          }
        }}
      />
    );
  }

  return <ClientCardPage card={card} c={c} menu={cardMenuActions(card, c)} />;
}
