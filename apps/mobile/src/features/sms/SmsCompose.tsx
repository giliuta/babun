import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MessageSquare, Settings2 } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { SELECT_SHEET_RATIO, SelectList, SelectRow } from "@/components/ui/select-rows";
import { accessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { useCurrentRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { smsOptions, smsUrlWithBody, type SmsOption, type SmsVars } from "./sms-compose";
import { smsErrorText, useSendSmsViaService, useSmsAccount } from "./sms-account";
import { priceOf } from "./sms-words";

// ЧТО ПОДСТАВЛЯТЬ В ШАБЛОН — ОТ ТОГО, ГДЕ НАЖАЛИ «SMS» (STORY-089, волна 1).
//
// Кнопка номера (`PhoneChannelButton`) знает только номер, а шаблону нужны
// запись и клиент. Их кладёт в контекст тот, кто рисует номер: запись — свою
// дату, время и услуги, карточка клиента — имя и долг. Номер без контекста
// (список клиентов) шаблонов не предлагает: подставить нечего.

/** Где нажали «SMS»: поля для шаблона и то, что нужно сервису, — запись,
 *  клиент и её календарь (SMS через сервис разрешаются по календарям). */
export interface SmsContext {
  vars: SmsVars;
  appointmentId?: string | null;
  clientId?: string | null;
  teamId?: string | null;
}

const SmsVarsContext = createContext<SmsContext | null>(null);

export function SmsComposeProvider({ context, children }: { context: SmsContext | null; children: ReactNode }) {
  return <SmsVarsContext.Provider value={context}>{children}</SmsVarsContext.Provider>;
}

/** Шаблоны, готовые к отправке с этого места. Пусто — когда подставлять
 *  нечего, шаблонов нет или право «Шаблоны SMS» закрыто.
 *
 *  `name` — чей это номер, если не самого клиента страницы: у строки
 *  человека («Екатерина · бухгалтер») [Имя] — её имя, а не клиента. */
export function useSmsOptions(name?: string | null): SmsOption[] {
  const context = useContext(SmsVarsContext);
  const templates = useSmsTemplates().data;
  return useMemo(() => {
    if (!context || !templates) return [];
    const vars: SmsVars = { ...context.vars };
    if (name !== undefined) {
      const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
      if (first) vars.Name = first;
      else delete vars.Name;
    }
    return smsOptions(templates, vars);
  }, [context, name, templates]);
}

/** Можно ли отсюда отправить через сервис: сервис подключён, владелец
 *  включил отправку, календарь записи среди разрешённых (из карточки без
 *  записи — только владельцу), деньги есть. Решает всё равно база. */
export function useSmsService(): { available: boolean; priceCents: number; context: SmsContext | null } {
  const context = useContext(SmsVarsContext);
  const account = useSmsAccount().data;
  const role = useCurrentRole().data;
  const available = Boolean(
    context?.clientId &&
      account?.serviceOn &&
      account.enabled &&
      account.canPay &&
      (context.teamId ? account.teamIds.includes(context.teamId) : role === "owner"),
  );
  return { available, priceCents: account?.priceCents ?? 10, context };
}

/** Может ли человек править шаблоны — тогда у листа есть вход в них. */
export function useCanEditSmsTemplates(): boolean {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return (
    accessGate({ role, map, blockKey: "company.sms_templates", scope: "company" }) === "write"
  );
}

/** Цена отправки до нажатия. В iOS-приложении о деньгах сервиса молчим
 *  (решение владельца, правило App Store) — там число частей: «2 SMS»;
 *  евро — на сайте. */
function servicePrice(segments: number, priceCents: number): string {
  return Platform.OS === "web" ? priceOf(segments, priceCents) : `${Math.max(1, segments)} SMS`;
}

/** Открыть «Сообщения» на номер с готовым текстом. */
export function openSms(url: string, body: string): void {
  void Linking.openURL(smsUrlWithBody(url, body, Platform.OS));
}

/** ЛИСТ «SMS»: шаблоны, заполненные записью, и пустое сообщение.
 *  Текст виден целиком ДО нажатия (владелец: «ответ виден, один тап»); тап —
 *  «Сообщения» с этим текстом, отправляет человек сам. */
export function SmsTemplateSheet({
  visible,
  title,
  url,
  options,
  onClose,
}: {
  visible: boolean;
  /** Номер, как его диктуют. */
  title: string;
  /** `sms:` номера без текста. */
  url: string;
  options: readonly SmsOption[];
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const canEdit = useCanEditSmsTemplates();
  const service = useSmsService();
  const send = useSendSmsViaService();
  // ДВА ПУТИ ОДНОГО ТЕКСТА (STORY-089): «С телефона» открывает «Сообщения»,
  // «Через сервис» отправляет сам и списывает с баланса. Путь по умолчанию —
  // телефон: он бесплатный, и так было до сервиса.
  const [mode, setMode] = useState<"phone" | "service">("phone");
  const viaService = service.available && mode === "service";
  const pick = (body: string) => {
    haptics.tap();
    onClose();
    // Системное окно «Сообщений» ждёт, пока лист уедет, — как у всех шторок.
    setTimeout(() => openSms(url, body), SHEET_EXIT_MS);
  };
  const sendViaService = (option: SmsOption) => {
    haptics.tap();
    onClose();
    send.mutate(
      {
        appointmentId: service.context?.appointmentId ?? null,
        clientId: service.context?.clientId ?? null,
        body: option.text,
        templateId: option.template.id,
      },
      {
        onSuccess: () => toast("SMS отправляется", "success"),
        onError: (e) => toast(smsErrorText(e), "error"),
      },
    );
  };
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      maxHeightRatio={SELECT_SHEET_RATIO}
      scroll
      title="SMS"
      subtitle={title}
      headerAction={
        canEdit ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClose();
              router.push("/clients/sms-templates" as Href);
            }}
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
    >
      {service.available ? (
        <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}>
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
      <SelectList>
        {options.map((option) => (
          <TemplateRow
            key={option.template.id}
            option={option}
            price={viaService ? servicePrice(analyzeSmsEncoding(option.text).segments, service.priceCents) : undefined}
            onPress={() => (viaService ? sendViaService(option) : pick(option.text))}
          />
        ))}
        {/* Своё сообщение пишется в «Сообщениях» — через сервис уходит
            только готовый текст шаблона, который человек видит здесь. */}
        {!viaService ? (
          <SelectRow
            icon={MessageSquare}
            title="Своё сообщение"
            onPress={() => pick("")}
          />
        ) : null}
      </SelectList>
    </BottomSheet>
  );
}

/** Строка шаблона: имя и ГОТОВЫЙ текст целиком. Общая `SelectRow` держит
 *  однострочную высоту 52 без полей — многострочный текст прижимался к её
 *  краю; здесь строка того же вида, но с полями под абзац. */
function TemplateRow({
  option,
  price,
  onPress,
}: {
  option: SmsOption;
  /** Цена через сервис — видна до нажатия, потому что тап сразу отправляет. */
  price?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${option.template.name}${price ? `, отправить за ${price}` : ""}: ${option.text}`}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {option.template.name}
        </Text>
        {price ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 14, fontWeight: "600", color: t.accent, fontVariant: ["tabular-nums"] }}
          >
            {price}
          </Text>
        ) : null}
      </View>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ marginTop: 4, fontSize: 14, lineHeight: 19, color: t.body }}
      >
        {option.text}
      </Text>
    </Pressable>
  );
}
