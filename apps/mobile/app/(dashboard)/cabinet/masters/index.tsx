import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";
import { notify } from "@/lib/notify";
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
  const mastersQuery = useMasters({ includeInactive: true });
  const {
    data: allMasters = [],
    isLoading,
    isError,
    error,
    refetch,
  } = mastersQuery;
  const sortedMasters = useMemo(
    () => [
      ...allMasters.filter((m) => m.is_active),
      ...allMasters.filter((m) => !m.is_active),
    ],
    [allMasters],
  );
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const create = useCreateMaster();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const masters = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return sortedMasters;
    return sortedMasters.filter((master) => {
      const profile = asRecord(master.profile);
      return normalizeSearch([
        master.full_name,
        master.phone,
        typeof profile.email === "string" ? profile.email : "",
        typeof profile.login_email === "string" ? profile.login_email : "",
      ].filter(Boolean).join(" ")).includes(needle);
    });
  }, [search, sortedMasters]);

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
      notify("Ошибка", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Мастера" />

      {isLoading || teamsQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError || teamsQuery.isError ? (
        <EmptyState
          fill
          state="error"
          subtitle={
            (error || teamsQuery.error) instanceof Error
              ? ((error || teamsQuery.error) as Error).message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void Promise.all([refetch(), teamsQuery.refetch()]),
          }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={masters}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ flexGrow: 1 }}
          ListHeaderComponent={
            allMasters.length > 0 ? (
              <View
                className="mx-3 mb-2 mt-2 h-11 flex-row items-center rounded-[10px] px-3"
                style={{ backgroundColor: t.fill }}
              >
                <Search color={t.faint} size={17} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Имя, телефон или email"
                  placeholderTextColor={t.placeholder}
                  keyboardAppearance="light"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Поиск мастера"
                  className="ml-2 flex-1 text-[15px]"
                  style={{ color: t.ink }}
                />
              </View>
            ) : null
          }
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
            allMasters.length > 0 ? (
              <>
                <Divider inset={64} />
                <AddRow label="Добавить мастера" onPress={openCreate} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title={search.trim() ? "Ничего не найдено" : "Нет мастеров"}
              subtitle={search.trim() ? "Измените имя, телефон или email в поиске." : undefined}
              action={search.trim() ? undefined : { label: "Добавить мастера", onPress: openCreate }}
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
            accessible={false}
          />
          <View className="rounded-t-[10px] p-5 pb-8" style={{ backgroundColor: t.surface }}>
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

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: readableForeground(archived ? t.faint : tint),
          }}
        >
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
