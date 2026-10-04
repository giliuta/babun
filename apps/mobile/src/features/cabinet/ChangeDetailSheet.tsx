import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  allChanges,
  changeSubject,
  changeTarget,
  changeTitle,
  fullWhen,
  type ChangeLogItem,
} from "./change-log";

// ПОДРОБНОСТИ ИЗМЕНЕНИЯ (владелец 03.10: «фиксируется чётко по времени — есть
// чёткая дата, время, что сделал… на это можно посмотреть, что произошло»).
//
// Тап по строке истории открывает лист: что случилось и с чем, когда — до
// секунды, кто и в какой команде, и ВСЕ поля правки «было → стало» (в
// строке ленты их три). У пачки — имена всех предметов. Запись и клиента
// отсюда можно открыть кнопкой внизу.

export function ChangeDetailSheet({
  item,
  actor,
  team,
  onOpen,
  onClose,
}: {
  item: ChangeLogItem | null;
  actor: string;
  team: string | null;
  /** Нет — двери к записи и клиенту нет (журнал чужого аккаунта, 04.10). */
  onOpen?: (item: ChangeLogItem) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const row = item?.row ?? null;
  const target = item && item.count === 1 ? changeTarget(item.row) : null;
  const lines = row && item?.count === 1 ? allChanges(row.changes) : [];
  const facts: [string, string][] = row
    ? [
        ["Когда", fullWhen(row.created_at)],
        ["Кто", actor],
        ...(team ? ([["Команда", team]] as [string, string][]) : []),
      ]
    : [];

  return (
    <BottomSheet
      visible={item !== null}
      onClose={onClose}
      title={row ? `${changeTitle(row)}${item && item.count > 1 ? ` ×${item.count}` : ""}` : ""}
      footer={
        target && item && onOpen ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button
              label={target.kind === "appointment" ? "Открыть запись" : "Открыть клиента"}
              onPress={() => onOpen(item)}
            />
          </View>
        ) : undefined
      }
    >
      {row && item ? (
        <View style={{ gap: 16, paddingBottom: 8 }}>
          {item.count > 1 ? (
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: t.ink }}>
              {item.labels.join(", ")}
            </Text>
          ) : changeSubject(row) ? (
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
              {changeSubject(row)}
            </Text>
          ) : null}

          <View style={{ borderRadius: t.radius.card, backgroundColor: t.rowFill }}>
            {facts.map(([name, value], index) => (
              <View key={name}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ width: 84, fontSize: 15, color: t.sub }}>
                    {name}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{ flex: 1, fontSize: 15, color: t.ink, fontVariant: ["tabular-nums"] }}
                  >
                    {value}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {lines.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 13, fontWeight: "600", letterSpacing: 0.4, color: t.sub }}
              >
                ЧТО ИЗМЕНИЛОСЬ
              </Text>
              <View style={{ borderRadius: t.radius.card, backgroundColor: t.rowFill }}>
                {lines.map((line, index) => (
                  <View key={`${index}-${line}`}>
                    {index > 0 ? <Divider inset={16} /> : null}
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: t.ink }}
                    >
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
