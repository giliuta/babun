import { ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { TYPE } from "@/components/ui/tokens";
import { useTeams } from "@/features/reference/queries";
import { ROLE_LABELS, isUserRole } from "@/features/settings/role-policy";
import { useThemeColors } from "@/theme/colors";

import {
  LEVEL_WORD,
  accessChange,
  levelOf,
  refusalOf,
  sectionsFor,
  type AccessBlock,
  type AccessLevel,
  type AccessRefusal,
} from "./access-map";
import {
  AccessRequestError,
  useAccessBlocks,
  useCalendarMembers,
  useMemberAccess,
  useSetMemberAccess,
  type CalendarMember,
} from "./queries";
import { roleAccessNotice } from "./role-access-notice";

// ПРАВА СОТРУДНИКА В КАЛЕНДАРЕ (STORY-081). Вид выбран владельцем 14.09 после
// трёх кругов вариантов на симуляторе: название блока слева, канонический
// `SegmentedControl` справа, слова «Скрыт · Смотрит · Меняет». Значки
// отклонены правилом DS §5: у кнопки из одного глифа должно быть слово.
//
// Переключил — применилось (`set_member_access`), кнопки «Сохранить» нет.
// Блок, который сервер ещё не проверяет (`live = false`), показан, но заперт:
// галочка без замка на сервере — пустое обещание.
//
// Пока заперты ВСЕ блоки, над разделами стоит строка о том, что действует на
// самом деле: доступ задаёт роль (`role-access-notice.ts`). Иначе экран
// говорил бы «Скрыт», пока диспетчер видит записи и телефоны.

const REFUSAL_TEXT: Record<AccessRefusal, string> = {
  not_live: "Этот раздел прав ещё не включён",
  not_owner: "Права сотрудников настраивает владелец",
  target_owner: "Права владельца не меняются",
  not_attached: "Сотрудник не прикреплён к этому календарю",
  not_member: "Сотрудник больше не работает в компании",
  other: "Не удалось сохранить права",
};

const refusalFor = (error: unknown): AccessRefusal =>
  error instanceof AccessRequestError ? refusalOf(error) : "other";

function PersonCard({ member }: { member: CalendarMember }) {
  const t = useThemeColors();
  return (
    <SectionCard title="Сотрудник" padded>
      <Text style={{ ...TYPE.headline, color: t.ink }}>{member.name}</Text>
      <Text style={{ ...TYPE.body, color: t.sub }}>{member.email}</Text>
      {member.phone ? (
        <Text style={{ ...TYPE.subhead, color: t.faint }}>
          {member.phoneVerified ? member.phone : `${member.phone} · не подтверждён`}
        </Text>
      ) : null}
    </SectionCard>
  );
}

function BlockRow({
  block,
  level,
  first,
  disabled,
  onChange,
}: {
  block: AccessBlock;
  level: AccessLevel;
  first: boolean;
  disabled: boolean;
  onChange: (level: AccessLevel) => void;
}) {
  const t = useThemeColors();
  // Блок компании в разделе календаря действует во всех календарях сразу —
  // иначе владелец решит, что меняет его только для этого календаря.
  const companyWide =
    block.scope === "company" && (block.area === "calendar" || block.area === "finance");
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 16,
        paddingRight: 8,
        paddingVertical: 4,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.separator,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ ...TYPE.callout, color: t.ink }}>
          {block.title}
        </Text>
        {companyWide ? (
          <Text style={{ ...TYPE.subhead, color: t.sub }}>Во всех календарях</Text>
        ) : null}
      </View>
      <SegmentedControl
        options={block.levels.map((value) => ({ value, label: LEVEL_WORD[value] }))}
        value={level}
        onChange={onChange}
        disabled={disabled}
        style={{ width: 212 }}
      />
    </View>
  );
}

export function MemberAccessScreen({
  userId,
  teamId,
  onBack,
}: {
  userId: string;
  teamId: string;
  onBack: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const blocksQuery = useAccessBlocks();
  const accessQuery = useMemberAccess(userId);
  const membersQuery = useCalendarMembers(teamId);
  const teamsQuery = useTeams();
  const setAccess = useSetMemberAccess(userId);

  const member = membersQuery.data?.find((m) => m.userId === userId);
  const teamName = teamsQuery.data?.find((team) => team.id === teamId)?.name;
  const header = <ScreenHeader title="Права" subtitle={member?.name} onBack={onBack} />;

  const failure = blocksQuery.error ?? accessQuery.error;
  if (failure) {
    const refusal = refusalFor(failure);
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState
          state="error"
          fill
          title={refusal === "other" ? "Не удалось загрузить права" : REFUSAL_TEXT[refusal]}
          action={{
            label: "Повторить",
            onPress: () => {
              void blocksQuery.refetch();
              void accessQuery.refetch();
            },
          }}
        />
      </Screen>
    );
  }

  if (!blocksQuery.data || !accessQuery.data) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  const map = accessQuery.data;
  const sections = sectionsFor(blocksQuery.data);
  const anyLive = sections.some((section) => section.blocks.some((block) => block.live));
  const teams = teamsQuery.data;
  const attachedNames = teams
    ? map.attachedCalendars.map((id) => teams.find((team) => team.id === id)?.name)
    : null;
  const notice = roleAccessNotice(
    member?.role ?? null,
    member && isUserRole(member.role) ? ROLE_LABELS[member.role] : null,
    attachedNames && attachedNames.every((name): name is string => typeof name === "string")
      ? attachedNames
      : null,
  );

  const change = (block: AccessBlock, level: AccessLevel) => {
    setAccess.mutate([accessChange(block, teamId, level)], {
      onError: (error) => toast(REFUSAL_TEXT[refusalFor(error)]),
    });
  };

  return (
    <Screen edges={["top"]}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {member ? <PersonCard member={member} /> : null}
        {anyLive ? null : (
          <Text style={{ ...TYPE.subhead, color: t.sub, paddingHorizontal: 16, paddingTop: 12 }}>
            {notice}
          </Text>
        )}
        {sections.map((section) => (
          <SectionCard
            key={section.area}
            title={
              section.area === "calendar" || section.area === "finance"
                ? `${section.title} · ${teamName ?? "календарь"}`
                : section.title
            }
          >
            {section.blocks.map((block, i) => (
              <BlockRow
                key={block.key}
                block={block}
                first={i === 0}
                level={levelOf(block, map, teamId)}
                disabled={!block.live || setAccess.isPending}
                onChange={(level) => change(block, level)}
              />
            ))}
          </SectionCard>
        ))}
      </ScrollView>
    </Screen>
  );
}
