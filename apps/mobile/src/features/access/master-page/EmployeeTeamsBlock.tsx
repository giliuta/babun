import { Text, View, Pressable } from "react-native";
import { CalendarRange, ChevronRight, Eye } from "lucide-react-native";

import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { TYPE } from "@/components/ui/tokens";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// БЛОК «КОМАНДЫ» НА СТРАНИЦЕ СОТРУДНИКА (владелец 29.09: «страницу мастера
// перенесём в кабинет… и полноценно на каждую команду, что он может делать,
// что не может»; «в команде один он может видеть клиентов, в команде три —
// нет»). Строка на каждую его команду: плитка цвета, имя и сводка прав В ЭТОЙ
// команде; тап — права команды, свайп — «Убрать» из неё. Внизу — «Добавить в
// команду» и «Посмотреть его глазами».

export function EmployeeTeamsBlock({
  teams,
  line,
  onOpenTeam,
  onRemoveTeam,
  onAddTeam,
  onMirror,
}: {
  /** Его команды, первая — домашняя. */
  teams: readonly Team[];
  /** Итог прав в команде выжимкой (`draftTeamBrief`). Нет — строка только с
   *  именем (карточка без аккаунта: прав у неё ещё нет). */
  line?: (teamId: string) => string;
  onOpenTeam?: (teamId: string) => void;
  onRemoveTeam?: (teamId: string) => void;
  /** Нет — двери «Добавить в команду» нет (все команды уже его). */
  onAddTeam?: () => void;
  onMirror?: () => void;
}) {
  const t = useThemeColors();
  return (
    <SectionCard title="Команды" padded={false}>
      {teams.map((team, i) => (
        <CalendarRightsRow
          key={team.id}
          team={team}
          line={line?.(team.id)}
          separated={i > 0}
          onPress={onOpenTeam ? () => onOpenTeam(team.id) : undefined}
          onDetach={onRemoveTeam ? () => onRemoveTeam(team.id) : undefined}
        />
      ))}
      {teams.length === 0 && !onAddTeam ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.faint }}
        >
          Без команды
        </Text>
      ) : null}
      {onAddTeam ? (
        <View style={teams.length > 0 ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}>
          <ChooseRow compact icon={CalendarRange} label="Добавить в команду" onPress={onAddTeam} />
        </View>
      ) : null}
      {onMirror ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
          <ChooseRow compact icon={Eye} label="Посмотреть его глазами" onPress={onMirror} />
        </View>
      ) : null}
    </SectionCard>
  );
}

/** СТРОКА КАЛЕНДАРЯ С ЕГО ПРАВАМИ. Плитка цвета календаря, имя и одна строка
 *  прав этого календаря; тап — права этого календаря, свайп — открепить. */
function CalendarRightsRow({
  team,
  line,
  separated,
  onPress,
  onDetach,
}: {
  team: Team;
  line?: string;
  separated: boolean;
  onPress?: () => void;
  onDetach?: () => void;
}) {
  const t = useThemeColors();
  const row = (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={line ? `${team.name}: ${line}` : team.name}
      accessibilityHint={onPress ? "Открывает его права в этой команде" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: line ? 60 : 52,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : t.surface,
      })}
    >
      <AppearanceTile color={team.color ?? null} icon={team.icon ?? null} fallback={CalendarRange} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ ...TYPE.callout, color: t.ink }}>
          {team.name}
        </Text>
        {line ? (
          <Text numberOfLines={3} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 17, color: t.sub, marginTop: 2 }}>
            {line}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
    </Pressable>
  );
  return onDetach ? (
    <SwipeRow label="Убрать" color={t.danger} onAction={onDetach} accessibilityLabel={`Убрать из ${team.name}`}>
      {row}
    </SwipeRow>
  ) : (
    row
  );
}
