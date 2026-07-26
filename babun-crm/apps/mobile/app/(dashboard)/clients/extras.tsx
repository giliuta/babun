import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { AcquisitionSource, Client } from "@babun/shared/local/clients";
import { ACQUISITION_LABELS } from "@babun/shared/local/clients";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import {
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/features/clients/card-rows";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { chooseValue } from "@/lib/choose";

// «ЕЩЁ» — мессенджеры, почта, источник.
//
// Владелец 2026-07-26: «мессенджеры убираем — они будут автоматически
// подтягиваться из чата, я не буду сам их прописывать… но чтоб не было
// постоянно видно: открывающееся окно, куда можно вписать… имейл туда же…
// источник — то же самое, будет максимально автоматически подтягиваться».
//
// Поэтому эти поля больше не занимают карточку: на ней одна строка «Ещё», а
// заполнить руками по-прежнему можно — здесь. Когда появится вкладка «Чат»,
// мессенджеры начнут подставляться сами, и эта страница останется местом,
// где их можно ПОПРАВИТЬ, а не заводить.

const SOURCE_KEYS = Object.keys(ACQUISITION_LABELS) as AcquisitionSource[];

/** @username хранится без «собачки»: её рисует поле, а не данные. */
const stripAt = (v: string) => v.trim().replace(/^@+/, "");

export default function ClientExtrasScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { data: client } = useClient(clientId ?? "");
  const updateClient = useUpdateClient(clientId ?? "");

  const update = (patch: Partial<Client>) => {
    void updateClient.mutateAsync(patch).catch(() => {
      // Алерт про неудачу принадлежит useUpdateClient.
    });
  };

  if (!client) {
    return (
      <Screen>
        <ScreenHeader title="Ещё" />
      </Screen>
    );
  }

  const tg = stripAt(client.telegram_username ?? "");
  const ig = stripAt(client.instagram_username ?? "");
  const source =
    client.acquisition_source && client.acquisition_source !== "unknown"
      ? ACQUISITION_LABELS[client.acquisition_source]
      : null;

  const pickSource = async () => {
    const picked = await chooseValue<AcquisitionSource>(
      "Источник обращения",
      SOURCE_KEYS.map((k) => ({ value: k, label: ACQUISITION_LABELS[k] })),
    );
    if (picked?.value) update({ acquisition_source: picked.value });
  };

  return (
    <Screen>
      <ScreenHeader title="Ещё" subtitle={client.full_name || undefined} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup title="Мессенджеры">
          <FieldRow
            label="Telegram"
            value={tg ? `@${tg}` : ""}
            placeholder="@username"
            stacked
            onSave={(v) => update({ telegram_username: stripAt(v) })}
          />
          <FieldRow
            label="Instagram"
            value={ig ? `@${ig}` : ""}
            placeholder="@username"
            separated
            stacked
            onSave={(v) => update({ instagram_username: stripAt(v) })}
          />
          {/* Отдельный номер WhatsApp — только если он ОТЛИЧАЕТСЯ от
              основного; пустое поле означает «WhatsApp на основном номере». */}
          <FieldRow
            label="WhatsApp, если номер другой"
            value={client.whatsapp_phone}
            placeholder="Номер"
            separated
            stacked
            tabular
            keyboardType="phone-pad"
            onSave={(v) => update({ whatsapp_phone: v })}
          />
        </RowGroup>
        <RowCaption text="Когда появится вкладка «Чат», мессенджеры начнут подтягиваться сами." />

        <RowGroup title="Почта">
          <FieldRow
            label="Email"
            value={client.email}
            placeholder="email@example.com"
            stacked
            keyboardType="email-address"
            onSave={(v) => update({ email: v })}
          />
        </RowGroup>

        <RowGroup title="Откуда пришёл">
          <NavRow
            label="Источник"
            value={source}
            placeholder="неизвестен"
            onPress={() => void pickSource()}
          />
        </RowGroup>
      </ScrollView>
    </Screen>
  );
}
