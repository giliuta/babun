import { useMemo, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { MessageSquareText, PenLine, Users } from "lucide-react-native";
import { smsUrl } from "@babun/shared/common/utils/messenger-links";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { iconPreset } from "@/components/ui/icon-set";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { acceptSmsInput, fillTemplate } from "./sms-compose";
import {
  smsErrorText,
  useAppointmentLink,
  useSendSmsViaService,
  useTeamTemplates,
  wantsLink,
  type SmsTeamTemplate,
} from "./sms-account";
import { openSms, useSmsServiceFor, type SmsContext } from "./SmsCompose";
import { priceOf } from "./sms-words";

// «ОТПРАВИТЬ SMS» — ОДНА ШТОРКА НА ВЕСЬ ПРОДУКТ (STORY-089; владелец 03.10:
// «нажимаю SMS — можно выбрать сразу шаблон… открывается уже готовый текст,
// который можно редактировать… и напрямую нажимаю „Отправить“… везде функция
// одна и та же… внизу „Своё SMS“ — можно написать что угодно»).
//
// Её открывают: «SMS» у номера клиента (лист «Связаться»), строка «Отправить
// SMS» в блоке SMS записи и карточки клиента, «SMS» в меню записи календаря.
//
// Два шага в одной шторке (две шторки разом iOS не показывает):
//   1. ШАБЛОНЫ — шаблоны команды строками (значок и цвет шаблона, под именем
//      — готовый текст с полями клиента и записи); шаблон, которому не
//      хватает данных («нет записи»), погашен; внизу «Своё SMS»;
//   2. ТЕКСТ — сверху выбранный шаблон (тап — вернуться к шаблонам), «От
//      команды» (если без записи и команд с отправителем несколько), поле с
//      готовым текстом — правится; внизу «Отправить».
// Сервис недоступен (нет тарифа, баланса или имени отправителя) — та же
// кнопка открывает «Сообщения» телефона с этим текстом.

type Step = "pick" | "compose" | "team";

const CUSTOM = "custom";

export function SmsSendSheet({
  visible,
  context,
  phone,
  templates: given,
  name,
  onClose,
}: {
  visible: boolean;
  context: SmsContext;
  /** Номер клиента: через сервис SMS уходит на него, «Сообщения» — тоже. */
  phone: string | null;
  /** Шаблоны команды записи, если позвавший их уже знает; нет — шаблоны
   *  команды отправителя. */
  templates?: readonly SmsTeamTemplate[];
  /** Чей номер, если не самого клиента: [Имя] — его имя. */
  name?: string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const send = useSendSmsViaService();
  const service = useSmsServiceFor(context);
  const { data: teams = [] } = useTeams();

  // ОТ КАКОЙ КОМАНДЫ (владелец 30.09): у записи — её команда; без записи —
  // команда клиента, если у неё есть имя отправителя, иначе первая с именем.
  const fixedTeam = context.appointmentId ? (context.teamId ?? null) : null;
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const defaultTeam =
    context.teamId && service.senders[context.teamId] ? context.teamId : (service.senderTeams[0] ?? context.teamId ?? null);
  const fromTeam = fixedTeam ?? pickedTeam ?? defaultTeam;
  const fetched = useTeamTemplates(given ? null : fromTeam).data;
  const templates = given ?? fetched ?? [];

  const needsLink = templates.some((tpl) => wantsLink(tpl.body));
  const link = useAppointmentLink(context.appointmentId, visible && needsLink).data ?? null;

  // Шаблоны строками: текст, заполненный полями клиента и записи, либо null —
  // данных не хватает (шаблон с датой у клиента без записи).
  const rows = useMemo(() => {
    const vars = { ...context.vars, ...(link ? { Link: link } : null) };
    if (name !== undefined) {
      const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
      if (first) vars.Name = first;
      else delete vars.Name;
    }
    return templates
      .filter((tpl) => tpl.enabled && tpl.body.trim())
      .map((tpl) => ({ template: tpl, text: fillTemplate(tpl.body, vars) }));
  }, [context.vars, link, name, templates]);

  const [step, setStep] = useState<Step>("pick");
  const [picked, setPicked] = useState<string>(CUSTOM);
  const [text, setText] = useState("");
  // Каждое открытие — с шаблонов: прошлый черновик не живёт.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStep("pick");
      setPicked(CUSTOM);
      setText("");
      setPickedTeam(null);
    }
  }

  const chosen = rows.find((row) => row.template.id === picked) ?? null;
  const url = smsUrl(phone);
  const encoding = analyzeSmsEncoding(text);
  const body = text.trim();
  const viaService = service.available;
  const canSend = body.length > 0 && (viaService || !!url);
  const senderName = fromTeam ? service.senders[fromTeam] : null;
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name ?? "Команда";

  const open = (id: string, filled: string) => {
    haptics.tap();
    setPicked(id);
    setText(filled);
    setStep("compose");
  };

  const submit = () => {
    haptics.tap();
    onClose();
    if (viaService) {
      send.mutate(
        {
          appointmentId: context.appointmentId ?? null,
          clientId: context.clientId ?? null,
          body,
          templateId: chosen?.template.id ?? null,
          teamId: fromTeam,
          phone,
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

  const price = viaService && body && Platform.OS === "web" ? ` · ${priceOf(encoding.segments, service.priceCents)}` : "";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={step === "pick" ? "SMS" : step === "team" ? "От команды" : chosen ? chosen.template.name : "Своё SMS"}
      subtitle={step === "pick" && senderName ? `от ${senderName}` : undefined}
      padded={false}
      avoidKeyboard
      scroll
      maxHeightRatio={0.9}
      footer={
        step === "compose" ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button label={viaService ? "Отправить" : "Открыть в Сообщениях"} onPress={submit} disabled={!canSend} />
          </View>
        ) : undefined
      }
    >
      {step === "pick" ? (
        <SelectList>
          {rows.map(({ template, text: filled }) => (
            <SelectRow
              key={template.id}
              icon={iconPreset(template.icon) ?? MessageSquareText}
              color={template.color ?? undefined}
              title={template.name}
              subtitle={filled ?? "Не хватает данных записи"}
              disabled={!filled}
              onPress={() => (filled ? open(template.id, filled) : undefined)}
            />
          ))}
          <SelectRow icon={PenLine} title="Своё SMS" subtitle="Написать любой текст" onPress={() => open(CUSTOM, "")} />
        </SelectList>
      ) : null}

      {step === "team" ? (
        <SelectList>
          {service.senderTeams.map((id) => (
            <SelectRow
              key={id}
              icon={Users}
              color={teams.find((x) => x.id === id)?.color ?? undefined}
              title={teamName(id)}
              subtitle={`Подпись: ${service.senders[id]}`}
              selected={fromTeam === id}
              accessibilityRole="radio"
              onPress={() => {
                haptics.tap();
                setPickedTeam(id);
                setStep("compose");
              }}
            />
          ))}
        </SelectList>
      ) : null}

      {step === "compose" ? (
        <>
          <SelectList>
            <SelectRow
              icon={chosen ? (iconPreset(chosen.template.icon) ?? MessageSquareText) : PenLine}
              color={chosen?.template.color ?? undefined}
              title={chosen ? chosen.template.name : "Своё SMS"}
              subtitle="Другой шаблон"
              accessibilityHint="Вернуться к шаблонам"
              onPress={() => {
                haptics.tap();
                setStep("pick");
              }}
            />
            {viaService && !fixedTeam && service.senderTeams.length > 1 ? (
              <SelectRow
                icon={Users}
                color={teams.find((x) => x.id === fromTeam)?.color ?? undefined}
                title={`От команды · ${teamName(fromTeam)}`}
                subtitle={senderName ? `Подпись: ${senderName}` : undefined}
                onPress={() => {
                  haptics.tap();
                  setStep("team");
                }}
              />
            ) : null}
          </SelectList>
          <View style={{ paddingHorizontal: GUTTER, paddingBottom: 12 }}>
            <TextInput
              value={text}
              onChangeText={(next) => setText(acceptSmsInput(next, text))}
              placeholder="Текст SMS"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              multiline
              autoFocus={!chosen}
              maxLength={1000}
              accessibilityLabel="Текст SMS"
              maxFontSizeMultiplier={1.3}
              style={{
                minHeight: 120,
                maxHeight: 220,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 16,
                lineHeight: 22,
                color: t.ink,
                textAlignVertical: "top",
                borderRadius: t.radius.input,
                borderCurve: "continuous",
                backgroundColor: t.fill,
              }}
            />
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ marginTop: 6, fontSize: 13, color: encoding.segments > 1 ? t.warning : t.sub, fontVariant: ["tabular-nums"] }}
            >
              {body ? `${encoding.length} знаков · ${encoding.segments} SMS${price}` : "До 70 знаков — 1 SMS"}
            </Text>
            {!viaService ? (
              <Text maxFontSizeMultiplier={1.2} style={{ marginTop: 4, fontSize: 13, color: t.sub }}>
                {url ? "Отправится с вашего телефона" : "У клиента нет номера"}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
