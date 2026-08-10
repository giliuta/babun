import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import type { AccountKind, AccountScope } from "@babun/shared/local/finance/account";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { useInsertAccount } from "./accounts";
import { KINDS } from "./account-ui";
import { TeamChecklist } from "./TeamChecklist";

// СОЗДАНИЕ СЧЁТА — ДВА ТАПА В ОБЫЧНОМ СЛУЧАЕ.
//
// Владелец 2026-08-10: «максимально просто и удобно, как можно меньше тапов,
// но создавать полноценно всё». Поэтому порядок вопросов перевёрнут: сначала
// ВИД (наличные/карта/банк), и он же подставляет название — «Касса», «Карта»,
// «Банк». Команда уже выбрана той, откуда пришли. Остаётся нажать «Создать».
//
// «Общий счёт» перестал быть режимом наверху: это переключатель под командой.
// Сегмент «Команды | Общий» заставлял выбирать конструкцию продукта раньше,
// чем человек назвал счёт, а общий счёт — редкий случай.
//
// Правка существующего счёта живёт на странице его настроек.

/** Название по виду счёта: обычная касса не заслуживает набора текста. */
const NAME_BY_KIND: Record<AccountKind, string> = {
  cash: "Касса",
  card: "Карта",
  bank: "Банк",
  other: "Счёт",
};
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
  // Человек начал печатать имя сам — вид его больше не перебивает.
  const [nameTouched, setNameTouched] = useState(false);

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
    setName(presetName ?? NAME_BY_KIND.cash);
    setNameTouched(!!presetName);
    setKind("cash");
    // Команда выбрана заранее: пришли из команды — её, иначе первую. Пустой
    // выбор гасил кнопку «Создать» и требовал лишний тап ни за чем.
    setBrigadeId(presetBrigadeId ?? teams[0]?.id ?? null);
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

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View className="px-5 pb-2">
        <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
          Новый счёт
        </Text>

        {/* 1. ВИД — первый вопрос и единственный обязательный: он же даёт имя. */}
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
              onPress={() => {
                setKind(k.value);
                if (!nameTouched) setName(NAME_BY_KIND[k.value]);
              }}
            />
          ))}
        </View>

        {/* 2. ЧЕЙ СЧЁТ. Команда уже выбрана — обычно менять нечего. */}
        {scope === "team" ? (
          teams.length === 0 ? (
            <Text className="mb-3 text-sm" style={{ color: t.faint }}>
              Сначала добавьте команду в справочниках.
            </Text>
          ) : (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
                Команда
              </Text>
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
            </>
          )
        ) : (
          <>
            <Text className="mb-1 text-xs font-medium" style={{ color: t.sub }}>
              Кто пользуется
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
          </>
        )}

        <SwitchRow
          label="Общий счёт"
          hint="Одна касса или банк на несколько команд"
          value={scope === "company"}
          onChange={(on) => changeScope(on ? "company" : "team")}
        />

        {/* 3. Имя уже подставлено — правят его редко, поэтому оно ниже. */}
        <View className="mt-3">
          <Field
            label="Название"
            value={name}
            onChangeText={(v) => {
              setNameTouched(true);
              setName(v);
            }}
            placeholder="Напр. Касса"
          />
          <Field
            label="Сколько сейчас на счёте €"
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
        </View>

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
