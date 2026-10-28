import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { levelOf as mapLevelOf } from "@/session/access-map";
import { useAccessBlocks, useMemberAccess } from "@/session/access-queries";
import { roleSummary } from "@/features/access/master-page/role-presets";
import { PersonRow } from "./PeopleRows";

// СТРОКА ПАРТНЁРА В СПИСКЕ: под именем — его роль и сколько у него команд
// («Директор · 5 команд»). Имена команд читались списком без конца и не
// говорили главного — кем человек работает. Роль считается по его карте
// прав (тот же запрос, что у страницы партнёра, — открытие страницы уже
// тёплое); пока карта едет — только число команд.
export function MemberListRow({
  userId,
  name,
  initials,
  tint,
  teamIds,
  onPress,
}: {
  userId: string;
  name: string;
  initials: string;
  tint: string;
  teamIds: readonly string[];
  onPress: () => void;
}) {
  const map = useMemberAccess(userId).data;
  const blocks = useAccessBlocks().data;
  const role =
    map && blocks
      ? roleSummary(blocks, (block, teamId) => mapLevelOf(block, map, teamId ?? ""), teamIds)
      : null;
  const count =
    teamIds.length > 0 ? formatCountRu(teamIds.length, ["команда", "команды", "команд"]) : "Без команды";
  return (
    <PersonRow
      name={name}
      initials={initials}
      tint={tint}
      sub={role ? `${role} · ${count}` : count}
      accessibilityLabel={`${name}, права доступа`}
      onPress={onPress}
    />
  );
}
