import { Fragment, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useInClientsTab } from "@/features/clients/reference-href";
import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import type { PhotoKind } from "@babun/shared/db/repositories/appointment-photos";
import type { Receipt as ReceiptDoc } from "@babun/shared/local/finance/receipt";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GradientButton } from "@/components/ui/GradientButton";
import { SelectList } from "@/components/ui/select-rows";
import { useToast } from "@/components/ui/Toast";
import { getSignedUrl, useDeleteAttachment, type ClientAttachment } from "@/features/clients/card-attachments";
import { useClient } from "@/features/clients/queries";
import { groupFilesByDay } from "@/features/clients/client-files";
import { ClientFileRow } from "@/features/clients/ClientFileRow";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { useClientFileUpload, useClientFiles, type ClientFileItem } from "@/features/clients/use-client-files";
import { isVideoPath } from "@/features/appointments/appointment-files";
import { AppointmentPhotoViewer } from "@/features/appointments/AppointmentPhotoViewer";
import { FileAddSheet } from "@/features/appointments/FileAddSheet";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useCardAccess } from "@/features/clients/use-card-access";

// ФАЙЛЫ КЛИЕНТА — ОДНОЙ ЛЕНТОЙ ПО ДНЯМ, КАК «ИСТОРИЯ» (владелец 03.10:
// «файлы — как история, по датам… файлы, чеки, инвойсы — полноценные блоки,
// красивые, чтобы можно было сразу открывать»).
//
// Дверь сюда — последний файл в блоке «Файлы» на карточке. Здесь всё: фото
// со снимком в плитке, документы, фото с выездов, инвойсы и чеки — день
// заголовком (с годом, как в «Финансах»), под ним плашки. Тап открывает файл
// сразу: снимок — просмотрщиком, документ — системным просмотром, инвойс —
// его страницей, чек — листом с «Выслать чек». Прежде инвойсы и чеки лежали
// за строкой «Выдано клиенту → Инвойсы и чеки» на чужой странице.
//
// Удалить можно только вложение клиента — смахнуть влево, с вопросом. Фото с
// выезда принадлежит записи, инвойс и чек аннулируют там, где выписали.
// «Добавить файл» — внизу, на месте главного действия, как «Записать клиента».

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientAttachmentsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientAttachmentsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientAttachmentsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const tenantId = useTenantId();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client } = useClient(id);
  // С 30.09 страница открыта и сотруднику — по праву «Файлы» этого клиента;
  // инвойсы и чеки — по праву «Долг и деньги» (`card-access.ts`).
  const access = useCardAccess(client, false);
  const canChange = access.files.edit;
  const files = useClientFiles(id, access.money.show);
  const upload = useClientFileUpload(id);
  const remove = useDeleteAttachment(id);
  const [addOpen, setAddOpen] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; kind: PhotoKind; source: "attachment" | "visit" } | null>(null);
  const [openReceipt, setOpenReceipt] = useState<ReceiptDoc | null>(null);
  const accountRows = useQuery({
    queryKey: ["accounts", tenantId, "rows", "all"],
    enabled: !!tenantId && openReceipt != null,
    queryFn: () => listAccounts(supabase, tenantId as string, { includeInactive: true }),
  });
  const days = groupFilesByDay(files.timeline);

  const openUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось открыть файл", "error");
    }
  };

  const openAttachment = async (doc: ClientAttachment) => {
    try {
      await openUrl(await getSignedUrl(doc));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось открыть файл", "error");
    }
  };

  const open = (entry: ClientFileItem) => {
    haptics.tap();
    switch (entry.type) {
      case "photo": {
        const url = files.thumbs[entry.item.id];
        if (url) setViewer({ url, kind: "other", source: "attachment" });
        else void openAttachment(entry.item);
        return;
      }
      case "visit":
        if (isVideoPath(entry.item.storage_path)) void openUrl(entry.item.url);
        else setViewer({ url: entry.item.url, kind: entry.item.kind, source: "visit" });
        return;
      case "file":
        void openAttachment(entry.item);
        return;
      case "invoice":
        router.push(`/invoices/${entry.item.id}` as Href);
        return;
      case "receipt":
        setOpenReceipt(entry.item);
        return;
    }
  };

  const confirmDelete = (doc: ClientAttachment) =>
    confirmThen(
      "Удалить файл?",
      { message: doc.filename, confirmLabel: "Удалить", destructive: true },
      () => remove.mutate(doc, { onSuccess: () => toast("Удалено", "info") }),
    );

  // Во вкладке нижний край держит таб-бар; поверх записи — свой.
  const inTab = useInClientsTab();
  return (
    // Нижнюю зону держит таб-бар — как у «Истории»: кнопка внизу стоит на
    // той же высоте, что на соседних экранах.
    <Screen edges={inTab ? ["top"] : undefined}>
      <ScreenHeader title="Файлы" subtitle={client?.full_name || undefined} />

      {!access.files.show ? null : files.isLoading ? (
        <EmptyState state="loading" fill />
      ) : files.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle="Не удалось загрузить файлы."
          action={{ label: "Повторить", onPress: () => void files.refetch() }}
        />
      ) : days.length === 0 && !upload.busy ? (
        // ПУСТО — ОДНИМ СЛОВОМ (закон 15.09): «Добавить файл» — внизу.
        <EmptyState fill title="Файлов нет" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}>
          {upload.busy ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
              <Spinner size={16} label="Загрузка" />
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
                Загружаем файлы…
              </Text>
            </View>
          ) : null}
          {days.map(({ day, items }) => (
            <Fragment key={day}>
              <VisitDayHeader date={day} />
              <SelectList>
                {items.map((entry) => {
                  const row = (
                    <ClientFileRow
                      entry={entry}
                      thumb={entry.type === "photo" ? files.thumbs[entry.item.id] : undefined}
                      onPress={() => open(entry)}
                    />
                  );
                  const own = entry.type === "photo" || entry.type === "file";
                  return own && canChange ? (
                    <SwipeRow
                      key={`${entry.type}-${entry.item.id}`}
                      radius={t.radius.input}
                      label="Удалить"
                      color={t.danger}
                      onAction={() => confirmDelete(entry.item)}
                      accessibilityLabel="Удалить файл"
                    >
                      {row}
                    </SwipeRow>
                  ) : (
                    <View key={`${entry.type}-${entry.item.id}`}>{row}</View>
                  );
                })}
              </SelectList>
            </Fragment>
          ))}
        </ScrollView>
      )}

      {/* «Добавить файл» — внизу, на месте главного действия страницы: тот
          же футер, что «Записать клиента» и «Добавить объект». */}
      {access.files.show && canChange ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="Добавить файл"
            disabled={upload.busy}
            onPress={() => {
              haptics.tap();
              setAddOpen(true);
            }}
          />
        </View>
      ) : null}

      <FileAddSheet visible={addOpen} pickers={upload.pickers} withDocuments onClose={() => setAddOpen(false)} />

      <AppointmentPhotoViewer
        photo={viewer ? { url: viewer.url, kind: viewer.kind, caption: "" } : null}
        onClose={() => setViewer(null)}
        onRetry={async () =>
          (await (viewer?.source === "visit" ? files.refetchVisitPhotos() : files.refetch())).isSuccess
        }
      />

      <ReceiptSheet
        receipt={openReceipt}
        appointment={null}
        accountName={(accountRows.data ?? []).find((a) => a.id === openReceipt?.account_id)?.name ?? null}
        onClose={() => setOpenReceipt(null)}
        onOpen={(href) => router.push(href as Href)}
      />
    </Screen>
  );
}
