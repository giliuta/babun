import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { Chip } from "@/components/ui/Chip";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { Percent } from "lucide-react-native";
import type { VatMode } from "@babun/shared/local/finance/vat";
import { grossFromNet, netFromGross } from "@babun/shared/local/finance/vat";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  useSaveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
  VAT_MODE_LABELS,
} from "@/features/finances/vat-queries";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";

// НДС — ОДНА СТРАНИЦА, ГДЕ ВИДНО ПОСЛЕДСТВИЕ ВЫБОРА.
//
// Разница между «включён» и «плюсом» — не термин, а деньги: при одной и той
// же цене 400 клиент платит 400 или 480. Поэтому под переключателем стоит
// живой пример с текущей ставкой: выбор виден в евро, а не в словах.
//
// Ставка на КОМАНДУ, а не на бизнес: у владельца команды работают в разных
// странах (Кипр 19, Греция 24). Компанейское значение — дефолт, команда
// может его переопределить (паттерн настроек календаря).

// Выключатель отдельно от выбора режима: «не работаю с НДС» — это не третий
// вариант ценообразования, а «уберите с глаз». Владелец 2026-08-09: «некоторые
// вообще не пользуются НДС — брови, маникюр, наличка; тумблер выключаешь, и
// всё это пропадает».
const PRICING_MODES: VatMode[] = ["inclusive", "exclusive"];
const EXAMPLE_PRICE = 400;

export default function VatSettingsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const settings = useVatSettings();
  const save = useSaveVatSettings();
  const overrides = useTeamVatOverrides();
  const { data: teams = [] } = useTeams();

  const [rateDraft, setRateDraft] = useState("");
  // Каким режимом пользовались до выключения — чтобы включение вернуло его,
  // а не поставило «включён» поверх «плюсом».
  const [lastPricingMode, setLastPricingMode] = useState<VatMode | null>(null);
  useEffect(() => {
    if (settings.data) setRateDraft(String(settings.data.rate));
    if (settings.data && settings.data.mode !== "off") {
      setLastPricingMode(settings.data.mode);
    }
  }, [settings.data]);

  if (settings.isLoading || !settings.data) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Загрузка настроек НДС" />
      </Screen>
    );
  }

  const v = settings.data;
  const rate = Number(rateDraft.replace(",", ".")) || 0;
  const overrideByTeam = new Map(
    (overrides.data ?? []).map((o) => [o.teamId, o]),
  );

  const commitRate = () => {
    // Ноль не принимаем: при включённом тумблере ставка 0 молча гасит клавиши
    // НДС во всех операциях (OperationSheet требует rate > 0), и настройка
    // выглядит сломанной. «Не считать налог» — это выключатель выше.
    if (!(rate > 0) || rate >= 100) {
      notify(
        "Ставка вне диапазона",
        "Введите значение больше 0 и меньше 100. Если с НДС не работаете — выключите его тумблером выше.",
      );
      setRateDraft(String(v.rate));
      return;
    }
    if (rate === v.rate) return;
    save.mutate(
      { rate },
      {
        onError: (e) => notify("Не удалось сохранить", (e as Error).message),
      },
    );
  };

  return (
    <Screen>
      <ScreenHeader title="НДС" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard>
          <SwitchRow
            label="Работаем с НДС"
            hint={
              v.mode === "off"
                ? "Приложение не спрашивает про налог и не считает его"
                : "В каждой операции можно выбрать «Без НДС», «включён» или «плюсом»"
            }
            value={v.mode !== "off"}
            onChange={(on) =>
              save.mutate(
                // Возвращаем ровно тот режим, каким пользовались: выключатель
                // не должен молча менять «плюс НДС» на «включён».
                { mode: on ? (lastPricingMode ?? "inclusive") : "off" },
                {
                  onSuccess: () => toast("Сохранено", "success"),
                  onError: (e) =>
                    notify("Не удалось сохранить", (e as Error).message),
                },
              )
            }
          />
        </SectionCard>

        {v.mode === "off" ? null : (
          <>
            <SectionEyebrow>Как назначается цена</SectionEyebrow>
            <SectionCard>
              <View className="flex-row flex-wrap gap-2 p-3">
                {PRICING_MODES.map((mode) => (
                  <Chip
                    key={mode}
                    label={VAT_MODE_LABELS[mode]}
                    radio
                    selected={v.mode === mode}
                    onPress={() => {
                      if (v.mode === mode) return;
                      save.mutate(
                        { mode },
                        {
                          onSuccess: () => toast("Сохранено", "success"),
                          onError: (e) =>
                            notify(
                              "Не удалось сохранить",
                              (e as Error).message,
                            ),
                        },
                      );
                    }}
                  />
                ))}
              </View>
              {/* ПОСЛЕДСТВИЕ В ЕВРО. Термины «inclusive/exclusive» ничего не
                  говорят на бегу; сумма, которую заплатит клиент, — говорит. */}
              <Divider inset={16} />
              <View className="px-4 py-3">
                <Text className="text-[13px]" style={{ color: t.sub }}>
                  Услуга за {formatEUR(EXAMPLE_PRICE)} при ставке {rate}%
                </Text>
                <Text
                  className="mt-1 text-[15px] font-semibold"
                  style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
                >
                  {v.mode === "exclusive"
                    ? `Клиент заплатит ${formatEUR(grossFromNet(EXAMPLE_PRICE, rate))} · вам останется ${formatEUR(EXAMPLE_PRICE)}`
                    : `Клиент заплатит ${formatEUR(EXAMPLE_PRICE)} · вам останется ${formatEUR(netFromGross(EXAMPLE_PRICE, rate))}`}
                </Text>
              </View>
            </SectionCard>

            <SectionEyebrow>Ставка компании</SectionEyebrow>
            <SectionCard>
              <View className="flex-row items-center px-4 py-3" style={{ gap: 12 }}>
                <Text className="flex-1 text-[15px]" style={{ color: t.ink }}>
                  Ставка по умолчанию
                </Text>
                <TextInput
                  value={rateDraft}
                  onChangeText={setRateDraft}
                  onBlur={commitRate}
                  onSubmitEditing={commitRate}
                  keyboardType="decimal-pad"
                  keyboardAppearance="light"
                  accessibilityLabel="Ставка НДС в процентах"
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
            </SectionCard>
            {v.rate > 0 ? null : (
              // Нулевая ставка могла приехать из старых данных: ввод её больше
              // не принимает, но пока она в базе — клавиш НДС в операциях нет,
              // и без объяснения включённый тумблер выглядит сломанным.
              <Text
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 6,
                  fontSize: 13,
                  lineHeight: 17,
                  color: t.warning,
                }}
              >
                Ставка 0% — клавиши НДС в операциях не появляются. Укажите
                ставку или выключите НДС тумблером выше.
              </Text>
            )}

            <SectionEyebrow>Своя ставка у команды</SectionEyebrow>
            <SectionCard>
              {teams.length === 0 ? (
                <Text className="px-4 py-3 text-[15px]" style={{ color: t.sub }}>
                  Команд пока нет
                </Text>
              ) : (
                teams.map((team, i) => {
                  const o = overrideByTeam.get(team.id);
                  const own = o?.rate != null || o?.mode != null;
                  return (
                    <View key={team.id}>
                      {i > 0 ? <Divider inset={56} /> : null}
                      <SettingsRow
                        tile={team.color || "#5B6678"}
                        icon={Percent}
                        title={team.name}
                        sub={
                          own
                            ? `${o?.mode ? VAT_MODE_LABELS[o.mode] : VAT_MODE_LABELS[v.mode]} · ${o?.rate ?? v.rate}%`
                            : `Как у компании · ${v.rate}%`
                        }
                        onPress={() =>
                          router.push(
                            `/finances/vat-team?teamId=${team.id}` as Href,
                          )
                        }
                      />
                    </View>
                  );
                })
              )}
            </SectionCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
