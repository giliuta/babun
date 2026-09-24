import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import {
  AVAILABLE_TOKENS,
  renderTemplate,
  type SmsTemplate,
  type TemplateKind,
} from "@babun/shared/local/sms-templates";
import { formatDateKey } from "@babun/shared/common/utils/date-utils";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, FieldLabel } from "@/components/ui/Field";
import { useThemeColors } from "@/theme/colors";
import { smsVars } from "./sms-compose";

// ПРАВКА ШАБЛОНА SMS — КАНОНИЧЕСКИЙ ЛИСТ СПРАВОЧНИКА (STORY-089; владелец
// 24.09: «соблюдая нашу архитектуру… по нашему дизайну»). Заведение и правка
// — один лист, как у типа события и метки; действие листа одно — внизу.
// Удаления и «скрыть» здесь нет: они живут на кромках свайпа строки.
//
// Что в листе и почему:
//   • «Название» — как шаблон зовётся в листе «SMS» у номера;
//   • «Текст» — с поля, а поля подставляются сами; под полем — сколько
//     знаков и частей SMS: сервис берёт деньги за часть, а кириллица — 70
//     знаков на часть;
//   • «Вставить» — фишки полей, встают туда, где стоит курсор;
//   • «Готовые» — только у нового и пустого: тап заполняет название и текст;
//   • «Клиент увидит» — текст с подставленным примером.

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

/** Пример для «Клиент увидит»: завтрашняя запись — так текст читается
 *  так же, как клиент прочтёт его в жизни. */
function sampleVars() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return smsVars({
    name: "Анна",
    date: formatDateKey(tomorrow),
    time: "10:00",
    calendar: "Бригада 1",
    services: ["Чистка кондиционера"],
    address: "Лимассол, Arch. Makariou 5",
    total: 80,
    debt: 40,
    company: "Компания",
  });
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
  const t = useThemeColors();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<TemplateKind>("new_appointment");
  const [cursor, setCursor] = useState(0);
  // Черновик берётся у открытой строки ровно один раз: пока лист открыт,
  // значениями владеют поля (тот же приём, что у листа типа события).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = !visible ? null : template ? template.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setName(template?.name ?? "");
    setBody(template?.body ?? "");
    setKind(template?.kind ?? "new_appointment");
    setCursor((template?.body ?? "").length);
  }

  const sample = useMemo(sampleVars, []);
  const preview = body.trim() ? renderTemplate(body, sample) : "";
  const encoding = analyzeSmsEncoding(preview);
  const multipart = encoding.segments > 1;

  const insert = (token: string) => {
    const at = Math.min(cursor, body.length);
    // Токен не липнет к слову: пробел ставится, только если его нет рядом.
    const before = at > 0 && !/\s$/.test(body.slice(0, at)) ? " " : "";
    const next = body.slice(0, at) + before + token + body.slice(at);
    setBody(next);
    setCursor(at + before.length + token.length);
  };

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
                  setCursor(ready.body.length);
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

      <View style={{ marginBottom: 16 }}>
        <FieldLabel text="Текст" />
        <TextInput
          value={body}
          onChangeText={setBody}
          onSelectionChange={(e) => setCursor(e.nativeEvent.selection.start)}
          placeholder="Текст SMS"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          multiline
          maxLength={1000}
          accessibilityLabel="Текст SMS"
          style={{
            minHeight: 112,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 12,
            fontSize: 15,
            lineHeight: 21,
            color: t.ink,
            textAlignVertical: "top",
            borderRadius: t.radius.input,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: t.separator,
          }}
        />
        {preview ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              marginTop: 6,
              fontSize: 13,
              color: multipart ? t.warning : t.sub,
              fontVariant: ["tabular-nums"],
            }}
          >
            {`${encoding.length} знаков · ${encoding.segments} SMS`}
          </Text>
        ) : null}
      </View>

      <View style={{ marginBottom: 16 }}>
        <FieldLabel text="Вставить" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {AVAILABLE_TOKENS.map(({ token, label }) => (
            <Chip
              key={token}
              label={label}
              variant="tint"
              accessibilityLabel={`Вставить поле «${label}»`}
              onPress={() => insert(token)}
            />
          ))}
        </View>
      </View>

      {preview ? (
        <View style={{ marginBottom: 8 }}>
          <FieldLabel text="Клиент увидит" />
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: t.radius.input,
              borderCurve: "continuous",
              backgroundColor: t.rowFill,
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, lineHeight: 21, color: t.ink }}>
              {preview}
            </Text>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
