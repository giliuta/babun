import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Phone, UserRound, X } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { RowActionButton } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { ClientHistoryLine } from "@/features/clients/history-line";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { contactsLocked } from "@/features/clients/member-contacts";
import { useRevealedClient } from "@/features/clients/revealed-contacts";
import { useOpenMemberContacts } from "@/features/clients/use-member-contacts";
import { useTenantId } from "@/lib/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// БЛОК «КЛИЕНТ» — ОДИН НА ПРОДУКТ.
//
// Жил разметкой внутри `app/book/index.tsx`, и жил ДВАЖДЫ: своя копия у
// записи, своя у события. Копии уже начали расходиться (у события завелась
// кнопка «убрать клиента», а поля отстояли на другие отступы) — ровно то, что
// случается со всякой скопированной разметкой.
//
// Вынесен 2026-09-20, когда владелец попросил тот же блок в составителе чека:
// «не надо создавать с нуля что-то новое, копируй то, что мы уже создали».
// Третьей копии заводить было нельзя, поэтому блок стал компонентом, а обе
// прежние копии — его вызовами. Вид не менялся: порядок строк (имя → вводная
// о человеке → телефон), кнопка связи и «X» перенесены дословно.
//
// КАРТОЧКА КЛИЕНТА — ДОЛГИМ НАЖАТИЕМ (владелец 03.10: «убери эти три точки…
// чтобы зайти в карточку клиента — зажать на клиента, а если один раз нажать —
// выбор клиента»). Кружка «…» в хвосте строки больше нет: тап по клиенту —
// выбор, удержание — карточка (VoiceOver — действием «Карточка клиента»).
//
// ЧЕГО БЛОК НЕ ЗНАЕТ. Ни записи, ни события, ни чека. Заметку клиента он не
// пишет сам — её передают готовым узлом (`note`): у записи это поле есть, у
// чека его нет, и блок не должен выбирать за них.
//
// НОМЕР СОТРУДНИКУ — ПО ОДНОМУ (защита базы 30.09). Клиент записи у мастера
// приходит без контактов (`contacts_hidden`): на месте цифр «•• ••• •••», а
// прежняя кнопка звонка открывает номер дверью с журналом — как на карточке
// клиента (`LockedPhoneRow`). «В день записи» — словами, без кнопки; права
// нет — строки номера нет. У владельца ключа нет — всё как было.

export function ClientBlock({
  client,
  stats,
  summary,
  onPick,
  onOpenCard,
  onClear,
  note,
}: {
  client: Client | null;
  /** Долг, визиты, деньги, последний визит — вводная о человеке (владелец
   *  2026-09-04). `undefined` — считать нечем, строка просто не появится. */
  stats?: ClientStats;
  /** Вводная о человеке ОДНОЙ СТРОКОЙ для VoiceOver — тем же текстом, что в
   *  списке выбора (`clientHistoryText`): долг идёт первым. Глазами её
   *  показывает `ClientHistoryLine`, но экранный читатель видит только
   *  подпись строки, и без этого он терял самое важное. */
  summary?: string | null;
  /** Нет — клиент записи только читается (STORY-084: одна страница записи
   *  для всех, блок по праву). Звонок и карточка при этом остаются: это
   *  дорога к человеку, а не правка записи. */
  onPick?: () => void;
  /** Удержание строки — карточка клиента. Нет — карточку человеку не открыть. */
  onOpenCard?: () => void;
  /** «X» — снять выбранного. Нет обработчика — нет и кнопки: у записи клиента
   *  меняют выбором другого, а не пустотой. */
  onClear?: () => void;
  /** Заметка клиента под строкой — узлом, а не флагом: блок не решает, чем
   *  её писать. */
  note?: ReactNode;
}) {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const { open } = useOpenMemberContacts();
  // Открытый номер лежит в памяти — поверх строки окна.
  const shown = useRevealedClient(client, tenantId) ?? null;
  // Отступ правого края: с «X» кнопки стоят теснее, иначе три круга подряд
  // упираются в край карточки.
  const gap = onClear ? "mr-2" : "mr-4";
  // Выбирать некого и нечем: блок без клиента в режиме «смотрит» пуст.
  if (!shown && !onPick) return null;
  const locked = shown ? contactsLocked(shown) : false;
  const lockedDay = locked && shown?.contacts_hidden === "day";
  const noPhoneRight = locked && shown?.contacts_hidden === "right";

  return (
    <SectionCard title="Клиент">
      {shown ? (
        <View className="flex-row items-center">
          <Pressable
            className="flex-1 flex-row items-center px-4 py-2.5"
            disabled={!onPick && !onOpenCard}
            onPress={
              onPick
                ? () => {
                    onPick();
                    haptics.tap();
                  }
                : undefined
            }
            onLongPress={
              onOpenCard
                ? () => {
                    haptics.tap();
                    onOpenCard();
                  }
                : undefined
            }
            accessibilityRole={onPick || onOpenCard ? "button" : "text"}
            accessibilityLabel={`Клиент: ${shown.full_name || "без имени"}. ${
              summary ?? shown.phone ?? "ещё не обслуживали"
            }`}
            accessibilityHint={
              onPick && onOpenCard
                ? "Открывает выбор клиента; удерживайте — карточка клиента"
                : onPick
                  ? "Открывает выбор клиента"
                  : onOpenCard
                    ? "Удерживайте — карточка клиента"
                    : undefined
            }
            accessibilityActions={onOpenCard ? [{ name: "longpress", label: "Карточка клиента" }] : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "longpress") onOpenCard?.();
            }}
          >
            <View className="flex-1">
              <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
                {shown.full_name || "Без имени"}
              </Text>
              {/* ПОРЯДОК КАК В СПИСКЕ КЛИЕНТОВ: имя, деньги, связь. Раньше
                  история ВЫТЕСНЯЛА телефон — у постоянного клиента номер из
                  записи пропадал вовсе. */}
              <ClientHistoryLine client={shown} stats={stats} />
              {noPhoneRight ? null : (
                <Text
                  style={{
                    fontSize: 13,
                    color: shown.phone || locked ? t.sub : t.placeholder,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {lockedDay
                    ? "Номер откроется в день записи"
                    : locked
                      ? "•• ••• •••"
                      : shown.phone || "без телефона"}
                </Text>
              )}
            </View>
          </Pressable>
          {locked && !lockedDay && !noPhoneRight ? (
            // Номер ещё не открыт: та же кнопка на том же месте открывает его
            // (журнал видит владелец), дальше строка — обычная.
            <View className={`${gap} self-center`}>
              <RowActionButton
                icon={Phone}
                color={t.accent}
                label="Открыть номер"
                hint="Каждое открытие видно владельцу"
                onPress={() => {
                  if (shown) void open(shown);
                }}
              />
            </View>
          ) : shown.phone ? (
            // Та же кнопка, что у номера в карточке и в списке: тап звонит,
            // удержание — способы связи; 32pt, как маршрут и «…» (владелец
            // 2026-09-06).
            <View className={`${gap} self-center`}>
              <PhoneChannelButton
                number={shown.phone}
                telegramUsername={shown.telegram_username}
                label={shown.full_name || undefined}
                teamId={shown.team_id ?? null}
              />
            </View>
          ) : null}
          {onClear ? (
            <Pressable
              onPress={() => {
                onClear();
                haptics.tap();
              }}
              className="mr-4 items-center justify-center self-center rounded-full"
              style={{ width: 32, height: 32, backgroundColor: t.rowFill }}
              accessibilityRole="button"
              accessibilityLabel="Убрать клиента"
            >
              <X color={t.body} size={ICON.sm} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ChooseRow
          icon={UserRound}
          label="Выбрать клиента"
          hint="Открывает поиск по имени или телефону"
          onPress={onPick ?? (() => {})}
        />
      )}
      {shown ? note : null}
    </SectionCard>
  );
}
