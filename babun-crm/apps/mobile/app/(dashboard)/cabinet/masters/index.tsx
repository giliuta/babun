import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { getInitials } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import {
  useCreateMaster,
  useMasters,
  useTeams,
  type Master,
} from "@/features/reference/queries";

// Список мастеров — теперь корневой экран nav-хаба (masters/index.tsx).
// Строка не открывает модалку-редактор (как в RefListScreen), а пушит на
// хаб ./[id], где живут профиль / доступы / визиты / статистика. Создание
// осталось лёгким («Добавить мастера» → имя+телефон): дальше пользователь
// дозаполняет карточку уже в хабе.
export default function MastersScreen() {
  const t = useThemeColors();
  const router = useRouter();
  // Включая архивных: «Вернуть из архива» живёт в хабе мастера, и без
  // архивного хвоста в списке он недостижим (аудит P1-10). Активные
  // сверху, архив серым снизу.
  const {
    data: allMasters = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useMasters({ includeInactive: true });
  const masters = useMemo(
    () => [
      ...allMasters.filter((m) => m.is_active),
      ...allMasters.filter((m) => !m.is_active),
    ],
    [allMasters],
  );
  const { data: teams = [] } = useTeams();
  const create = useCreateMaster();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // Тинт аватара по основной команде мастера (цвет команды), как на вебе.
  const teamColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const team of teams) if (team.color) m.set(team.id, team.color);
    return m;
  }, [teams]);

  const openCreate = () => {
    setName("");
    setPhone("");
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const m = await create.mutateAsync({
        full_name: name.trim(),
        phone: phone.trim() || undefined,
      });
      setOpen(false);
      // Цепочка «дозаполнить»: сразу открываем хаб нового мастера.
      router.push(`/cabinet/masters/${m.id}`);
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Мастера" />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          fill
          state="error"
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={masters}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ flexGrow: 1 }}
          renderItem={({ item }) => (
            <MasterRow
              master={item}
              tint={
                item.team_id ? teamColorById.get(item.team_id) ?? t.faint : t.faint
              }
              onPress={() => router.push(`/cabinet/masters/${item.id}`)}
            />
          )}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListFooterComponent={
            masters.length > 0 ? (
              <>
                <Divider inset={64} />
                <AddRow label="Добавить мастера" onPress={openCreate} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет мастеров"
              action={{ label: "Добавить мастера", onPress: openCreate }}
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            className="flex-1"
            style={{ backgroundColor: t.scrim }}
            onPress={() => setOpen(false)}
            accessibilityLabel="Закрыть"
          />
          <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
            <Text style={{ marginBottom: 12, fontSize: 18, fontWeight: "700", color: t.ink }}>
              Новый мастер
            </Text>
            <Field
              label="Имя"
              value={name}
              onChangeText={setName}
              placeholder="Иван Петров"
              autoFocus
            />
            <Field
              label="Телефон"
              value={phone}
              onChangeText={setPhone}
              placeholder="+357…"
              keyboardType="phone-pad"
            />
            <Button
              label="Создать"
              onPress={submit}
              disabled={name.trim().length === 0 || busy}
              loading={busy}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function MasterRow({
  master,
  tint,
  onPress,
}: {
  master: Master;
  tint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const archived = !master.is_active;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${master.full_name || "Мастер"}${archived ? ", в архиве" : ""}`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: archived ? t.faint : tint }}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: t.onAccent }}>
          {getInitials(master.full_name)}
        </Text>
      </View>
      <View className="flex-1">
        <Text
          style={{ fontSize: 16, fontWeight: "600", color: archived ? t.faint : t.ink }}
          numberOfLines={1}
        >
          {master.full_name || "Без имени"}
        </Text>
        {archived ? (
          <Text style={{ fontSize: 14, color: t.faint }} numberOfLines={1}>
            В архиве — открыть, чтобы вернуть
          </Text>
        ) : master.phone ? (
          <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
            {master.phone}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
