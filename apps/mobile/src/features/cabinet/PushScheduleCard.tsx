import { useState } from "react";
import { BellOff, Clock, Moon, Sunrise } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import {
  DEFAULT_PUSH_SETTINGS,
  DEFAULT_QUIET,
  quietLabel,
  usePushSettings,
  useSavePushSettings,
  type PushSettings,
} from "@/lib/push-settings";
import { QuietHoursSheet } from "./QuietHoursSheet";

// «СВОДКИ» И «ТИХИЕ ЧАСЫ» НА «УВЕДОМЛЕНИЯХ» — настройки человека, а не
// команды, поэтому карточки стоят над лентой команд. Сводка — число визитов
// во всех календарях, которые человек видит; в тихие часы пуши копятся и
// приходят одной сводкой, когда окно кончится. По умолчанию всё выключено.

export function PushScheduleCard() {
  const toast = useToast();
  const { data } = usePushSettings();
  const save = useSavePushSettings();
  const settings = data ?? DEFAULT_PUSH_SETTINGS;
  const [quietOpen, setQuietOpen] = useState(false);
  const quietOn = settings.quietStart !== null && settings.quietEnd !== null;
  const quietStart = settings.quietStart ?? DEFAULT_QUIET.start;
  const quietEnd = settings.quietEnd ?? DEFAULT_QUIET.end;
  const set = (patch: Partial<PushSettings>) =>
    save.mutate(patch, {
      onError: (error) => toast(error.message || "Не удалось сохранить", "error"),
    });

  return (
    <>
      <SectionCard title="Сводки">
        <SettingsRow
          tile={SETTINGS_TILE.orange}
          icon={Sunrise}
          title="Утром — план на день"
          sub="В 8:00: сколько визитов и первый"
          toggle={{ value: settings.digestMorning, onChange: (v) => set({ digestMorning: v }) }}
        />
        <Divider inset={56} />
        <SettingsRow
          tile={SETTINGS_TILE.indigo}
          icon={Moon}
          title="Вечером — план на завтра"
          sub="В 20:00"
          toggle={{ value: settings.digestEvening, onChange: (v) => set({ digestEvening: v }) }}
        />
      </SectionCard>

      <SectionCard title="Тихие часы">
        <SettingsRow
          tile={SETTINGS_TILE.indigo}
          icon={BellOff}
          title="Не беспокоить"
          sub="Пуши придут одной сводкой"
          toggle={{
            value: quietOn,
            onChange: (v) =>
              set(v ? { quietStart: DEFAULT_QUIET.start, quietEnd: DEFAULT_QUIET.end } : { quietStart: null, quietEnd: null }),
          }}
        />
        {quietOn ? (
          <>
            <Divider inset={56} />
            <SettingsRow
              tile={SETTINGS_TILE.teal}
              icon={Clock}
              title="Время"
              sub={quietLabel(quietStart, quietEnd)}
              onPress={() => setQuietOpen(true)}
            />
          </>
        ) : null}
      </SectionCard>

      <QuietHoursSheet
        visible={quietOpen}
        start={quietStart}
        end={quietEnd}
        onClose={() => setQuietOpen(false)}
        onApply={(start, end) => {
          setQuietOpen(false);
          set(start === end ? { quietStart: null, quietEnd: null } : { quietStart: start, quietEnd: end });
        }}
      />
    </>
  );
}
