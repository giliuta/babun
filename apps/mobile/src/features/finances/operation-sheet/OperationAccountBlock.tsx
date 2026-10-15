import { Text, View } from "react-native";
import type { AccountWithBalance } from "../accounts";
import { SectionCard } from "@/components/ui/SectionCard";
import {
  PaymentTile,
  TILE_GAP,
  useTileWidth,
} from "@/features/appointments/PaymentTiles";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { accountIcon } from "../account-ui";

/** 5. Счёт — ПЛИТКАМИ, КАК В ЗАПИСИ: иконки полноценные, наличные или карта.
 *  Лента чипов называла бы счёт словом; плитка несёт его значок
 *  и цвет — те же, что человек задал счёту в финансах, и тот же
 *  контрол, которым принимают оплату на записи. */
export function OperationAccountBlock({
  accountsFailed,
  teamAccounts,
  teamId,
  accountId,
  busy,
  refundHoldsAccount,
  refundsKnown,
  txAccountId,
  onPick,
}: {
  accountsFailed: boolean;
  teamAccounts: AccountWithBalance[];
  teamId: string | null;
  accountId: string | null;
  busy: boolean;
  refundHoldsAccount: boolean;
  refundsKnown: boolean;
  /** Account of the edited operation; `null` for a new one. */
  txAccountId: string | null | undefined;
  onPick: (id: string) => void;
}) {
  const th = useThemeColors();
  const tileWidth = useTileWidth();
  if (accountsFailed) {
    return (
      <SectionCard title="Счёт" dense>
        <Text className="px-4 py-3 text-sm" style={{ color: th.faint }}>
          Счета не загрузились. Обновите экран финансов и откройте форму
          заново.
        </Text>
      </SectionCard>
    );
  }
  if (teamAccounts.length > 0) {
    return (
      <SectionCard title="Счёт" dense>
        <View
          className="flex-row flex-wrap"
          style={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 10,
            gap: TILE_GAP,
          }}
        >
          {teamAccounts.map((a) => (
            <PaymentTile
              key={a.id}
              icon={accountIcon(a)}
              label={a.name}
              color={a.color ?? th.ink}
              tint={a.color}
              width={tileWidth}
              // Одной плашкой: значок слева от имени, 44pt (компактнее,
              // чтобы иконка была слева).
              compact
              // Плитка держит СВОЙ цвет и в покое, и выбранной — им счёт
              // и узнают. Radio-семантика: счёт обязателен, повторный тап
              // выбор не снимает.
              state="idle"
              selected={accountId === a.id}
              disabled={busy}
              onPress={() => {
                if (
                  refundHoldsAccount &&
                  txAccountId &&
                  a.id !== txAccountId
                ) {
                  haptics.warning();
                  notify(
                    "Счёт не сменить",
                    refundsKnown
                      ? "По этому доходу есть возврат — он лежит на этом счёте. Сначала удалите возврат."
                      : "Возвраты по доходу ещё загружаются — счёт можно сменить, когда они придут.",
                  );
                  return;
                }
                onPick(a.id);
              }}
              accessibilityLabel={`Счёт: ${a.name}`}
            />
          ))}
        </View>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Счёт" dense>
      <Text className="px-4 py-3 text-sm" style={{ color: th.faint }}>
        {teamId
          ? "У этой команды нет активного счёта — заведите его в «Счетах»."
          : "Кассы принадлежат командам. Закройте форму и выберите команду чипом на экране финансов."}
      </Text>
    </SectionCard>
  );
}
