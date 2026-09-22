import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import { Pressable, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
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
import { InvoiceNumberRow, type InvoiceNumberTarget } from "./InvoiceNumberRow";
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
// ТАП ВСЕГДА ОТКРЫВАЕТ ШТОРКУ ВЫБОРА (владелец 2026-09-22: «нажимаю
// реквизиты — снизу вверх шторка, выбираю, какой реквизит»). Анатомия —
// канон шторки выбора (AGENTS 5.2): строки `SelectRow` с той же подписью, что
// на странице «Реквизиты», тап выбирает и закрывает, в футере — «Добавить
// реквизиты», шестерёнка в шапке ведёт на саму страницу. Новый набор
// заводится тем же `CompanySheet`, что на странице: второй формы нет.

export function InvoiceRequisitesBlock({
  companyId,
  onCompanyChange,
  number,
}: {
  companyId: string | null;
  onCompanyChange: (id: string | null) => void;
  /** Строка «Номер» — серия этих реквизитов; у выставленного счёта её нет. */
  number?: InvoiceNumberTarget;
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
  // Лист набора открывается ПОСЛЕ ухода шторки: два модальных листа в одном
  // кадре iOS не показывает.
  const [afterPicker, setAfterPicker] = useState<(() => void) | null>(null);
  const open = () => setPicker(true);

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
        {number ? <InvoiceNumberRow target={number} /> : null}
      </SectionCard>

      <BottomSheet
        visible={picker}
        title="Реквизиты"
        onClose={() => setPicker(false)}
        onExited={() => {
          const run = afterPicker;
          setAfterPicker(null);
          run?.();
        }}
        // Ползунки в шапке — та же дверь на страницу, что у любой шторки
        // выбора из справочника (`PickerSheet`).
        headerAction={
          <Pressable
            onPress={() => {
              setPicker(false);
              router.push("/requisites" as Href);
            }}
            accessibilityRole="button"
            accessibilityLabel="Страница реквизитов"
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Settings2 color={t.sub} size={20} strokeWidth={2} />
          </Pressable>
        }
        padded={false}
        scroll
        footer={
          <View style={{ paddingHorizontal: 16 }}>
            <GradientButton
              label="Добавить реквизиты"
              onPress={() => {
                setAfterPicker(() => () => edit(null));
                setPicker(false);
              }}
            />
          </View>
        }
      >
        <SelectList>
          {live.map((c) => (
            <SelectRow
              key={c.id}
              icon={iconPreset(c.icon) ?? Building2}
              color={c.color ?? t.accent}
              title={c.name}
              subtitle={companyDetail(c)}
              selected={c.id === company?.id}
              onPress={() => {
                onCompanyChange(c.id);
                setPicker(false);
              }}
            />
          ))}
        </SelectList>
      </BottomSheet>

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
