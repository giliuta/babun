// BulkActionBar — the bottom action strip shown while the clients list is
// in selection mode (mobile bulk-mode; parity with the web bulk action bar
// in app/dashboard/clients/page.tsx). Three actions on the selected set:
//
//   · SMS      → opens BulkSmsSheet (template picker + blast/sequential)
//   · Экспорт  → CSV of the selection via the OS share sheet (bulk-export)
//   · Архив    → reversible soft archive after a native confirm
//
// Disabled-not-hidden when nothing is picked, so the bar never reflows. The
// SMS/Export/Delete plumbing lives in the parent (index.tsx) — this is a
// dumb presenter that renders the three buttons and their counts.

import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Archive, MessageSquare, Share2 } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

export function BulkActionBar({
  count,
  onSms,
  onExport,
  onArchive,
}: {
  count: number;
  onSms: () => void;
  onExport: () => void;
  onArchive: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const disabled = count === 0;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 flex-row items-stretch border-t px-2 pt-2"
      style={{
        backgroundColor: t.surface,
        borderColor: t.separator,
        paddingBottom: Math.max(10, insets.bottom),
      }}
    >
      <BarButton
        label="SMS"
        icon={<MessageSquare color={disabled ? t.faint : t.accent} size={20} strokeWidth={2} />}
        color={t.accent}
        disabled={disabled}
        count={count}
        onPress={onSms}
      />
      <BarButton
        label="Экспорт"
        icon={<Share2 color={disabled ? t.faint : t.body} size={20} strokeWidth={2} />}
        color={t.body}
        disabled={disabled}
        count={count}
        onPress={onExport}
      />
      <BarButton
        label="Архив"
        icon={<Archive color={disabled ? t.faint : t.danger} size={20} strokeWidth={2} />}
        color={t.danger}
        disabled={disabled}
        count={count}
        onPress={onArchive}
      />
    </View>
  );
}

function BarButton({
  label,
  icon,
  color,
  count,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  count: number;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}${count > 0 ? `, выбрано ${count}` : ""}`}
      accessibilityState={{ disabled }}
      className={`flex-1 items-center gap-1 py-1.5 active:opacity-60 ${disabled ? "opacity-40" : ""}`}
    >
      {icon}
      <Text className="text-[11px] font-medium" style={{ color: disabled ? undefined : color }}>
        {label}
        {count > 0 ? ` · ${count}` : ""}
      </Text>
    </Pressable>
  );
}
