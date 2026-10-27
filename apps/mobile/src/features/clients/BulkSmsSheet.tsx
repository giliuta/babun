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
// Text comes from the SMS templates of every team the operator sees
// (useTeamTemplates(null), same text once — STORY-089); a
// blank «Свой текст» option lets them type ad-hoc. Recipients without a
// dialable phone are counted out up front (parity with the web sheet).

import { useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { Chip } from "@/components/ui/Chip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole, useTenant } from "@/session/tenant";
import {
  smsErrorText,
  uniqueByBody,
  useSendSmsBulk,
  useSmsAccount,
  useTeamTemplates,
} from "@/features/sms/sms-account";
import { euro } from "@/features/sms/sms-words";
import { acceptSmsInput } from "@/features/sms/sms-compose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import {
  bodyHasNameToken,
  buildBlastSms,
  buildSequentialSms,
  bulkBodyFor,
  bulkFillable,
  bulkProblem,
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
  const { data: templates = [] } = useTeamTemplates(null);
  const [body, setBody] = useState("");
  // Sequential cursor — index of the recipient whose composer opens next.
  const [seqIdx, setSeqIdx] = useState<number | null>(null);
  // ПЛАН «КАЖДОМУ ПО ИМЕНИ» — СНИМОК НА СТАРТЕ. Живой план пересобирается
  // из выбранных клиентов, а список перечитывается, пока человек в
  // «Сообщениях»: порядок мог смениться, и «Дальше» по номеру шага открыло
  // бы переписку соседа.
  const [frozenPlan, setFrozenPlan] = useState<ReturnType<typeof buildSequentialSms> | null>(null);

  // ЧЕРЕЗ СЕРВИС (STORY-089): рассылка с баланса компании, от одной
  // выбранной команды — её имя отправителя стоит подписью. Только владельцу
  // (так решает и база) и только когда у какой-то команды есть имя.
  const toast = useToast();
  const role = useCurrentRole().data;
  const account = useSmsAccount().data;
  const { data: teams = [] } = useTeams();
  const bulk = useSendSmsBulk();
  const senders = account?.senders ?? {};
  const senderTeams = Object.keys(senders);
  const canService = role === "owner" && !!account?.serviceOn && senderTeams.length > 0;
  const [mode, setMode] = useState<"phone" | "service">("phone");
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const viaService = canService && mode === "service";
  const fromTeam = pickedTeam && senders[pickedTeam] ? pickedTeam : (senderTeams[0] ?? null);

  const withPhone = useMemo(
    () => recipients.filter((c) => smsDigits(c).length > 0),
    [recipients],
  );
  const noPhone = recipients.length - withPhone.length;

  // [Компания] — имя своей компании: от её команды идёт и рассылка.
  const company = useTenant().data?.name ?? null;

  // Шаблоны с полями записи или долгом рассылке заполнить нечем — их нет в
  // списке (тем же правилом, что лист SMS у номера гасит незаполняемые).
  const usableTemplates = useMemo(
    () => uniqueByBody(templates.filter((tpl) => tpl.enabled && tpl.body.trim() && bulkFillable(tpl.body))),
    [templates],
  );

  const hasName = bodyHasNameToken(body);
  const problem = visible ? bulkProblem(body, withPhone, company) : null;
  const seqPlan = useMemo(
    () => (visible ? buildSequentialSms(body, withPhone, company, Platform.OS) : []),
    [visible, body, withPhone, company],
  );

  const reset = () => {
    setBody("");
    setSeqIdx(null);
    setFrozenPlan(null);
    setMode("phone");
  };

  // Платное и необратимое — только после вопроса. Сумма — только в вебе:
  // в iOS-приложении о цене молчим (правило App Store).
  const sendViaService = () => {
    if (!fromTeam || !body.trim() || withPhone.length === 0 || problem) return;
    const items = withPhone.flatMap((c) => {
      const text = bulkBodyFor(body, c, company);
      return text ? [{ clientId: c.id, body: text }] : [];
    });
    if (items.length === 0) return;
    const cost = euro(items.length * (account?.priceCents ?? 12));
    confirmThen(
      `Отправить ${items.length} ${countWordRu(items.length, "SMS", "SMS", "SMS")} через сервис?`,
      {
        message:
          Platform.OS === "web"
            ? `От «${senders[fromTeam]}». С баланса спишется от ${cost} — длинные SMS дороже.`
            : `От «${senders[fromTeam]}». Спишется с баланса SMS.`,
        confirmLabel: "Отправить",
      },
      () =>
        bulk.mutate(
          { teamId: fromTeam, items },
          {
            onSuccess: (r) => {
              toast(
                r.skipped > 0
                  ? `Отправляется ${r.queued} · пропущено ${r.skipped}`
                  : `Отправляется ${r.queued} ${countWordRu(r.queued, "SMS", "SMS", "SMS")}`,
                "success",
              );
              onSent();
              close();
            },
            onError: (e) => notify("Рассылка не ушла", smsErrorText(e)),
          },
        ),
    );
  };
  const close = () => {
    reset();
    onClose();
  };
  // НАБРАННЫЙ ТЕКСТ НЕ ПРОПАДАЕТ ОТ СВАЙПА И СКРИМА — сначала вопрос.
  // Отправка (и «Остановить рассылку») закрывает лист сама, без вопроса.
  const guard = useGuardedClose({
    dirty: seqIdx === null && body.trim() !== "",
    busy: bulk.isPending,
    onClose: close,
    message: "Набранный текст рассылки не сохранится.",
  });

  // «Всем сразу» — one composer, all numbers, neutral body.
  const sendBlast = async () => {
    if (problem) return;
    const blast = buildBlastSms(body, withPhone, company, Platform.OS);
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
    if (seqPlan.length === 0 || problem) return;
    setFrozenPlan(seqPlan);
    setSeqIdx(0);
    await openSeq(0, seqPlan);
  };
  const plan = frozenPlan ?? seqPlan;
  const openSeq = async (idx: number, steps = plan) => {
    const step = steps[idx];
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
    if (next >= plan.length) {
      onSent();
      close();
      return;
    }
    setSeqIdx(next);
    await openSeq(next);
  };

  const inSequence = seqIdx !== null;

  return (
    <BottomSheet
      visible={visible && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title="SMS-рассылка"
      subtitle={`${withPhone.length} ${countWordRu(withPhone.length, "получатель", "получателя", "получателей")}${noPhone > 0 ? ` · ${noPhone} без телефона ${countWordRu(noPhone, "пропущен", "пропущены", "пропущены")}` : ""}`}
      // КАНОНИЧЕСКИЙ ЛИСТ, А НЕ СЫРОЙ Modal. Вопрос «Отправить через
      // сервис?» ложится в окно этого листа (`sheet-overlay.tsx`); поверх
      // сырого Modal он был третьим окном, iOS его не показывал, и невидимый
      // вопрос глушил все следующие подтверждения.
      maxHeightRatio={0.86}
      scroll
      // Поле текста и кнопки отправки не уходят под клавиатуру.
      avoidKeyboard
    >
      <View style={{ paddingBottom: Math.max(32, insets.bottom + 12) }}>
        {inSequence ? (
          // ── Sequential progress ──────────────────────────────────────
          <View>
            <Text className="text-sm" style={{ color: t.sub }}>
              Отправка по одному — «Сообщения» открылись для клиента:
            </Text>
            <Text className="mt-1 text-xl font-bold" style={{ color: t.ink }}>
              {plan[seqIdx]?.client.full_name || "Клиент"}
            </Text>
            <Text className="mt-1 text-xs" style={{ color: t.faint }}>
              {(seqIdx ?? 0) + 1} из {plan.length}. Отправьте сообщение в
              «Сообщениях», вернитесь и нажмите «Дальше».
            </Text>
            <View className="mt-4">
              <Button
                label={
                  seqIdx! + 1 >= plan.length
                    ? "Готово"
                    : `Дальше — ${plan[seqIdx! + 1]?.client.full_name || "следующий"}`
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
          // ── Compose ── (листает сам лист: `scroll`)
          <View>
            {canService ? (
              <View className="mb-3">
                <SegmentedControl
                  options={[
                    { value: "phone", label: "С телефона" },
                    { value: "service", label: "Через сервис" },
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              </View>
            ) : null}
            {viaService && senderTeams.length > 1 ? (
              <View className="mb-3">
                <Text className="mb-1.5 text-xs font-semibold" style={{ color: t.faint }}>
                  ОТ КОМАНДЫ
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {senderTeams.map((id) => (
                    <Chip
                      key={id}
                      label={`${teams.find((x) => x.id === id)?.name ?? "Команда"} · ${senders[id]}`}
                      selected={fromTeam === id}
                      radio
                      onPress={() => setPickedTeam(id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
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
                        {active ? <Check color={t.onAccent} size={13} strokeWidth={3} /> : null}
                        <Text
                          className="text-[13px] font-medium"
                          style={{ color: active ? t.onAccent : t.body }}
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
              onChangeText={(next) => setBody(acceptSmsInput(next, body))}
              placeholder="Текст сообщения… можно вставить [Имя]"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              multiline
              maxLength={500}
              className="min-h-[92px] rounded-[10px] px-3 py-2.5 text-base"
              style={{ backgroundColor: t.fill, color: t.ink, textAlignVertical: "top" }}
            />
            {problem ? (
              <Text className="mt-2 text-[11px] leading-snug" style={{ color: t.faint }}>
                {problem}
              </Text>
            ) : null}
            {viaService ? (
              <View className="mt-4">
                <Button
                  label={`Отправить · ${withPhone.length}`}
                  onPress={sendViaService}
                  disabled={!body.trim() || withPhone.length === 0 || !fromTeam || !!problem || bulk.isPending}
                  loading={bulk.isPending}
                />
              </View>
            ) : (
            <>
            <Text className="mt-2 text-[11px] leading-snug" style={{ color: t.faint }}>
              Откроется системное приложение «Сообщения» с текстом — отправку
              подтверждаете там. «Каждому по имени» подставит [Имя] и откроет
              переписки по очереди; «Всем сразу» — одно окно на все номера.
            </Text>

            <View className="mt-4 gap-2">
              <Button
                label={`Каждому по имени · ${seqPlan.length}`}
                onPress={startSequential}
                disabled={!body.trim() || seqPlan.length === 0 || !!problem}
              />
              <Button
                label={`Всем сразу · ${withPhone.length}`}
                variant="secondary"
                onPress={sendBlast}
                disabled={!body.trim() || withPhone.length === 0 || hasName || !!problem}
              />
              {hasName ? (
                <Text className="text-[11px]" style={{ color: t.faint }}>
                  «Всем сразу» недоступно с токеном [Имя] — имя у всех было бы
                  разным. Используйте «Каждому по имени» или уберите [Имя].
                </Text>
              ) : null}
            </View>
            </>
            )}
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
