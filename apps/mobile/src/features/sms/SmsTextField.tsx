import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { AVAILABLE_TOKENS, renderTemplate } from "@babun/shared/local/sms-templates";
import { formatDateKey } from "@babun/shared/common/utils/date-utils";
import { Chip } from "@/components/ui/Chip";
import { FieldLabel } from "@/components/ui/Field";
import { useThemeColors } from "@/theme/colors";
import { smsVars } from "./sms-compose";

// ТЕКСТ SMS — ОДНО ПОЛЕ НА ВСЕ ЛИСТЫ (STORY-089): шаблон ручной отправки и
// текст события (новая запись, напоминание, отмена…) пишутся одинаково.
//   • «Текст» — поле; под ним — сколько знаков и частей SMS: сервис берёт
//     деньги за часть, а кириллица — 70 знаков на часть;
//   • «Вставить» — фишки полей, встают туда, где стоит курсор;
//   • «Клиент увидит» — текст с подставленным примером.

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

export function SmsTextField({
  value,
  onChange,
  editable = true,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Только показать: текст компании у команды «как у компании». */
  editable?: boolean;
}) {
  const t = useThemeColors();
  const [cursor, setCursor] = useState(value.length);
  const sample = useMemo(sampleVars, []);
  const preview = value.trim() ? renderTemplate(value, sample) : "";
  const encoding = analyzeSmsEncoding(preview);
  const multipart = encoding.segments > 1;

  const insert = (token: string) => {
    const at = Math.min(cursor, value.length);
    // Токен не липнет к слову: пробел ставится, только если его нет рядом.
    const before = at > 0 && !/\s$/.test(value.slice(0, at)) ? " " : "";
    onChange(value.slice(0, at) + before + token + value.slice(at));
    setCursor(at + before.length + token.length);
  };

  return (
    <>
      {editable ? (
        <View style={{ marginBottom: 16 }}>
          <FieldLabel text="Текст" />
          <TextInput
            value={value}
            onChangeText={onChange}
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
      ) : null}

      {editable ? (
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
      ) : null}

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
          {!editable ? (
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ marginTop: 6, fontSize: 13, color: multipart ? t.warning : t.sub, fontVariant: ["tabular-nums"] }}
            >
              {`${encoding.length} знаков · ${encoding.segments} SMS`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
