import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { BadgeCheck, EyeOff, RotateCcw, Trash2, Wallet } from "lucide-react-native";
import { AppearanceTile, appearanceRowFill } from "@/components/ui/AppearanceSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  balanceWarning,
  orderTemplates,
  useDeleteTeamTemplate,
  useReorderTeamTemplates,
  useSetTeamTemplateEnabled,
  useSmsAccount,
  useTeamTemplates,
  whenWords,
  type SmsTeamTemplate,
} from "./sms-account";
import { SmsSenderSheet } from "./SmsSenderSheet";
import { SmsTemplateSheet } from "./SmsTemplateSheet";
import { balanceWords, euro } from "./sms-words";

// SMS КОМАНДЫ — В НАСТРОЙКАХ КАЛЕНДАРЯ (STORY-089; владелец 29.09: «первый
// блок — баланс одним блоком, внизу шаблоны… аналитику — в балансе… тут
// просто сверху баланс, всё сказано, и внизу кнопка „Добавить шаблон“»).
//
//   • БАЛАНС — общий у компании, одна строка-дверь в Кабинет → SMS, где
//     пополнение, отправка по командам, счёт месяца и история;
//   • ОТПРАВИТЕЛЬ — имя, которым SMS команды подписана у клиента (волна
//     10); без него команда не отправляет;
//   • ШАБЛОНЫ — справочник по канону меток и типов событий: строка залита
//     цветом шаблона, значок, имя и «когда»; ручка порядка справа; тап —
//     шторка шаблона (03.10, снова шторка — как объекты); смахнуть влево (правая кромка) — «Удалить», вправо
//     (левая кромка) — «Скрыть» / «Показать». Скрытый гаснет и уходит вниз:
//     сам не отправляется и в листе «SMS клиенту» не стоит;
//   • «Добавить шаблон» — внизу и всегда.

/** Высота строки — по ней ручка считает перелёт через соседей. */
const ROW_H = 60;

type Editing = { mode: "create" } | { mode: "edit"; template: SmsTeamTemplate } | null;

export function SmsTeamScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === params.team) ?? teams[0];
  const teamId = team?.id ?? "";
  const account = useSmsAccount();
  const templates = useTeamTemplates(teamId || null);
  const toggle = useSetTeamTemplateEnabled();
  const remove = useDeleteTeamTemplate();
  const reorder = useReorderTeamTemplates(teamId || null);
  const [dragging, setDragging] = useState(false);
  const [senderOpen, setSenderOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const owner = account.data?.owner;
  const sender = (teamId && account.data?.senders?.[teamId]) || null;
  const list = orderTemplates(templates.data ?? []);
  const loading = account.isLoading || templates.isLoading;
  const failed = account.isError || templates.isError;
  const error = account.error ?? templates.error;

  // Шаблон — шторка блоками (03.10, была страница): двери внутри открывают
  // свои шторки поверх неё, как «Тип объекта» в листе объекта.
  const openTemplate = (template: SmsTeamTemplate | null) =>
    setEditing(template ? { mode: "edit", template } : { mode: "create" });

  const drop = (template: SmsTeamTemplate) =>
    confirmThen(
      `Удалить шаблон «${template.name}»?`,
      {
        message: "Отправленные SMS останутся в истории, неотправленные по нему — не уйдут.",
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        remove.mutate(template.id, {
          onError: (e) => notify("Не удалось удалить", e instanceof Error ? e.message : undefined),
        }),
    );

  const flip = (template: SmsTeamTemplate) =>
    toggle.mutate(
      { id: template.id, enabled: !template.enabled },
      { onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined) },
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="SMS" subtitle={team?.name} />

      {loading ? (
        <EmptyState state="loading" fill />
      ) : failed || !teamId ? (
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{
            label: "Повторить",
            onPress: () => {
              void account.refetch();
              void templates.refetch();
            },
          }}
        />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} scrollEnabled={!dragging}>
          <SectionCard title="Баланс">
            <SettingsRow
              tile="neutral"
              icon={Wallet}
              title={owner ? euro(owner.balanceCents) : "—"}
              // Ниже €5 — «Пополните баланс» строкой, без плашки (владелец 30.09).
              sub={
                balanceWarning(account.data) ??
                (owner && account.data
                  ? balanceWords(owner.balanceCents, owner.freeLeft, account.data.priceCents)
                  : undefined)
              }
              subColor={balanceWarning(account.data) ? t.warning : undefined}
              onPress={() => router.push("/cabinet/sms" as Href)}
            />
          </SectionCard>

          {/* ИМЯ ОТПРАВИТЕЛЯ — у каждой команды своё (волна 10): так SMS
              подписана у клиента; без него команда не отправляет. */}
          <SectionCard title="Отправитель">
            <SettingsRow
              tile="neutral"
              icon={BadgeCheck}
              title={sender ?? "Имя не указано"}
              sub={sender ? undefined : "Без него SMS не уходят"}
              onPress={() => setSenderOpen(true)}
            />
          </SectionCard>

          <SectionCard title="Шаблоны">
            {list.length === 0 ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.sub }}
              >
                Шаблонов пока нет
              </Text>
            ) : (
              <ReorderList
                items={list}
                rowHeight={ROW_H}
                labelFor={(template) => template.name}
                handleInside
                onReorder={(ids) =>
                  reorder.mutate(ids, {
                    onError: (e) => notify("Не удалось сохранить порядок", e instanceof Error ? e.message : undefined),
                  })
                }
                onDraggingChange={setDragging}
              >
                {(template, _index, handle) => (
                  <SwipeRow
                    label="Удалить"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить шаблон ${template.name}`}
                    onAction={() => drop(template)}
                    leading={{
                      label: template.enabled ? "Скрыть" : "Показать",
                      color: template.enabled ? t.warning : t.success,
                      icon: template.enabled ? EyeOff : RotateCcw,
                      accessibilityLabel: template.enabled
                        ? `Скрыть шаблон ${template.name}`
                        : `Показать шаблон ${template.name}`,
                      onAction: () => flip(template),
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        opacity: template.enabled ? 1 : 0.45,
                        backgroundColor: appearanceRowFill(template.color, false, {
                          rest: t.surface,
                          pressed: t.pressed,
                        }),
                      }}
                    >
                      <Pressable
                        onPress={() => openTemplate(template)}
                        accessibilityRole="button"
                        accessibilityLabel={`Шаблон ${template.name}, ${whenWords(template)}, редактировать`}
                        style={({ pressed }) => ({
                          flex: 1,
                          height: ROW_H,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                          paddingLeft: 16,
                          backgroundColor: pressed ? t.pressed : "transparent",
                        })}
                      >
                        <AppearanceTile color={template.color} icon={template.icon} size={30} />
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 16, color: t.ink }}>
                            {template.name}
                          </Text>
                          <Text
                            numberOfLines={1}
                            maxFontSizeMultiplier={1.3}
                            style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                          >
                            {whenWords(template)}
                            {template.enabled ? "" : " · скрыт"}
                          </Text>
                        </View>
                      </Pressable>
                      {handle}
                    </View>
                  </SwipeRow>
                )}
              </ReorderList>
            )}
          </SectionCard>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ И ВСЕГДА, как у меток и типов событий. */}
      {!loading && !failed && teamId ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Добавить шаблон" onPress={() => openTemplate(null)} />
        </View>
      ) : null}

      {teamId ? (
        <SmsSenderSheet
          visible={senderOpen}
          teamId={teamId}
          current={sender}
          onClose={() => setSenderOpen(false)}
        />
      ) : null}
      {teamId ? (
        <SmsTemplateSheet
          visible={editing !== null}
          teamId={teamId}
          teamName={team?.name}
          template={editing?.mode === "edit" ? editing.template : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

export default SmsTeamScreen;
