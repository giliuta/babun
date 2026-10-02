import { useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Bell, CalendarCheck, CalendarClock, CalendarPlus, CalendarSync, CalendarX, Hand, Repeat } from "lucide-react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { NameColorField } from "@/components/ui/picker-fields";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { ReferenceBlock } from "@/components/ui/ReferenceBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { ValueRow } from "@/components/ui/ValueRow";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useSaveTeamTemplate, type SmsTeamTemplate } from "./sms-account";
import {
  blankDraft,
  draftOf,
  draftProblem,
  hoursChip,
  SMS_WHEN,
  usesWindow,
  WHEN_LABELS,
  whenWords,
  windowWords,
  withTrigger,
  type SmsWhen,
  type TemplateDraft,
} from "./sms-team-templates";
import { SmsTermSheet, type SmsTermKind } from "./SmsTermSheet";
import { SmsTextBlock } from "./SmsTextField";

// ШАБЛОН SMS — ШТОРКА БЛОКАМИ, КАК «НОВЫЙ ОБЪЕКТ» (STORY-089; владелец 03.10:
// «зачем отдельная страница — давай шторка… топаю ещё раз на выбор, как
// отправлять, и открывается ещё одна шторка… как объекты: выбор типа объекта»).
//
// Тело — язык страницы на прохладном фоне (как `ObjectSheet`): блоки с шапкой,
// в блоке дверь, по двери — своя шторка поверх этой. Лист в листе законен:
// так из листа объекта открывается «Тип объекта», из операции — категория.
// Вложенные шторки живут ВНУТРИ тела листа — иначе iOS не покажет вторую.
//
//   • ШАБЛОН — имя, цвет и значок одной строкой (`NameColorField`);
//   • КОГДА ОТПРАВЛЯТЬ — `ReferenceBlock`, как тип события: выбранный вариант
//     плиткой со значком и цветом, под именем — срок и окно словами; тап —
//     шторка выбора из восьми вариантов с «Применить» (`SmsWhenSheet`);
//   • СРОК — строки со значением справа (`ValueRow`): «за сколько», «во
//     сколько», «через сколько» и «окно отправки»; тап — барабан в своей
//     шторке (`SmsTermSheet`). У ручного шаблона блока нет;
//   • ТЕКСТ — поле, счёт знаков и SMS, дверь «Вставить поле» (своя шторка).
//     Блока «Клиент увидит» и подсказок нет (владелец 03.10: «не надо, и так
//     понятно… не ставь вообще подсказки»);
//   • «Создать» / «Сохранить» — футер листа, одна кнопка.

// Строки — только имя, значок и цвет: подсказок под именем нет (владелец
// 03.10: «не ставь вообще подсказки»).
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

/** «КОГДА ОТПРАВЛЯТЬ» — шторка выбора с «Применить» (владелец 03.10:
 *  «отрегулировать шторку… чтоб появилась кнопка применить»). Тап отмечает
 *  вариант, кнопка применяет; шторка высотой во все восемь строк, чтобы
 *  последние не уходили за край. */
function SmsWhenSheet({
  visible,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: SmsWhen;
  onClose: () => void;
  onApply: (when: SmsWhen) => void;
}) {
  const [picked, setPicked] = useState<SmsWhen>(value);
  // Отметка — заново на каждое открытие: закрыли без «Применить» — выбор не живёт.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setPicked(value);
  }
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Когда отправлять"
      padded={false}
      scroll
      maxHeightRatio={0.9}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Применить"
            onPress={() => {
              onApply(picked);
              onClose();
            }}
          />
        </View>
      }
    >
      <SelectList>
        {SMS_WHEN.map((when) => (
          <SelectRow
            key={when}
            icon={WHEN_LOOK[when].icon}
            color={WHEN_LOOK[when].color}
            title={WHEN_LABELS[when]}
            selected={picked === when}
            accessibilityRole="radio"
            onPress={() => {
              haptics.tap();
              setPicked(when);
            }}
          />
        ))}
      </SelectList>
    </BottomSheet>
  );
}

/** Срок словами в строке: «24 ч», «2 дня 3 ч». */
function hoursValue(h: number | null): string {
  if (!h) return "Не выбран";
  const days = Math.floor(h / 24);
  const rest = h % 24;
  if (days && rest) return `${hoursChip(days * 24)} ${rest} ч`;
  return days ? hoursChip(h) : `${h} ч`;
}

export function SmsTemplateSheet({
  visible,
  teamId,
  teamName,
  template,
  onClose,
}: {
  visible: boolean;
  teamId: string;
  teamName?: string;
  /** Что правим; `null` — новый шаблон. */
  template: SmsTeamTemplate | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const save = useSaveTeamTemplate();

  const [draft, setDraft] = useState<TemplateDraft>(() => blankDraft(teamId));
  // Черновик — заново на каждое открытие: из шаблона или пустой.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = !visible ? null : template ? template.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    if (key) setDraft(template ? draftOf(template) : blankDraft(teamId));
  }
  const [whenOpen, setWhenOpen] = useState(false);
  const [term, setTerm] = useState<SmsTermKind | null>(null);

  const set = (patch: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = draftProblem(draft);
  const look = WHEN_LOOK[draft.trigger];
  const auto = draft.trigger !== "manual";
  const whenLine = usesWindow(draft.trigger)
    ? `${whenWords(draft)} · ${windowWords(draft.sendFrom, draft.sendTo).toLowerCase()}`
    : whenWords(draft);
  const termKind: SmsTermKind | null =
    draft.trigger === "before" || draft.trigger === "after" || draft.trigger === "day_before" || draft.trigger === "repeat"
      ? draft.trigger
      : null;

  const openTerm = (kind: SmsTermKind) => {
    Keyboard.dismiss();
    setTerm(kind);
  };

  const submit = () =>
    save.mutate(draft, {
      onSuccess: () => {
        toast(draft.id ? "Шаблон сохранён" : "Шаблон добавлен", "success");
        onClose();
      },
      onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined),
    });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={template ? "Шаблон SMS" : "Новый шаблон"}
      subtitle={teamName}
      padded={false}
      maxHeightRatio={0.92}
      avoidKeyboard
      footer={
        <View
          style={{
            paddingHorizontal: GUTTER,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <GradientButton
            label={template ? "Сохранить" : "Создать"}
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
      }
    >
      {/* Тело — язык страницы (блоки на прохладном фоне), как у листа объекта.
          Паддинги только через contentContainerStyle — className на ScrollView
          NativeWind молча роняет. */}
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
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
              <ValueRow label="За сколько до визита" value={hoursValue(draft.hours)} onPress={() => openTerm("before")} />
            ) : null}
            {draft.trigger === "after" ? (
              <ValueRow label="Через сколько после" value={hoursValue(draft.hours)} onPress={() => openTerm("after")} />
            ) : null}
            {draft.trigger === "day_before" ? (
              <ValueRow label="Накануне в" value={draft.atTime ?? "18:00"} onPress={() => openTerm("day_before")} />
            ) : null}
            {draft.trigger === "repeat" ? (
              <ValueRow label="Через" value={`${draft.months ?? 6} мес`} onPress={() => openTerm("repeat")} />
            ) : null}
            {usesWindow(draft.trigger) ? (
              <ValueRow
                label="Окно отправки"
                value={windowWords(draft.sendFrom, draft.sendTo)}
                separated={!!termKind}
                onPress={() => openTerm("window")}
              />
            ) : null}
          </SectionCard>
        ) : null}

        <SmsTextBlock value={draft.body} onChange={(body) => set({ body })} />

        {/* Шторки дверей — внутри листа: лист в листе iOS показывает, а
            соседний — нет. */}
        <SmsWhenSheet
          visible={whenOpen}
          value={draft.trigger}
          onClose={() => setWhenOpen(false)}
          onApply={(when) => setDraft((d) => (d.trigger === when ? d : withTrigger(d, when)))}
        />
        <SmsTermSheet kind={term} value={draft} onClose={() => setTerm(null)} onApply={(patch) => set(patch)} />
      </ScrollView>
    </BottomSheet>
  );
}
