import { Fragment } from "react";
import { View } from "react-native";
import {
  Bell,
  BellRing,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Heart,
  Repeat,
  type LucideIcon,
} from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { teamEventState, type SmsAccount, type SmsEvent } from "./sms-model";
import { EVENT_GROUPS, EVENT_TITLES, timingWords } from "./sms-words";

// СОБЫТИЯ SMS СТРОКАМИ (STORY-089): до визита, изменения, после визита.
// Один рисунок на страницу компании и страницу команды — расходится только
// подпись: у компании «За сутки» / «Выключено», у команды ещё «Как у
// компании», «Свой текст», «Не отправлять».

const ICONS: Record<SmsEvent, LucideIcon> = {
  new_appointment: CalendarPlus,
  reminder: Bell,
  reminder_2: BellRing,
  reschedule: CalendarClock,
  cancellation: CalendarX,
  thank_you: Heart,
  repeat: Repeat,
};

/** Подпись события: когда уходит и чей текст. */
export function eventSub(account: SmsAccount, teamId: string, event: SmsEvent): string {
  const company = account.owner?.events.find((e) => e.event === event);
  const when = timingWords(event, company?.timing ?? null);
  if (!teamId) return company?.on ? when : "Выключено";
  const state = teamEventState(account, teamId, event);
  if (state.mode === "off") return "Не отправлять";
  if (state.mode === "on") return `Свой текст · ${when}`;
  return company?.on ? `Как у компании · ${when}` : "Как у компании · выключено";
}

export function SmsEventRows({
  account,
  teamId,
  onOpen,
}: {
  account: SmsAccount;
  /** '' — события компании; иначе — команды. */
  teamId: string;
  onOpen: (event: SmsEvent) => void;
}) {
  return (
    <>
      {EVENT_GROUPS.map((group) => (
        <Fragment key={group.title}>
          <SectionEyebrow>{group.title}</SectionEyebrow>
          <SectionCard>
            {group.events.map((event, index) => (
              <View key={event}>
                {index > 0 ? <Divider inset={48} /> : null}
                <SettingsRow
                  tile="neutral"
                  icon={ICONS[event]}
                  title={EVENT_TITLES[event]}
                  sub={eventSub(account, teamId, event)}
                  onPress={() => onOpen(event)}
                />
              </View>
            ))}
          </SectionCard>
        </Fragment>
      ))}
    </>
  );
}
