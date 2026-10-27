import { useRef, useState } from "react";

import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useBeforeUnloadWhileDirty } from "@/lib/use-before-unload";
import { useTenantId } from "@/lib/tenant";
import { clearStoredInvoiceDraft } from "@/features/invoices/invoice-editor/stored-draft";
import { randomUuid } from "@babun/shared/sync";
import { InvoiceAlreadyIssuedError } from "@babun/shared/db/repositories/invoices";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useAllServices } from "@/features/services/queries";
import { invoiceGeneratorSettings } from "@/features/invoices/generator-settings";
import {
  InvoiceEditor,
  type InvoiceEditorValue,
} from "@/features/invoices/InvoiceEditor";
import {
  useInvoice,
  useInvoices,
  useIssueInvoice,
  useUpdateInvoice,
} from "@/features/finances/invoices-queries";
import { rememberedDueDays } from "@/features/invoices/due-days";
import { useSession } from "@/providers/SessionProvider";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole , useTenant } from "@/session/tenant";
import { accessGate } from "@/session/my-access";
import { useMyAccess } from "@/session/access-queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/lib/paper/format";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "@/features/finances/vat-queries";

export default function NewInvoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    transactionId?: string;
    clientId?: string;
    appointmentId?: string;
    teamId?: string;
    amount?: string;
    title?: string;
    issuedOn?: string;
    /** Правка выставленного счёта на месте. */
    invoiceId?: string;
  }>();
  const editId = params.invoiceId || undefined;
  const existing = useInvoice(editId);
  const clients = useClients();
  const appointments = useAppointments();
  // Услуги нужны генератору: он расписывает визит их названиями.
  // Счёт читает у услуги ТОЛЬКО имя и описание, ничего не выбирая, поэтому
  // список берётся полный — включая убранные из прайса. Иначе позиция уже
  // выставленного документа теряла название и печаталась заглушкой.
  const services = useAllServices();
  const teams = useTeams();
  // Партнёр выставляет инвойсы только командам, где у него «Документы:
  // Выставляет»; владелец — всем.
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const issueTeams = (teams.data ?? []).filter(
    (team) =>
      role === "owner" ||
      accessGate({ role, map: myAccess, blockKey: "finance.documents", scope: "calendar", teamId: team.id }) ===
        "write",
  );
  const tenant = useTenant();
  // Срок оплаты — как на своём прошлом инвойсе, первый — 30 дней.
  // Отказ списка не держит экран: тогда просто 30.
  const invoices = useInvoices();
  const me = useSession().session?.user.id ?? null;
  const calendarSettings = useCalendarSettings();
  const issue = useIssueInvoice();
  const update = useUpdateInvoice(editId ?? "");
  const vat = useVatSettings();
  const teamVat = useTeamVatOverrides();
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  const requestId = useRef(randomUuid()).current;
  /** Этот id уже уходил на сервер: ответ мог потеряться, а документ — создаться. */
  const sentRef = useRef(false);

  const amount = params.amount ? Number(params.amount) : null;
  // Ждём и настройки НДС (компании И команд): редактор берёт режим ОДИН РАЗ
  // при рождении, и смонтированный раньше ответа он навсегда оставался
  // «Без НДС».
  // Услуги ждём вместе с остальным: смонтированный без них редактор собрал бы
  // строки без названий и запомнил бы их — генератор считает ОДИН раз.
  const loading = clients.isLoading || appointments.isLoading || teams.isLoading
    || services.isLoading || tenant.isLoading || calendarSettings.isLoading
    || vat.isLoading || teamVat.isLoading || invoices.isLoading
    || (!!editId && existing.isLoading);
  // A failed background refetch must not unmount InvoiceEditor and erase the
  // user's draft. Only replace the editor when a required query has no usable
  // data at all; retrying keeps all local form state intact.
  // НДС и услуги стоят в этом же гейте: их отказ гасит isLoading, и редактор
  // молча рождался бы «Без НДС» и со строками без названий.
  const error = (clients.data === undefined ? clients.error : null)
    || (appointments.data === undefined ? appointments.error : null)
    || (teams.data === undefined ? teams.error : null)
    || (services.data === undefined ? services.error : null)
    || (tenant.data === undefined ? tenant.error : null)
    || (calendarSettings.data === undefined ? calendarSettings.error : null)
    || (vat.data === undefined ? vat.error : null)
    || (teamVat.data === undefined ? teamVat.error : null)
    || (editId && existing.data === undefined ? existing.error : null);
  const retry = () => void Promise.all([
    clients.refetch(),
    appointments.refetch(),
    teams.refetch(),
    services.refetch(),
    tenant.refetch(),
    calendarSettings.refetch(),
    vat.refetch(),
    teamVat.refetch(),
  ]);

  const tenantId = useTenantId();
  const submit = async (value: InvoiceEditorValue) => {
    if (editId) {
      const { link_to_tx_id: _link, ...draft } = value;
      const saved = await update.mutateAsync(draft);
      if (value.language && saved.language !== value.language) {
        notify(
          "Изменения сохранены, язык бумаги не сохранился",
          "Документ на прежнем языке. Смените его ещё раз через «Изменить инвойс» в «⋯».",
        );
      }
      // Сохранён — тот же номер, назад к его странице.
      leavingRef.current = true;
      back();
      return;
    }
    const repeat = sentRef.current;
    sentRef.current = true;
    let invoice;
    try {
      invoice = await issue.mutateAsync({ ...value, request_id: requestId, repeat });
    } catch (issueError) {
      // ПРОШЛАЯ ПОПЫТКА УЖЕ ВЫСТАВИЛА ДОКУМЕНТ (ответ на неё потерялся) — ведём
      // на него, а не держим на форме с ошибкой: уход с неё и новая попытка
      // родили бы второй счёт.
      if (!(issueError instanceof InvoiceAlreadyIssuedError)) throw issueError;
      notify("Инвойс уже выставлен", "Прошлая попытка его создала — откроется выставленный документ.");
      clearStoredInvoiceDraft(tenantId, params.teamId);
      leavingRef.current = true;
      router.replace(`/invoices/${issueError.invoice.id}` as Href);
      return;
    }
    // Язык не записался (сеть моргнула дважды) — сказать, а не молчать: иначе
    // клиенту ушла бы русская бумага вместо утверждённой английской.
    if (value.language && invoice.language !== value.language) {
      notify(
        "Инвойс выставлен, язык бумаги не сохранился",
        "Документ пока на русском. Смените язык через «Изменить инвойс» в «⋯».",
      );
    }
    // Выставлен — черновика больше нет, уход без вопроса.
    clearStoredInvoiceDraft(tenantId, params.teamId);
    leavingRef.current = true;
    router.replace(`/invoices/${invoice.id}` as Href);
  };

  // ЗАПОЛНЕННЫЙ ЧЕРНОВИК НЕ ИСЧЕЗАЕТ ПО ОДНОМУ ТАПУ. Клиент, позиции, налог и
  // комментарий — это работа на минуту, и «‹» стирала её без вопроса.
  //
  // ВОПРОС — НА ЛЮБОЙ УХОД, А НЕ ТОЛЬКО НА «‹». Свайп от
  // левого края и системное «назад» снимали экран мимо стрелки, и черновик
  // исчезал молча. Теперь спрашивает сама навигация (`usePreventRemove`, как
  // у черновика клиента), а «‹» просто уходит — тот же вопрос задаст она.
  const [dirty, setDirty] = useState(false);
  const navigation = useNavigation();
  const leavingRef = useRef(false);
  useBeforeUnloadWhileDirty(dirty);
  usePreventRemove(dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    confirmThen(
      "Черновик не сохранён",
      {
        message: "Уйти и потерять заполненное?",
        confirmLabel: "Уйти",
        destructive: true,
      },
      () => {
        // «Уйти» — черновик брошен и после выгрузки не вернётся.
        clearStoredInvoiceDraft(tenantId, params.teamId);
        leavingRef.current = true;
        navigation.dispatch(data.action);
      },
    );
  });
  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace("/finances?view=documents" as Href);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={existing.data ? `Инвойс ${existing.data.number}` : "Новый инвойс"}
        onBack={back}
      />
      {loading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState
          state="error"
          fill
          subtitle={(error as Error).message}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : editId && !existing.data ? (
        <EmptyState fill title="Инвойс не найден" />
      ) : (
        <InvoiceEditor
          existing={existing.data ?? null}
          prefill={{
            transactionId: params.transactionId,
            clientId: params.clientId,
            appointmentId: params.appointmentId,
            teamId: params.teamId,
            amount: Number.isFinite(amount) ? amount : null,
            title: params.title,
            issuedOn: params.issuedOn,
          }}
          // Налог инвойса — из НАСТРОЙКИ, а не из догадки по наличию VAT-номера:
          // раньше компания, работающая «плюсом», получала счёт с налогом
          // внутри цены, то есть на 19% меньше денег. Резолвер — по КОМАНДЕ
          // (Кипр 19 и Греция 24 живут в одном тенанте); счёта у инвойса нет.
          vatForTeam={(teamId) =>
            effectiveVatSettings(
              vat.data,
              teamId
                ? (teamVat.data ?? []).find((o) => o.teamId === teamId)
                : undefined,
              null,
            )
          }
          onDirtyChange={setDirty}
          clients={clients.data ?? []}
          appointments={appointments.data ?? []}
          services={services.data ?? []}
          generator={{
            ...invoiceGeneratorSettings(tenant.data),
            dueDays: rememberedDueDays(invoices.data, me),
          }}
          teams={issueTeams}
          businessToday={businessToday}
          currentBusinessToday={() =>
            todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia")
          }
          tenant={tenant.data}
          submitting={issue.isPending || update.isPending}
          onSubmit={submit}
        />
      )}
    </Screen>
  );
}
