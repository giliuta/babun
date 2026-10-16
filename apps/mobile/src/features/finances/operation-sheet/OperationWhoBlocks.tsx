import { User } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { ReferenceBlock } from "@/components/ui/ReferenceBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import type { useClientChoice } from "../use-client-choice";
import { DebtWhoBlock } from "../DebtWhoBlock";

/** Who the money is about, as the category asks: the payee («Кому» /
 *  «Партнёр») and the attached client. Each block shows only when asked. */
export function OperationWhoBlocks({
  askEmployee,
  isExpense,
  payee,
  onOpenPayee,
  attachClient,
  pickedClient,
  clientChoice,
  onOpenClient,
}: {
  askEmployee: boolean;
  isExpense: boolean;
  payee: { full_name: string; color?: string | null } | null;
  onOpenPayee: () => void;
  attachClient: boolean;
  pickedClient: Client | null;
  clientChoice: ReturnType<typeof useClientChoice>;
  onOpenClient: () => void;
}) {
  return (
    <>
      {/* 3a. КОМУ — тот же блок-справочник, что категория: шапка, строка-
          дверь, выбранный человек его цветом. Необязателен: выплату без
          имени сервер примет, просто разбор не разделит её по людям. */}
      {askEmployee ? (
        <ReferenceBlock
          dense
          // Расход — «Кому» ушли деньги; доход — «Сотрудник», кто их принёс.
          title={isExpense ? "Кому" : "Партнёр"}
          emptyIcon={User}
          emptyLabel="Выбрать партнёра"
          emptyHint="Открывает список партнёров"
          value={
            payee
              ? { name: payee.full_name, color: payee.color ?? null, Icon: User }
              : null
          }
          onPress={() => {
            onOpenPayee();
            haptics.tap();
          }}
        />
      ) : null}

      {/* 3b. КЛИЕНТ — у категории, которая прикрепляет клиента. Та же
          строка, что у долга и в записи: имя, вводная, телефон. */}
      {attachClient ? (
        <SectionCard title="Клиент" dense>
          <DebtWhoBlock
            client={pickedClient}
            stats={pickedClient ? clientChoice.statsById.get(pickedClient.id) : undefined}
            counterparty=""
            onOpenPicker={() => {
              onOpenClient();
              haptics.tap();
            }}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
