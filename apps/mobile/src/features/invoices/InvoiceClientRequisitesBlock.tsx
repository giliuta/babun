import { useMemo, useState } from "react";
import { View } from "react-native";
import { Building2 } from "lucide-react-native";
import type { Client, ClientRequisites } from "@babun/shared/local/clients";
import {
  clientRequisitesOf,
  invoiceRequisites,
  orderedRequisites,
  requisitesNumbersLine,
  resolveInvoiceRequisitesId,
} from "@babun/shared/local/client-requisites";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { useUpdateClientById } from "@/features/clients/queries";
import { RequisitesSheet } from "@/features/clients/RequisitesSheet";
import { RequisitesRow } from "@/features/clients/blocks/RequisitesBlock";
import { useRequisitesWriter } from "@/features/clients/use-requisites-writer";
import { useThemeColors } from "@/theme/colors";

// БЛОК «РЕКВИЗИТЫ КЛИЕНТА» ИНВОЙСА — КАК БЛОК «ОБЪЕКТ».
//
// Владелец 22.09: «сначала выбираем клиента, потом объект, потом реквизиты
// клиента; выбираем те, что вписаны у клиента; если нет ничего — добавляем;
// если есть — выбираем, какие именно вносим в инвойс». Поэтому ровно состояния
// блока «Объект»:
//   • клиента нет — «Добавить реквизиты» стоит на месте и пригашена;
//   • у клиента нет реквизитов — «Добавить реквизиты» открывает тот же лист,
//     что на карточке клиента (`RequisitesSheet`), и новый набор сразу выбран;
//   • реквизиты есть — строка набора той же анатомии, что на карточке
//     (`RequisitesRow`); не выбирали — стоит основной. Тап — шторка выбора с
//     «Добавить реквизиты» в футере.
// Наборы и их запись — работа сессии 012 (`client-requisites.ts`, миграция
// 20260922100000); здесь только выбор.

const subtitle = (set: ClientRequisites) =>
  [set.is_default ? "Основные" : "", requisitesNumbersLine(set)].filter(Boolean).join(" · ")
  || (set.billing_address ?? "").split("\n")[0]?.trim()
  || undefined;

export function InvoiceClientRequisitesBlock({
  client,
  requisitesId,
  onRequisitesChange,
}: {
  client: Client | null;
  /** Выбранный набор; `null` — основной. */
  requisitesId: string | null;
  onRequisitesChange: (id: string | null) => void;
}) {
  const t = useThemeColors();
  const updateClient = useUpdateClientById();
  const sets = useMemo(() => clientRequisitesOf(client), [client]);
  const chosen = invoiceRequisites(sets, requisitesId);
  const [picker, setPicker] = useState(false);
  // Лист нового набора монтируется заново на каждое открытие — как на
  // карточке клиента (`autoFocus` работает только на монтировании).
  const [sheet, setSheet] = useState<{ key: number; open: boolean } | null>(null);
  const [afterPicker, setAfterPicker] = useState<(() => void) | null>(null);
  const openSheet = () => setSheet((prev) => ({ key: (prev?.key ?? 0) + 1, open: true }));

  const writer = useRequisitesWriter(
    sets,
    async (patch) => {
      if (!client) return false;
      try {
        await updateClient.mutateAsync({ id: client.id, patch });
        return true;
      } catch {
        return false;
      }
    },
    client?.id ?? null,
  );

  return (
    <>
      <SectionCard title="Реквизиты клиента">
        {!client ? (
          <ChooseRow
            icon={Building2}
            label="Добавить реквизиты"
            hint="Станет доступно после выбора клиента"
            disabled
            onPress={() => {}}
          />
        ) : chosen ? (
          <RequisitesRow
            set={chosen}
            markDefault={sets.length > 1}
            separated={false}
            onPress={() => setPicker(true)}
            onLongPress={() => setPicker(true)}
          />
        ) : (
          <ChooseRow
            icon={Building2}
            label="Добавить реквизиты"
            hint="Заводит реквизиты клиента"
            onPress={openSheet}
          />
        )}
      </SectionCard>

      <BottomSheet
        visible={picker}
        title="Реквизиты клиента"
        onClose={() => setPicker(false)}
        onExited={() => {
          const run = afterPicker;
          setAfterPicker(null);
          run?.();
        }}
        padded={false}
        scroll
        footer={
          <View style={{ paddingHorizontal: 16 }}>
            <GradientButton
              label="Добавить реквизиты"
              onPress={() => {
                // Лист набора — после ухода шторки: два модальных листа в
                // одном кадре iOS не показывает.
                setAfterPicker(() => openSheet);
                setPicker(false);
              }}
            />
          </View>
        }
      >
        <SelectList>
          {orderedRequisites(sets).map((set) => (
            <SelectRow
              key={set.id}
              icon={Building2}
              color={t.accent}
              title={set.legal_name || "Юридическое имя не указано"}
              subtitle={subtitle(set)}
              selected={set.id === chosen?.id}
              onPress={() => {
                // Повторный тап по выбранному набору возвращает к основному
                // (владелец 2026-09-22: «нажимаю второй раз — снимается»).
                onRequisitesChange(
                  set.id === chosen?.id ? null : resolveInvoiceRequisitesId(sets, set.id),
                );
                setPicker(false);
              }}
            />
          ))}
        </SelectList>
      </BottomSheet>

      {sheet && client ? (
        <RequisitesSheet
          key={sheet.key}
          visible={sheet.open}
          set={null}
          canMakeDefault={false}
          onClose={() => setSheet((prev) => (prev ? { ...prev, open: false } : prev))}
          onSave={async (fields) => {
            const id = await writer.saveRequisites({ ...fields, id: null });
            if (id === null) return false;
            // Новый набор сразу идёт в этот инвойс (первый станет основным —
            // тогда выбор и так он).
            onRequisitesChange(id);
            return true;
          }}
          onMakeDefault={() => {}}
        />
      ) : null}
    </>
  );
}
