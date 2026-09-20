import { useState } from "react";
import { Text } from "react-native";
import { ActionRow, NavRow, RowCaption } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { CompanySheet } from "./CompanySheet";
import {
  useCompanies,
  useMakeDefaultCompany,
  useSaveCompany,
  type Company,
} from "./queries";

// РЕКВИЗИТЫ — СПИСКОМ, ПРЯМО НА СВОЕЙ СТРАНИЦЕ.
//
// Владелец 2026-09-20: «реквизиты компании и компании — это можешь совместить
// вместе, то есть в реквизиты компании туда добавляются компании». И он прав:
// две двери к одному и тому же («чьи реквизиты печатать на бумаге») — это и
// есть то дублирование, которого канон не терпит.
//
// ЧТО ТАКОЕ ЗАПИСЬ ЗДЕСЬ. НАБОР РЕКВИЗИТОВ, которым подписывают чек и инвойс:
// имя на бумаге, адрес, VAT, счёт в банке. Владелец 2026-09-20 поправил меня
// на слове: «компания — это компания, а именно реквизиты компании». Компания
// одна, наборов может быть несколько — по юрлицам, под разные бумаги.
//
// Один набор — ОСНОВНОЙ: его подставляет документ, пока человек не выбрал
// другой. За «ровно один основной» следит база частичным уникальным индексом,
// не этот экран.
//
// УДАЛЕНИЯ НЕТ, ЕСТЬ АРХИВ: выданный чек ссылается на реквизиты, которыми
// подписан, и стереть их значит оставить бумагу без продавца.

export function CompaniesCard() {
  const t = useThemeColors();
  const toast = useToast();
  const companies = useCompanies();
  const save = useSaveCompany();
  const makeDefault = useMakeDefaultCompany();
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);

  const rows = companies.data ?? [];
  const show = (company: Company | null) => {
    setEditing(company);
    setOpen(true);
  };

  return (
    <>
      <SectionCard title="Реквизиты">
        {rows.map((company, index) => (
          <NavRow
            key={company.id}
            separated={index > 0}
            label={company.name}
            value={company.legal_name || company.business_address || null}
            placeholder="Реквизиты не заполнены"
            dimmed={!!company.archived_at}
            accessory={
              company.is_default ? (
                <Text
                  className="text-[11px] font-semibold uppercase"
                  style={{ color: t.accent }}
                >
                  основные
                </Text>
              ) : undefined
            }
            onPress={() => show(company)}
          />
        ))}
        <ActionRow
          separated={rows.length > 0}
          label="Добавить реквизиты"
          onPress={() => show(null)}
        />
      </SectionCard>
      {rows.length > 1 ? (
        <RowCaption text="Основные реквизиты подставляет документ сам. В самом чеке можно выбрать другие — основные от этого не меняются." />
      ) : null}

      <CompanySheet
        visible={open}
        company={editing}
        saving={save.isPending}
        onMakeDefault={
          editing && !editing.is_default
            ? () =>
                makeDefault.mutate(editing.id, {
                  onSuccess: () => {
                    setOpen(false);
                    toast(`Основные реквизиты — ${editing.name}`, "success");
                  },
                  onError: (error) =>
                    toast(
                      error instanceof Error ? error.message : "Не переключилось",
                      "error",
                    ),
                })
            : undefined
        }
        onClose={() => setOpen(false)}
        onSave={(patch) =>
          save.mutate(
            { id: editing?.id ?? null, patch },
            {
              onSuccess: async (id) => {
                // Первая компания сразу становится основной: справочник, из
                // которого нечего подставить, документу бесполезен.
                if (rows.length === 0) await makeDefault.mutateAsync(id);
                setOpen(false);
              },
              onError: (error) =>
                toast(error instanceof Error ? error.message : "Не сохранилось", "error"),
            },
          )
        }
      />
    </>
  );
}
