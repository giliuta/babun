import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import { CalendarClock, CalendarDays, CheckCheck, Clock, Phone, Send, User, Users, Wallet, XCircle } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { usePlanAllows } from "@/features/settings/tenant";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import { notify } from "@/lib/notify";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useThemeColors } from "@/theme/colors";
import { smsErrorText, useSendSmsViaService } from "./sms-account";
import { bucketOf } from "./sms-history-view";
import type { SmsHistoryItem } from "./sms-model";
import { when } from "./SmsHistoryRow";
import { costWords, statusWords, triggerWords } from "./sms-words";

// СООБЩЕНИЕ ЦЕЛИКОМ (STORY-089). Тап по строке истории — в записи, у клиента,
// на странице истории. Лист собран нашим языком (владелец 03.10: «сделать
// дизайн этой шторки в нашем стиле»), как лист шаблона и «Новый объект»:
// блоки с шапкой на прохладном фоне, без пузыря-чата.
//   • шапка листа — шаблон, по которому ушло (нет — повод), под ним — кому;
//   • «ТЕКСТ» — сообщение, как его прочёл клиент;
//   • «ОТПРАВКА» — строки с плиткой: итог (цвет итога), когда, номер,
//     команда, стоимость с частями;
//   • двери к клиенту и записи — только там, где их нет на странице;
//   • действие одно и только у недошедшего — «Отправить ещё раз».

/** Итог — значок и цвет плитки по корзине: дошло, ждёт, не дошло. */
function statusLook(bucket: ReturnType<typeof bucketOf>, waits: boolean): { icon: LucideIcon; tile: string } {
  if (bucket === "delivered") return { icon: CheckCheck, tile: SETTINGS_TILE.green };
  if (bucket === "failed") return { icon: XCircle, tile: SETTINGS_TILE.red };
  return waits ? { icon: Clock, tile: SETTINGS_TILE.orange } : { icon: Send, tile: SETTINGS_TILE.blue };
}

export function SmsMessageSheet({
  item,
  teamName,
  from,
  onClose,
}: {
  /** Открытое сообщение; `null` — лист закрыт. */
  item: SmsHistoryItem | null;
  /** Откуда открыли: из записи дверей нет (клиент и запись — тут же), из
   *  карточки клиента — только «Запись». Нет — страница истории, обе. */
  from?: "record" | "client";
  teamName: (teamId: string | null) => string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const send = useSendSmsViaService();
  const country = useDefaultCountry(item?.teamId ?? null);
  const smsInPlan = usePlanAllows("sms");
  const insets = useSafeAreaInsets();
  // Закрытый лист дорисовывает последнее сообщение, пока уезжает вниз.
  const [shown, setShown] = useState<SmsHistoryItem | null>(item);
  if (item && item !== shown) setShown(item);
  const m = item ?? shown;
  if (!m) return null;

  const bucket = bucketOf(m.status);
  const color = bucket === "failed" ? t.danger : bucket === "delivered" ? t.success : t.warning;
  const waits = m.status === "queued" && m.sendAfter && new Date(m.sendAfter).getTime() > Date.now();
  const look = statusLook(bucket, !!waits);
  const status = waits && m.sendAfter ? `Уйдёт ${when(m.sendAfter)}` : statusWords(m.status);
  const text = m.body ?? m.templateBody ?? "";
  const cost = costWords(m);
  const team = teamName(m.teamId);
  const canResend = bucket === "failed" && !!m.body && !!m.clientId;
  const clientDoor = !!m.clientId && from === undefined;
  const recordDoor = !!m.appointmentId && from !== "record";

  const go = (href: Href) => {
    onClose();
    setTimeout(() => router.push(href), SHEET_EXIT_MS);
  };

  const resend = () => {
    onClose();
    // ТА ЖЕ SMS — ТЕМ ЖЕ ПУТЁМ (аудит 03.10): без записи сервер ищет
    // команду в аргументах и отвечал «SMS в этом календаре выключены» на
    // каждый повтор из карточки и истории; без номера повтор уходил на
    // основной номер клиента, а не на тот, куда слали.
    send.mutate(
      {
        appointmentId: m.appointmentId,
        clientId: m.clientId,
        body: m.body ?? "",
        teamId: m.teamId,
        phone: m.toPhone.trim() || null,
      },
      {
        onSuccess: () => toast("SMS отправляется", "success"),
        onError: (e) => notify("SMS не отправлена", smsErrorText(e)),
      },
    );
  };

  const phone = m.toPhone ? formatPhoneForDisplay(m.toPhone, country) : null;
  const parts = m.segments ? `${m.segments} SMS` : null;
  const price = [cost, parts].filter(Boolean).join(" · ");
  // Строки «Отправки» — что есть, тем и строка: сотруднику номер и цену
  // сервер не отдаёт, пустых строк не рисуем.
  const facts: { icon: LucideIcon; tile: string; title: string; value: string }[] = [
    { icon: CalendarClock, tile: SETTINGS_TILE.indigo, title: "Когда", value: when(m.createdAt) },
    ...(phone ? [{ icon: Phone, tile: SETTINGS_TILE.blue, title: "Номер", value: phone }] : []),
    ...(team ? [{ icon: Users, tile: SETTINGS_TILE.teal, title: "Команда", value: team }] : []),
    ...(price ? [{ icon: Wallet, tile: SETTINGS_TILE.green, title: "Стоимость", value: price }] : []),
  ];

  return (
    <BottomSheet
      visible={!!item}
      onClose={onClose}
      // Шаблон, по которому ушло (владелец 03.10: «название шаблона»); нет —
      // повод. Под ним — кому, если сервер назвал клиента.
      title={m.templateName ?? triggerWords(m.trigger)}
      subtitle={m.clientName ?? undefined}
      padded={false}
      maxHeightRatio={0.9}
      footer={
        canResend ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            <TariffLocked locked={!smsInPlan} beforeNudge={onClose}>
              <Button label="Отправить ещё раз" onPress={resend} />
            </TariffLocked>
          </View>
        ) : undefined
      }
    >
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        // Без футера низ листа — у полосы «домой»: последний блок не липнет к краю.
        contentContainerStyle={{ paddingBottom: canResend ? 12 : Math.max(insets.bottom, 16) }}
      >
        {text ? (
          <SectionCard title="Текст">
            <Text
              selectable
              maxFontSizeMultiplier={1.3}
              style={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14, fontSize: 16, lineHeight: 23, color: t.ink }}
            >
              {text}
            </Text>
          </SectionCard>
        ) : null}

        <SectionCard title="Отправка">
          <SettingsRow
            tile={look.tile}
            icon={look.icon}
            title="Итог"
            value={status}
            valueColor={color}
            sub={bucket === "failed" && m.error ? m.error : undefined}
            subColor={t.danger}
          />
          {facts.map((fact) => (
            <View key={fact.title}>
              <Divider inset={48} />
              <SettingsRow tile={fact.tile} icon={fact.icon} title={fact.title} value={fact.value} />
            </View>
          ))}
        </SectionCard>

        {clientDoor || recordDoor ? (
          <SectionCard>
            {clientDoor ? (
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={User}
                title="Клиент"
                value={m.clientName ?? undefined}
                onPress={() => go(`/clients/${m.clientId}` as Href)}
              />
            ) : null}
            {clientDoor && recordDoor ? <Divider inset={48} /> : null}
            {recordDoor ? (
              <SettingsRow
                tile={SETTINGS_TILE.indigo}
                icon={CalendarDays}
                title="Запись"
                onPress={() => go({ pathname: "/book", params: { appointmentId: m.appointmentId } } as unknown as Href)}
              />
            ) : null}
          </SectionCard>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}
