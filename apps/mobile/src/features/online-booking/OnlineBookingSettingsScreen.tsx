import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { CalendarCheck, Link2 } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { useTeams } from "@/features/reference/queries";
import { useCopyValue } from "@/lib/copy-value";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { bookingUrl, durationWords } from "./online-booking";
import { useBookingSettings, useSetBookingEnabled, useSetBookingService } from "./online-booking-settings";

// «ОНЛАЙН-ЗАПИСЬ» КАЛЕНДАРЯ — за шестерёнкой календаря (`?team=`, как
// «Услуги» и «SMS»). Сверху выключатель и ссылка, ниже — какие услуги видны
// заказчику. Главное действие — «Скопировать ссылку» в футере: её ставят в
// Instagram, Google-профиль и на визитку.
//
// Услуги по умолчанию закрыты: публикация прайса — решение владельца, а не
// умолчание базы. Без открытых услуг страница заказчику говорит «закрыта».
//
// Права: страница — только владельцу (шестерёнка не показывает строку
// другим, ступень «/calendar/*» стоит за `manage-calendar-settings`), и все
// три функции базы сами проверяют владельца компании этого календаря.

export function OnlineBookingSettingsScreen() {
  const t = useThemeColors();
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === params.team) ?? teams[0];
  const teamId = team?.id ?? null;
  const settings = useBookingSettings(teamId);
  const setEnabled = useSetBookingEnabled(teamId);
  const setService = useSetBookingService(teamId);
  const copy = useCopyValue();
  const data = settings.data;
  const url = data?.token ? bookingUrl(data.token) : null;
  const openCount = data?.services.filter((s) => s.online).length ?? 0;

  const toggle = (enabled: boolean) =>
    setEnabled.mutate(enabled, { onError: (e) => notify("Ошибка", e.message) });

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Онлайн-запись" subtitle={team?.name} />

      {settings.isLoading ? (
        <EmptyState state="loading" fill />
      ) : settings.isError || !data ? (
        <EmptyState
          state="error"
          fill
          subtitle={settings.error instanceof Error ? settings.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void settings.refetch() }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          <SectionCard>
            <SettingsRow
              tile={SETTINGS_TILE.indigo}
              icon={CalendarCheck}
              title="Онлайн-запись"
              sub={data.enabled ? "Заказчики записываются сами" : "Выключена"}
              toggle={{ value: data.enabled, onChange: toggle, disabled: setEnabled.isPending }}
            />
            {data.enabled && url ? (
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Link2}
                title="Ссылка"
                sub={url.replace(/^https:\/\//, "")}
                // Копирует кнопка футера; удержание строки — тот же жест,
                // что у реквизитов и телефона. Шеврона нет: строка никуда
                // не ведёт.
                onLongPress={() => copy(url)}
              />
            ) : null}
          </SectionCard>

          <SectionCard title="Услуги для записи">
            {data.services.length === 0 ? (
              <Text style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.faint }}>
                В этом календаре пока нет услуг.
              </Text>
            ) : (
              data.services.map((s) => (
                <SwitchRow
                  key={s.id}
                  label={s.name}
                  hint={durationWords(s.duration) || undefined}
                  value={s.online}
                  disabled={setService.isPending}
                  onChange={(online) =>
                    setService.mutate(
                      { serviceId: s.id, online },
                      { onError: (e) => notify("Ошибка", e.message) },
                    )
                  }
                />
              ))
            )}
          </SectionCard>
          {data.enabled && openCount === 0 && data.services.length > 0 ? (
            <Text style={{ paddingHorizontal: GUTTER + 4, marginTop: 8, fontSize: 13, lineHeight: 18, color: t.sub }}>
              Включите хотя бы одну услугу — без неё запись закрыта.
            </Text>
          ) : null}
        </ScrollView>
      )}

      {data?.enabled && url ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Скопировать ссылку" onPress={() => copy(url)} />
        </View>
      ) : null}
    </Screen>
  );
}
