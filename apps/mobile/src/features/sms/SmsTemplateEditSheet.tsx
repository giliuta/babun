import { useState } from "react";
import { View } from "react-native";
import type { SmsTemplate, TemplateKind } from "@babun/shared/local/sms-templates";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, FieldLabel } from "@/components/ui/Field";
import { SmsTextField } from "./SmsTextField";

// ПРАВКА ШАБЛОНА SMS — КАНОНИЧЕСКИЙ ЛИСТ СПРАВОЧНИКА (STORY-089; владелец
// 24.09: «соблюдая нашу архитектуру… по нашему дизайну»). Заведение и правка
// — один лист, как у типа события и метки; действие листа одно — внизу.
// Удаления и «скрыть» здесь нет: они живут на кромках свайпа строки.
//
// Что в листе и почему:
//   • «Название» — как шаблон зовётся в листе «SMS» у номера;
//   • «Текст», «Вставить», «Клиент увидит» — общее поле `SmsTextField`
//     (тем же полем пишется текст события на странице SMS);
//   • «Готовые» — только у нового и пустого: тап заполняет название и текст.

/** Готовые тексты: короткие, чтобы укладываться в одну-две части. */
const READY: readonly { id: string; kind: TemplateKind; name: string; body: string }[] = [
  {
    id: "confirm",
    kind: "new_appointment",
    name: "Подтверждение",
    body: "[Имя], запись подтверждена: [Дата], [Время]. Адрес: [Адрес]. [Компания]",
  },
  {
    id: "reminder",
    kind: "reminder",
    name: "Напоминание",
    body: "[Имя], напоминаем: [День], [Дата] в [Время] — [Услуга]. [Компания]",
  },
  {
    id: "thanks",
    kind: "after_24h_short",
    name: "Спасибо",
    body: "[Имя], спасибо, что выбрали нас! Будем рады снова помочь. [Компания]",
  },
  {
    // «Еду к вам» — мастер шлёт из записи, когда выехал (так у Jobber,
    // Housecall Pro, ServiceM8 — разбор STORY-089).
    id: "on_the_way",
    kind: "reminder",
    name: "Еду к вам",
    body: "[Имя], мастер выехал и будет у вас в течение часа. [Компания]",
  },
  {
    id: "debt",
    kind: "debt",
    name: "Долг",
    body: "[Имя], напоминаем об оплате [Сумма]. Спасибо! [Компания]",
  },
];

export interface SmsTemplateDraft {
  name: string;
  body: string;
  kind: TemplateKind;
}

export function SmsTemplateEditSheet({
  visible,
  template,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** Правим этот шаблон; `null` — заводим новый. */
  template: SmsTemplate | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: SmsTemplateDraft) => void;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<TemplateKind>("new_appointment");
  // Черновик берётся у открытой строки ровно один раз: пока лист открыт,
  // значениями владеют поля (тот же приём, что у листа типа события).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = !visible ? null : template ? template.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setName(template?.name ?? "");
    setBody(template?.body ?? "");
    setKind(template?.kind ?? "new_appointment");
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={template ? "Шаблон SMS" : "Новый шаблон"}
      avoidKeyboard
      scroll
      footer={
        <Button
          label={template ? "Сохранить" : "Создать"}
          onPress={() => onSubmit({ name: name.trim(), body: body.trim(), kind })}
          disabled={!name.trim() || !body.trim() || busy}
          loading={busy}
        />
      }
    >
      {!template && !body.trim() ? (
        <View style={{ marginBottom: 16 }}>
          <FieldLabel text="Готовые" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {READY.map((ready) => (
              <Chip
                key={ready.id}
                label={ready.name}
                onPress={() => {
                  setName(ready.name);
                  setBody(ready.body);
                  setKind(ready.kind);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Field
        label="Название"
        placeholder="Название шаблона"
        value={name}
        onChangeText={setName}
        maxLength={60}
        autoFocus={!template}
        returnKeyType="next"
      />

      <SmsTextField value={body} onChange={setBody} />
    </BottomSheet>
  );
}
