import { Alert } from "react-native";
import { Archive, RotateCcw, Trash2 } from "lucide-react-native";
import {
  useArchiveClients,
  useDeleteClientForever,
  useRestoreClient,
  useTrashedClients,
} from "@/features/clients/queries";
import {
  DaysLeft,
  DeletedOn,
  HiddenClientsScreen,
} from "@/features/clients/HiddenClientsScreen";
import { useCurrentRole } from "@/features/settings/tenant";
import { useThemeColors } from "@/theme/colors";

// «НЕДАВНО УДАЛЁННЫЕ» — как в Фото на iPhone.
//
// Удаление клиента ничего не стирает сразу: он лежит здесь со счётчиком, и
// каждый день счётчик уменьшается. Ночное задание в базе стирает тех, чей
// срок вышел, — не «когда откроешь экран», а само по себе.
//
// Владелец 2026-08-08: «если удаляешь клиента, он сначала перемещается в
// настройки, удалённые контакты, на 30 дней — как фотографии в iPhone».

export default function ClientTrashScreen() {
  const t = useThemeColors();
  const trashed = useTrashedClients();
  const restore = useRestoreClient();
  const archive = useArchiveClients();
  const erase = useDeleteClientForever();
  // «Стереть навсегда» разрешено только владельцу (гейт в самой мутации).
  // Показывать его диспетчеру значит обещать действие, которое ответит
  // отказом, — предлагать нужно только то, что человек может сделать.
  const isOwner = useCurrentRole().data === "owner";

  return (
    <HiddenClientsScreen
      title="Недавно удалённые"
      query={trashed}
      // Слева ФАКТ («удалён 8 авг.»), справа СРОК («30 дней»). Сначала обе
      // половины говорили одно и то же — «будет стёрт через 30 дней» и рядом
      // «30 дней»; строка тратила два места на одну мысль.
      caption={(c) => DeletedOn(c.deleted_at)}
      trailing={(c) => <DaysLeft purgeAt={c.purge_at} />}
      empty={{
        icon: <Trash2 color={t.faint} size={40} strokeWidth={1.5} />,
        title: "Пусто",
        subtitle:
          "Удалённые клиенты лежат здесь 30 дней — за это время их можно вернуть. Потом они стираются навсегда.",
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
          // Передумал стирать, но и в работе он не нужен: архив держит без
          // срока. Иначе единственным выходом из корзины был бы возврат в
          // рабочий список — и человек снова мозолил бы глаза.
          id: "archive",
          label: "Оставить в архиве",
          icon: Archive,
          run: async () => {
            const res = await archive.mutateAsync({ ids: [client.id] });
            if (res.archived === 0) {
              throw new Error("Проверьте соединение и повторите.");
            }
          },
        },
        ...(isOwner
          ? [{
          id: "erase",
          label: "Стереть навсегда",
          icon: Trash2,
          danger: true,
          run: () =>
            new Promise<void>((resolve, reject) => {
              Alert.alert(
                "Стереть навсегда?",
                `${client.full_name || "Клиент"} исчезнет без возможности вернуть.`,
                [
                  { text: "Отмена", style: "cancel", onPress: () => resolve() },
                  {
                    text: "Стереть",
                    style: "destructive",
                    onPress: () => {
                      erase.mutateAsync(client.id).then(() => resolve(), reject);
                    },
                  },
                ],
              );
            }),
        }]
          : []),
      ]}
    />
  );
}
