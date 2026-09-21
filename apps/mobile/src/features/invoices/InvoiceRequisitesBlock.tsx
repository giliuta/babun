import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { CompanySheet } from "@/features/companies/CompanySheet";
import { companyDetail, companyFilled } from "@/features/companies/company-rules";
import {
  defaultCompany,
  useCompanies,
  useMakeDefaultCompany,
  useSaveCompany,
  type Company,
} from "@/features/companies/queries";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

// БЛОК «РЕКВИЗИТЫ» ИНВОЙСА — ЧЕМ ПОДПИСАН ДОКУМЕНТ.
//
// Владелец 2026-09-22 (разбор редактора, «давай то, что рекомендуешь»): строка
// «AirFix LTD — Реквизиты не заполнены» серым справа читалась как пустое
// значение, хотя это предупреждение, а шторка выбора из одного набора была
// лишним шагом. Теперь строка — как у любой сущности: плитка вида набора, имя
// и ПОД НИМ то, что ляжет на бумагу («Основные · Airfix LTD · VAT …»);
// незаполненный набор говорит это цветом предупреждения.
//
// ТАП ВЕДЁТ ТУДА, ГДЕ ОТВЕТ:
//   • набора нет — сразу лист «Новые реквизиты»;
//   • набор один — сразу его лист: выбирать не из чего, есть что дописать;
//   • наборов несколько — шторка выбора с той же подписью, что на странице.
// Лист — тот же `CompanySheet`, что на странице «Реквизиты»: второй формы
// реквизитов в продукте нет.

export function InvoiceRequisitesBlock({
  companyId,
  onCompanyChange,
}: {
  companyId: string | null;
  onCompanyChange: (id: string | null) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const companies = useCompanies();
  const save = useSaveCompany();
  const makeDefault = useMakeDefaultCompany();
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const rows = companies.data ?? [];
  const live = rows.filter((c) => !c.archived_at);
  const company = live.find((c) => c.id === companyId) ?? defaultCompany(rows);
  const empty = !company || !companyFilled(company);

  const edit = (target: Company | null) => {
    setEditing(target);
    setSheetOpen(true);
  };
  const open = () => {
    if (live.length > 1) setPicker(true);
    else edit(company ?? null);
  };

  return (
    <>
      <SectionCard title="Реквизиты">
        <SettingsRow
          appearance={{ color: company?.color, icon: company?.icon, fallback: Building2 }}
          title={company?.name ?? "Реквизиты не заведены"}
          sub={company ? companyDetail(company) : "Добавьте, чем подписывать инвойс"}
          subColor={empty ? t.warning : undefined}
          onPress={open}
        />
      </SectionCard>

      <PickerSheet
        visible={picker}
        title="Реквизиты"
        items={live.map((c) => ({
          id: c.id,
          label: c.name,
          // Та же подпись, что на странице «Реквизиты»: один набор не
          // выглядит в выборе иначе, чем в справочнике.
          hint: companyDetail(c),
          icon: iconPreset(c.icon) ?? Building2,
          color: c.color ?? t.accent,
          onPress: () => {
            onCompanyChange(c.id);
            setPicker(false);
          },
        }))}
        selectedId={company?.id ?? null}
        onSettings={() => {
          setPicker(false);
          router.push("/requisites" as Href);
        }}
        settingsLabel="Реквизиты"
        onClose={() => setPicker(false)}
      />

      <CompanySheet
        visible={sheetOpen}
        company={editing}
        saving={save.isPending}
        onMakeDefault={
          editing && !editing.is_default && !editing.archived_at
            ? () =>
                makeDefault.mutate(editing.id, {
                  onSuccess: () => setSheetOpen(false),
                  onError: (e) => notify("Не переключилось", e.message),
                })
            : undefined
        }
        onClose={() => setSheetOpen(false)}
        onSave={(patch) =>
          save.mutate(
            { id: editing?.id ?? null, patch: editing ? patch : { ...patch, position: rows.length } },
            {
              onSuccess: async (id) => {
                // Первый набор сразу основной — как на странице «Реквизиты».
                if (live.length === 0) await makeDefault.mutateAsync(id);
                setSheetOpen(false);
              },
              onError: (e) => notify("Не сохранилось", e.message),
            },
          )
        }
      />
    </>
  );
}
