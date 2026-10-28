import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { onThisDevice } from "@/lib/device-word";
import { RefreshCw, Trash2 } from "lucide-react-native";
import {
  removeMemberOp,
  retryMemberOp,
  type MemberQueuedOp,
} from "@babun/shared/db/cache/sql";
import { emitQueueChange, relativeTime } from "@babun/shared/sync";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { queryClient } from "@/lib/query-client";
import { kickMemberQueue } from "@/lib/member-queue/runtime";
import { heldBehindRefusal, memberOpLabel } from "@/lib/member-queue/plan";

/** Правки сотрудника в «Синхронизации». Ждущая — словами, где она лежит;
 *  отклонённая сервером — причиной и двумя кнопками: «Повторить» (права
 *  вернули) и «Удалить» (вместе с правками этой записи, что стоят за ней). */
export function MemberQueueCards({ ops, online }: { ops: MemberQueuedOp[]; online: boolean }) {
  const t = useThemeColors();
  const [busy, setBusy] = useState(false);
  const held = heldBehindRefusal(ops);
  const savedHere = `Сохранено ${onThisDevice()}`;

  const retry = async (op: MemberQueuedOp) => {
    if (!online) {
      notify("Нет соединения", "Повторная отправка начнётся после подключения к интернету.");
      return;
    }
    setBusy(true);
    try {
      await retryMemberOp(op.id);
      emitQueueChange();
      kickMemberQueue();
    } finally {
      setBusy(false);
    }
  };

  const discard = (op: MemberQueuedOp) => {
    // Правки той же записи после этой строились поверх неё — уходят вместе.
    const related = ops.filter((item) => item.record_id === op.record_id && item.id >= op.id);
    confirmThen(
      related.length > 1 ? "Удалить несохранённые изменения?" : "Удалить локальное изменение?",
      {
        message: `${
          related.length > 1 ? `Будут удалены ${related.length} связанные операции. ` : ""
        }Серверная версия вернётся после обновления данных.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        void (async () => {
          setBusy(true);
          try {
            for (const item of related) await removeMemberOp(item.id);
            emitQueueChange();
            await queryClient.invalidateQueries({ queryKey: ["appointments"] });
          } catch (error) {
            notify("Не удалось удалить изменение", (error as Error).message || "Повторите попытку.");
          } finally {
            setBusy(false);
          }
        })(),
    );
  };

  return (
    <>
      {ops.map((op) => {
        const status = op.refused
          ? op.last_error || "Сервер не принял изменение."
          : held.has(op.id)
            ? "Ждёт: сервер не принял прошлую правку этой записи"
            : online
              ? "Ожидает отправки"
              : savedHere;
        const stuck = op.refused || held.has(op.id);
        return (
          <SectionCard key={`member-${op.id}`} padded>
            <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>{memberOpLabel(op)}</Text>
            <Text className="mt-1 text-xs" style={{ color: t.faint }}>
              {relativeTime(op.created_at)}
            </Text>
            <Text
              className="mt-2 text-sm"
              style={{ color: op.refused ? t.danger : t.sub }}
              numberOfLines={5}
            >
              {status}
            </Text>
            {stuck ? (
              <View className="mt-3 flex-row gap-2">
                {op.refused ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Повторить синхронизацию изменения"
                    disabled={busy}
                    onPress={() => void retry(op)}
                    className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-[10px]"
                    style={({ pressed }) => ({
                      backgroundColor: `${t.accent}14`,
                      opacity: busy ? 0.45 : pressed ? 0.78 : 1,
                    })}
                  >
                    <RefreshCw color={t.accent} size={17} />
                    <Text style={{ color: t.accent, fontSize: 14, fontWeight: "600" }}>Повторить</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Удалить несохранённое изменение"
                  disabled={busy}
                  onPress={() => discard(op)}
                  className="min-h-11 flex-row items-center justify-center gap-2 rounded-[10px] px-4"
                  style={({ pressed }) => ({
                    backgroundColor: `${t.danger}12`,
                    opacity: busy ? 0.45 : pressed ? 0.78 : 1,
                  })}
                >
                  <Trash2 color={t.danger} size={17} />
                  <Text style={{ color: t.danger, fontSize: 14, fontWeight: "600" }}>Удалить</Text>
                </Pressable>
              </View>
            ) : null}
          </SectionCard>
        );
      })}
    </>
  );
}
