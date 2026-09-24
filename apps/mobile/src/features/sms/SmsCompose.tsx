import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Linking, Platform, Pressable, Text } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MessageSquare, Settings2 } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { SELECT_SHEET_RATIO, SelectList, SelectRow } from "@/components/ui/select-rows";
import { accessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { useCurrentRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { smsOptions, smsUrlWithBody, type SmsOption, type SmsVars } from "./sms-compose";

// ЧТО ПОДСТАВЛЯТЬ В ШАБЛОН — ОТ ТОГО, ГДЕ НАЖАЛИ «SMS» (STORY-089, волна 1).
//
// Кнопка номера (`PhoneChannelButton`) знает только номер, а шаблону нужны
// запись и клиент. Их кладёт в контекст тот, кто рисует номер: запись — свою
// дату, время и услуги, карточка клиента — имя и долг. Номер без контекста
// (список клиентов) шаблонов не предлагает: подставить нечего.

const SmsVarsContext = createContext<SmsVars | null>(null);

export function SmsComposeProvider({ vars, children }: { vars: SmsVars | null; children: ReactNode }) {
  return <SmsVarsContext.Provider value={vars}>{children}</SmsVarsContext.Provider>;
}

/** Шаблоны, готовые к отправке с этого места. Пусто — когда подставлять
 *  нечего, шаблонов нет или право «Шаблоны SMS» закрыто.
 *
 *  `name` — чей это номер, если не самого клиента страницы: у строки
 *  человека («Екатерина · бухгалтер») [Имя] — её имя, а не клиента. */
export function useSmsOptions(name?: string | null): SmsOption[] {
  const base = useContext(SmsVarsContext);
  const templates = useSmsTemplates().data;
  return useMemo(() => {
    if (!base || !templates) return [];
    const vars: SmsVars = { ...base };
    if (name !== undefined) {
      const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
      if (first) vars.Name = first;
      else delete vars.Name;
    }
    return smsOptions(templates, vars);
  }, [base, name, templates]);
}

/** Может ли человек править шаблоны — тогда у листа есть вход в них. */
export function useCanEditSmsTemplates(): boolean {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return (
    accessGate({ role, map, blockKey: "company.sms_templates", scope: "company" }) === "write"
  );
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
  const canEdit = useCanEditSmsTemplates();
  const pick = (body: string) => {
    haptics.tap();
    onClose();
    // Системное окно «Сообщений» ждёт, пока лист уедет, — как у всех шторок.
    setTimeout(() => openSms(url, body), SHEET_EXIT_MS);
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
              router.push("/cabinet/sms-templates" as Href);
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
      <SelectList>
        {options.map((option) => (
          <TemplateRow key={option.template.id} option={option} onPress={() => pick(option.text)} />
        ))}
        <SelectRow
          icon={MessageSquare}
          title="Своё сообщение"
          onPress={() => pick("")}
        />
      </SelectList>
    </BottomSheet>
  );
}

/** Строка шаблона: имя и ГОТОВЫЙ текст целиком. Общая `SelectRow` держит
 *  однострочную высоту 52 без полей — многострочный текст прижимался к её
 *  краю; здесь строка того же вида, но с полями под абзац. */
function TemplateRow({ option, onPress }: { option: SmsOption; onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${option.template.name}: ${option.text}`}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
      })}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {option.template.name}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ marginTop: 4, fontSize: 14, lineHeight: 19, color: t.body }}
      >
        {option.text}
      </Text>
    </Pressable>
  );
}
