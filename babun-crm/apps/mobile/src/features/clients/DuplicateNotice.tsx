import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Users } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import {
  useArchiveClients,
  useClients,
  useUpdateClientById,
} from "@/features/clients/queries";
import { mergeClientPatch, phoneKey } from "@/features/clients/merge-clients";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// «ПОХОЖЕ, ЭТО ОДИН ЧЕЛОВЕК».
//
// Дубли заводятся буднично: звонок со второго номера, импорт, два
// диспетчера одновременно. Дальше половина визитов у одной карточки,
// половина у другой, и долг не сходится ни там, ни там. Проверка на дубль
// была ТОЛЬКО при создании — на живых карточках никто никогда не смотрел.
//
// Плашка не решает за пользователя: она показывает, кого считает тем же
// человеком, и предлагает объединить. Слияние дополняет эту карточку тем,
// чего в ней нет (см. mergeClientPatch), переносит записи и убирает дубль в
// архив — не удаляет, чтобы ошибку можно было пережить.

export function DuplicateNotice({ client }: { client: Client }) {
  const t = useThemeColors();
  const toast = useToast();
  const { data: all = [] } = useClients();
  const { data: appts = [] } = useAppointments();
  const updateById = useUpdateClientById();
  const updateAppt = useUpdateAppointment();
  const archive = useArchiveClients();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  // ТОЛЬКО ПО НОМЕРУ. `findDuplicateCandidates` умеет ловить и по имени —
  // для подсказки при создании это уместно («открыть карточку?»), но здесь
  // за подсказкой стоит НЕОБРАТИМОЕ слияние: двух разных Марий с разными
  // телефонами оно предложило бы объединить одним тапом.
  //
  // Ключ — последние 8 цифр (тот же, что у слияния и импорта): «+357 99 12
  // 34 56» и «99123456» один человек, а имена — нет.
  const dup = useMemo(() => {
    if (!client.id || client.deleted_at) return null;
    const key = phoneKey(client.phone);
    if (!key || key.length < 8) return null;
    return (
      all.find(
        (c) =>
          c.id !== client.id &&
          !c.deleted_at &&
          (phoneKey(c.phone) === key ||
            (c.phones ?? []).some((p) => phoneKey(p.number) === key)),
      ) ?? null
    );
  }, [all, client.id, client.phone, client.deleted_at]);

  if (!dup) return null;

  const merge = async () => {
    // Засов рефом, а не состоянием: два тапа в одном кадре оба видели
    // `busy === false` и запускали слияние дважды — балансы складывались
    // ВТОРОЙ раз, заметки дублировались.
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      // 1. Дополняем карточку. Если не записалось — дальше не идём: иначе
      //    записи уедут к клиенту, который не получил данных дубля.
      const patch = mergeClientPatch(client, dup);
      if (Object.keys(patch).length > 0) {
        await updateById.mutateAsync({ id: client.id, patch });
      }
      // 2. Переносим визиты — ради них слияние и затевается.
      const moving = appts.filter((a) => a.client_id === dup.id);
      for (const a of moving) {
        await updateAppt.mutateAsync({
          id: a.id,
          patch: { client_id: client.id },
        });
      }
      // 3. Дубль — в архив, а не в удаление. Архивация возвращает список
      //    неудач вместо исключения: без этой проверки слияние отчитывалось
      //    успехом, дубль оставался живым, плашка возвращалась — и второе
      //    слияние удваивало баланс.
      const res = await archive.mutateAsync([dup.id]);
      if (res.failed > 0 || res.archived === 0) {
        throw new Error("Карточка объединена, но дубль не ушёл в архив");
      }
      haptics.success();
      toast(
        moving.length > 0
          ? `Объединили · ${moving.length} ${moving.length === 1 ? "визит перенесён" : "визитов перенесено"}`
          : "Объединили",
      );
    } catch (e) {
      haptics.warning();
      toast((e as Error).message || "Не удалось объединить", "error");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const ask = () => {
    haptics.tap();
    Alert.alert(
      "Объединить карточки?",
      `Данные и визиты «${dup.full_name || dup.phone}» переедут сюда, а сама карточка уйдёт в архив.`,
      [
        { text: "Отмена", style: "cancel" },
        { text: "Объединить", onPress: () => void merge() },
      ],
    );
  };

  return (
    // ОДИН ГОЛОС С ОСТАЛЬНЫМИ ПЛАШКАМИ страницы (ClientDataNotice,
    // ClientDraftNotice): та же подложка surface, тот же паддинг 16, тот же
    // ритм 15/600 заголовок + 13 пояснение. Прежний янтарный прямоугольник
    // был единственным цветным пятном на белой странице и читался как
    // предупреждение об ошибке, хотя это подсказка.
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: t.radius.card,
        backgroundColor: t.surface,
      }}
    >
      <Users color={t.warning} size={20} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          Похоже, это один человек
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={2}
          style={{ marginTop: 2, fontSize: 13, color: t.sub }}
        >
          {`${dup.full_name || "Без имени"}${dup.phone ? ` · ${dup.phone}` : ""}`}
        </Text>
        <Pressable
          onPress={ask}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Объединить с ${dup.full_name || dup.phone}`}
          hitSlop={8}
          style={({ pressed }) => ({
            marginTop: 10,
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            minHeight: 36,
            justifyContent: "center",
            borderRadius: t.radius.input,
            backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
          >
            {busy ? "Объединяем…" : "Объединить"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default DuplicateNotice;
