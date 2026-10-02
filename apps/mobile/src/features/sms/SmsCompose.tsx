import { createContext, useContext, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import { usePlanAllows } from "@/features/settings/tenant";
import { smsUrlWithBody, type SmsVars } from "./sms-compose";
import { useSmsAccount } from "./sms-account";

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

/** Где нажали «SMS» — контекст, положенный страницей (карточка клиента,
 *  запись); `null` — номер без контекста (список клиентов). */
export function useSmsComposeContext(): SmsContext | null {
  return useContext(SmsVarsContext);
}

/** Можно ли отсюда отправить через сервис: сервис подключён, баланса
 *  хватает, и есть команда с именем отправителя. Решает всё равно база. */
export interface SmsServiceState {
  available: boolean;
  priceCents: number;
  context: SmsContext | null;
  /** Команды с именем отправителя — от них можно отправить без записи. */
  senderTeams: string[];
  /** Имя отправителя каждой команды. */
  senders: Record<string, string>;
}

/** То же — для места, которое знает запись само (блок «SMS» записи). */
export function useSmsServiceFor(context: SmsContext | null): SmsServiceState {
  const account = useSmsAccount().data;
  const senders = account?.senders ?? {};
  const senderTeams = Object.keys(senders);
  const teamId = context?.teamId;
  // Без тарифа SMS сервиса нет (02.10, SMS — с «Соло»); с телефона — как
  // звонок, это не наш сервис.
  const smsInPlan = usePlanAllows("sms");
  const ready = Boolean(smsInPlan && context?.clientId && account?.serviceOn && account.canPay);
  const available =
    ready && (context?.appointmentId ? Boolean(teamId && senders[teamId]) : senderTeams.length > 0);
  return { available, priceCents: account?.priceCents ?? 10, context, senderTeams, senders };
}

/** Открыть «Сообщения» на номер с готовым текстом. */
export function openSms(url: string, body: string): void {
  void Linking.openURL(smsUrlWithBody(url, body, Platform.OS));
}
