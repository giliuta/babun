import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { CheckCircle2, RefreshCw, Trash2, WifiOff } from "lucide-react-native";
import {
  kickReplayer,
  labelForOp,
  relativeTime,
  removeOpAndEmit,
  resetOpAttemptsAndEmit,
  subscribeQueueChange,
  useIsOnline,
} from "@babun/shared/sync";
import {
  cacheDelete,
  dequeueAll,
  type QueuedOp,
} from "@babun/shared/db/cache/sql";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { useThemeColors } from "@/theme/colors";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useTenantId } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { isQueuedOpVisibleForTenant } from "@/lib/sync-queue-policy";

const MAX_ATTEMPTS = 3;

export default function SyncStatusScreen() {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const online = useIsOnline();
  const [operations, setOperations] = useState<QueuedOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | "all" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await dequeueAll();
      setOperations(rows.filter((op) => isQueuedOpVisibleForTenant(op, tenantId)));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Контрол = ЖЕСТ. `loading` взводится и первым чтением очереди, и подпиской
  // на её изменения — то есть контрол выезжал сам, стоило очереди дрогнуть.
  const pull = usePullRefresh(refresh);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return subscribeQueueChange(() => void refresh());
    }, [refresh]),
  );

  const retry = async (op?: QueuedOp) => {
    if (!online) {
      Alert.alert("Нет соединения", "Повторная отправка начнётся после подключения к интернету.");
      return;
    }
    setBusyId(op?.id ?? "all");
    try {
      // One offline aggregate can have an INSERT followed by edits for the
      // same row. Retrying only the later edit while its failed INSERT stays
      // blocked can never succeed, so retry the dependency chain together.
      const targets = op
        ? operations.filter(
            (item) => item.table === op.table && item.row_id === op.row_id,
          )
        : operations;
      await Promise.all(
        targets
          .filter((item) => item.attempts >= MAX_ATTEMPTS)
          .map((item) => resetOpAttemptsAndEmit(item.id)),
      );
      await kickReplayer({ supabase });
      await refresh();
    } catch (error) {
      Alert.alert(
        "Не удалось синхронизировать",
        (error as Error).message || "Проверьте соединение и повторите.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const discard = (op: QueuedOp) => {
    const related = operations.filter(
      (item) => item.table === op.table && item.row_id === op.row_id,
    );
    Alert.alert(
      related.length > 1
        ? "Удалить несохранённые изменения?"
        : "Удалить локальное изменение?",
      `${
        related.length > 1
          ? `Будут удалены ${related.length} связанные операции. `
          : ""
      }Серверная версия вернётся после обновления данных.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () =>
            void (async () => {
              setBusyId(op.id);
              try {
                await Promise.all(
                  related.map((item) => removeOpAndEmit(item.id)),
                );
                // Drop an optimistic snapshot as well. For a queued delete it
                // is already absent; for insert/update this prevents a rejected
                // local value from continuing to look canonical.
                await cacheDelete(op.table, op.row_id).catch(() => {});
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["appointments"] }),
                  queryClient.invalidateQueries({ queryKey: ["clients"] }),
                  queryClient.invalidateQueries({ queryKey: ["client-tags"] }),
                ]);
                await refresh();
              } catch (error) {
                Alert.alert(
                  "Не удалось удалить изменение",
                  (error as Error).message || "Повторите попытку.",
                );
              } finally {
                setBusyId(null);
              }
            })(),
        },
      ],
    );
  };

  const failed = operations.filter((op) => op.attempts >= MAX_ATTEMPTS).length;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Синхронизация"
        subtitle={
          online
            ? operations.length > 0
              ? `${operations.length} ${countWordRu(operations.length, "изменение", "изменения", "изменений")} ${operations.length === 1 ? "ожидает" : "ожидают"} сервер`
              : "Данные актуальны"
            : "Нет соединения"
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {!online ? (
          <View
            className="mx-3 mt-3 flex-row items-center gap-3 rounded-2xl px-4 py-3"
            style={{ backgroundColor: `${t.warning}1A` }}
          >
            <WifiOff color={t.warning} size={20} />
            <Text className="flex-1 text-sm" style={{ color: t.body }}>
              Изменения хранятся только на этом iPhone и отправятся после подключения.
            </Text>
          </View>
        ) : null}

        {/* Первое чтение очереди: раньше эту паузу «показывал» программно
            выехавший контрол обновления, а без него экран был просто пустым. */}
        {loading && operations.length === 0 ? (
          <View className="items-center py-10">
            <Spinner size={26} label="Читаем очередь изменений" />
          </View>
        ) : null}

        {operations.length === 0 && !loading ? (
          <EmptyState
            icon={<CheckCircle2 color={t.success} size={36} />}
            title="Всё синхронизировано"
            subtitle="На этом iPhone нет ожидающих изменений."
          />
        ) : null}

        {operations.map((op) => {
          const permanentlyFailed = op.attempts >= MAX_ATTEMPTS;
          const busy = busyId !== null;
          return (
            <SectionCard key={op.id} padded>
              <View className="flex-row items-start gap-3">
                <View className="min-w-0 flex-1">
                  <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
                    {labelForOp(op)}
                  </Text>
                  <Text className="mt-1 text-xs" style={{ color: t.faint }}>
                    {relativeTime(op.created_at)}
                  </Text>
                  <Text
                    className="mt-2 text-sm"
                    style={{ color: permanentlyFailed ? t.danger : t.sub }}
                    numberOfLines={5}
                  >
                    {permanentlyFailed
                      ? op.last_error || "Сервер отклонил изменение."
                      : online
                        ? "Ожидает отправки"
                        : "Сохранено на этом iPhone"}
                  </Text>
                </View>
              </View>
              <View className="mt-3 flex-row gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Повторить синхронизацию изменения"
                  disabled={busy}
                  onPress={() => void retry(op)}
                  className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl"
                  style={({ pressed }) => ({
                    backgroundColor: `${t.accent}14`,
                    opacity: busy ? 0.45 : pressed ? 0.78 : 1,
                  })}
                >
                  <RefreshCw color={t.accent} size={17} />
                  <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>
                    Повторить
                  </Text>
                </Pressable>
                {permanentlyFailed ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Удалить несохранённое изменение"
                    disabled={busy}
                    onPress={() => discard(op)}
                    className="min-h-11 flex-row items-center justify-center gap-2 rounded-xl px-4"
                    style={({ pressed }) => ({
                      backgroundColor: `${t.danger}12`,
                      opacity: busy ? 0.45 : pressed ? 0.78 : 1,
                    })}
                  >
                    <Trash2 color={t.danger} size={17} />
                    <Text style={{ color: t.danger, fontSize: 14, fontWeight: "600" }}>
                      Удалить
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </SectionCard>
          );
        })}

        {operations.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Повторить все изменения"
            disabled={busyId !== null}
            onPress={() => void retry()}
            className="mx-3 mt-4 min-h-[50px] items-center justify-center rounded-2xl"
            style={({ pressed }) => ({
              backgroundColor: t.accent,
              opacity: busyId !== null ? 0.45 : pressed ? 0.82 : 1,
            })}
          >
            <Text style={{ color: t.onAccent, fontSize: 16, fontWeight: "700" }}>
              {failed > 0 ? "Повторить всё" : "Отправить сейчас"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
