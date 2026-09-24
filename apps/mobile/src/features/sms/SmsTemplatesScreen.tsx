import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { createBlankTemplate, type SmsTemplate } from "@babun/shared/local/sms-templates";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useSaveSmsTemplates, useSmsTemplates } from "@/features/settings/sms-templates";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useCanEditSmsTemplates } from "./SmsCompose";
import { SmsTemplateEditSheet, type SmsTemplateDraft } from "./SmsTemplateEditSheet";

// ШАБЛОНЫ SMS — СПРАВОЧНИК ПО ОБЩЕМУ КАНОНУ (STORY-089; владелец 24.09:
// «доделывай, соблюдая нашу архитектуру… по нашему дизайну»).
//
// Раньше здесь был экран-порт старого веба: кнопка посреди пустой страницы,
// карточки с тумблером «в палитре», ряд таблеток «тип события» из семи
// значений и зелёная «Тест»-плашка. Теперь — ровно то, что у типов событий,
// меток и услуг:
//   • строка — своя карточка с ручкой; порядок строк — порядок в листе «SMS»
//     у номера;
//   • тап — правка листом снизу;
//   • смахнуть влево — «Удалить» с подтверждением, вправо — «Скрыть»:
//     скрытый шаблон не предлагается ни у номера, ни в рассылке, но живёт
//     серой строкой;
//   • «Добавить шаблон» — внизу и всегда; пустой экран — только слова.
//
// ТИП ШАБЛОНА ИЗ ВИДА УБРАН. Семь «типов событий» ничего не решали: лист
// «SMS» показывает шаблон по тому, заполняется ли он, а автоматическая
// отправка (волна 2) выбирает шаблон на странице SMS сама. Поле `kind` в
// данных остаётся — старые строки его носят, готовые тексты ставят свой.

const ROW_H = 60;

type Editing = { mode: "create" } | { mode: "edit"; template: SmsTemplate };

export function SmsTemplatesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const query = useSmsTemplates();
  const save = useSaveSmsTemplates();
  const canEdit = useCanEditSmsTemplates();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);
  const templates = query.data ?? [];

  const write = (next: SmsTemplate[], failure: string, done?: () => void) => {
    save.mutate(next, {
      onSuccess: () => done?.(),
      onError: (e) => notify(failure, e instanceof Error ? e.message : undefined),
    });
  };

  const submit = (draft: SmsTemplateDraft) => {
    if (!draft.name || !draft.body) return;
    if (editing?.mode === "edit") {
      const id = editing.template.id;
      write(
        templates.map((x) => (x.id === id ? { ...x, name: draft.name, body: draft.body } : x)),
        "Не удалось сохранить шаблон",
        () => setEditing(null),
      );
      return;
    }
    const created: SmsTemplate = {
      ...createBlankTemplate(draft.kind),
      name: draft.name,
      body: draft.body,
    };
    write([...templates, created], "Не удалось завести шаблон", () => setEditing(null));
  };

  const toggleHidden = (template: SmsTemplate) =>
    write(
      templates.map((x) => (x.id === template.id ? { ...x, enabled: !x.enabled } : x)),
      template.enabled ? "Не удалось скрыть шаблон" : "Не удалось показать шаблон",
      () => toast(template.enabled ? "Шаблон скрыт" : "Шаблон показан"),
    );

  const remove = (template: SmsTemplate) => {
    if (save.isPending) return;
    confirmThen(
      "Удалить шаблон?",
      {
        message: `«${template.name}» больше не будет предлагаться в SMS. Уже отправленные сообщения это не затронет.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        write(
          templates.filter((x) => x.id !== template.id),
          "Не удалось удалить шаблон",
          () => toast("Шаблон удалён"),
        ),
    );
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(templates.map((x) => [x.id, x]));
    const next = ids.map((id) => byId.get(id)).filter((x): x is SmsTemplate => x != null);
    if (next.length !== templates.length) return;
    write(next, "Не удалось изменить порядок");
  };

  const openCreate = () => setEditing({ mode: "create" });

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Шаблоны SMS" />

      {query.isLoading ? (
        <EmptyState state="loading" fill />
      ) : query.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={query.error instanceof Error ? query.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void query.refetch() }}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          fill
          title="Шаблонов пока нет"
          subtitle="Шаблон — готовый текст SMS. Имя, дата, время и адрес подставятся из записи сами."
          action={canEdit ? { label: "Добавить шаблон", onPress: openCreate } : undefined}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ marginHorizontal: GUTTER }}>
            <ReorderList
              items={templates}
              rowHeight={ROW_H}
              spaced
              labelFor={(x) => x.name}
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(template, _index, handle) => {
                const row = (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      opacity: template.enabled ? 1 : 0.45,
                      backgroundColor: t.surface,
                    }}
                  >
                    <Pressable
                      onPress={canEdit ? () => setEditing({ mode: "edit", template }) : undefined}
                      disabled={!canEdit}
                      accessibilityRole="button"
                      accessibilityLabel={`Шаблон ${template.name}${canEdit ? ", редактировать" : ""}`}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: ROW_H,
                        justifyContent: "center",
                        paddingLeft: 16,
                        paddingRight: canEdit ? 0 : 16,
                        backgroundColor: pressed ? t.pressed : "transparent",
                      })}
                    >
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                        style={{ fontSize: 16, color: t.ink }}
                      >
                        {template.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                        style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                      >
                        {template.enabled ? template.body : `скрыт · ${template.body}`}
                      </Text>
                    </Pressable>
                    {canEdit ? handle : null}
                  </View>
                );
                return canEdit ? (
                  <SwipeRow
                    label="Удалить"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить шаблон ${template.name}`}
                    onAction={() => remove(template)}
                    leading={{
                      label: template.enabled ? "Скрыть" : "Показать",
                      color: template.enabled ? t.warning : t.success,
                      icon: template.enabled ? EyeOff : RotateCcw,
                      accessibilityLabel: template.enabled
                        ? `Скрыть шаблон ${template.name}`
                        : `Показать шаблон ${template.name}`,
                      onAction: () => toggleHidden(template),
                    }}
                  >
                    {row}
                  </SwipeRow>
                ) : (
                  row
                );
              }}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ И ВСЕГДА, как у типов событий и меток. У
          пустого списка ту же кнопку ставит `EmptyState.action`. */}
      {canEdit && !query.isLoading && !query.isError && templates.length > 0 ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Добавить шаблон" onPress={openCreate} />
        </View>
      ) : null}

      <SmsTemplateEditSheet
        visible={editing !== null}
        template={editing?.mode === "edit" ? editing.template : null}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submit}
      />
    </Screen>
  );
}

export default SmsTemplatesScreen;
