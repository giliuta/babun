import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Phone, UserRound, X } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { RowActionButton } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { useDefaultCountry } from "@/features/reference/default-country";
import { formatPhoneForDisplay } from "@/lib/phone";
import { visitMark } from "@/features/clients/visit-mark";
import { PhoneVisitLine, visitMarkWords } from "@/features/clients/VisitDate";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { contactsLocked } from "@/session/member-contacts";
import { useRevealedClient } from "@/session/revealed-contacts";
import { useOpenMemberContacts } from "@/features/clients/use-member-contacts";
import { useTenantId } from "@/lib/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// БЛОК «КЛИЕНТ» — ОДИН НА ПРОДУКТ.
//
// Блок общий для записи, события и составителя чека: своя копия у каждого
// разошлась бы (у события завелась бы кнопка «убрать клиента», поля отстояли
// бы на другие отступы). Порядок строк: имя → вводная о человеке → телефон,
// затем кнопка связи и «X».
//
// СТРОКА — КАК В СПИСКЕ КЛИЕНТОВ: такая же карточка клиента, как на странице
// клиентов (имя, номер телефона и дата последнего визита). Долга, числа
// визитов и денег здесь нет — они на странице
// клиента. Под именем — номер и дата цветом, правило `visit-mark.ts`: синяя —
// последний визит, жёлтая — визит не закрыт, серая — записан вперёд.
//
// КАРТОЧКА КЛИЕНТА — ДОЛГИМ НАЖАТИЕМ. Кружка «…» в хвосте строки нет: тап по клиенту —
// выбор, удержание — карточка (VoiceOver — действием «Карточка клиента»).
//
// ЧЕГО БЛОК НЕ ЗНАЕТ. Ни записи, ни события, ни чека. Заметку клиента он не
// пишет сам — её передают готовым узлом (`note`): у записи это поле есть, у
// чека его нет, и блок не должен выбирать за них.
//
// НОМЕР СОТРУДНИКУ — ПО ОДНОМУ (защита базы). Клиент записи у мастера
// приходит без контактов (`contacts_hidden`): на месте цифр «•• ••• •••», а
// кнопка звонка открывает номер дверью с журналом — как на карточке
// клиента (`LockedPhoneRow`). Права нет — строки номера нет. У владельца ключа нет — всё как было.

export function ClientBlock({
  client,
  stats,
  onPick,
  pickOpensCard = false,
  onOpenCard,
  onClear,
  note,
  deletedName,
}: {
  client: Client | null;
  /** Последний визит (или запись вперёд) — дата под именем, как в списке
   *  клиентов. `undefined` — считать нечем, даты нет. */
  stats?: ClientStats;
  /** Нет — клиент записи только читается (STORY-084: одна страница записи
   *  для всех, блок по праву). Звонок и карточка при этом остаются: это
   *  дорога к человеку, а не правка записи. */
  onPick?: () => void;
  /** Тап открывает карточку, а не выбор: клиента держит оплата записи,
   *  подменить его нельзя, править — можно. Меняет только подсказку. */
  pickOpensCard?: boolean;
  /** Удержание строки — карточка клиента. Нет — карточку человеку не открыть. */
  onOpenCard?: () => void;
  /** «X» — снять выбранного. Нет обработчика — нет и кнопки: у записи клиента
   *  меняют выбором другого, а не пустотой. */
  onClear?: () => void;
  /** Заметка клиента под строкой — узлом, а не флагом: блок не решает, чем
   *  её писать. */
  note?: ReactNode;
  /** Клиент записи удалён (`client_id` есть, в рабочем списке его нет) — его
   *  имя, только для подписи. Без него блок звал «Выбрать клиента», будто
   *  человека не было. Тап — выбор другого: удалённого в запись не выбрать. */
  deletedName?: string | null;
}) {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const { open } = useOpenMemberContacts();
  // Открытый номер лежит в памяти — поверх строки окна.
  const shown = useRevealedClient(client, tenantId) ?? null;
  // Номер — в том же виде, что в списке клиентов: страна команды клиента.
  const country = useDefaultCountry(shown?.team_id ?? null);
  // Отступ правого края: с «X» кнопки стоят теснее, иначе три круга подряд
  // упираются в край карточки.
  const gap = onClear ? "mr-2" : "mr-4";
  // Выбирать некого и нечем: блок без клиента в режиме «смотрит» пуст.
  if (!shown && !onPick && !deletedName) return null;
  const locked = shown ? contactsLocked(shown) : false;
  const noPhoneRight = locked && shown?.contacts_hidden === "right";
  // Дата — как в списке клиентов; «Историю записей» закрыли — даты нет.
  const mark =
    shown && clientBlockLevel(shown, "clients.history") !== "hidden" ? visitMark(stats) : null;
  const markWords = mark ? visitMarkWords(mark) : null;

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
            accessibilityLabel={[`Клиент: ${shown.full_name || "без имени"}`, locked ? null : shown.phone, markWords]
              .filter(Boolean)
              .join(". ")}
            accessibilityHint={
              onPick && pickOpensCard
                ? "Открывает карточку клиента"
                : onPick && onOpenCard
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
              {/* НОМЕР И ДАТА ОДНОЙ СТРОКОЙ ПОД ИМЕНЕМ — как в списке клиентов
                  (`ClientRow`): номер серым, за ним дата визита цветом. */}
              <PhoneVisitLine
                phone={
                  noPhoneRight
                    ? null
                    : locked
                      ? "•• ••• •••"
                      : shown.phone
                        ? formatPhoneForDisplay(shown.phone, country)
                        : "без телефона"
                }
                phoneColor={shown.phone || locked ? t.sub : t.placeholder}
                mark={mark}
              />
            </View>
          </Pressable>
          {locked && !noPhoneRight ? (
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
            // удержание — способы связи; 32pt, как маршрут и «…».
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
      ) : deletedName ? (
        <Pressable
          className="px-4 py-2.5"
          disabled={!onPick}
          onPress={
            onPick
              ? () => {
                  onPick();
                  haptics.tap();
                }
              : undefined
          }
          accessibilityRole={onPick ? "button" : "text"}
          accessibilityLabel={[`Клиент: ${deletedName}`, "Клиент удалён"].join(". ")}
          accessibilityHint={onPick ? "Открывает выбор клиента" : undefined}
        >
          <Text style={{ fontSize: 17, fontWeight: "700", color: t.sub }}>{deletedName}</Text>
          <Text style={{ marginTop: 2, fontSize: 13, color: t.sub }}>Клиент удалён</Text>
        </Pressable>
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
