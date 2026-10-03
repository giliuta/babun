import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MessageSquareText, Settings2, Users } from "lucide-react-native";
import { smsUrl } from "@babun/shared/common/utils/messenger-links";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { iconPreset } from "@/components/ui/icon-set";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { acceptSmsInput, fillTemplate, MAX_SMS_PARTS } from "./sms-compose";
import {
  smsErrorText,
  useAppointmentLink,
  useSendSmsViaService,
  useTeamTemplates,
  wantsLink,
  type SmsTeamTemplate,
} from "./sms-account";
import { openSms, useSmsServiceFor, type SmsContext } from "./SmsCompose";

// «SMS» У ТРУБКИ КЛИЕНТА — ЕДИНСТВЕННАЯ ДВЕРЬ ОТПРАВКИ (STORY-089; владелец
// 03.10: «SMS отправляется исключительно, если нажать на трубку клиента…
// чётко выбираешь шаблон, оно отмечается, и внизу кнопка „Отправить“»).
// Внизу записи и карточки клиента — только история, кнопки там нет.
//
//   • Строки — шаблоны команды: значок и цвет шаблона, под именем — готовый
//     текст с полями клиента и записи. Тап отмечает шаблон галкой; шаблон,
//     которому не хватает данных («нет записи»), погашен. «Своего SMS» нет —
//     «чтоб случайно не тыкали».
//   • Под шаблонами — ТЕКСТ отмеченного шаблона полем: правится сразу, уходит
//     ровно то, что в поле (владелец 03.10: «обязательно превью шаблона,
//     которое я могу сразу редактировать, и только потом отправка»).
//   • Справа в шапке — «палочки с кружочками»: шаблоны команды (владелец:
//     «справа поставить, чтоб сразу переходила в шаблоны»). Страница — общим
//     адресом над табами (`/sms-templates`): «назад» вернёт в запись.
//   • Внизу — ДВЕ ДОРОГИ (владелец 03.10: «кто не хочет платно — со своего
//     телефона… две кнопки… снизу синяя „Отправить от“, сверху — через
//     телефон»): «Со своего телефона» — «Сообщения» телефона с этим текстом,
//     бесплатно; под ней «Отправить от <имя отправителя>» — через сервис, с
//     баланса. Сервиса нет (тариф, баланс, имя отправителя) — остаётся одна
//     «Со своего телефона», синей.
//   • «От команды» — строкой над шаблонами, только без записи и когда команд с
//     именем отправителя несколько (владелец 30.09).

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
  const router = useRouter();
  const toast = useToast();
  const send = useSendSmsViaService();
  const service = useSmsServiceFor(context);
  const { data: teams = [] } = useTeams();
  const role = useCurrentRole().data;

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

  const [choosingTeam, setChoosingTeam] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // Текст в поле — шаблон, заполненный полями, и правки поверх него.
  const [text, setText] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);
  // Каждое открытие — без отметки: прошлый выбор не живёт.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setChoosingTeam(false);
      setPicked(null);
      setText("");
      setPickedTeam(null);
    }
  }

  const chosen = rows.find((row) => row.template.id === picked && row.text) ?? null;
  const body = chosen ? text.trim() : "";
  const encoding = analyzeSmsEncoding(text);
  const url = smsUrl(phone);
  const viaService = service.available;
  const senderName = fromTeam ? service.senders[fromTeam] : null;
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name ?? "Команда";
  // Шаблоны правит тот, кто правит настройки календаря.
  const canEditTemplates = (role === "owner" || role === "dispatcher") && !!fromTeam;

  const sendFromCompany = () => {
    if (!body) return;
    haptics.tap();
    onClose();
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
  };

  const sendFromPhone = () => {
    if (!body || !url) return;
    haptics.tap();
    onClose();
    setTimeout(() => openSms(url, body), SHEET_EXIT_MS);
  };

  const openTemplates = () => {
    if (!fromTeam) return;
    haptics.tap();
    onClose();
    setTimeout(
      () => router.push({ pathname: "/sms-templates", params: { team: fromTeam } } as unknown as Href),
      SHEET_EXIT_MS,
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={choosingTeam ? "От команды" : "SMS"}
      subtitle={!choosingTeam && viaService && senderName ? `от ${senderName}` : undefined}
      padded={false}
      scroll
      scrollRef={scrollRef}
      avoidKeyboard
      maxHeightRatio={0.9}
      headerAction={
        canEditTemplates && !choosingTeam ? (
          <Pressable
            onPress={openTemplates}
            accessibilityRole="button"
            accessibilityLabel="Шаблоны SMS"
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Settings2 color={t.sub} size={20} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
      footer={
        choosingTeam ? undefined : (
          <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
            {url ? (
              <Button
                label="Со своего телефона"
                variant={viaService ? "secondary" : "primary"}
                onPress={sendFromPhone}
                disabled={!body}
              />
            ) : null}
            {viaService ? (
              <Button
                label={senderName ? `Отправить от ${senderName}` : "Отправить"}
                onPress={sendFromCompany}
                disabled={!body}
              />
            ) : null}
          </View>
        )
      }
    >
      {choosingTeam ? (
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
                if (id !== fromTeam) {
                  setPicked(null);
                  setText("");
                }
                setPickedTeam(id);
                setChoosingTeam(false);
              }}
            />
          ))}
        </SelectList>
      ) : (
        <SelectList>
          {viaService && !fixedTeam && service.senderTeams.length > 1 ? (
            <SelectRow
              icon={Users}
              color={teams.find((x) => x.id === fromTeam)?.color ?? undefined}
              title={`От команды · ${teamName(fromTeam)}`}
              onPress={() => {
                haptics.tap();
                setChoosingTeam(true);
              }}
            />
          ) : null}
          {rows.map(({ template, text }) => (
            <SelectRow
              key={template.id}
              icon={iconPreset(template.icon) ?? MessageSquareText}
              color={template.color ?? undefined}
              title={template.name}
              subtitle={text ?? "Не хватает данных записи"}
              disabled={!text}
              selected={picked === template.id}
              accessibilityRole="radio"
              onPress={() => {
                if (!text) return;
                haptics.tap();
                setPicked(template.id);
                setText(text);
                // Поле текста — под шаблонами: докручиваем к нему.
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
              }}
            />
          ))}
          {rows.length === 0 ? (
            <Text maxFontSizeMultiplier={1.3} style={{ paddingHorizontal: GUTTER, paddingVertical: 14, fontSize: 15, color: t.sub }}>
              Шаблонов пока нет
            </Text>
          ) : null}
        </SelectList>
      )}
      {!choosingTeam && chosen ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 12 }}>
          <TextInput
            value={text}
            // Без эмодзи и не длиннее 3 SMS — то же правило, что у шаблона.
            onChangeText={(next) => setText(acceptSmsInput(next, text))}
            placeholder="Текст SMS"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            multiline
            maxLength={1000}
            accessibilityLabel="Текст SMS"
            maxFontSizeMultiplier={1.3}
            style={{
              minHeight: 110,
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
            style={{
              marginTop: 6,
              fontSize: 13,
              color: encoding.segments > 1 ? t.warning : t.sub,
              fontVariant: ["tabular-nums"],
            }}
          >
            {body
              ? `${encoding.length} знаков · ${encoding.segments} SMS${encoding.segments >= MAX_SMS_PARTS ? " — предел" : ""}`
              : "Текст пустой"}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}
