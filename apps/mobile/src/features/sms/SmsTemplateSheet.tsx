import { useState } from "react";
import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { Chip } from "@/components/ui/Chip";
import { FieldLabel } from "@/components/ui/Field";
import { NameColorField } from "@/components/ui/picker-fields";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  blankDraft,
  DAY_BEFORE_TIMES,
  draftOf,
  draftProblem,
  emptyFieldsWarning,
  HOURS_AFTER,
  HOURS_BEFORE,
  hoursChip,
  REPEAT_MONTHS,
  SMS_WHEN,
  usesWindow,
  WHEN_LABELS,
  whenWords,
  WINDOW_FROM,
  WINDOW_TO,
  windowWords,
  withTrigger,
  type SmsTeamTemplate,
  type TemplateDraft,
} from "./sms-team-templates";
import { SmsTextField } from "./SmsTextField";

// ПРАВКА ШАБЛОНА SMS — КАНОНИЧЕСКИЙ ЛИСТ СПРАВОЧНИКА, как «Тип события» и
// «Метка» (владелец 29.09: «шторка снизу, как всегда… можно выбрать иконку,
// можно выбрать цвет… полноценно всё настраивать… в нашей архитектуре»).
// Заведение и правка — один лист; действие одно — внизу. Удаления и
// «Скрыть» здесь нет: они на кромках свайпа строки.
//
// Сверху вниз:
//   • имя, цвет и значок одной строкой (`NameColorField`);
//   • «Когда отправлять» — восемь вариантов фишками, видны сразу, ставятся
//     одним тапом; под выбранным — его срок теми же фишками; у
//     автоматического — окно «можно отправлять с … до …»; итог словами;
//   • текст: поле, «Вставить», «Клиент увидит», части; предупреждение, если
//     в тексте поле, которого у записи может не быть.

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
    <View style={{ marginTop: 14 }}>
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

export function SmsTemplateSheet({
  visible,
  teamId,
  template,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  teamId: string;
  /** Правим этот шаблон; `null` — заводим новый. */
  template: SmsTeamTemplate | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: TemplateDraft) => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const [draft, setDraft] = useState<TemplateDraft>(() => blankDraft(teamId));
  // Черновик берётся у открытой строки ровно один раз: пока лист открыт,
  // значениями владеют поля (как у листа типа события).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = !visible ? null : template ? template.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setDraft(template ? draftOf(template) : blankDraft(teamId));
  }

  const set = (patch: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = draftProblem(draft);
  const warning = emptyFieldsWarning(draft.body);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={template ? "Шаблон SMS" : "Новый шаблон"}
      avoidKeyboard
      scroll
      footer={
        <GradientButton
          label={template ? "Сохранить" : "Создать"}
          onPress={() => onSubmit(draft)}
          disabled={!!problem || busy}
          loading={busy}
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
      }
    >
      <NameColorField
        name={draft.name}
        onNameChange={(name) => set({ name })}
        color={draft.color}
        onColorChange={(color) => set({ color })}
        icon={draft.icon}
        onIconChange={(icon) => set({ icon })}
        maxLength={60}
        autoFocus={!template}
      />

      <View style={{ marginTop: 8 }}>
        <FieldLabel text="Когда отправлять" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SMS_WHEN.map((when) => (
            <Chip
              key={when}
              label={WHEN_LABELS[when]}
              selected={draft.trigger === when}
              radio
              onPress={() => setDraft((d) => withTrigger(d, when))}
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
          style={{ marginTop: 14, marginBottom: 16, fontSize: 15, lineHeight: 21, fontWeight: "600", color: t.ink }}
        >
          {usesWindow(draft.trigger)
            ? `${whenWords(draft)}, ${windowWords(draft.sendFrom, draft.sendTo).toLowerCase()}`
            : whenWords(draft)}
        </Text>
      </View>

      <SmsTextField value={draft.body} onChange={(body) => set({ body })} />
      {warning ? (
        <Text maxFontSizeMultiplier={1.3} style={{ marginBottom: 8, fontSize: 14, lineHeight: 19, color: t.warning }}>
          {warning}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
