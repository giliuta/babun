import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";
import { Field, FieldLabel } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useSaveTeamTemplate, useTeamTemplates } from "./sms-account";
import {
  blankDraft,
  DAY_BEFORE_TIMES,
  draftOf,
  draftProblem,
  emptyFieldsWarning,
  fromReady,
  HOURS_AFTER,
  HOURS_BEFORE,
  hoursChip,
  READY_TEMPLATES,
  REPEAT_MONTHS,
  SMS_WHEN,
  usesWindow,
  WHEN_LABELS,
  whenWords,
  WINDOW_FROM,
  WINDOW_TO,
  windowWords,
  withTrigger,
  type TemplateDraft,
} from "./sms-team-templates";
import { SmsTextField } from "./SmsTextField";

// НАСТРОЙКА ШАБЛОНА SMS КОМАНДЫ (STORY-089; владелец 29.09: «когда добавляю
// шаблон, полноценно настраиваю: когда отправлять — за 24 часа или в
// такое-то время… тихих часов нет, мы программируем шаблон в определённое
// время… главное — удобно, чтоб не было косяков»).
//
// Блоки сверху вниз:
//   • ГОТОВЫЕ — только у нового и пустого: тап ставит название, текст и
//     «когда» разом;
//   • ШАБЛОН — название (так он зовётся в листе «SMS клиенту»);
//   • КОГДА ОТПРАВЛЯТЬ — восемь вариантов фишками, видны сразу и ставятся
//     одним тапом (владелец: «ответ виден, один тап»); под выбранным — его
//     срок теми же фишками и итог словами («Накануне в 18:00»). У
//     автоматического — окно «Можно отправлять с … до …»: событие вне окна
//     ждёт его начала; «накануне в ЧЧ:ММ» уходит ровно в своё время;
//   • СООБЩЕНИЕ — поле «Текст», «Вставить», «Клиент увидит» и число частей; под ним —
//     предупреждение, если в тексте поле, которого у записи может не быть;
//   • «Включён».
// Действие одно — «Сохранить» внизу. Проверка та же, что у базы: неверное
// сохранить нельзя, а тап по серой кнопке говорит, чего не хватает.
// Удаление и «Выключить» — на свайпе строки в списке шаблонов команды.

function Chips<T extends string | number>({
  label,
  options,
  value,
  words,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  words: (option: T) => string;
  onPick: (option: T) => void;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <FieldLabel text={label} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <Chip
            key={String(option)}
            label={words(option)}
            selected={value === option}
            radio
            onPress={() => onPick(option)}
          />
        ))}
      </View>
    </View>
  );
}

const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function SmsTemplateScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ team?: string; id?: string }>();
  const teamId = params.team ?? "";
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === teamId);
  const templates = useTeamTemplates(teamId || null);
  const save = useSaveTeamTemplate();

  const existing = params.id ? (templates.data ?? []).find((x) => x.id === params.id) : undefined;
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  // Черновик берётся один раз: пока страница открыта, значениями владеют
  // поля (как у листов справочников).
  if (!draft && teamId) {
    if (!params.id) setDraft(blankDraft(teamId));
    else if (existing) setDraft(draftOf(existing));
  }

  const title = params.id ? (existing?.name ?? "Шаблон SMS") : "Новый шаблон";

  if (!teamId || (params.id && templates.isSuccess && !existing)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} subtitle={team?.name} />
        <EmptyState fill title="Шаблон не найден" />
      </Screen>
    );
  }
  if (!draft) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} subtitle={team?.name} />
        <EmptyState
          state={templates.isError ? "error" : "loading"}
          fill
          action={templates.isError ? { label: "Повторить", onPress: () => void templates.refetch() } : undefined}
        />
      </Screen>
    );
  }

  const set = (patch: Partial<TemplateDraft>) => setDraft({ ...draft, ...patch });
  const problem = draftProblem(draft);
  const warning = emptyFieldsWarning(draft.body);
  const fresh = !draft.id && !draft.body.trim() && !draft.name.trim();

  const submit = () => {
    if (problem) return;
    save.mutate(draft, {
      onSuccess: () => {
        toast(draft.id ? "Шаблон сохранён" : "Шаблон добавлен", "success");
        router.back();
      },
      onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined),
    });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} subtitle={team?.name} />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {fresh ? (
            <SectionCard title="Готовые" padded>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {READY_TEMPLATES.map((ready) => (
                  <Chip key={ready.name} label={ready.name} variant="tint" onPress={() => setDraft(fromReady(draft, ready))} />
                ))}
              </View>
            </SectionCard>
          ) : null}

          <SectionCard title="Шаблон" padded>
            <Field
              label="Название"
              placeholder="Например, «Напоминание накануне»"
              value={draft.name}
              onChangeText={(name) => set({ name })}
              maxLength={60}
              returnKeyType="done"
            />
          </SectionCard>

          <SectionCard title="Когда отправлять" padded>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {SMS_WHEN.map((when) => (
                <Chip
                  key={when}
                  label={WHEN_LABELS[when]}
                  selected={draft.trigger === when}
                  radio
                  onPress={() => setDraft(withTrigger(draft, when))}
                />
              ))}
            </View>

            {draft.trigger === "before" ? (
              <Chips
                label="За сколько до визита"
                options={HOURS_BEFORE}
                value={draft.hours as (typeof HOURS_BEFORE)[number] | null}
                words={hoursChip}
                onPick={(hours) => set({ hours })}
              />
            ) : null}
            {draft.trigger === "day_before" ? (
              <Chips
                label="Во сколько накануне"
                options={DAY_BEFORE_TIMES}
                value={draft.atTime as (typeof DAY_BEFORE_TIMES)[number] | null}
                words={(time) => time}
                onPick={(atTime) => set({ atTime })}
              />
            ) : null}
            {draft.trigger === "after" ? (
              <Chips
                label="Через сколько после визита"
                options={HOURS_AFTER}
                value={draft.hours as (typeof HOURS_AFTER)[number] | null}
                words={hoursChip}
                onPick={(hours) => set({ hours })}
              />
            ) : null}
            {draft.trigger === "repeat" ? (
              <Chips
                label="Через сколько после визита"
                options={REPEAT_MONTHS}
                value={draft.months as (typeof REPEAT_MONTHS)[number] | null}
                words={(m) => `${m} мес`}
                onPick={(months) => set({ months })}
              />
            ) : null}

            {usesWindow(draft.trigger) ? (
              <>
                <Chips
                  label="Можно отправлять с"
                  options={WINDOW_FROM}
                  value={draft.sendFrom as (typeof WINDOW_FROM)[number]}
                  words={hh}
                  onPick={(sendFrom) => set({ sendFrom })}
                />
                <Chips
                  label="До"
                  options={WINDOW_TO}
                  value={draft.sendTo as (typeof WINDOW_TO)[number]}
                  words={hh}
                  onPick={(sendTo) => set({ sendTo })}
                />
              </>
            ) : null}

            <Text
              maxFontSizeMultiplier={1.3}
              style={{ marginTop: 16, fontSize: 15, lineHeight: 21, fontWeight: "600", color: t.ink }}
            >
              {usesWindow(draft.trigger)
                ? `${whenWords(draft)}, ${windowWords(draft.sendFrom, draft.sendTo).toLowerCase()}`
                : whenWords(draft)}
            </Text>
          </SectionCard>

          <SectionCard title="Сообщение" padded>
            <SmsTextField value={draft.body} onChange={(body) => set({ body })} />
            {warning ? (
              <Text maxFontSizeMultiplier={1.3} style={{ marginTop: 4, fontSize: 14, lineHeight: 19, color: t.warning }}>
                {warning}
              </Text>
            ) : null}
          </SectionCard>

          <SectionCard>
            <SwitchRow label="Включён" value={draft.enabled} onChange={(enabled) => set({ enabled })} />
          </SectionCard>
        </ScrollView>

        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label={draft.id ? "Сохранить" : "Добавить шаблон"}
            onPress={submit}
            disabled={!!problem || save.isPending}
            loading={save.isPending}
            // Серая кнопка отвечает плашкой сверху — что мешает сохранить
            // (как у записи: «Выберите услугу»).
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
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default SmsTemplateScreen;
