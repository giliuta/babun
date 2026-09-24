import { useMemo, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { smsUrl } from "@babun/shared/common/utils/messenger-links";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FieldLabel } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { fillTemplate } from "./sms-compose";
import { smsErrorText, useSendSmsViaService } from "./sms-account";
import { openSms, useSmsServiceFor, type SmsContext } from "./SmsCompose";
import { priceOf } from "./sms-words";

// «ОТПРАВИТЬ SMS» ИЗ ЗАПИСИ (STORY-089; владелец 25.09: «зашёл в запись,
// нажал кнопку „Отправить SMS“ — и оно сразу отправляет то, что записал…
// вручную»).
//
// Лист открывается уже с готовым текстом: «Запись» — текст «Новая запись»
// команды, заполненный полями этой записи. Рядом — ручные шаблоны, тап
// заменяет текст; текст можно поправить рукой. Одно действие внизу:
//   • сервис подключён и календарь разрешён — «Отправить» уходит сразу,
//     с баланса компании;
//   • иначе (или выбрано «С телефона») — «Сообщения» с этим текстом.
// Второй тап — сам лист: текст виден ДО отправки, платная SMS не уходит
// от случайного касания.

type Mode = "service" | "phone";

const MODES = [
  { value: "service", label: "Через сервис" },
  { value: "phone", label: "С телефона" },
] as const;

export function SmsSendSheet({
  visible,
  context,
  phone,
  confirmBody,
  onClose,
}: {
  visible: boolean;
  context: SmsContext;
  /** Номер клиента — для «С телефона». */
  phone: string | null;
  /** Текст «Новая запись» команды записи (ещё с полями). */
  confirmBody: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const send = useSendSmsViaService();
  const service = useSmsServiceFor(context);
  const templates = useSmsTemplates().data ?? [];

  // Выбор: «Запись» и ручные шаблоны, которые заполнились полями записи.
  const choices = useMemo(() => {
    const out: { id: string; name: string; text: string }[] = [];
    const record = confirmBody ? fillTemplate(confirmBody, context.vars) : null;
    if (record) out.push({ id: "record", name: "Запись", text: record });
    for (const tpl of templates) {
      if (!tpl.enabled || !tpl.body.trim()) continue;
      const text = fillTemplate(tpl.body, context.vars);
      if (text) out.push({ id: tpl.id, name: tpl.name, text });
    }
    return out;
  }, [confirmBody, context.vars, templates]);

  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("service");
  // Черновик — один раз на открытие: пока лист открыт, текстом владеет поле.
  const [seeded, setSeeded] = useState(false);
  if (visible && !seeded) {
    setSeeded(true);
    setPicked(choices[0]?.id ?? null);
    setText(choices[0]?.text ?? "");
    setMode(service.available ? "service" : "phone");
  }
  if (!visible && seeded) setSeeded(false);

  const viaService = service.available && mode === "service";
  const url = smsUrl(phone);
  const encoding = analyzeSmsEncoding(text);
  const body = text.trim();
  const canSend = body.length > 0 && (viaService || !!url);

  const submit = () => {
    haptics.tap();
    onClose();
    if (viaService) {
      send.mutate(
        {
          appointmentId: context.appointmentId ?? null,
          clientId: context.clientId ?? null,
          body,
          templateId: picked && picked !== "record" ? picked : null,
        },
        {
          onSuccess: () => toast("SMS отправляется", "success"),
          onError: (e) => notify("SMS не отправлена", smsErrorText(e)),
        },
      );
      return;
    }
    if (url) setTimeout(() => openSms(url, body), SHEET_EXIT_MS);
  };

  const price =
    viaService && body
      ? Platform.OS === "web"
        ? ` · ${priceOf(encoding.segments, service.priceCents)}`
        : ""
      : "";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="SMS клиенту"
      avoidKeyboard
      scroll
      footer={
        <Button
          label={viaService ? "Отправить" : "Открыть в Сообщениях"}
          onPress={submit}
          disabled={!canSend}
        />
      }
    >
      {service.available ? (
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl options={MODES} value={mode} onChange={setMode} />
        </View>
      ) : null}

      {choices.length > 1 ? (
        <View style={{ marginBottom: 16 }}>
          <FieldLabel text="Текст" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {choices.map((choice) => (
              <Chip
                key={choice.id}
                label={choice.name}
                selected={picked === choice.id}
                radio
                onPress={() => {
                  setPicked(choice.id);
                  setText(choice.text);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ marginBottom: 8 }}>
        {choices.length > 1 ? null : <FieldLabel text="Текст" />}
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            setPicked(null);
          }}
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
        {body ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              marginTop: 6,
              fontSize: 13,
              color: encoding.segments > 1 ? t.warning : t.sub,
              fontVariant: ["tabular-nums"],
            }}
          >
            {`${encoding.length} знаков · ${encoding.segments} SMS${price}`}
          </Text>
        ) : null}
        {!viaService && !url ? (
          <Text maxFontSizeMultiplier={1.2} style={{ marginTop: 6, fontSize: 13, color: t.sub }}>
            У клиента нет номера
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
