
import { RotateCcw, Trash2 } from "lucide-react-native";
import {
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
import { confirmAction } from "@/lib/confirm";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";

// «УДАЛЁННЫЕ КЛИЕНТЫ» — как «Недавно удалённые» в Фото на iPhone.
//
// Удаление клиента ничего не стирает сразу: он лежит здесь со счётчиком, и
// каждый день счётчик уменьшается. Ночное задание в базе стирает тех, чей
// срок вышел, — не «когда откроешь экран», а само по себе.
//
// Владелец 2026-08-08: «если удаляешь клиента, он сначала перемещается в
// настройки, удалённые контакты, на 30 дней — как фотографии в iPhone».
//
// ОДНА ПОЛКА (владелец 03.10: «понятия „в архив" не будет — удалить»).
// Клиент с записями, инвойсами или деньгами тоже здесь, но без счётчика и
// без «Стереть навсегда»: его история в отчётах, база его не сотрёт.

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientTrashScreenRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientTrashScreen />
    </ClientsCompanyRoute>
  );
}

function ClientTrashScreen() {
  const t = useThemeColors();
  const trashed = useTrashedClients();
  const restore = useRestoreClient();
  const erase = useDeleteClientForever();
  // «Стереть навсегда» разрешено только владельцу (гейт в самой мутации).
  // Показывать его диспетчеру значит обещать действие, которое ответит
  // отказом, — предлагать нужно только то, что человек может сделать.
  const isOwner = useCurrentRole().data === "owner";

  return (
    <HiddenClientsScreen
      title="Удалённые клиенты"
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
          "Удалённые клиенты лежат здесь — отсюда их можно вернуть. Без записей и денег клиент стирается через 30 дней.",
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
        // Срока нет — у клиента история, стереть его база не даст.
        ...(isOwner && client.purge_at
          ? [{
          id: "erase",
          label: "Стереть навсегда",
          icon: Trash2,
          danger: true,
          run: async () => {
            const ok = await confirmAction("Стереть навсегда?", {
              message: `${client.full_name || "Клиент"} исчезнет без возможности вернуть.`,
              confirmLabel: "Стереть",
              destructive: true,
            });
            if (!ok) return;
            await erase.mutateAsync(client.id);
          },
        }]
          : []),
      ]}
    />
  );
}
