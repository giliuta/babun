// BulkActionBar — the bottom action strip shown while the clients list is
// in selection mode (mobile bulk-mode; parity with the web bulk action bar
// in app/dashboard/clients/page.tsx). Actions on the selected set:
//
//   · SMS      → opens BulkSmsSheet (template picker + blast/sequential)
//   · Теги     → «Поставить» / «Снять», then the card's TagPickerSheet
//   · Команда  → the client's team, one server call for the whole set
//   · Источник → the card's «Источник обращения» sheet
//   · Экспорт  → CSV of the selection via the OS share sheet (bulk-export)
//   · Удалить  → «Удалённые клиенты» after a native confirm, with undo
//                (there is no client archive)
//
// Disabled-not-hidden when nothing is picked, so the bar never reflows. The
// plumbing lives in the list hooks (`list/use-list-bulk*.ts`) — this is a
// dumb presenter. The count lives in the header («Выбрано N»): six buttons
// with « · N» each no longer fit a phone's width.

import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Megaphone, MessageSquare, Share2, Tags, Trash2, Users } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { usePlanAllows } from "@/session/tenant";
import { useTariffNudge } from "@/features/tariffs/use-tariff";

export function BulkActionBar({
  count,
  onSms,
  onExport,
  onTags,
  onTeam,
  onSource,
  busy = false,
  onDelete,
}: {
  count: number;
  onSms: () => void;
  onExport: () => void;
  /** Нет — кнопки нет: правка карточек выбранных этому человеку закрыта. */
  onTags?: () => void;
  /** Нет — кнопки нет: команда одна или менять её нельзя. */
  onTeam?: () => void;
  onSource?: () => void;
  /** Пачка уже ушла на сервер — правки ждут ответа, второй тап не шлёт. */
  busy?: boolean;
  /** Нет — кнопки «Удалить» нет: массово удаляет владелец своей компании,
   *  у партнёра сервер запись откажет (STORY-088, волна 4). */
  onDelete?: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const disabled = count === 0;
  const editOff = disabled || busy;
  // Без тарифа рассылки нет: «SMS» серое, тап — плашка про тариф.
  const smsLocked = !usePlanAllows("sms");
  const nudgeTariff = useTariffNudge();

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
        icon={<MessageSquare color={disabled || smsLocked ? t.faint : t.accent} size={20} strokeWidth={2} />}
        color={smsLocked ? t.faint : t.accent}
        disabled={disabled}
        count={count}
        onPress={smsLocked ? nudgeTariff : onSms}
      />
      {onTags ? (
        <BarButton
          label="Теги"
          icon={<Tags color={editOff ? t.faint : t.body} size={20} strokeWidth={2} />}
          color={t.body}
          disabled={editOff}
          count={count}
          onPress={onTags}
        />
      ) : null}
      {onTeam ? (
        <BarButton
          label="Команда"
          icon={<Users color={editOff ? t.faint : t.body} size={20} strokeWidth={2} />}
          color={t.body}
          disabled={editOff}
          count={count}
          onPress={onTeam}
        />
      ) : null}
      {onSource ? (
        <BarButton
          label="Источник"
          icon={<Megaphone color={editOff ? t.faint : t.body} size={20} strokeWidth={2} />}
          color={t.body}
          disabled={editOff}
          count={count}
          onPress={onSource}
        />
      ) : null}
      <BarButton
        label="Экспорт"
        icon={<Share2 color={disabled ? t.faint : t.body} size={20} strokeWidth={2} />}
        color={t.body}
        disabled={disabled}
        count={count}
        onPress={onExport}
      />
      {onDelete ? (
        <BarButton
          label="Удалить"
          icon={<Trash2 color={disabled ? t.faint : t.danger} size={20} strokeWidth={2} />}
          color={t.danger}
          disabled={disabled}
          count={count}
          onPress={onDelete}
        />
      ) : null}
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
      <Text
        numberOfLines={1}
        className="text-[11px] font-medium"
        style={{ color: disabled ? undefined : color }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
