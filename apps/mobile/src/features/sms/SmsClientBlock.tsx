import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { MessageSquare, UserRound } from "lucide-react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { useToast } from "@/components/ui/Toast";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { clientSubParams } from "@/features/clients/clients-company";
import { useReferenceHref } from "@/features/clients/reference-href";
import { moreLabel } from "@/features/clients/more-label";
import { haptics } from "@/lib/haptics";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { firstName } from "@/features/clients/sms-name";
import { useThemeColors } from "@/theme/colors";
import { smsErrorText, useClientSms, useSetClientSmsOptOut, type SmsHistoryItem } from "./sms-account";
import { SmsPlaque } from "./SmsPlaque";
import { SmsMessageSheet } from "./SmsMessageSheet";
import { useTeams } from "@/features/reference/queries";

// БЛОК «SMS» НА СТРАНИЦЕ КЛИЕНТА — ВСЁ ПРО SMS ЭТОМУ КЛИЕНТУ ОДНИМ БЛОКОМ
// (STORY-089; владелец 30.09: «присылать или не присылать — в едином блоке
// SMS… вторая строчка — имя для SMS: компания называется RTX, а номер
// принадлежит Ольге… и история — все SMS по этому клиенту и на какой номер
// ушло: у клиента бывает два-три-четыре номера»).
//
//   • «Присылать SMS» — клиент попросил не писать: сервис ему не пишет ни сам,
//     ни по кнопке. Своя функция базы, а не правка карточки: флаг нельзя
//     стереть офлайн-очередью. Тумблер откликается сразу;
//   • «Имя для SMS» — то, что встаёт в [Имя] (`sms_name`), пишется прямо в
//     строке; пусто — первое слово имени клиента, оно и показано серым;
//   • сообщения — МИНИ-ИСТОРИЯ прямо в блоке (владелец 03.10: «не надо
//     отдельную страницу — мини-блок просто с историей; „Присылать SMS“ и
//     имя — сразу на блоке, чтобы не тапать много раз; отдельная страница —
//     только если их много»): три последних плашками `SmsPlaque` — итог
//     цветом, шаблон, день и время, номер; тап — сообщение целиком. Больше
//     трёх — «Ещё N» в шапке ведёт на страницу всех (`/clients/sms`). Кнопки
//     «Отправить SMS» нет (владелец 03.10: «SMS отправляется исключительно,
//     если нажать на трубку клиента… внизу просто история»).

const HISTORY_LIMIT = 200;
/** Сколько последних сообщений стоит в мини-истории блока. */
const MINI_HISTORY = 3;
const NO_MESSAGES: SmsHistoryItem[] = [];

export function SmsClientBlock({
  client,
  update,
  readOnly = false,
}: {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Сотрудник без «Клиенты: Меняет» — строки видны, но не меняются. */
  readOnly?: boolean;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const subPage = useReferenceHref().clientPage;
  const country = useDefaultCountry(client.team_id ?? null);
  // Компания карточки: клиент работодателя читается под её заголовком.
  const scope = useClientsScopeOrNull();
  const cardTenantId = scope?.tenantId ?? null;
  const log = useClientSms(client.id, HISTORY_LIMIT, cardTenantId);
  const optOut = useSetClientSmsOptOut();
  const [smsOff, setSmsOff] = useState<boolean | null>(null);
  const smsBlocked = smsOff ?? client.sms_opt_out === true;
  // Приехало значение сервера — своё «на время» больше не держим (аудит
  // 03.10: иначе смена с другого устройства пряталась до ухода с экрана).
  useEffect(() => setSmsOff(null), [client.sms_opt_out]);
  const messages = log.data ?? NO_MESSAGES;
  const recent = useMemo(
    () =>
      [...messages]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, MINI_HISTORY),
    [messages],
  );
  const more = moreLabel(messages.length, recent.length);
  const { data: teams = [] } = useTeams();
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  const openAll = () => {
    haptics.tap();
    router.push({ pathname: subPage("sms"), params: clientSubParams(client.id, scope) });
  };
  const smsName = (client.sms_name ?? "").trim();
  const fallbackName = firstName(client);
  // Черновик имени — только пока поле в фокусе; отпустили — запись.
  const nameRef = useRef<TextInput>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const saveName = () => {
    if (nameDraft === null) return;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (next !== smsName) void update({ sms_name: next });
  };
  const setSend = (send: boolean) => {
    setSmsOff(!send);
    optOut.mutate(
      { clientId: client.id, value: !send, tenantId: cardTenantId },
      {
        onError: (e) => {
          setSmsOff(null);
          toast(smsErrorText(e), "error");
        },
      },
    );
  };

  return (
    <>
      <SectionCard
        title="SMS"
        action={more ? { label: more, pill: true, onPress: openAll } : undefined}
      >
        {/* НАСТРОЙКИ — ПЛАШКАМИ СО ЗНАЧКОМ, КАК СООБЩЕНИЯ НИЖЕ (владелец
            03.10 выбрал вариант 1 из трёх: «имя для SMS справа — Артем, только
            под Артёма этот блок»). Значок «Присылать» — зелёный, пока SMS
            идут, и серый, когда клиент просил не писать; вся плашка —
            тумблер. Имя пишется прямо в сером поле справа (владелец 30.09:
            «не шторка — сразу туда можно написать»), сохраняется, когда поле
            отпускают; пусто — первое слово имени клиента серым. */}
        <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4, gap: 2 }}>
          <SelectRow
            icon={MessageSquare}
            color={smsBlocked ? t.faint : t.success}
            plain
            title="Присылать SMS"
            subtitle={smsBlocked ? "Клиент просил не писать" : undefined}
            disabled={readOnly}
            accessibilityLabel={`Присылать SMS: ${smsBlocked ? "нет" : "да"}`}
            accessibilityHint={readOnly ? undefined : "Переключает отправку SMS этому клиенту"}
            onPress={() => {
              if (readOnly || optOut.isPending) return;
              setSend(smsBlocked);
            }}
            trailing={
              // Тумблер — показание: жест собирает плашка (как в SwitchRow),
              // и обёртка держит его ровно по центру строки.
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <SwitchControl value={!smsBlocked} disabled={readOnly} />
              </View>
            }
          />
          <SelectRow
            icon={UserRound}
            // «Только видит» — тише, как «Присылать SMS» над ним: живая синяя
            // плашка обещала правку, которой нет (проверка «его глазами» 03.10).
            color={readOnly ? t.faint : t.accent}
            plain
            title="Имя для SMS"
            disabled={readOnly}
            accessibilityLabel={`Имя для SMS: ${smsName || fallbackName}`}
            onPress={() => nameRef.current?.focus()}
            trailing={
              readOnly ? (
                <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: t.sub, maxWidth: 180 }}>
                  {smsName || fallbackName}
                </Text>
              ) : (
              <View
                style={{
                  minWidth: 96,
                  maxWidth: 180,
                  height: 36,
                  justifyContent: "center",
                  paddingHorizontal: 12,
                  // МЯГКАЯ АКЦЕНТНАЯ ПЛАШКА, А НЕ СЕРОЕ ПОЛЕ (владелец 03.10:
                  // «серенькое — немного не то»): серое с серым именем
                  // читалось пустым и выключенным. Тот же тон, что «Ещё N».
                  borderRadius: t.radius.input,
                  backgroundColor: `${t.accent}14`,
                }}
              >
                {(
                  <TextInput
                    ref={nameRef}
                    value={nameDraft ?? smsName}
                    placeholder={fallbackName || "Имя"}
                    // Подставленное имя — то, что и уйдёт в SMS: тем же цветом,
                    // что заданное, а не серой «пустотой».
                    placeholderTextColor={fallbackName ? t.accent : t.placeholder}
                    selectionColor={t.accent}
                    onFocus={() => setNameDraft(smsName)}
                    onChangeText={setNameDraft}
                    onBlur={saveName}
                    returnKeyType="done"
                    onSubmitEditing={() => nameRef.current?.blur()}
                    autoCapitalize="words"
                    autoCorrect={false}
                    accessibilityLabel="Имя для SMS"
                    maxFontSizeMultiplier={1.3}
                    style={{ fontSize: 15, fontWeight: "600", color: t.accent, textAlign: "right", padding: 0 }}
                  />
                )}
              </View>
              )
            }
          />
        </View>
        {recent.length > 0 ? (
          <>
            <Divider inset={16} />
            <View style={{ paddingHorizontal: 2, paddingTop: 4, paddingBottom: 6 }}>
              {recent.map((item) => (
                <SmsPlaque
                  key={item.id}
                  item={item}
                  withDate
                  phone={item.toPhone ? formatPhoneForDisplay(item.toPhone, country) : null}
                  onPress={() => setOpen(item)}
                />
              ))}
            </View>
          </>
        ) : null}
        {messages.length === 0 && !log.isLoading ? (
          <>
            <Divider inset={16} />
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.sub }}
            >
              Сообщений пока нет
            </Text>
          </>
        ) : null}
      </SectionCard>

      <SmsMessageSheet
        item={open}
        teamName={(teamId) => teams.find((x) => x.id === teamId)?.name ?? null}
        from="client"
        onClose={() => setOpen(null)}
      />
    </>
  );
}

