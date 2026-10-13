import { FlatList, RefreshControl, View } from "react-native";
import { Users } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import ClientRow from "@/features/clients/ClientRow";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { clientCardHref, ownClientCardHref } from "@/session/clients-company";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useThemeColors } from "@/theme/colors";
import type { ClientsList } from "./use-clients-list";

/** The list itself: loading, the error notice, or the rows. */
export function ListBody({ list }: { list: ClientsList }) {
  const {
    t,
    router,
    scope,
    isLoading,
    error,
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
    openSwipe,
    setRemindClient,
    confirmDeleteOne,
    setMenuClient,
    filtering,
    teamChoice,
  } = list;
  return (
    <>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={30} label="Загрузка клиентов" />
        </View>
      ) : error ? (
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
          renderItem={({ item }) => {
            const stats = statsMap.get(item.id);
            // ГОСТЬ — клиент компании, где человек работает. Его карточка
            // открывается в ЕГО компании, и массовый выбор к нему не
            // относится. Меню и свайпы — по его блокам, как в зеркале (аудит
            // 03.10: у настоящего партнёра они гасли целиком).
            const guest = guestOf.get(item.id);
            const actions = rowActionsOf(item, selecting);
            return (
              <ClientRow
                memoKey={selecting ? "selecting" : "browsing"}
                client={item}
                stats={stats}
                cardFields={cardFieldsFor(item.team_id)}
                // «Связаться» клиента работодателя — набор и шестерёнка его
                // компании, а не своей (03.10).
                source={guest}
                selectionMode={selecting && !guest}
                picked={selectedIds.has(item.id)}
                onPress={() =>
                  selecting && !guest
                    ? toggleId(item.id)
                    : // Видит клиента — открывает его страницу (владелец 02.10:
                      // «Открывает карточку» убрано).
                      guest
                      ? router.push(clientCardHref(item.id, guest.tenantId))
                      : router.push(ownClientCardHref(item.id, scope))
                }
                onSwipeOpen={(row) => {
                  if (openSwipe.current && openSwipe.current !== row) {
                    openSwipe.current.close();
                  }
                  openSwipe.current = row;
                }}
                // Свайп (владелец 03.10): вправо — «Напомнить», влево —
                // «Удалить»; «Записать» — в меню долгого нажатия.
                onRemind={actions.remind ? () => setRemindClient(item) : undefined}
                onDelete={actions.remove ? () => confirmDeleteOne(item) : undefined}
                onLongPress={() => {
                  if (actions.select) toggleId(item.id);
                  // Меню — те же права, что у `ClientActionsSheet` ниже; ни
                  // одного — нет и пустой шторки (проверка глазами 30.09).
                  // Партнёру — с «Меню клиента» или «Удаление клиента» (03.10).
                  else if (actions.menu) setMenuClient(item);
                }}
              />
            );
          }}
          ItemSeparatorComponent={ClientSeparator}
          // Плотнее окно отрисовки (аудит Android 13.10): строка клиента
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
                // Подписи здесь нет: канон пустых состояний (LOCKED
                // 2026-08-27) оставляет объяснения ошибкам. Что делать
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
