import { FlatList, RefreshControl, View } from "react-native";
import { Users } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { TourTarget } from "@/components/tour/TourTarget";
import { Spinner } from "@/components/ui/Spinner";
import ClientRow from "@/features/clients/ClientRow";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { clientCardHref, ownClientCardHref } from "@/session/clients-company";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useThemeColors } from "@/theme/colors";
import { clientMatchEvidence } from "@babun/shared/local/selectors/client-search";
import { segmentEvidence } from "@/features/clients/filter";
import { useBusinessToday } from "@/features/settings/business-today";
import type { ClientsList } from "./use-clients-list";

/** The list itself: loading, the error notice, or the rows. */
export function ListBody({ list }: { list: ClientsList }) {
  const {
    t,
    router,
    scope,
    isLoading,
    error,
    data,
    listErrorWords,
    refetch,
    isRefetching,
    pull,
    result,
    selecting,
    statsMap,
    guestOf,
    rowActionsOf,
    cardFieldsFor,
    selectedIds,
    toggleId,
    setRemindClient,
    confirmDeleteOne,
    setMenuClient,
    filtering,
    teamChoice,
    query,
    filter,
  } = list;
  // УЛИКА ПОД ИМЕНЕМ: при поиске — поле, по которому клиент нашёлся, если не
  // по имени и не по номеру; без поиска — почему он в выбранном статусе
  // («не был 87 дней»). Иначе строка в выдаче выглядит случайной.
  const today = useBusinessToday();
  const evidenceOf = (c: Parameters<typeof segmentEvidence>[0]) =>
    query.trim()
      ? clientMatchEvidence(c, query)
      : segmentEvidence(c, filter.segments, statsMap.get(c.id), today);
  return (
    <>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={30} label="Загрузка клиентов" />
        </View>
      ) : error && !data ? (
        // ПОЛНЫЙ ЭКРАН ОШИБКИ — ТОЛЬКО КОГДА ПОКАЗАТЬ НЕЧЕГО. Упало фоновое
        // перечитывание (react-query держит и `error`, и прежние `data`) —
        // список остаётся, а слова ошибки — плашкой над ним.
        <ClientDataNotice
          fullScreen
          title={listErrorWords.title}
          message={listErrorWords.subtitle}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <>
        {/* Дообновление в фоне: данные на экране уже есть, поэтому индикация
            не имеет права сдвигать список. */}
        <LoadingBar visible={isRefetching && !pull.refreshing} />
        {error ? (
          <ClientDataNotice
            title={listErrorWords.title}
            message={listErrorWords.subtitle}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        ) : null}
        <FlatList
          style={{ flex: 1 }}
          accessibilityLabel="Список клиентов"
          data={result.filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          // Низ списка не должен прятаться под нижней панелью массовых
          // действий в режиме выбора; вне выбора — небольшой отступ.
          contentContainerStyle={{
            paddingBottom: selecting ? 108 : 24,
          }}
          renderItem={({ item, index }) => {
            const stats = statsMap.get(item.id);
            // ГОСТЬ — клиент компании, где человек работает. Его карточка
            // открывается в ЕГО компании, и массовый выбор к нему не
            // относится. Меню и свайпы — по его блокам, как в зеркале (у
            // настоящего партнёра они не гаснут целиком).
            const guest = guestOf.get(item.id);
            const actions = rowActionsOf(item, selecting);
            const row = (
              <ClientRow
                memoKey={selecting ? "selecting" : "browsing"}
                client={item}
                stats={stats}
                cardFields={cardFieldsFor(item.team_id)}
                evidence={evidenceOf(item)}
                // «Связаться» клиента работодателя — набор и шестерёнка его
                // компании, а не своей.
                source={guest}
                selectionMode={selecting && !guest}
                picked={selectedIds.has(item.id)}
                onPress={() =>
                  selecting && !guest
                    ? toggleId(item.id)
                    : // Видит клиента — открывает его страницу (отдельного права
                      // «Открывает карточку» нет).
                      guest
                      ? router.push(clientCardHref(item.id, guest.tenantId))
                      : router.push(ownClientCardHref(item.id, scope))
                }
                // Свайп: вправо — «Напомнить», влево —
                // «Удалить»; «Записать» — в меню долгого нажатия.
                onRemind={actions.remind ? () => setRemindClient(item) : undefined}
                onDelete={actions.remove ? () => confirmDeleteOne(item) : undefined}
                onLongPress={() => {
                  if (actions.select) toggleId(item.id);
                  // Меню — те же права, что у `ClientActionsSheet` ниже; ни
                  // одного — нет и пустой шторки. Партнёру — с «Меню клиента»
                  // или «Удаление клиента».
                  else if (actions.menu) setMenuClient(item);
                }}
              />
            );
            // Обучение показывает строку на первом клиенте списка.
            return index === 0 ? <TourTarget id="clients.row" shape="strip">{row}</TourTarget> : row;
          }}
          ItemSeparatorComponent={ClientSeparator}
          // Плотнее окно отрисовки: строка клиента
          // тяжёлая (свайп, кнопка связи), и FlatList по умолчанию держал
          // 21 экран строк смонтированными.
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={9}
          refreshControl={
            // В режиме выбора pull-to-refresh отключаем — refetch мог бы
            // выронить выбранные строки из-под чекбоксов.
            selecting ? undefined : (
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={t.accent}
              />
            )
          }
          ListEmptyComponent={
            filtering ? (
              <EmptyState
                title="Ничего не найдено"
                subtitle="Измените запрос или сбросьте фильтры"
              />
            ) : (
              <EmptyState
                icon={<Users color={t.faint} size={40} strokeWidth={1.5} />}
                title={
                  teamChoice === ALL_TEAMS
                    ? "Пока нет клиентов"
                    : "В этой команде пока нет клиентов"
                }
                // Подписи здесь нет: канон пустых состояний
                // оставляет объяснения ошибкам. Что делать
                // дальше, говорит футер — он на месте у всех.
              />
            )
          }
        />
        </>
      )}
    </>
  );
}

/** Линия между строками — один тип компонента на все перерисовки: стрелочная
 *  функция в пропе была новым типом каждый раз, и все линии монтировались
 *  заново. */
function ClientSeparator() {
  const t = useThemeColors();
  return <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />;
}
