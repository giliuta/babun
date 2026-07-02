import { useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { MessageSquareText, X } from "lucide-react-native";
import {
  AVAILABLE_TOKENS,
  KIND_LABELS,
  createBlankTemplate,
  renderTemplate,
  type SmsTemplate,
  type TemplateKind,
} from "@babun/shared/local/sms-templates";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { getSmsPresets } from "@babun/shared/local/sms-presets";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Card } from "@/components/ui/Card";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import {
  useSaveSmsTemplates,
  useSmsTemplates,
} from "@/features/settings/sms-templates";

// SMS-шаблоны — порт /dashboard/sms-templates: список, редактор с палитрой
// токенов, честный счётчик GSM-7/UCS-2 (по ОТРЕНДЕРЕННОМУ превью — carrier
// биллит подставленный текст, не сырой [Имя]), пер-типовые пресеты и
// «Тест» = живой предпросмотр с подстановкой тестовых данных.
// «Шаблоны» в хабе (финансовые транзакции) — другая сущность, не трогаем.

// P2 #40 — стартовые пресеты в пустом состоянии: черновик открывается сразу
// в редакторе, чтобы оператор увидел переменные в деле.
const STARTER_PRESETS: ReadonlyArray<{
  id: string;
  kind: TemplateKind;
  name: string;
  body: string;
}> = [
  {
    id: "preset-reminder",
    kind: "reminder",
    name: "Напоминание за 24ч",
    body:
      "[Имя], напоминаем: завтра в [Время] — [Услуга]. Адрес: [Адрес]. " +
      "Если планы изменились, ответьте на это сообщение. — [Компания]",
  },
  {
    id: "preset-confirm",
    kind: "new_appointment",
    name: "Подтверждение записи",
    body:
      "[Имя], запись подтверждена: [Дата], [Время]. Мастер — [Мастер]. " +
      "Адрес: [Адрес]. — [Компания]",
  },
  {
    id: "preset-feedback",
    kind: "after_24h_short",
    name: "Запрос отзыва",
    body:
      "[Имя], спасибо что выбрали нас. Поделитесь впечатлением — это " +
      "займёт минуту: [СсылкаНаОтмену]. — [Компания]",
  },
  {
    id: "preset-birthday",
    kind: "after_24h_long",
    name: "Поздравление с днём рождения",
    body:
      "[Имя], с днём рождения! В этом месяце скидка на сервис от " +
      "[Компания]. Бронируйте по этой ссылке: [СсылкаНаОтмену].",
  },
  {
    id: "preset-debt",
    kind: "debt",
    name: "Напоминание о долге",
    body: "Здравствуйте, [Имя]! Напоминаем об оплате [Сумма]. Спасибо!",
  },
];

// Ключи — канонические английские: alias-таблица renderTemplate маппит
// русские токены ([Имя] и т.д.) на них сама.
const SAMPLE_VARS: Record<string, string> = {
  Name: "Анастасия",
  Day: "Пятница",
  Date: "12.04.2026",
  Time: "10:00",
  Master: "Y&D",
  Service: "x4 A/C Чистка",
  Address: "Лимассол",
  Price: "€80",
  Amount: "€80",
  Company: "Babun",
  CancelUrl: "babun.app/c/abc",
};

export default function SmsTemplatesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { data: templates = [], isLoading, isError, refetch } = useSmsTemplates();
  const save = useSaveSmsTemplates();

  const [editing, setEditing] = useState<SmsTemplate | null>(null);

  // Черновик из createBlankTemplate ещё не в списке → режим «создание»,
  // «Удалить» спрятан (P2 #39).
  const isCreating = editing
    ? !templates.some((tpl) => tpl.id === editing.id)
    : false;

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const upsert = async (tpl: SmsTemplate) => {
    const next = templates.some((x) => x.id === tpl.id)
      ? templates.map((x) => (x.id === tpl.id ? tpl : x))
      : [...templates, tpl];
    await save.mutateAsync(next);
  };

  const handleSave = async (tpl: SmsTemplate) => {
    try {
      await upsert(tpl);
      setEditing(null);
      toast("Шаблон сохранён");
    } catch (e) {
      alertError(e); // редактор остаётся открытым
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Удалить шаблон?", undefined, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await save.mutateAsync(templates.filter((x) => x.id !== id));
            setEditing(null);
          } catch (e) {
            alertError(e);
          }
        },
      },
    ]);
  };

  const toggleEnabled = (tpl: SmsTemplate) => {
    save.mutate(
      templates.map((x) =>
        x.id === tpl.id ? { ...x, enabled: !x.enabled } : x,
      ),
      { onError: alertError },
    );
  };

  const handlePreset = (preset: (typeof STARTER_PRESETS)[number]) => {
    const draft = createBlankTemplate(preset.kind);
    setEditing({ ...draft, name: preset.name, body: preset.body });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="SMS-шаблоны"
        subtitle={templates.length ? `${templates.length} шт.` : undefined}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить шаблоны"
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : templates.length === 0 ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Свои шаблоны — отдельная секция: заголовок «Шаблонов пока нет»
              прямо над карточками пресетов противоречил сам себе. */}
          <View className="mx-3 mt-2">
            <Card>
              <View className="p-4">
                <View className="mb-1 flex-row items-center gap-2">
                  <MessageSquareText color={t.accent} size={ICON.sm} />
                  <Text className="text-base font-semibold" style={{ color: t.ink }}>
                    Свои шаблоны
                  </Text>
                </View>
                <Text className="mb-3 text-sm leading-5" style={{ color: t.sub }}>
                  Своих шаблонов пока нет — создайте пустой или возьмите
                  готовый ниже.
                </Text>
                <Button
                  label="Создать шаблон"
                  onPress={() => setEditing(createBlankTemplate())}
                />
              </View>
            </Card>
          </View>
          <View className="mx-3 mt-3">
            <Card>
              <View className="p-4">
                <Text className="mb-1 text-base font-semibold" style={{ color: t.ink }}>
                  Готовые шаблоны
                </Text>
                <Text className="mb-3 text-sm leading-5" style={{ color: t.sub }}>
                  Нажмите „Использовать“, чтобы добавить и настроить под себя.
                </Text>
                {STARTER_PRESETS.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => handlePreset(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Использовать шаблон ${p.name}`}
                    className="mb-2 flex-row items-center justify-between rounded-xl px-4 py-3 active:opacity-60"
                    style={{
                      backgroundColor: t.fill,
                    }}
                  >
                    <View className="min-w-0 flex-1 pr-2">
                      <Text
                        className="text-sm font-medium"
                        style={{ color: t.ink }}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      <Text className="text-xs" style={{ color: t.sub }} numberOfLines={1}>
                        {KIND_LABELS[p.kind]}
                      </Text>
                    </View>
                    <Text className="text-xs font-semibold" style={{ color: t.accent }}>
                      Использовать →
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={templates}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
          ListFooterComponent={
            <View className="mt-1">
              <AddRow
                label="Добавить шаблон"
                onPress={() => setEditing(createBlankTemplate())}
              />
            </View>
          }
          renderItem={({ item }) => (
            <View className="mx-3 mb-2">
              <Card>
                <Pressable
                  onPress={() => setEditing(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Редактировать шаблон ${item.name}`}
                  className="px-4 pb-2 pt-3 active:opacity-60"
                >
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: t.faint }}
                    >
                      {KIND_LABELS[item.kind]}
                    </Text>
                    {!item.enabled ? (
                      <Text
                        className="overflow-hidden rounded px-1.5 py-0.5 text-[11px]"
                        style={{
                          color: t.sub,
                          backgroundColor: t.fill,
                        }}
                      >
                        выкл.
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    className="mt-1 text-base font-medium"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    className="mt-0.5 text-xs leading-4"
                    style={{ color: item.body ? t.sub : t.faint }}
                    numberOfLines={2}
                  >
                    {item.body || "Пусто"}
                  </Text>
                </Pressable>
                <Divider inset={16} />
                <View className="flex-row items-center justify-between px-4 py-1.5">
                  <Text className="text-xs" style={{ color: t.sub }}>
                    Отправлять автоматически
                  </Text>
                  <Switch
                    value={item.enabled}
                    onValueChange={() => toggleEnabled(item)}
                    trackColor={{ true: t.accent }}
                    accessibilityLabel={`Автоотправка: ${item.name}`}
                  />
                </View>
              </Card>
            </View>
          )}
        />
      )}

      {editing ? (
        <TemplateEditor
          template={editing}
          mode={isCreating ? "create" : "edit"}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ) : null}
    </Screen>
  );
}

function TemplateEditor({
  template,
  mode,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  template: SmsTemplate;
  mode: "create" | "edit";
  busy: boolean;
  onClose: () => void;
  onSave: (tpl: SmsTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<SmsTemplate>(template);
  // Позиция курсора в теле — токен вставляется в место выделения.
  const selection = useRef({ start: template.body.length, end: template.body.length });
  const bodyRef = useRef<TextInput>(null);

  const preview = useMemo(
    () => renderTemplate(draft.body, SAMPLE_VARS),
    [draft.body],
  );
  // v547 §3.10 — считаем ОТРЕНДЕРЕННЫЙ текст: «[Имя]» — 5 GSM-7 знаков,
  // но «Анастасия» — 9 UCS-2; сырой подсчёт занижал бы счёт за SMS.
  const encInfo = useMemo(() => analyzeSmsEncoding(preview), [preview]);
  const presets = useMemo(() => getSmsPresets(draft.kind), [draft.kind]);

  const insertToken = (token: string) => {
    const { start, end } = selection.current;
    const body = draft.body;
    const at = Math.min(Math.max(start, 0), body.length);
    const to = Math.min(Math.max(end, at), body.length);
    setDraft((d) => ({ ...d, body: body.slice(0, at) + token + body.slice(to) }));
    selection.current = { start: at + token.length, end: at + token.length };
    bodyRef.current?.focus();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрыть" />
          <View
            className="h-[88%] overflow-hidden rounded-t-3xl"
            style={{ backgroundColor: t.canvas }}
          >
            <View
              className="flex-row items-center border-b px-2 py-2"
              style={{ borderColor: t.separator, backgroundColor: t.surface }}
            >
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Закрыть редактор"
                className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
              >
                <X color={t.body} size={ICON.md} />
              </Pressable>
              <Text
                className="flex-1 text-center text-base font-semibold"
                style={{ color: t.ink }}
              >
                {mode === "create" ? "Новый шаблон" : "Шаблон"}
              </Text>
              <View className="w-10" />
            </View>

            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            >
              <Field
                label="Название"
                value={draft.name}
                onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
                placeholder="Напоминание за 24 ч"
              />

              <Text className="mb-2 text-sm font-medium" style={{ color: t.sub }}>
                Тип события
              </Text>
              <View className="mb-4 flex-row flex-wrap gap-2">
                {(Object.keys(KIND_LABELS) as TemplateKind[]).map((k) => (
                  <Chip
                    key={k}
                    label={KIND_LABELS[k]}
                    radio
                    selected={draft.kind === k}
                    onPress={() => setDraft((d) => ({ ...d, kind: k }))}
                    accessibilityLabel={`Тип: ${KIND_LABELS[k]}`}
                  />
                ))}
              </View>

              <View className="mb-1 flex-row items-end justify-between">
                <Text className="text-sm font-medium" style={{ color: t.sub }}>
                  Текст сообщения
                </Text>
                <Text
                  className="text-xs tabular-nums"
                  style={{
                    color: encInfo.segments > 1 ? t.warning : t.faint,
                    fontWeight: encInfo.segments > 1 ? "600" : "400",
                  }}
                >
                  {encInfo.length} знаков · {encInfo.segments} SMS
                  {encInfo.encoding === "ucs2" ? " · UCS-2" : ""}
                </Text>
              </View>
              <TextInput
                ref={bodyRef}
                value={draft.body}
                onChangeText={(v) => setDraft((d) => ({ ...d, body: v }))}
                onSelectionChange={(e) => {
                  selection.current = e.nativeEvent.selection;
                }}
                multiline
                placeholder="Введите текст шаблона…"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                className="rounded-xl px-4 py-3 text-base"
                style={{
                  minHeight: 110,
                  textAlignVertical: "top",
                  color: t.ink,
                  borderWidth: 1,
                  borderColor: t.separator,
                }}
              />
              {encInfo.segments > 1 ? (
                <Text className="mt-1.5 text-xs leading-4" style={{ color: t.warning }}>
                  Сообщение разобьётся на {encInfo.segments} SMS. Чтобы уложиться
                  в одну — сократите до {encInfo.singleLimit} знаков
                  {encInfo.encoding === "ucs2" ? " (кириллица)" : ""}.
                </Text>
              ) : null}

              {/* Пер-типовые пресеты — только пока тело пустое, чтобы не
                  затереть начатый черновик (v547 §3.10). */}
              {presets.length > 0 && !draft.body.trim() ? (
                <View className="mt-4">
                  <Text className="mb-2 text-sm font-medium" style={{ color: t.sub }}>
                    Готовые шаблоны для «{KIND_LABELS[draft.kind]}»
                  </Text>
                  {presets.map((p, i) => (
                    <Pressable
                      key={i}
                      onPress={() =>
                        setDraft((d) => ({
                          ...d,
                          name: d.name.trim() ? d.name : p.name,
                          body: p.body,
                        }))
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Применить пресет ${p.label}`}
                      className="mb-2 rounded-xl px-3 py-2.5 active:opacity-60"
                      style={{
                        backgroundColor: t.surface,
                        borderWidth: 1,
                        borderColor: t.separator,
                      }}
                    >
                      <View className="mb-0.5 flex-row items-center justify-between gap-2">
                        <Text className="text-sm font-semibold" style={{ color: t.ink }}>
                          {p.label}
                        </Text>
                        <Text className="text-[11px] font-medium" style={{ color: t.accent }}>
                          Применить →
                        </Text>
                      </View>
                      <Text
                        className="text-xs leading-4"
                        style={{ color: t.sub }}
                        numberOfLines={2}
                      >
                        {p.body}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text className="mb-2 mt-4 text-sm font-medium" style={{ color: t.sub }}>
                Переменные (нажмите, чтобы вставить)
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {AVAILABLE_TOKENS.map(({ token, label }) => (
                  <Pressable
                    key={token}
                    onPress={() => insertToken(token)}
                    accessibilityRole="button"
                    accessibilityLabel={`Вставить: ${label}`}
                    className="rounded-full px-3 py-2 active:opacity-60"
                    style={{
                      backgroundColor: t.dark
                        ? "rgba(90,134,255,0.16)"
                        : "rgba(44,91,224,0.10)",
                    }}
                  >
                    <Text className="text-xs font-medium" style={{ color: t.accent }}>
                      {token}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* «Тест» — предпросмотр с подстановкой тестовых данных клиента:
                  ровно то, что уйдёт абоненту. Живёт всегда на экране. */}
              <Text className="mb-1 mt-4 text-sm font-medium" style={{ color: t.sub }}>
                Тест — как увидит клиент
              </Text>
              <View
                className="rounded-xl px-3 py-3"
                style={{
                  backgroundColor: t.dark
                    ? "rgba(47,211,154,0.10)"
                    : "rgba(52,199,89,0.08)",
                  borderWidth: 1,
                  borderColor: t.dark
                    ? "rgba(47,211,154,0.25)"
                    : "rgba(52,199,89,0.2)",
                }}
              >
                <Text
                  className="text-base leading-6"
                  style={{
                    color: preview ? t.ink : t.faint,
                    fontStyle: preview ? "normal" : "italic",
                  }}
                >
                  {preview || "— пусто —"}
                </Text>
              </View>

              <View className="mt-4 flex-row items-center justify-between">
                <Text className="text-base" style={{ color: t.ink }}>
                  Отправлять автоматически
                </Text>
                <Switch
                  value={draft.enabled}
                  onValueChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
                  trackColor={{ true: t.accent }}
                  accessibilityLabel="Отправлять автоматически"
                />
              </View>

              <View className="mt-5">
                <Button
                  label="Сохранить"
                  onPress={() => onSave(draft)}
                  disabled={!draft.name.trim() || busy}
                  loading={busy}
                />
              </View>
              {mode === "edit" ? (
                <Pressable
                  onPress={() => onDelete(template.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить шаблон"
                  className="mt-1 items-center py-3 active:opacity-70"
                >
                  <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                    Удалить
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
