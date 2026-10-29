import { Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import type { OperationReason } from "./operation-guards";

/** Footer of the operation sheet: the one reason the button is grey, then
 *  the button itself. */
export function OperationFooter({
  reason,
  label,
  onSave,
  canSave,
  busy,
  onRetry,
}: {
  reason: OperationReason;
  label: string;
  onSave: () => void;
  canSave: boolean;
  busy: boolean;
  /** Тап по причине с `retry` — перечитать то, что не загрузилось. */
  onRetry?: () => void;
}) {
  const th = useThemeColors();
  return (
    <View style={{ paddingHorizontal: FOOTER_SIDE, gap: 8 }}>
      {reason ? (
        <Pressable
          disabled={!reason.retry || !onRetry}
          onPress={onRetry}
          accessibilityRole={reason.retry && onRetry ? "button" : undefined}
        >
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 13,
              lineHeight: 18,
              textAlign: "center",
              color: reason.error ? th.danger : th.sub,
            }}
          >
            {reason.text}
          </Text>
        </Pressable>
      ) : null}
      <Button
        label={label}
        onPress={onSave}
        disabled={!canSave}
        loading={busy}
      />
    </View>
  );
}
