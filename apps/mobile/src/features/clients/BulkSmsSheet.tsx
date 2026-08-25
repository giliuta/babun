// BulkSmsSheet — bulk SMS blast to the selected clients (mobile bulk-mode,
// port of the web BulkSmsSheet in app/dashboard/clients/page.tsx).
//
// NOTHING is sent from the app. The system Messages composer is opened
// pre-filled via the sms: URL scheme; the operator taps Send there. Two
// modes (see bulk-sms.ts for the rationale):
//   · «Каждому по имени» — sequential, one composer per recipient, [Имя]
//     personalised. The only native way to get per-person names right.
//   · «Всем сразу» — one composer, comma-joined numbers, a single neutral
//     body. Offered only when the chosen text has no [Имя] token, so the
//     operator never silently loses the personalisation.
//
// Text comes from the operator's own SMS templates (useSmsTemplates); a
// blank «Свой текст» option lets them type ad-hoc. Recipients without a
// dialable phone are counted out up front (parity with the web sheet).

import { useMemo, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, X } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { notify } from "@/lib/notify";
import {
  bodyHasNameToken,
  buildBlastSms,
  buildSequentialSms,
  smsDigits,
} from "./bulk-sms";

export function BulkSmsSheet({
  visible,
  recipients,
  onClose,
  onSent,
}: {
  visible: boolean;
  recipients: Client[];
  onClose: () => void;
  /** Called after a blast is dispatched — the caller exits selection mode. */
  onSent: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const { data: templates = [] } = useSmsTemplates();
  const [body, setBody] = useState("");
  // Sequential cursor — index of the recipient whose composer opens next.
  const [seqIdx, setSeqIdx] = useState<number | null>(null);

  const withPhone = useMemo(
    () => recipients.filter((c) => smsDigits(c).length > 0),
    [recipients],
  );
  const noPhone = recipients.length - withPhone.length;

  const usableTemplates = useMemo(
    () => templates.filter((tpl) => tpl.enabled && tpl.body.trim()),
    [templates],
  );

  const hasName = bodyHasNameToken(body);
  const seqPlan = useMemo(
    () => (visible ? buildSequentialSms(body, withPhone) : []),
    [visible, body, withPhone],
  );

  const reset = () => {
    setBody("");
    setSeqIdx(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  // «Всем сразу» — one composer, all numbers, neutral body.
  const sendBlast = async () => {
    const blast = buildBlastSms(body, withPhone);
    if (!blast) return;
    try {
      await Linking.openURL(blast.url);
      onSent();
      close();
    } catch {
      notify("Не удалось открыть SMS", "Приложение «Сообщения» недоступно.");
    }
  };

  // «Каждому по имени» — open the first composer; on return the operator
  // taps «Дальше» to advance. State-machine so we never fire a burst of
  // openURL the OS would collapse into one.
  const startSequential = async () => {
    if (seqPlan.length === 0) return;
    setSeqIdx(0);
    await openSeq(0);
  };
  const openSeq = async (idx: number) => {
    const step = seqPlan[idx];
    if (!step) return;
    try {
      await Linking.openURL(step.url);
    } catch {
      notify("Не удалось открыть SMS", "Приложение «Сообщения» недоступно.");
    }
  };
  const advanceSeq = async () => {
    if (seqIdx === null) return;
    const next = seqIdx + 1;
    if (next >= seqPlan.length) {
      onSent();
      close();
      return;
    }
    setSeqIdx(next);
    await openSeq(next);
  };

  const inSequence = seqIdx !== null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        className="flex-1"
        style={{ backgroundColor: t.scrim }}
        onPress={close}
        accessible={false}
      />
      <View
        className="absolute bottom-0 left-0 right-0 max-h-[86%] rounded-t-[10px] p-5"
        style={{
          backgroundColor: t.surface,
          paddingBottom: Math.max(32, insets.bottom + 12),
        }}
      >
        <View className="mb-1 flex-row items-center">
          <Text className="flex-1 text-lg font-bold" style={{ color: t.ink }}>
            SMS-рассылка
          </Text>
          <Pressable
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          >
            <X color={t.body} size={ICON.md} />
          </Pressable>
        </View>
        <Text className="mb-3 text-xs" style={{ color: t.sub }}>
          {withPhone.length}{" "}
          {countWordRu(withPhone.length, "получатель", "получателя", "получателей")}
          {noPhone > 0 ? ` · ${noPhone} без телефона пропущены` : ""}
        </Text>

        {inSequence ? (
          // ── Sequential progress ──────────────────────────────────────
          <View>
            <Text className="text-sm" style={{ color: t.sub }}>
              Отправка по одному — «Сообщения» открылись для клиента:
            </Text>
            <Text className="mt-1 text-xl font-bold" style={{ color: t.ink }}>
              {seqPlan[seqIdx]?.client.full_name || "Клиент"}
            </Text>
            <Text className="mt-1 text-xs" style={{ color: t.faint }}>
              {(seqIdx ?? 0) + 1} из {seqPlan.length}. Отправьте сообщение в
              «Сообщениях», вернитесь и нажмите «Дальше».
            </Text>
            <View className="mt-4">
              <Button
                label={
                  seqIdx! + 1 >= seqPlan.length
                    ? "Готово"
                    : `Дальше — ${seqPlan[seqIdx! + 1]?.client.full_name || "следующий"}`
                }
                onPress={advanceSeq}
              />
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Остановить рассылку"
                className="mt-1 min-h-11 items-center justify-center py-2 active:opacity-60"
              >
                <Text className="text-sm" style={{ color: t.sub }}>
                  Остановить рассылку
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          // ── Compose ───────────────────────────────────────────────────
          <ScrollView keyboardShouldPersistTaps="handled">
            {usableTemplates.length > 0 ? (
              <View className="mb-3">
                <Text className="mb-1.5 text-xs font-semibold" style={{ color: t.faint }}>
                  ШАБЛОН
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {usableTemplates.map((tpl) => {
                    const active = body === tpl.body;
                    return (
                      <Pressable
                        key={tpl.id}
                        onPress={() => setBody(tpl.body)}
                        className="flex-row items-center gap-1 rounded-full px-3 py-1.5 active:opacity-70"
                        style={{
                          backgroundColor: active ? t.accent : t.fill,
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Шаблон ${tpl.name}`}
                        accessibilityState={{ selected: active }}
                      >
                        {active ? <Check color="#fff" size={13} strokeWidth={3} /> : null}
                        <Text
                          className="text-[13px] font-medium"
                          style={{ color: active ? "#fff" : t.body }}
                          numberOfLines={1}
                        >
                          {tpl.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

          <TextInput
            value={body}
            accessibilityLabel="Текст SMS"
              onChangeText={setBody}
              placeholder="Текст сообщения… можно вставить [Имя]"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              multiline
              maxLength={500}
              className="min-h-[92px] rounded-[10px] px-3 py-2.5 text-base"
              style={{ backgroundColor: t.fill, color: t.ink, textAlignVertical: "top" }}
            />
            <Text className="mt-2 text-[11px] leading-snug" style={{ color: t.faint }}>
              Откроется системное приложение «Сообщения» с текстом — отправку
              подтверждаете там. «Каждому по имени» подставит [Имя] и откроет
              переписки по очереди; «Всем сразу» — одно окно на все номера.
            </Text>

            <View className="mt-4 gap-2">
              <Button
                label={`Каждому по имени · ${seqPlan.length}`}
                onPress={startSequential}
                disabled={!body.trim() || seqPlan.length === 0}
              />
              <Button
                label={`Всем сразу · ${withPhone.length}`}
                variant="secondary"
                onPress={sendBlast}
                disabled={!body.trim() || withPhone.length === 0 || hasName}
              />
              {hasName ? (
                <Text className="text-[11px]" style={{ color: t.faint }}>
                  «Всем сразу» недоступно с токеном [Имя] — имя у всех было бы
                  разным. Используйте «Каждому по имени» или уберите [Имя].
                </Text>
              ) : null}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
