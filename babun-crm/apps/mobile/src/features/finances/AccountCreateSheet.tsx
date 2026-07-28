import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import type { AccountKind, AccountScope } from "@babun/shared/local/finance/account";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { useInsertAccount } from "./accounts";
import { KINDS } from "./account-ui";
import { TeamChecklist } from "./TeamChecklist";

// Создание счёта — канонический BottomSheet. Охват выбирается сегментом
// «Команды | Общий»; у общего счёта команды-владельца нет, вместо неё —
// явный список подключённых команд (account_teams). Правка существующего
// счёта живёт на странице его настроек.
export function AccountCreateSheet({
  visible,
  onClose,
  teams,
  presetBrigadeId,
  presetName,
}: {
  visible: boolean;
  onClose: () => void;
  /** Активные команды — для выбора владельца/участников. */
  teams: Team[];
  /** Предвыбранная команда из цепочки «команда → счёт». */
  presetBrigadeId?: string | null;
  /** Предзаполненное имя из той же цепочки («Касса»). */
  presetName?: string;
}) {
  const t = useThemeColors();
  const insert = useInsertAccount();

  const [scope, setScope] = useState<AccountScope>("team");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("cash");
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState("");

  // Каждое ОТКРЫТИЕ листа начинает с чистой формы и пресетов цепочки
  // «команда → счёт». Только по фронту открытия: фоновый рефетч команд
  // при открытом листе не должен стирать набранное.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (wasVisible.current) return;
    wasVisible.current = true;
    setScope("team");
    setName(presetName ?? "");
    setKind("cash");
    setBrigadeId(presetBrigadeId ?? (teams.length === 1 ? teams[0].id : null));
    setTeamIds(new Set());
    setOpening("");
  }, [visible, presetBrigadeId, presetName, teams]);

  // Смена охвата задаёт умолчание вида: команды чаще считают наличку,
  // общий счёт компании — почти всегда банк/карта.
  const changeScope = (next: AccountScope) => {
    if (next === scope) return;
    setScope(next);
    setKind(next === "company" ? "bank" : "cash");
  };

  const openingCents = opening.trim()
    ? parseMoneyInputToCents(opening, { allowNegative: true, allowZero: true })
    : 0;
  const scopeReady = scope === "team" ? !!brigadeId : teamIds.size > 0;
  const canSave =
    !!name.trim() && scopeReady && openingCents != null && !insert.isPending;

  const submit = async () => {
    if (openingCents == null) {
      Alert.alert(
        "Проверьте баланс",
        "Введите сумму и не больше двух знаков после запятой.",
      );
      return;
    }
    try {
      await insert.mutateAsync({
        scope,
        brigade_id: scope === "team" ? brigadeId : null,
        team_ids: scope === "company" ? [...teamIds] : undefined,
        name: name.trim(),
        kind,
        opening_balance: (openingCents ?? 0) / 100,
      });
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const scopeOptions = useMemo(
    () =>
      [
        { value: "team" as const, label: "Команды" },
        { value: "company" as const, label: "Общий" },
      ] as const,
    [],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View className="px-5 pb-2">
        <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
          Новый счёт
        </Text>
        <Field
          label="Название"
          value={name}
          onChangeText={setName}
          placeholder="Напр. Касса"
          autoFocus
        />

        <SegmentedControl
          options={scopeOptions}
          value={scope}
          onChange={changeScope}
          style={{ marginBottom: 12 }}
        />

        {scope === "team" ? (
          <>
            <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
              Команда
            </Text>
            {teams.length === 0 ? (
              <Text className="mb-3 text-sm" style={{ color: t.faint }}>
                Сначала добавьте команду в справочниках.
              </Text>
            ) : (
              <View className="mb-3 flex-row flex-wrap gap-2">
                {teams.map((team) => (
                  <Chip
                    key={team.id}
                    label={team.name}
                    radio
                    selected={brigadeId === team.id}
                    onPress={() => setBrigadeId(team.id)}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <Text className="mb-1 text-xs font-medium" style={{ color: t.sub }}>
              Команды счёта
            </Text>
            <TeamChecklist
              teams={teams}
              selected={teamIds}
              onToggle={(id) =>
                setTeamIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onToggleAll={() =>
                setTeamIds((prev) =>
                  prev.size === teams.length
                    ? new Set()
                    : new Set(teams.map((x) => x.id)),
                )
              }
            />
            <Text className="mb-3 text-xs" style={{ color: t.faint }}>
              Счёт увидят только выбранные команды.
            </Text>
          </>
        )}

        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          Вид
        </Text>
        <View className="mb-3 flex-row flex-wrap gap-2">
          {KINDS.map((k) => (
            <Chip
              key={k.value}
              label={k.label}
              radio
              selected={kind === k.value}
              onPress={() => setKind(k.value)}
            />
          ))}
        </View>

        <Field
          label="Начальный баланс €"
          value={opening}
          onChangeText={setOpening}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        {opening.length > 0 && openingCents == null ? (
          <Text className="mb-3 text-sm" style={{ color: t.danger }}>
            Введите сумму и не больше двух знаков после запятой.
          </Text>
        ) : null}

        <GradientButton
          label="Создать счёт"
          onPress={submit}
          disabled={!canSave}
          loading={insert.isPending}
        />
      </View>
    </BottomSheet>
  );
}
