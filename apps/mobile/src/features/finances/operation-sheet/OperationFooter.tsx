import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { GUTTER } from "@/components/ui/tokens";
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
}: {
  reason: OperationReason;
  label: string;
  onSave: () => void;
  canSave: boolean;
  busy: boolean;
}) {
  const th = useThemeColors();
  return (
    <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
      {reason ? (
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
