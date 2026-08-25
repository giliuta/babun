import { Alert } from "react-native";
import { Archive, RotateCcw, Trash2 } from "lucide-react-native";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import {
  useArchiveClients,
  useArchivedClients,
  useRestoreClient,
} from "@/features/clients/queries";
import {
  ArchivedSince,
  HiddenClientsScreen,
} from "@/features/clients/HiddenClientsScreen";
import { useThemeColors } from "@/theme/colors";

// АРХИВ КЛИЕНТОВ — «больше не работаем, но история нужна».
//
// Без срока: архивного клиента никто не сотрёт, его заявки и деньги остаются
// привязанными к нему навсегда. Тем он и отличается от «Недавно удалённых»,
// где идёт отсчёт.

export default function ClientArchiveScreen() {
  const t = useThemeColors();
  const archived = useArchivedClients();
  const restore = useRestoreClient();
  const archive = useArchiveClients();

  return (
    <HiddenClientsScreen
      title="Архив клиентов"
      query={archived}
      caption={(c) => ArchivedSince(c.deleted_at)}
      empty={{
        icon: <Archive color={t.faint} size={40} strokeWidth={1.5} />,
        title: "Архив пуст",
        subtitle:
          "Здесь лежат клиенты, убранные из работы. Их заявки, инвойсы и деньги остаются на месте.",
      }}
      actions={(client) => [
        {
          id: "restore",
          label: "Вернуть в список",
          icon: RotateCcw,
          run: async () => {
            await restore.mutateAsync(client);
          },
        },
        {
          id: "delete",
          label: "Удалить",
          icon: Trash2,
          danger: true,
          run: () =>
            new Promise((resolve, reject) => {
              Alert.alert(
                "Удалить клиента?",
                `${client.full_name || "Клиент"} переедет в «Недавно удалённые» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть.`,
                [
                  { text: "Отмена", style: "cancel", onPress: () => resolve() },
                  {
                    text: "Удалить",
                    style: "destructive",
                    onPress: () => {
                      archive
                        .mutateAsync({ ids: [client.id], trash: true })
                        .then((res) => {
                          if (res.archived === 0) {
                            reject(
                              new Error(
                                "Клиент остался в архиве. Проверьте соединение и повторите.",
                              ),
                            );
                            return;
                          }
                          resolve();
                        })
                        .catch(reject);
                    },
                  },
                ],
              );
            }),
        },
      ]}
    />
  );
}
