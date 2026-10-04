import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/Field";
import { LoopWheelColumn, TimeWheelPair } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { whenWords, windowWords, type TemplateDraft } from "./sms-team-templates";

// СРОК ШАБЛОНА SMS — БАРАБАНОМ В СВОЕЙ ШТОРКЕ (AGENTS.md 5.1: «со страницы —
// канонический лист»; владелец 17.08: «не по списку, а именно тумблер»).
// Один лист на пять вопросов, у каждого свой барабан:
//   • «За сколько до визита» / «Через сколько после» — дни и часы (как у
//     «Напомнить» записи), до недели и до трёх суток — те же пределы у базы;
//   • «Накануне в» — часы и минуты (`TimeWheelPair`);
//   • «Пора повторить» — месяцы 1…24;
//   • «Окно отправки» — начало и конец целыми часами (база хранит часы).
// Итог словами под барабанами, внизу «Применить».

export type SmsTermKind = "before" | "after" | "day_before" | "repeat" | "window";

const pad2 = (n: number) => String(n).padStart(2, "0");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const DAYS = { before: range(0, 7), after: range(0, 3) } as const;
const MAX_HOURS = { before: 168, after: 72 } as const;
const DAY_HOURS = range(0, 23);
const MONTHS = range(1, 24);
const FROM_HOURS = range(0, 23);
const TO_HOURS = range(1, 24);

const TITLES: Record<SmsTermKind, string> = {
  before: "За сколько до визита",
  after: "Через сколько после визита",
  day_before: "Накануне в",
  repeat: "Через сколько месяцев",
  window: "Окно отправки",
};

type Term = Pick<TemplateDraft, "trigger" | "hours" | "atTime" | "months" | "sendFrom" | "sendTo">;

function Wheel({ label, items, value, onChange, width }: {
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

export function SmsTermSheet({
  kind,
  value,
  onClose,
  onApply,
}: {
  /** Что правим; `null` — лист закрыт. */
  kind: SmsTermKind | null;
  value: Term;
  onClose: () => void;
  onApply: (patch: Partial<Term>) => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<Term>(value);
  // Черновик — по фронту открытия: пока лист открыт, барабанами владеет он.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (kind && !wasOpen.current) setDraft(value);
    wasOpen.current = !!kind;
  }, [kind, value]);

  const shown = kind ?? "before";
  const set = (patch: Partial<Term>) => setDraft((d) => ({ ...d, ...patch }));
  const hours = draft.hours ?? 0;
  const span = shown === "after" ? "after" : "before";
  const setHours = (days: number, h: number) => set({ hours: Math.min(days * 24 + h, MAX_HOURS[span]) || null });
  const [atH = 18, atM = 0] = (draft.atTime ?? "18:00").split(":").map(Number);

  const empty = (shown === "before" || shown === "after") && !draft.hours;
  const summary = empty
    ? "Выберите срок"
    : shown === "window"
      ? windowWords(draft.sendFrom, draft.sendTo)
      : whenWords({ ...draft, trigger: shown });

  return (
    <BottomSheet
      visible={kind !== null}
      onClose={onClose}
      title={TITLES[shown]}
      padded={false}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Применить"
            disabled={empty}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 12, gap: 14 }}>
        {shown === "before" || shown === "after" ? (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 28 }}>
            <Wheel
              label="Дней"
              items={DAYS[span].map(String)}
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

        {shown === "day_before" ? (
          <View style={{ alignItems: "center" }}>
            <TimeWheelPair
              hour={atH}
              minute={atM}
              onChangeHour={(h) => set({ atTime: `${pad2(h)}:${pad2(atM)}` })}
              onChangeMinute={(m) => set({ atTime: `${pad2(atH)}:${pad2(m)}` })}
              labelPrefix="Накануне в"
            />
          </View>
        ) : null}

        {shown === "repeat" ? (
          <View style={{ alignItems: "center" }}>
            <Wheel
              label="Месяцев"
              items={MONTHS.map(String)}
              value={(draft.months ?? 6) - 1}
              onChange={(i) => set({ months: MONTHS[i] })}
            />
          </View>
        ) : null}

        {shown === "window" ? (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 28 }}>
            <Wheel
              label="Начало"
              items={FROM_HOURS.map((h) => `${pad2(h)}:00`)}
              value={draft.sendFrom}
              width={124}
              onChange={(i) => {
                const from = FROM_HOURS[i];
                setDraft((d) => ({ ...d, sendFrom: from, sendTo: Math.max(d.sendTo, from + 1) }));
              }}
            />
            <Wheel
              label="Конец"
              items={TO_HOURS.map((h) => `${pad2(h)}:00`)}
              value={draft.sendTo - 1}
              width={124}
              onChange={(i) => {
                const to = TO_HOURS[i];
                setDraft((d) => ({ ...d, sendTo: to, sendFrom: Math.min(d.sendFrom, to - 1) }));
              }}
            />
          </View>
        ) : null}

        <Text
          maxFontSizeMultiplier={1.3}
          style={{ textAlign: "center", fontSize: 15, lineHeight: 21, fontWeight: "600", color: empty ? t.faint : t.ink }}
        >
          {summary}
        </Text>
      </View>
    </BottomSheet>
  );
}
