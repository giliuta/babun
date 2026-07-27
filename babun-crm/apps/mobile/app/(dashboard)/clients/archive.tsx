import { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Archive, RotateCcw } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import {
  useArchivedClients,
  useRestoreClient,
} from "@/features/clients/queries";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";

function archivedLabel(client: Client): string {
  if (!client.deleted_at) return "";
  const date = new Date(client.deleted_at);
  if (Number.isNaN(date.getTime())) return "В архиве";
  return `В архиве с ${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)}`;
}

export default function ClientArchiveScreen() {
  const t = useThemeColors();
  const archived = useArchivedClients();
  const pull = usePullRefresh(archived.refetch);
  const restore = useRestoreClient();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const restoreClient = async (client: Client) => {
    if (restoringId) return;
    setRestoringId(client.id);
    try {
      await restore.mutateAsync(client);
    } catch (error) {
      Alert.alert(
        "Не удалось восстановить",
        (error as Error).message || "Проверьте соединение и повторите.",
      );
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Архив клиентов" />
      {archived.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={28} label="Загрузка архива" />
        </View>
      ) : archived.isError ? (
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить архив"
          message={(archived.error as Error).message}
          onRetry={() => void archived.refetch()}
          retrying={archived.isRefetching}
        />
      ) : (
        <FlatList
          data={archived.data ?? []}
          keyExtractor={(client) => client.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={t.accent}
            />
          }
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => {
            const busy = restoringId === item.id;
            return (
              <View
                className="rounded-2xl border px-4 py-3"
                style={{ backgroundColor: t.surface, borderColor: t.separator }}
              >
                <View className="flex-row items-center gap-3">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.fill }}
                  >
                    <Archive color={t.sub} size={19} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[15px] font-semibold"
                      style={{ color: t.ink }}
                      numberOfLines={1}
                    >
                      {item.full_name || item.phone || "Клиент"}
                    </Text>
                    <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
                      {archivedLabel(item)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => void restoreClient(item)}
                  disabled={!!restoringId}
                  accessibilityRole="button"
                  accessibilityLabel={`Восстановить ${item.full_name || "клиента"}`}
                  accessibilityState={{ disabled: !!restoringId }}
                  className="mt-3 min-h-11 flex-row items-center justify-center gap-2 rounded-xl active:opacity-70"
                  style={{ backgroundColor: t.fill, opacity: restoringId && !busy ? 0.45 : 1 }}
                >
                  {busy ? (
                    <Spinner size={18} label="Восстанавливаем" />
                  ) : (
                    <RotateCcw color={t.accent} size={17} />
                  )}
                  <Text className="text-sm font-semibold" style={{ color: t.accent }}>
                    {busy ? "Восстанавливаем…" : "Восстановить"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon={<Archive color={t.faint} size={40} strokeWidth={1.5} />}
              title="Архив пуст"
              subtitle="Архивированные клиенты появятся здесь, а их история останется в заявках и инвойсах."
            />
          }
        />
      )}
    </Screen>
  );
}
