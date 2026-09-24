import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { FieldRow, NavRow } from "@/components/ui/card-rows";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { useAppointments } from "@/features/calendar/queries";
import { formatShortDateRu } from "@/features/clients/format";
import {
  getMasterProfile,
  useUpdateMasterProfile,
  type MasterProfile,
} from "@/features/reference/master-profile";
import type { Master } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import { monthWorkOf, workLine } from "./master-work";

// БЛОКИ «РАБОТА», «ЛИЧНОЕ» И «БАНК И НАЛОГИ» НА СТРАНИЦЕ СОТРУДНИКА
// (STORY-087). Раньше они жили на отдельной странице «Информация» старой
// формой — поля в рамках, даты текстом «ГГГГ-ММ-ДД», роли старой системы
// прав. Теперь это блоки главной страницы в том же языке, что у клиента:
// строка «ярлык — значение», даты барабаном, правка на месте.
//
// Записи привязаны к КАЛЕНДАРЮ, а не к мастеру (`appointments.team_id`;
// `master_id` у работ пуст): «работа мастера» — это работа его календарей.

/** «Работа» — сводка месяца и дверь в записи сотрудника. */
export function MasterWorkBlock({
  card,
  teamIds,
}: {
  card: Master;
  teamIds: readonly string[];
}) {
  const router = useRouter();
  const appts = useAppointments();
  const work = useMemo(
    () => monthWorkOf(appts.data ?? [], teamIds, new Date()),
    [appts.data, teamIds],
  );
  return (
    <SectionCard title="Работа" padded={false}>
      {/* Одна дверь: итоги периода и записи — на одной странице. */}
      <NavRow
        label="Записи"
        value={workLine(work)}
        onPress={() =>
          router.push(
            `/calendar/masters/${card.id}/visits?teams=${encodeURIComponent(teamIds.join(","))}` as Href,
          )
        }
      />
    </SectionCard>
  );
}

type DateField = "birthday" | "hire_date";

const DATE_TITLE: Record<DateField, string> = {
  birthday: "День рождения",
  hire_date: "Дата найма",
};

/** «Личное» и «Банк и налоги» — поля профиля карточки мастера. */
export function MasterPersonalBlocks({ card }: { card: Master }) {
  const t = useThemeColors();
  const toast = useToast();
  const update = useUpdateMasterProfile();
  const profile = getMasterProfile(card);
  const [dateOpen, setDateOpen] = useState<DateField | null>(null);

  const write = (patch: MasterProfile) =>
    update.mutate(
      { id: card.id, patch },
      { onError: (error) => toast(error.message || "Не удалось сохранить", "error") },
    );
  // Текст: пустое стирает поле — JSON null, а не undefined (тот пропал бы при
  // сериализации, и правка молча не ушла бы).
  const writeText = (field: keyof MasterProfile, next: string) => {
    const trimmed = next.trim();
    const current = ((profile[field] as string | undefined) ?? "").trim();
    if (trimmed === current) return;
    write({ [field]: trimmed || null } as unknown as MasterProfile);
  };
  const dateValue = (field: DateField) => (profile[field] as string | undefined) || null;

  return (
    <>
      <SectionCard title="Личное" padded={false}>
        {(["birthday", "hire_date"] as const).map((field, i) => {
          const value = dateValue(field);
          return (
            <NavRow
              key={field}
              label={DATE_TITLE[field]}
              value={value ? formatShortDateRu(value) : null}
              placeholder="не указана"
              separated={i > 0}
              onPress={() => {
                haptics.tap();
                setDateOpen(field);
              }}
            />
          );
        })}
        <FieldRow
          label="Адрес"
          value={profile.address ?? ""}
          placeholder="не указан"
          autoCapitalize="sentences"
          separated
          onSave={(v) => writeText("address", v)}
        />
      </SectionCard>

      <SectionCard title="Банк и налоги" padded={false}>
        <FieldRow
          label="IBAN"
          value={profile.iban ?? ""}
          placeholder="не указан"
          autoCapitalize="characters"
          tabular
          onSave={(v) => writeText("iban", v.replace(/\s+/g, " "))}
        />
        <FieldRow
          label="Банк"
          value={profile.bank_name ?? ""}
          placeholder="не указан"
          autoCapitalize="words"
          separated
          onSave={(v) => writeText("bank_name", v)}
        />
        <FieldRow
          label="Налоговый номер"
          value={profile.tax_number ?? ""}
          placeholder="не указан"
          autoCapitalize="characters"
          separated
          onSave={(v) => writeText("tax_number", v)}
        />
        {/* Та же черта между строками, что у полей выше: без неё тумблер
            прилипал к «Налоговому номеру» (аудит 24.09). */}
        <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
          <SwitchRow
            label="Налоговый резидент Кипра"
            value={profile.tax_resident === true}
            onChange={(next) => write({ tax_resident: next })}
          />
        </View>
      </SectionCard>

      <DateWheelSheet
        visible={dateOpen !== null}
        title={dateOpen ? DATE_TITLE[dateOpen] : ""}
        value={dateOpen ? dateValue(dateOpen) : null}
        // День рождения не с сегодняшней даты: у неё смысла нет.
        seed={dateOpen === "birthday" ? "1990-01-01" : undefined}
        clearLabel={dateOpen && dateValue(dateOpen) ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          if (dateOpen) write({ [dateOpen]: ymd } as MasterProfile);
          setDateOpen(null);
        }}
        onClear={() => {
          if (dateOpen) write({ [dateOpen]: null } as unknown as MasterProfile);
          setDateOpen(null);
        }}
        onClose={() => setDateOpen(null)}
      />
    </>
  );
}
