import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { MoreHorizontal, UserRound, X } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { ClientHistoryLine } from "@/features/clients/history-line";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
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
// о человеке → телефон), кнопка связи, «…» в карточку и «X» перенесены
// дословно.
//
// ЧЕГО БЛОК НЕ ЗНАЕТ. Ни записи, ни события, ни чека. Заметку клиента он не
// пишет сам — её передают готовым узлом (`note`): у записи это поле есть, у
// чека его нет, и блок не должен выбирать за них.

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
  onPick: () => void;
  onOpenCard: () => void;
  /** «X» — снять выбранного. Нет обработчика — нет и кнопки: у записи клиента
   *  меняют выбором другого, а не пустотой. */
  onClear?: () => void;
  /** Заметка клиента под строкой — узлом, а не флагом: блок не решает, чем
   *  её писать. */
  note?: ReactNode;
}) {
  const t = useThemeColors();
  // Отступ правого края: с «X» кнопки стоят теснее, иначе три круга подряд
  // упираются в край карточки.
  const gap = onClear ? "mr-2" : "mr-4";

  return (
    <SectionCard title="Клиент">
      {client ? (
        <View className="flex-row items-center">
          <Pressable
            className="flex-1 flex-row items-center px-4 py-2.5"
            onPress={() => {
              onPick();
              haptics.tap();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Клиент: ${client.full_name || "без имени"}. ${
              summary ?? client.phone ?? "ещё не обслуживали"
            }`}
            accessibilityHint="Открывает выбор клиента"
          >
            <View className="flex-1">
              <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
                {client.full_name || "Без имени"}
              </Text>
              {/* ПОРЯДОК КАК В СПИСКЕ КЛИЕНТОВ: имя, деньги, связь. Раньше
                  история ВЫТЕСНЯЛА телефон — у постоянного клиента номер из
                  записи пропадал вовсе. */}
              <ClientHistoryLine client={client} stats={stats} />
              <Text
                style={{
                  fontSize: 13,
                  color: client.phone ? t.sub : t.placeholder,
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                {client.phone ?? "без телефона"}
              </Text>
            </View>
          </Pressable>
          {client.phone ? (
            // Та же кнопка, что у номера в карточке и в списке: тап звонит,
            // удержание — способы связи; 32pt, как маршрут и «…» (владелец
            // 2026-09-06).
            <View className={`${gap} self-center`}>
              <PhoneChannelButton
                number={client.phone}
                telegramUsername={client.telegram_username}
                label={client.full_name || undefined}
              />
            </View>
          ) : null}
          {/* «…» — карточка клиента: телефоны, объекты, история, долг.
              Снаружи нажимаемой области строки, иначе VoiceOver склеит их в
              один элемент. */}
          <Pressable
            onPress={onOpenCard}
            className={`${gap} items-center justify-center self-center rounded-full`}
            style={{ width: 32, height: 32, backgroundColor: t.rowFill }}
            accessibilityRole="button"
            accessibilityLabel={`Карточка клиента ${client.full_name || "без имени"}`}
          >
            <MoreHorizontal color={t.body} size={ICON.sm} />
          </Pressable>
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
          onPress={onPick}
        />
      )}
      {client ? note : null}
    </SectionCard>
  );
}
