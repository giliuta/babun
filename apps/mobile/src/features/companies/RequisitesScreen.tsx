import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { Building2 } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavRow, RowCaption } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
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

// РЕКВИЗИТЫ — СВОЯ СТРАНИЦА В НАСТРОЙКАХ ФИНАНСОВ, КАК УСЛУГИ.
//
// Владелец 2026-09-21: «настройка реквизитов — это будет находиться в
// настройках финансов… полноценно как услуги: добавить реквизиты,
// открывается плашка, туда мы вносим реквизиты, оно там фиксируется, и можно
// добавить сразу несколько». До этого список жил карточкой внутри страницы
// «Бизнес» в Кабинете — второй дверью к тому же, а канон держит одну дверь
// на настройку и ставит её в СВОЙ раздел (владелец 14.09: «у настройки одна
// дверь, в её разделе»).
//
// ЧТО ТАКОЕ ЗАПИСЬ ЗДЕСЬ. НАБОР РЕКВИЗИТОВ, которым подписывают чек и инвойс:
// имя на бумаге, адрес, VAT, рег. номер, счёт в банке, логотип. Компания
// одна, наборов может быть несколько — по юрлицам, под разные бумаги.
//
// Один набор — ОСНОВНОЙ: его подставляет документ, пока человек не выбрал
// другой. За «ровно один основной» следит база частичным уникальным индексом,
// не этот экран.
//
// УДАЛЕНИЯ НЕТ, ЕСТЬ АРХИВ: выданный чек ссылается на реквизиты, которыми
// подписан, и стереть их значит оставить бумагу без продавца.
//
// УСТРОЕНО КАК ОБЪЕКТЫ КЛИЕНТА (владелец 2026-09-21: «по большей степени оно
// даже будет похоже на объекты — то же самое, как добавление объектов… это
// делается единоразово и потом уже не меняется, либо добавляются несколько
// видов реквизитов»). Значит и дверь добавления такая же: строка `ChooseRow`
// ПОСЛЕДНЕЙ в карточке, а не кнопка в футере. Пустой список от этого не
// становится тупиком — в карточке всегда есть эта строка, и отдельное пустое
// состояние здесь не нужно вовсе.

export function RequisitesScreen() {
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
    <Screen edges={["top"]}>
      <ScreenHeader title="Реквизиты" />

      {companies.isLoading ? (
        <EmptyState state="loading" fill />
      ) : companies.isError ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить реквизиты"
          subtitle={
            companies.error instanceof Error ? companies.error.message : undefined
          }
          action={{ label: "Повторить", onPress: () => void companies.refetch() }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionCard>
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
            <ChooseRow
              icon={Building2}
              label="Добавить реквизиты"
              hint="Имя на бумаге, адрес, VAT, банк и логотип"
              onPress={() => show(null)}
            />
          </SectionCard>
          {rows.length > 1 ? (
            <RowCaption text="Основные реквизиты документ подставляет сам. В самом чеке или счёте можно выбрать другие — основные от этого не меняются." />
          ) : null}
        </ScrollView>
      )}

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
                // Первый набор сразу становится основным: справочник, из
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
    </Screen>
  );
}
