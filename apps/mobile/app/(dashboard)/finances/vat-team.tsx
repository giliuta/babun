import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { OptionSheet, type SheetOption } from "@/components/ui/OptionSheet";
import { ValueRow } from "@/components/ui/ValueRow";
import type { VatMode } from "@babun/shared/local/finance/vat";
import {
  type TeamVatOverride,
  useSaveTeamVat,
  useTeamVatOverrides,
  useVatSettings,
  VAT_MODE_LABELS,
} from "@/features/finances/vat-queries";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

// НДС ОДНОЙ КОМАНДЫ — СТРАНИЦА, А НЕ ЛИСТ (закон «настройка — страницей»).
//
// Команды работают в разных странах одновременно (Кипр 19, Греция 24):
// компанейское значение — дефолт, команда может переопределить режим и
// ставку по отдельности. Наследование — не тумблер и не пустое поле, а
// живое значение серым «Как у компании · …» (диалект настроек календаря):
// у режима три смысла, Switch физически умеет два.
//
// Приоритет действующего НДС: счёт → команда → компания
// (effectiveVatSettings).
//
// ТЕПЕРЬ ЭТО ЕДИНСТВЕННАЯ СТРАНИЦА VAT (владелец 2026-09-24: «всё отдельно
// под каждую команду»; «VAT там по идее не нужен»). У компании остался только
// выключатель в «Функциях» настроек финансов, а режим и ставка — у команды.
// «Как у компании» больше не показывается: значения компании видны только
// как ТЕКУЩИЕ у команды, которая их ещё не меняла, и первая правка
// записывает их команде целиком.

type ModeChoice = VatMode;

export default function TeamVatSettingsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const settings = useVatSettings();
  const overrides = useTeamVatOverrides();
  const save = useSaveTeamVat();
  const teamsQuery = useTeams();

  const override = (overrides.data ?? []).find((o) => o.teamId === teamId);
  // Ставка команды — своя или, пока её не меняли, та, что действует сейчас.
  const ownRate = override?.rate ?? settings.data?.rate ?? null;

  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState("");
  useEffect(() => {
    setRateDraft(ownRate == null ? "" : String(ownRate));
  }, [ownRate]);

  if (
    settings.isLoading ||
    !settings.data ||
    overrides.isLoading ||
    teamsQuery.isLoading
  ) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Загрузка настроек VAT" />
      </Screen>
    );
  }

  const v = settings.data;
  const team = (teamsQuery.data ?? []).find((x) => x.id === teamId);
  if (!team) {
    // useTeams отдаёт только активные команды: сюда приводит холодный
    // диплинк на архивированную или чужую команду.
    return (
      <Screen>
        <ScreenHeader title="VAT команды" />
        <EmptyState state="error" title="Команда не найдена" fill />
      </Screen>
    );
  }

  // Каждое сохранение несёт ПОЛНОЕ переопределение: upsert перезаписывает все
  // колонки, поэтому не затираем то, что не редактируем (exemptionNote).
  // Пустое переопределение мутация сама превращает в delete = «как у компании».
  const commit = (patch: Partial<Pick<TeamVatOverride, "mode" | "rate">>) => {
    save.mutate(
      {
        teamId: team.id,
        mode: override?.mode ?? null,
        rate: override?.rate ?? null,
        exemptionNote: override?.exemptionNote ?? null,
        ...patch,
      },
      {
        onSuccess: () => toast("Сохранено", "success"),
        onError: (e) => notify("Не удалось сохранить", (e as Error).message),
      },
    );
  };

  const commitRate = () => {
    const next = Number(rateDraft.replace(",", "."));
    // Ноль и мусор не принимаем: своя ставка 0 гасила бы клавиши НДС в
    // операциях команды при включённом тумблере компании. «Не считать налог» —
    // это режим «Без НДС», а не нулевая ставка.
    if (!(next > 0) || next >= 100) {
      notify(
        "Ставка вне диапазона",
        "Введите значение больше 0 и меньше 100.",
      );
      setRateDraft(ownRate == null ? "" : String(ownRate));
      return;
    }
    if (next === ownRate && override?.rate != null) return;
    // Ставка команды пишется вместе с её режимом — команда, которую ещё не
    // настраивали, получает свои значения целиком.
    commit({ rate: next, mode: override?.mode ?? v.mode });
  };

  // Порядок — рабочие ключи первыми, умолчание последним с видимым значением
  // компании (решение владельца в настройках счёта: «Как в настройках» не
  // должно стоять первым и не должно скрывать, ЧТО именно унаследуется).
  const modeOptions: readonly SheetOption<ModeChoice>[] = [
    {
      value: "inclusive",
      label: VAT_MODE_LABELS.inclusive,
      hint: "Цена уже содержит налог",
    },
    {
      value: "exclusive",
      label: VAT_MODE_LABELS.exclusive,
      hint: "Налог добавляется сверху цены",
    },
    {
      value: "off",
      label: VAT_MODE_LABELS.off,
      hint: "Клавиш VAT в операциях команды нет",
    },
  ];
  const teamMode: VatMode = override?.mode ?? v.mode;

  return (
    <Screen>
      <ScreenHeader title={team.name} subtitle="VAT команды" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {v.mode === "off" ? (
          // Сюда можно попасть холодным диплинком при выключенном НДС компании:
          // честно говорим, что настройка спит, вместо молчаливо мёртвых полей.
          <Text
            style={{
              paddingHorizontal: 20,
              paddingTop: 12,
              fontSize: 13,
              lineHeight: 17,
              color: t.warning,
            }}
          >
            VAT выключен — включите его в «Настройках финансов», в «Функциях».
          </Text>
        ) : null}

        <SectionEyebrow>Режим и ставка</SectionEyebrow>
        <SectionCard>
          <ValueRow
            label="Режим"
            value={VAT_MODE_LABELS[teamMode]}
            onPress={() => setModeSheetOpen(true)}
          />
          {teamMode === "off" ? null : (
            <>
              <Divider inset={16} />
              <View
                className="flex-row items-center px-4 py-3"
                style={{ gap: 12 }}
              >
                <Text className="flex-1 text-[15px]" style={{ color: t.ink }}>
                  Ставка
                </Text>
                <TextInput
                  value={rateDraft}
                  onChangeText={setRateDraft}
                  onBlur={commitRate}
                  onSubmitEditing={commitRate}
                  keyboardType="decimal-pad"
                  keyboardAppearance="light"
                  accessibilityLabel="Ставка VAT команды в процентах"
                  className="min-w-16 px-3 py-2 text-[15px] font-semibold"
                  // textAlign через style: NativeWind не доносит класс
                  // выравнивания до TextInput (контрактный тест на это есть).
                  style={{
                    backgroundColor: t.fill,
                    color: t.ink,
                    textAlign: "right",
                    borderRadius: t.radius.input,
                  }}
                />
                <Text className="text-[15px]" style={{ color: t.sub }}>
                  %
                </Text>
              </View>
            </>
          )}
        </SectionCard>
      </ScrollView>

      <OptionSheet<ModeChoice>
        visible={modeSheetOpen}
        title="Режим VAT"
        options={modeOptions}
        value={teamMode}
        onPick={(choice) => {
          haptics.tap();
          // Режим пишется команде вместе с действующей ставкой: команда,
          // которую ещё не настраивали, получает свои значения целиком.
          commit({ mode: choice, rate: override?.rate ?? v.rate });
        }}
        onClose={() => setModeSheetOpen(false)}
      />
    </Screen>
  );
}
