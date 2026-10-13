import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { InvoiceNumberRow } from "@/features/invoices/InvoiceNumberRow";
import { useNextInvoiceSeries } from "@/features/invoices/queries";
import { useThemeColors } from "@/theme/colors";
import { NUMBER_PADDINGS, cleanSeriesPrefix, documentNumberPreview } from "../company-rules";
import type { Company, CompanyDraft } from "../queries";

// БЛОК «НОМЕР» (владелец 03.10: «буквы и длина номера — в реквизитах,
// сразу»). Следующий инвойс показывает набранное до «Сохранить»: сменил
// буквы — видишь, как будет. Порядок номера при этом не трогается — дальше
// идёт тот же счётчик серии, выпущенные бумаги хранят свой номер.
export function SeriesBlock({
  company,
  draft,
  onPadding,
  children,
}: {
  company: Company | null;
  draft: CompanyDraft;
  onPadding: (padding: number) => void;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const year = new Date().getFullYear();
  const next = useNextInvoiceSeries(year, company?.id ?? null).data ?? null;
  const padding = draft.number_padding ?? company?.number_padding ?? 4;
  const prefix =
    cleanSeriesPrefix(draft.invoice_prefix ?? "") || company?.invoice_prefix || "INV";
  return (
    <SectionCard dense title="Номер">
      {company ? (
        <InvoiceNumberRow
          stacked
          label="Следующий инвойс"
          target={{ companyId: company.id, year, next }}
          preview={next ? documentNumberPreview(prefix, year, next.seq, padding) : undefined}
        />
      ) : null}
      {children}
      <View
        style={{
          // Линия — как у строк-полей над ней: от края до края карточки.
          borderTopWidth: 1,
          borderTopColor: t.separator,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 60,
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 15, color: t.ink }}
        >
          Цифр в номере
        </Text>
        <SegmentedControl
          compact
          options={NUMBER_PADDINGS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(padding)}
          onChange={(value) => onPadding(Number(value))}
          style={{ width: 176 }}
        />
      </View>
    </SectionCard>
  );
}
