import { useState } from "react";
import { Keyboard, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Bell, CalendarCheck, CalendarClock, CalendarPlus, CalendarSync, CalendarX, Hand, Repeat } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { FieldLabel } from "@/components/ui/Field";
import { NameColorField } from "@/components/ui/picker-fields";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { LoopWheelColumn, TimeWheelPair } from "@/components/ui/TimeWheel";
import { useToast } from "@/components/ui/Toast";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  blankDraft,
  draftOf,
  draftProblem,
  SMS_WHEN,
  templateWarnings,
  usesWindow,
  WHEN_LABELS,
  whenWords,
  windowWords,
  withTrigger,
  type SmsTeamTemplate,
  type SmsWhen,
  type TemplateDraft,
} from "./sms-team-templates";
import { SmsTextField } from "./SmsTextField";

// ПРАВКА ШАБЛОНА SMS — ЛИСТ СПРАВОЧНИКА (владелец 29.09: «шторка снизу, как
// всегда… иконку, цвет… полноценно всё настраивать»). Заведение и правка —
// один лист; действие одно — внизу. Удаления и «Скрыть» здесь нет: они на
// кромках свайпа строки.
//
// БЕЗ ФИШЕК (владелец 02.10: «мне не нравятся чипы… выбор времени не чипами, а
// тумблерами»). Тот же язык, что у шторки «Напомнить» и «Графика команды»:
//   • имя, цвет и значок одной строкой (`NameColorField`);
//   • «Когда отправлять» — восемь строк со значком и цветом, видны сразу,
//     выбираются одним тапом (галка справа);
//   • срок — барабаном («тумблер» владельца, 17.08: «отдельно кручу часы,
//     отдельно минуты»): «до/после визита» — дни и часы, «накануне» — время,
//     «пора повторить» — месяцы; у автоматического — окно «отправлять с … до
//     …» двумя барабанами часов; итог словами под ними;
//   • текст: поле, «Вставить», «Клиент увидит», части; предупреждения с
//     учётом «когда» (`templateWarnings`).

const WHEN_LOOK: Record<SmsWhen, { icon: LucideIcon; color: string }> = {
  manual: { icon: Hand, color: SETTINGS_TILE.blue },
  created: { icon: CalendarPlus, color: SETTINGS_TILE.green },
  before: { icon: Bell, color: SETTINGS_TILE.orange },
  day_before: { icon: CalendarClock, color: SETTINGS_TILE.indigo },
  rescheduled: { icon: CalendarSync, color: SETTINGS_TILE.teal },
  cancelled: { icon: CalendarX, color: SETTINGS_TILE.red },
  after: { icon: CalendarCheck, color: SETTINGS_TILE.green },
  repeat: { icon: Repeat, color: SETTINGS_TILE.purple },
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Барабаны срока: дни и часы. До визита — до недели, после — до трёх суток
 *  (те же пределы проверяет база). */
const DAYS_BEFORE = range(0, 7);
const DAYS_AFTER = range(0, 3);
const DAY_HOURS = range(0, 23);
const MONTHS = range(1, 24);
/** Окно отправки — целые часы: «с» 00…23, «до» 01…24. */
const FROM_HOURS = range(0, 23);
const TO_HOURS = range(1, 24);

/** Колонка барабана с подписью над ней. */
function Wheel({
  label,
  items,
  value,
  onChange,
  width,
}: {
  label: string;
  items: string[];
  value: number;
  onChange: (index: number) => void;
  width?: number;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <FieldLabel text={label} />
      <LoopWheelColumn
        items={items}
        value={Math.max(0, Math.min(items.length - 1, value))}
        onChange={onChange}
        width={width}
        accessibilityLabel={label}
      />
    </View>
  );
}

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
  const warnings = templateWarnings(draft);

  // Срок в часах — дни и часы барабанов. Пустой срок (0) база не примет: итог
  // скажет «Выберите срок», кнопка — что мешает.
  const hours = draft.hours ?? 0;
  const maxHours = draft.trigger === "before" ? 168 : 72;
  const setHours = (days: number, h: number) => set({ hours: Math.min(days * 24 + h, maxHours) || null });
  const [atH = 18, atM = 0] = (draft.atTime ?? "18:00").split(":").map(Number);

  const auto = draft.trigger !== "manual";
  const noTerm = (draft.trigger === "before" || draft.trigger === "after") && !draft.hours;
  const summary = !auto
    ? null
    : noTerm
      ? "Выберите срок"
      : usesWindow(draft.trigger)
        ? `${whenWords(draft)} · ${windowWords(draft.sendFrom, draft.sendTo).toLowerCase()}`
        : whenWords(draft);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={template ? "Шаблон SMS" : "Новый шаблон"}
      padded={false}
      avoidKeyboard
      scroll
      maxHeightRatio={0.92}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
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
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER }}>
        <NameColorField
          name={draft.name}
          onNameChange={(name) => set({ name })}
          color={draft.color}
          onColorChange={(color) => set({ color })}
          icon={draft.icon}
          onIconChange={(icon) => set({ icon })}
          maxLength={60}
          placeholder="Название шаблона"
          autoFocus={!template}
        />
      </View>

      <View style={{ paddingHorizontal: GUTTER, marginTop: 8 }}>
        <FieldLabel text="Когда отправлять" />
      </View>
      <SelectList>
        {SMS_WHEN.map((when) => (
          <SelectRow
            key={when}
            icon={WHEN_LOOK[when].icon}
            color={WHEN_LOOK[when].color}
            title={WHEN_LABELS[when]}
            selected={draft.trigger === when}
            accessibilityRole="radio"
            onPress={() => {
              // Выбор — не ввод: клавиатура названия закрывала полшторки.
              Keyboard.dismiss();
              haptics.tap();
              setDraft((d) => withTrigger(d, when));
            }}
          />
        ))}
      </SelectList>

      {auto ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 6, paddingBottom: 18, gap: 16 }}>
          {draft.trigger === "before" || draft.trigger === "after" ? (
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 24 }}>
              <Wheel
                label="Дней"
                items={(draft.trigger === "before" ? DAYS_BEFORE : DAYS_AFTER).map(String)}
                value={Math.floor(hours / 24)}
                onChange={(d) => setHours(d, hours % 24)}
              />
              <Wheel
                label="Часов"
                items={DAY_HOURS.map(String)}
                value={hours % 24}
                onChange={(h) => setHours(Math.floor(hours / 24), h)}
              />
            </View>
          ) : null}

          {draft.trigger === "day_before" ? (
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="Во сколько" />
              <TimeWheelPair
                hour={atH}
                minute={atM}
                onChangeHour={(h) => set({ atTime: `${pad2(h)}:${pad2(atM)}` })}
                onChangeMinute={(m) => set({ atTime: `${pad2(atH)}:${pad2(m)}` })}
                labelPrefix="Накануне в"
              />
            </View>
          ) : null}

          {draft.trigger === "repeat" ? (
            <View style={{ alignItems: "center" }}>
              <Wheel
                label="Через месяцев"
                items={MONTHS.map(String)}
                value={(draft.months ?? 6) - 1}
                onChange={(i) => set({ months: MONTHS[i] })}
              />
            </View>
          ) : null}

          {usesWindow(draft.trigger) ? (
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 24 }}>
              <Wheel
                label="Отправлять с"
                items={FROM_HOURS.map((h) => `${pad2(h)}:00`)}
                value={draft.sendFrom}
                width={124}
                onChange={(i) => {
                  const from = FROM_HOURS[i];
                  set({ sendFrom: from, sendTo: Math.max(draft.sendTo, from + 1) });
                }}
              />
              <Wheel
                label="до"
                items={TO_HOURS.map((h) => `${pad2(h)}:00`)}
                value={draft.sendTo - 1}
                width={124}
                onChange={(i) => {
                  const to = TO_HOURS[i];
                  set({ sendTo: to, sendFrom: Math.min(draft.sendFrom, to - 1) });
                }}
              />
            </View>
          ) : null}

          {summary ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                textAlign: "center",
                fontSize: 15,
                lineHeight: 21,
                fontWeight: "600",
                color: noTerm ? t.faint : t.ink,
              }}
            >
              {summary}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: GUTTER, paddingTop: auto ? 0 : 6 }}>
        <SmsTextField value={draft.body} onChange={(body) => set({ body })} />
        {warnings.map((warning) => (
          <Text
            key={warning}
            maxFontSizeMultiplier={1.3}
            style={{ marginBottom: 8, fontSize: 14, lineHeight: 19, color: t.warning }}
          >
            {warning}
          </Text>
        ))}
      </View>
    </BottomSheet>
  );
}
