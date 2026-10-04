import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
import { useLocalSearchParams } from "expo-router";
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { useClientSettingLevel } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";
import {
  contactWayDef,
  isWayOffered,
  useEnabledWays,
  useReorderWays,
  useToggleWay,
  useWaysOrder,
  type ContactWayId,
} from "@/features/clients/contact-ways";

// «СПОСОБЫ СВЯЗИ» — ОДИН СПИСОК (владелец 2026-09-04: «мы можем это всё в
// одну настройку пихнуть и совместить — зачем „можно добавить в карточку“ или
// „у номера“, ну типа немного странно»).
//
// Страница держала две секции, и WhatsApp с Telegram стояли в ней ДВАЖДЫ, с
// двумя галками: внутри продукта это два разных списка — каналы у номера и
// поля карточки. Различие продукта, а не человека: человек думает «мы
// работаем в WhatsApp».
//
// Теперь галка одна на способ, а что он умеет — сказано подписью строки:
// «у номера», «в карточке» или обе. Правило и перенос старых настроек живут в
// `contact-ways`.

// Строка шестерёнки — за своим правом команды (владелец 01.10).
export default function ClientChannelsScreenRoute() {
  return (
    <ClientSettingsRoute row="ways">
      <ClientChannelsScreen />
    </ClientSettingsRoute>
  );
}

function ClientChannelsScreen() {
  // Набор КОМАНДЫ из адреса (у каждой команды свои настройки клиентов,
  // владелец 30.09); без команды — набор компании.
  const { team } = useLocalSearchParams<{ team?: string }>();
  const teamId = team || null;
  const { data: ownTeams = [] } = useTeams();
  const teamName = ownTeams.find((tm) => tm.id === teamId)?.name;
  // «Только видит»: галки и порядок как есть, без правки.
  const readOnly = useClientSettingLevel("ways", teamId) !== "write";
  const order = useWaysOrder(teamId);
  const enabled = useEnabledWays(teamId);
  const toggle = useToggleWay(teamId);
  const reorder = useReorderWays(teamId);

  // ЗВОНОК В СПИСКЕ НЕ СТОИТ (владелец 2026-09-04: «зачем лишний шум
  // создавать — это можно даже не выбирать, оно идёт как стандарт, вообще
  // убирается, и всё»). Строка «Позвонить · всегда» была строкой-нельзя:
  // галка стоит, тап не работает, приписка объясняет, почему. Настройка — это
  // выбор; звонок по номеру выбором не является и остаётся первым в кнопке
  // связи сам (`pinned` в наборе), просто больше не занимает строку.
  const items = order
    .filter((id) => isWayOffered(id) && contactWayDef(id)?.optional !== false)
    .map((id) => {
      const def = contactWayDef(id);
      return def
        ? {
            id: def.id,
            label: def.label,
            icon: def.icon,
            color: def.color,
            checked: enabled.includes(def.id),
            readOnly,
            onToggle: () => toggle.mutate(def.id),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <ToggleListScreen
      // «Связь» — как строка шестерёнки (02.10, «настройки по функциям»).
      title="Связь"
      subtitle={teamName}
      sections={[
        { items, onReorder: readOnly ? undefined : (ids) => reorder.mutate(ids as ContactWayId[]) },
      ]}
    />
  );
}
