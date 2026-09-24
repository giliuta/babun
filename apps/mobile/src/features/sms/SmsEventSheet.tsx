import { useState } from "react";
import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FieldLabel } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useSaveSmsRule } from "./sms-account";
import { smsErrorText, teamEventState, type SmsAccount, type SmsEvent } from "./sms-model";
import { EVENT_TITLES, TIMING_OPTIONS, timingKind, timingWords } from "./sms-words";
import { SmsTextField } from "./SmsTextField";

// ЛИСТ СОБЫТИЯ SMS (STORY-089; владелец 24.09: «новая запись — свой шаблон,
// напоминание — свой, отмена — свой… настройка каждого… шаблон под каждую
// команду»). Один лист на оба слоя:
//   • у компании — «Отправлять», «Когда» (у напоминаний, «Спасибо» и «Пора
//     повторить») и текст по умолчанию;
//   • у команды — «Как у компании | Свой текст | Не отправлять»: свой текст
//     перекрывает текст компании только в этой команде.
// Действие листа одно — «Сохранить» внизу.

type TeamMode = "inherit" | "on" | "off";

const TEAM_MODES = [
  { value: "inherit", label: "Как у компании" },
  { value: "on", label: "Свой текст" },
  { value: "off", label: "Не отправлять" },
] as const;

export function SmsEventSheet({
  account,
  event,
  teamId,
  onClose,
}: {
  account: SmsAccount;
  /** Открытое событие; `null` — лист закрыт. */
  event: SmsEvent | null;
  /** '' — текст компании; иначе — команда. */
  teamId: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const save = useSaveSmsRule();
  // Закрытый лист дорисовывает последнее событие, пока уезжает вниз.
  const [shown, setShown] = useState<SmsEvent | null>(event);
  if (event && event !== shown) setShown(event);
  const current = event ?? shown;
  const company = account.owner?.events.find((e) => e.event === current) ?? null;
  const isTeam = teamId !== "";

  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<TeamMode>("inherit");
  const [body, setBody] = useState("");
  const [timing, setTiming] = useState<number | null>(null);
  // Черновик берётся у открытого события ровно один раз: пока лист открыт,
  // значениями владеют поля.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = event ? `${teamId}:${event}` : null;
  if (key !== seededFor) {
    setSeededFor(key);
    if (event) {
      const state = teamEventState(account, teamId, event);
      setOn(company?.on ?? false);
      setMode(state.mode);
      setBody(isTeam ? state.body : (company?.body ?? ""));
      setTiming(company?.timing ?? null);
    }
  }

  if (!current || !company) return null;

  const kind = timingKind(current);
  const needsText = isTeam ? mode === "on" : on;
  const canSave = !needsText || body.trim().length > 0;

  const submit = () => {
    save.mutate(
      isTeam
        ? { teamId, event: current, mode, body: mode === "on" ? body.trim() : null }
        : { teamId: "", event: current, mode: on ? "on" : "off", body: body.trim() || null, timing },
      { onError: (e) => notify("Не удалось сохранить", smsErrorText(e)) },
    );
    onClose();
  };

  return (
    <BottomSheet
      visible={!!event}
      onClose={onClose}
      title={EVENT_TITLES[current]}
      subtitle={isTeam ? undefined : timingWords(current, timing)}
      avoidKeyboard
      scroll
      footer={<Button label="Сохранить" onPress={submit} disabled={!canSave} />}
    >
      {isTeam ? (
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl options={TEAM_MODES} value={mode} onChange={setMode} />
          <Text maxFontSizeMultiplier={1.2} style={{ marginTop: 8, fontSize: 13, color: t.sub }}>
            {mode === "off"
              ? "Эта команда не отправляет это SMS"
              : mode === "inherit" && !company.on
                ? "У компании это SMS выключено"
                : timingWords(current, company.timing)}
          </Text>
        </View>
      ) : (
        <View
          style={{
            marginBottom: 16,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            backgroundColor: t.rowFill,
            overflow: "hidden",
          }}
        >
          <SwitchRow label="Отправлять" value={on} onChange={setOn} />
        </View>
      )}

      {!isTeam && kind ? (
        <View style={{ marginBottom: 16 }}>
          <FieldLabel text="Когда" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TIMING_OPTIONS[kind].map((value) => (
              <Chip
                key={value}
                label={timingWords(current, value)}
                selected={timing === value}
                radio
                onPress={() => setTiming(value)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {isTeam && mode === "off" ? null : (
        <SmsTextField
          value={isTeam && mode === "inherit" ? company.body : body}
          onChange={setBody}
          editable={!isTeam || mode === "on"}
        />
      )}
    </BottomSheet>
  );
}
