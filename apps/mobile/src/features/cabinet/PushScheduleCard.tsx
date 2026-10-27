import { Moon, Sunrise } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import {
  DEFAULT_PUSH_SETTINGS,
  usePushSettings,
  useSavePushSettings,
  type PushSettings,
} from "@/lib/push-settings";

// «СВОДКИ» НА «УВЕДОМЛЕНИЯХ» — настройка человека, а не команды, поэтому
// карточка стоит над лентой команд. Пушем приходит число визитов во всех
// календарях, которые человек видит; по умолчанию выключено.

export function PushScheduleCard() {
  const toast = useToast();
  const { data } = usePushSettings();
  const save = useSavePushSettings();
  const settings = data ?? DEFAULT_PUSH_SETTINGS;
  const set = (patch: Partial<PushSettings>) =>
    save.mutate(patch, {
      onError: (error) => toast(error.message || "Не удалось сохранить", "error"),
    });

  return (
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
  );
}
