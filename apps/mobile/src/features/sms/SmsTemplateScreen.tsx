import { useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import { Bell, CalendarCheck, CalendarClock, CalendarPlus, CalendarSync, CalendarX, Hand, Repeat } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { NameColorField } from "@/components/ui/picker-fields";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ReferenceBlock } from "@/components/ui/ReferenceBlock";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { ValueRow } from "@/components/ui/ValueRow";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useSaveTeamTemplate, useTeamTemplates } from "./sms-account";
import {
  blankDraft,
  draftOf,
  draftProblem,
  hoursChip,
  SMS_WHEN,
  templateWarnings,
  usesWindow,
  WHEN_LABELS,
  whenWords,
  windowWords,
  withTrigger,
  type SmsWhen,
  type TemplateDraft,
} from "./sms-team-templates";
import { SmsTermSheet, type SmsTermKind } from "./SmsTermSheet";
import { SmsPreviewBlock, SmsTextBlock } from "./SmsTextField";

// ШАБЛОН SMS — СТРАНИЦА БЛОКАМИ (STORY-089; владелец 02.10: «продумай
// полностью дизайн… соблюдая нашу архитектуру и наш дизайн»).
//
// Почему страница, а не шторка. Выбор «когда» и сроки по канону открываются
// своей шторкой (AGENTS.md 5.2 — шторка выбора, 5.1 — барабан листом), а две
// шторки в одном кадре iOS не показывает. Поэтому шаблон собран как запись:
// блоки с шапкой, в каждом дверь, по двери — стандартная шторка.
//
//   • ШАБЛОН — имя, цвет и значок одной строкой (`NameColorField`);
//   • КОГДА ОТПРАВЛЯТЬ — `ReferenceBlock`, как тип события: выбранный вариант
//     плиткой со значком и цветом, под именем — срок и окно словами; тап —
//     шторка выбора из восьми вариантов (`PickerSheet`);
//   • СРОК — строки со значением справа (`ValueRow`): «за сколько», «во
//     сколько», «через сколько» и «окно отправки»; тап — барабан в своей
//     шторке (`SmsTermSheet`). У ручного шаблона блока нет;
//   • ТЕКСТ — поле, счёт знаков и SMS, дверь «Вставить поле»;
//   • КЛИЕНТ УВИДИТ — пример и предупреждения;
//   • «Создать» / «Сохранить» — внизу, одна кнопка экрана.

const WHEN_LOOK: Record<SmsWhen, { icon: LucideIcon; color: string; hint: string }> = {
  manual: { icon: Hand, color: SETTINGS_TILE.blue, hint: "Отправляете сами из записи или карточки" },
  created: { icon: CalendarPlus, color: SETTINGS_TILE.green, hint: "Сразу, как запись создана" },
  before: { icon: Bell, color: SETTINGS_TILE.orange, hint: "За часы или дни до начала" },
  day_before: { icon: CalendarClock, color: SETTINGS_TILE.indigo, hint: "Накануне визита в выбранное время" },
  rescheduled: { icon: CalendarSync, color: SETTINGS_TILE.teal, hint: "Когда запись перенесли" },
  cancelled: { icon: CalendarX, color: SETTINGS_TILE.red, hint: "Когда запись отменили" },
  after: { icon: CalendarCheck, color: SETTINGS_TILE.green, hint: "Через часы после выполненной работы" },
  repeat: { icon: Repeat, color: SETTINGS_TILE.purple, hint: "Через месяцы — пора снова на обслуживание" },
};

/** Срок словами в строке: «24 ч», «2 дня 3 ч». */
function hoursValue(h: number | null): string {
  if (!h) return "Не выбран";
  const days = Math.floor(h / 24);
  const rest = h % 24;
  if (days && rest) return `${hoursChip(days * 24)} ${rest} ч`;
  return days ? hoursChip(h) : `${h} ч`;
}

export function SmsTemplateScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ team?: string; id?: string }>();
  const teamId = params.team ?? "";
  const { data: teams = [] } = useTeams();
  const teamName = teams.find((x) => x.id === teamId)?.name;
  const templates = useTeamTemplates(teamId || null);
  const template = params.id ? (templates.data ?? []).find((x) => x.id === params.id) ?? null : null;
  const save = useSaveTeamTemplate();

  const [draft, setDraft] = useState<TemplateDraft>(() => blankDraft(teamId));
  // Черновик берётся у шаблона один раз — когда он пришёл из базы.
  const [seeded, setSeeded] = useState<string | null>(params.id ? null : "create");
  if (template && seeded !== template.id) {
    setSeeded(template.id);
    setDraft(draftOf(template));
  }
  const [whenOpen, setWhenOpen] = useState(false);
  const [term, setTerm] = useState<SmsTermKind | null>(null);

  const set = (patch: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = draftProblem(draft);
  const warnings = templateWarnings(draft);
  const look = WHEN_LOOK[draft.trigger];
  const auto = draft.trigger !== "manual";
  const whenLine = usesWindow(draft.trigger)
    ? `${whenWords(draft)} · ${windowWords(draft.sendFrom, draft.sendTo).toLowerCase()}`
    : whenWords(draft);

  const submit = () =>
    save.mutate(draft, {
      onSuccess: () => {
        toast(draft.id ? "Шаблон сохранён" : "Шаблон добавлен", "success");
        router.back();
      },
      onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined),
    });

  const title = params.id ? "Шаблон SMS" : "Новый шаблон";
  if (params.id && !template) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} subtitle={teamName} />
        <EmptyState
          state={templates.isLoading ? "loading" : templates.isError ? "error" : "empty"}
          title={templates.isLoading || templates.isError ? undefined : "Шаблон удалён"}
          fill
        />
      </Screen>
    );
  }

  const termKind: SmsTermKind | null =
    draft.trigger === "before" || draft.trigger === "after" || draft.trigger === "day_before" || draft.trigger === "repeat"
      ? draft.trigger
      : null;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} subtitle={teamName} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <SectionCard title="Шаблон">
            <NameColorField
              bare
              label={null}
              name={draft.name}
              onNameChange={(name) => set({ name })}
              color={draft.color}
              onColorChange={(color) => set({ color })}
              icon={draft.icon}
              onIconChange={(icon) => set({ icon })}
              maxLength={60}
              placeholder="Название шаблона"
              autoFocus={!params.id}
            />
        </SectionCard>

        <ReferenceBlock
          title="Когда отправлять"
          emptyIcon={Hand}
          emptyLabel="Выбрать"
          value={{ name: WHEN_LABELS[draft.trigger], Icon: look.icon, color: look.color, subtitle: whenLine }}
          onPress={() => {
            Keyboard.dismiss();
            setWhenOpen(true);
          }}
        />

        {auto && (termKind || usesWindow(draft.trigger)) ? (
          <SectionCard title="Срок">
            {draft.trigger === "before" ? (
              <ValueRow label="За сколько до визита" value={hoursValue(draft.hours)} onPress={() => setTerm("before")} />
            ) : null}
            {draft.trigger === "after" ? (
              <ValueRow label="Через сколько после" value={hoursValue(draft.hours)} onPress={() => setTerm("after")} />
            ) : null}
            {draft.trigger === "day_before" ? (
              <ValueRow label="Накануне в" value={draft.atTime ?? "18:00"} onPress={() => setTerm("day_before")} />
            ) : null}
            {draft.trigger === "repeat" ? (
              <ValueRow label="Через" value={`${draft.months ?? 6} мес`} onPress={() => setTerm("repeat")} />
            ) : null}
            {usesWindow(draft.trigger) ? (
              <ValueRow
                label="Окно отправки"
                value={windowWords(draft.sendFrom, draft.sendTo)}
                separated={!!termKind}
                onPress={() => setTerm("window")}
              />
            ) : null}
          </SectionCard>
        ) : null}

        <SmsTextBlock value={draft.body} onChange={(body) => set({ body })} />
        <SmsPreviewBlock value={draft.body} warnings={warnings} />
      </ScrollView>

      <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
        <GradientButton
          label={params.id ? "Сохранить" : "Создать"}
          onPress={submit}
          disabled={!!problem || save.isPending}
          loading={save.isPending}
          // Серая кнопка отвечает плашкой — что мешает сохранить.
          onDisabledPress={
            problem
              ? () => {
                  haptics.warning();
                  toast(problem, "info");
                }
              : undefined
          }
        />
      </View>

      <PickerSheet
        visible={whenOpen}
        title="Когда отправлять"
        selectedId={draft.trigger}
        items={SMS_WHEN.map((when) => ({
          id: when,
          label: WHEN_LABELS[when],
          icon: WHEN_LOOK[when].icon,
          color: WHEN_LOOK[when].color,
          hint: WHEN_LOOK[when].hint,
          onPress: () => setDraft((d) => withTrigger(d, when)),
        }))}
        onClose={() => setWhenOpen(false)}
      />
      <SmsTermSheet kind={term} value={draft} onClose={() => setTerm(null)} onApply={(patch) => set(patch)} />
    </Screen>
  );
}

export default SmsTemplateScreen;
