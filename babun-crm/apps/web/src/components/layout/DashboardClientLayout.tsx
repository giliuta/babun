"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Sidebar, { type DialogType } from "@/components/layout/Sidebar";
import BottomTabBar from "@/components/layout/BottomTabBar";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { bumpSessionCount } from "@/lib/session-count";

// PWA prompts + splash + sync panel are conditional UI that fires
// after mount based on localStorage gates / platform detection /
// queue depth. next/dynamic({ ssr: false }) lets the dashboard shell
// paint first; the browser fetches these chunks in parallel/idle
// instead of blocking initial JS execution on them. Each component
// is still rendered unconditionally below — React just shows nothing
// until its chunk lands, which is the same as the gated render path.
// PWA install prompts (pwa/InstallPrompt + install/IOSInstallPrompt)
// intentionally NOT mounted — the «Установить Babun» nag kept popping
// up while working via web. Components left on disk; re-mount them
// (here + in the JSX below) when a proper native app ships.
// v495 — splash needs to be in the SSR HTML so the first paint
// already covers the calendar. Previously `dynamic(..., {ssr:false})`
// rendered nothing on the server, the calendar flashed during
// hydration, and only then did the chunk arrive and the overlay
// pop on top. Direct import = bundled with the layout chunk =
// available on the very first paint.
import { SplashScreen } from "@/components/splash/SplashScreen";
const EnableNotificationsPrompt = dynamic(
  () =>
    import("@/components/pwa/EnableNotificationsPrompt").then((m) => ({
      default: m.EnableNotificationsPrompt,
    })),
  { ssr: false },
);
const SyncQueuePanel = dynamic(
  () => import("@/components/sync/SyncQueuePanel"),
  { ssr: false },
);
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useOfflineToast } from "@/hooks/useOfflineToast";
import { installConsoleErrorBuffer } from "@/lib/observability/consoleErrorBuffer";
import {
  type ScheduleMap,
} from "@babun/shared/local/schedule";
import {
  loadMasters,
  saveMasters,
  loadTeams,
  saveTeams,
  defaultPermissionsForRole,
  type Master,
  type Team,
} from "@babun/shared/local/masters";
import {
  loadAppointments,
  saveAppointments,
  loadFieldVisibility,
  saveFieldVisibility,
  loadRequiredFields,
  saveRequiredFields,
  type Appointment,
  type FormFieldVisibility,
  type RequiredFields,
} from "@babun/shared/local/appointments";
import {
  loadServices,
  saveServices,
  loadCategories,
  saveCategories,
  type Service,
  type ServiceCategory,
} from "@babun/shared/local/services";
import {
  type Client,
  type ClientTag,
} from "@babun/shared/local/clients";
// STORY-054 G3 — clients + tags route through cache wrappers
// (lib/sync/{clientsCached,tagsCached}) so write paths optimistically
// hit IDB and queue when offline. Read paths SWR via cache.
import {
  listClients,
  createClient as createClientRepo,
  updateClient as updateClientRepo,
  deleteClient as deleteClientRepo,
} from "@/lib/sync/clientsCached";
import {
  listClientTags,
  createClientTag,
  updateClientTag,
  deleteClientTag,
} from "@/lib/sync/tagsCached";
// STORY-054 G3 — appointments route through cache wrappers.
import {
  listAppointments as listAppointmentsRepo,
  createAppointment as createAppointmentRepo,
  updateAppointment as updateAppointmentRepo,
  deleteAppointment as deleteAppointmentRepo,
} from "@/lib/sync/appointmentsCached";
import {
  listScheduleEntries,
  upsertScheduleEntry,
} from "@babun/shared/db/repositories/schedule";
import {
  getCalendarSettings as getCalendarSettingsRepo,
  updateCalendarSettings as updateCalendarSettingsRepo,
} from "@babun/shared/db/repositories/calendar-settings";
import {
  listDayCities as listDayCitiesRepo,
  setDayCity as setDayCityRepo,
} from "@babun/shared/db/repositories/day-cities";
import {
  listDayExtras as listDayExtrasRepo,
  setDayExtras as setDayExtrasRepo,
} from "@babun/shared/db/repositories/day-extras";
import { insertAccount } from "@babun/shared/db/repositories/accounts";
import { signOut } from "@/lib/supabase/auth-client";
import { enforceCacheOwner } from "@/lib/sync/auth-clear";
import UnconfirmedEmailBanner from "@/components/auth/UnconfirmedEmailBanner";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  loadTemplates,
  saveTemplates,
  type SmsTemplate,
} from "@babun/shared/local/sms-templates";
import {
  loadExpenseCategories,
  saveExpenseCategories,
  type ExpenseCategory,
} from "@babun/shared/local/expense-categories";
import {
  loadDayCities,
  saveDayCities,
  setDayCity,
  getDayCity,
  type DayCityMap,
} from "@babun/shared/local/day-cities";
import {
  setDayExtrasFor,
  getDayExtras,
  type DayExtrasMap,
  type DayExtra,
} from "@babun/shared/local/day-extras";
import {
  loadCalendarSettings,
  saveCalendarSettings,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { loadCities, saveCities, type City } from "@babun/shared/local/cities";
import {
  loadEquipment,
  saveEquipment,
  type Equipment,
} from "@babun/shared/local/equipment";
import {
  loadLocationLabels,
  saveLocationLabels,
  type LocationLabel,
} from "@babun/shared/local/location-labels";
import { warmUpHaptics } from "@/lib/haptics";
import { getStorage } from "@babun/shared/storage";
import { useRealtimeTenantSync } from "@/hooks/useRealtimeTenantSync";
import {
  fetchTenantState,
  restoreEmptyStoresFromBlob,
  scheduleTenantStateSave,
} from "@/lib/sync/tenant-state-backup";
import { reportSyncError } from "@/lib/sync/sync-error-bus";
import { logAudit } from "@/lib/audit/audit-log";
import { useIsDesktop } from "@/lib/useIsDesktop";
// useDashboardSwipeTrap removed in v428 — its sentinel-pushing
// pattern collided with router.push from sidebar Links and from the
// PageHeader back arrow, leaving users stuck on stale routes. Edge
// swipe-back is already blocked by the EdgeGuard strips in the
// dashboard layout + global overscroll-behavior in globals.css.
import { kickReplayer } from "@/lib/sync/replayer";
import { setSyncToast } from "@/lib/sync/clientsCached";
import { subscribeNetwork, isOnline } from "@/lib/sync/network";
import { queueDepth } from "@babun/shared/db/cache";
import OfflineIndicator from "@/components/sync/OfflineIndicator";
// SyncQueuePanel — lazy-loaded via the next/dynamic block at the top
// of this file (only opens when the user taps the offline indicator).

interface SidebarContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within DashboardLayout");
  return ctx;
}

// STORY-049 — expose the server-resolved tenant + user identity via
// context so leaf components can read them synchronously, without
// re-fetching from Supabase. Without this, screens like the Settings
// hero card would show a placeholder ("Babun") on first paint and
// flicker to the real name once a client-side getUser() landed.
interface TenantContextValue {
  id: string;
  name: string;
  email: string;
  emailConfirmed: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenantId(): string {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenantId must be used within DashboardLayout");
  return ctx.id;
}

/** Tenant display name. Resolved server-side, synchronous on the client.
 *  STORY-060 §F3.3 — canonical fallback "Моя компания" when the DB row has
 *  an empty/whitespace-only name (legacy onboarding gap, hand-rolled SQL,
 *  pre-onboarded shells). Centralising the fallback here keeps every
 *  consumer free of `name || "..."` boilerplate and guarantees we never
 *  surface a blank string to the user. */
export function useTenantName(): string {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenantName must be used within DashboardLayout");
  const trimmed = ctx.name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Моя компания";
}

/** Authenticated user's email. Empty string when unavailable. */
export function useUserEmail(): string {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useUserEmail must be used within DashboardLayout");
  return ctx.email;
}

export function useEmailConfirmed(): boolean {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useEmailConfirmed must be used within DashboardLayout");
  return ctx.emailConfirmed;
}

interface SchedulesContextValue {
  schedules: ScheduleMap;
  setSchedules: (next: ScheduleMap) => void;
}

const SchedulesContext = createContext<SchedulesContextValue | null>(null);

export function useSchedules() {
  const ctx = useContext(SchedulesContext);
  if (!ctx) throw new Error("useSchedules must be used within DashboardLayout");
  return ctx;
}

interface MastersContextValue {
  masters: Master[];
  setMasters: (next: Master[]) => void;
  upsertMaster: (master: Master) => void;
  deleteMaster: (id: string) => void;
}

const MastersContext = createContext<MastersContextValue | null>(null);

export function useMasters() {
  const ctx = useContext(MastersContext);
  if (!ctx) throw new Error("useMasters must be used within DashboardLayout");
  return ctx;
}

// Sprint 033 Phase I37 — Current master context. Until Supabase Auth
// lands, `currentMasterId` is a stub: first admin / dispatcher found
// in the masters list. Gives the personal-calendar feature a stable
// owner so we can ship the UX before the auth layer.
interface CurrentMasterContextValue {
  currentMasterId: string | null;
  /** Dev-only setter — the settings page exposes a switcher so a
   *  single-tenant dev account can preview how each master sees
   *  their personal calendar. */
  setCurrentMasterId: (id: string | null) => void;
}

const CurrentMasterContext = createContext<CurrentMasterContextValue | null>(
  null,
);

export function useCurrentMaster() {
  const ctx = useContext(CurrentMasterContext);
  if (!ctx)
    throw new Error("useCurrentMaster must be used within DashboardLayout");
  return ctx;
}

interface TeamsContextValue {
  teams: Team[];
  setTeams: (next: Team[]) => void;
  upsertTeam: (team: Team) => void;
  deleteTeam: (id: string) => void;
  /** True once the tenant_state backup blob has been consulted (cloud
   *  restore settled). Until then a fresh-device / cleared-cache session
   *  has an empty local store even though real calendars may be loading —
   *  so `teams.length === 0` cannot yet be trusted as «no calendar». */
  teamsLoaded: boolean;
}

const TeamsContext = createContext<TeamsContextValue | null>(null);

export function useTeams() {
  const ctx = useContext(TeamsContext);
  if (!ctx) throw new Error("useTeams must be used within DashboardLayout");
  return ctx;
}

interface AppointmentsContextValue {
  appointments: Appointment[];
  /** True until the first listAppointments() resolves. Calendar
   *  pages can render a skeleton while this is true. */
  appointmentsLoading: boolean;
  /** Last error message from a load. UI can show a retry banner. */
  appointmentsError: string | null;
  /** Manual refetch. */
  reloadAppointments: () => Promise<void>;
  /** STORY-042 — both create and update funnel through the repo.
   *  Async: caller may await but doesn't have to. Nested arrays in
   *  the patch are REPLACED ATOMICALLY by the repo (no merge). */
  upsertAppointment: (apt: Appointment) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;
  getAppointment: (id: string) => Appointment | undefined;
}

const AppointmentsContext = createContext<AppointmentsContextValue | null>(null);

export function useAppointments() {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) throw new Error("useAppointments must be used within DashboardLayout");
  return ctx;
}

interface FormSettingsContextValue {
  fieldVisibility: FormFieldVisibility;
  setFieldVisibility: (next: FormFieldVisibility) => void;
  requiredFields: RequiredFields;
  setRequiredFields: (next: RequiredFields) => void;
}

const FormSettingsContext = createContext<FormSettingsContextValue | null>(null);

export function useFormSettings() {
  const ctx = useContext(FormSettingsContext);
  if (!ctx) throw new Error("useFormSettings must be used within DashboardLayout");
  return ctx;
}

interface ServicesContextValue {
  services: Service[];
  setServices: (next: Service[]) => void;
  upsertService: (svc: Service) => void;
  deleteService: (id: string) => void;
  categories: ServiceCategory[];
  setCategories: (next: ServiceCategory[]) => void;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

interface EquipmentContextValue {
  equipment: Equipment[];
  setEquipment: (next: Equipment[]) => void;
  upsertEquipment: (e: Equipment) => void;
  deleteEquipment: (id: string) => void;
}
const EquipmentContext = createContext<EquipmentContextValue | null>(null);
export function useEquipment() {
  const ctx = useContext(EquipmentContext);
  if (!ctx) throw new Error("useEquipment must be used within DashboardLayout");
  return ctx;
}

export function useServices() {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within DashboardLayout");
  return ctx;
}

interface ClientsContextValue {
  clients: Client[];
  /** True until the first listClients() resolves. Pages that show
   *  the full list should render a skeleton while this is true. */
  clientsLoading: boolean;
  /** Last error message from a load. UI can show a retry banner. */
  clientsError: string | null;
  /** Manual refetch — used by retry buttons. */
  reloadClients: () => Promise<void>;
  setClients: (next: Client[]) => void;
  upsertClient: (c: Client) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  tags: ClientTag[];
  setTags: (next: ClientTag[]) => void;
  upsertTag: (tag: ClientTag) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}

const ClientsContext = createContext<ClientsContextValue | null>(null);

export function useClients() {
  const ctx = useContext(ClientsContext);
  if (!ctx) throw new Error("useClients must be used within DashboardLayout");
  return ctx;
}

interface SmsTemplatesContextValue {
  templates: SmsTemplate[];
  setTemplates: (next: SmsTemplate[]) => void;
  upsertTemplate: (tpl: SmsTemplate) => void;
}

const SmsTemplatesContext = createContext<SmsTemplatesContextValue | null>(null);

export function useSmsTemplates() {
  const ctx = useContext(SmsTemplatesContext);
  if (!ctx) throw new Error("useSmsTemplates must be used within DashboardLayout");
  return ctx;
}

interface ExpenseCategoriesContextValue {
  categories: ExpenseCategory[];
  setCategories: (next: ExpenseCategory[]) => void;
}

const ExpenseCategoriesContext = createContext<ExpenseCategoriesContextValue | null>(null);

export function useExpenseCategories() {
  const ctx = useContext(ExpenseCategoriesContext);
  if (!ctx) throw new Error("useExpenseCategories must be used within DashboardLayout");
  return ctx;
}

interface DayCitiesContextValue {
  dayCities: DayCityMap;
  setCityFor: (teamId: string, dateKey: string, city: string) => void;
  getCityFor: (teamId: string | null, dateKey: string, teamDefault: string) => string;
}

const DayCitiesContext = createContext<DayCitiesContextValue | null>(null);

export function useDayCities() {
  const ctx = useContext(DayCitiesContext);
  if (!ctx) throw new Error("useDayCities must be used within DashboardLayout");
  return ctx;
}

interface DayExtrasContextValue {
  dayExtras: DayExtrasMap;
  getExtrasFor: (teamId: string | null, dateKey: string) => DayExtra[];
  setExtrasFor: (teamId: string, dateKey: string, extras: DayExtra[]) => void;
}

const DayExtrasContext = createContext<DayExtrasContextValue | null>(null);

export function useDayExtras() {
  const ctx = useContext(DayExtrasContext);
  if (!ctx) throw new Error("useDayExtras must be used within DashboardLayout");
  return ctx;
}

interface CalendarSettingsContextValue {
  calendarSettings: CalendarSettings;
  setCalendarSettings: (next: CalendarSettings) => void;
}

const CalendarSettingsContext = createContext<CalendarSettingsContextValue | null>(null);

export function useCalendarSettings() {
  const ctx = useContext(CalendarSettingsContext);
  if (!ctx) throw new Error("useCalendarSettings must be used within DashboardLayout");
  return ctx;
}

interface CitiesContextValue {
  cities: City[];
  setCities: (next: City[]) => void;
}

const CitiesContext = createContext<CitiesContextValue | null>(null);

export function useCities() {
  const ctx = useContext(CitiesContext);
  if (!ctx) throw new Error("useCities must be used within DashboardLayout");
  return ctx;
}

interface LocationLabelsContextValue {
  locationLabels: LocationLabel[];
  setLocationLabels: (next: LocationLabel[]) => void;
}

const LocationLabelsContext = createContext<LocationLabelsContextValue | null>(null);

export function useLocationLabels() {
  const ctx = useContext(LocationLabelsContext);
  if (!ctx) throw new Error("useLocationLabels must be used within DashboardLayout");
  return ctx;
}

// v328 + STORY-064 — transparent strip pinned to the left or right
// edge of the viewport. Captures touchstart with `touch-action: none`
// and preventDefault, so iOS PWA's native swipe-back/-forward
// gesture cannot fire. Vertical scrolling, internal SwipeableRow
// gestures, etc. happen further inside and are untouched.
//
// STORY-064 changes:
//   * Width 16 → 24 px. iOS PWA in iOS 26+ activates the system
//     edge-back gesture from the first ~20 px of the screen edge —
//     a 16-px strip wasn't catching every finger placement. 24 px
//     covers the gesture activation zone with margin to spare.
//   * Position absolute → fixed. The previous absolute placement
//     resolved relative to <main>, which has safe-area-left
//     padding from the parent. On notched iPhones in landscape
//     that pushed the strip ~44 px inboard, leaving the actual
//     screen edge unguarded. `position: fixed` anchors to the
//     viewport so the strip always reaches the device edge.
function EdgeGuard({ side }: { side: "left" | "right" }) {
  // STORY-085 — bumped width from 24 to 40 px to stop iOS edge-swipe
  // gesture on small phones in landscape. Non-passive touchstart so
  // preventDefault actually fires (React's onTouchStart is passive).
  //
  // v502 — taps inside the strip used to be eaten too (the original
  // touchstart handler preventDefault-ed every single-finger touch
  // unconditionally). Result: the rightmost 40 px of the calendar
  // didn't respond to taps — user perceived this as «clicks land
  // 40 px to the left». New logic: hold off on preventDefault until
  // we actually see a horizontal swipe — a brief tap with no move
  // (or a vertical scroll) passes through to the calendar untouched.
  return (
    <div
      aria-hidden
      ref={(el) => {
        if (!el) return;
        let startX = 0;
        let startY = 0;
        let prevented = false;
        const onStart = (e: TouchEvent) => {
          if (e.touches.length !== 1) return;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          prevented = false;
        };
        const onMove = (e: TouchEvent) => {
          if (prevented || e.touches.length !== 1) return;
          const dx = Math.abs(e.touches[0].clientX - startX);
          const dy = Math.abs(e.touches[0].clientY - startY);
          // Treat as edge-swipe only when horizontal travel dominates
          // AND has reached ~6 px (below this point it's still
          // ambiguous; iOS hasn't decided either). Once it's a swipe,
          // preventDefault to keep the browser's edge-back gesture
          // from kicking in.
          if (dx > 6 && dx > dy) {
            e.preventDefault();
            prevented = true;
          }
        };
        el.addEventListener("touchstart", onStart, { passive: true });
        el.addEventListener("touchmove", onMove, { passive: false });
        // No cleanup — this element lives for the dashboard layout's
        // entire lifetime; listeners go with it on unmount.
      }}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        [side]: 0,
        width: 40,
        zIndex: 50,
        // touchAction: "pan-y" lets vertical scrolling work inside
        // the strip (so the user can scroll the calendar grid even
        // when their thumb starts in the edge band). Horizontal
        // movement is what we suppress via preventDefault above.
        touchAction: "pan-y",
        pointerEvents: "auto",
        background: "transparent",
      }}
    />
  );
}

interface DashboardClientLayoutProps {
  children: React.ReactNode;
  /** Resolved on the server from auth.users → tenants. Source of
   *  truth for every repo call inside the dashboard tree. */
  tenantId: string;
  /** Live tenant name from the DB. Replaces the legacy "Babun CRM"
   *  hardcode in the sidebar; user edits it via
   *  /dashboard/settings/account/personal. */
  tenantName: string;
  /** Shown in the sidebar footer. Empty string if not available. */
  userEmail: string;
  /** False → render the unconfirmed-email banner above the main area. */
  emailConfirmed: boolean;
}

export default function DashboardClientLayout({
  children,
  tenantId,
  tenantName,
  userEmail,
  emailConfirmed,
}: DashboardClientLayoutProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // G7 — sync panel state lives here, not in OfflineIndicator, so
  // dropping the queue to 0 doesn't unmount an open panel.
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  // STORY-056 — PWA prompts, EdgeGuard, and the floating offline pill
  // are mobile-only artefacts. Hide them on desktop (≥ 1024 px).
  const isDesktop = useIsDesktop();

  // useDashboardSwipeTrap removed in v428 — see import comment above.

  // v316 — Prime the haptics audio context + iOS taptic switch on
  // the first user gesture.  Without this, iOS Safari suspends the
  // AudioContext and the very first haptic() call after launch is
  // silent.  Listener is { once: true } so it self-removes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prime = () => {
      warmUpHaptics();
    };
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("touchstart", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("touchstart", prime);
    };
  }, []);

  // STORY-053b — bump the session counter so EnableNotificationsPrompt
  // can gate on "user has actually used the app at least twice".
  useEffect(() => {
    bumpSessionCount();
  }, []);

  // STORY-054 G3a → STORY-052 G5b — sync warning toasts now go
  // through the real Toast UI. The wiring lives in <SyncToastBridge>
  // below the ToastProvider so useToast() resolves correctly.

  // STORY-054 G3a — drain the offline queue on offline→online
  // transitions. useRealtimeTenantSync.onResync (set up further
  // down) covers Supabase-channel reconnects, but a fast network
  // flap (offline 5s → online) may not disconnect the realtime
  // channel at all. The browser's `online` event is the lower-
  // level signal. Mounted once at dashboard layout. We call
  // getSupabaseBrowser() inside the effect because the
  // `supabaseClient` const is declared later in this component;
  // the getter is an idempotent singleton.
  useEffect(() => {
    let wasOffline = !isOnline();
    return subscribeNetwork((online) => {
      if (online && wasOffline) {
        void kickReplayer({ supabase: getSupabaseBrowser() });
      }
      wasOffline = !online;
    });
  }, []);

  // STORY-054 G4b — one-shot drain at mount when we boot online with
  // a non-empty queue. Without this, a user who closes the PWA with
  // pending offline writes and reopens it later (online) would see
  // the «Синхронизация: N» badge stuck — the network listener only
  // fires on offline→online transitions, not on first mount, and
  // realtime onResync only fires after a disconnect. queueDepth()
  // is sub-millisecond against IDB so the gate is cheap.
  useEffect(() => {
    if (!isOnline()) return;
    let cancelled = false;
    void (async () => {
      try {
        const depth = await queueDepth();
        if (cancelled || depth === 0) return;
        void kickReplayer({ supabase: getSupabaseBrowser() });
      } catch {
        /* IDB unavailable (private mode / SSR) — leave silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // STORY-054 G5 — listen for replay nudges from the Service Worker.
  // The SW posts BABUN_SYNC_REPLAY when (a) the Background Sync
  // event fires (Chromium only — connectivity restored while the
  // page was backgrounded) or (b) a push notification arrives. Both
  // are good signals to flush any locally-queued writes the user
  // made while the tab wasn't focused.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type !== "BABUN_SYNC_REPLAY") return;
      void kickReplayer({ supabase: getSupabaseBrowser() });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);
  const [schedules, setSchedulesState] = useState<ScheduleMap>({});
  const [masters, setMastersState] = useState<Master[]>([]);
  // v796 — lazy-init from localStorage (same pattern as dayCities /
  // calendarSettings below) so the team list is known on the client's
  // FIRST render. The calendar page gates its whole render on this: no
  // teams → «Создать календарь» screen, never a flash of the empty grid.
  const [teams, setTeamsState] = useState<Team[]>(() => loadTeams());
  // v482 — hydrate from localStorage synchronously so the UI paints
  // any rows the user created right before closing the app, even if
  // the IDB / Supabase round-trip from `reloadAppointments` is still
  // in flight (or hasn't started because the network is slow). The
  // localStorage mirror is written on every upsert / delete below, so
  // it's the most recent client-side snapshot the app has.
  const [appointments, setAppointmentsState] = useState<Appointment[]>(() =>
    typeof window === "undefined" ? [] : loadAppointments(),
  );
  // STORY-042 — appointments now live in Supabase. Hydrated on mount
  // via listAppointments(); calendar pages see [] until then.
  const [appointmentsLoading, setAppointmentsLoading] = useState<boolean>(true);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);
  const [services, setServicesState] = useState<Service[]>([]);
  const [serviceCategories, setServiceCategoriesState] = useState<ServiceCategory[]>([]);
  // STORY-036 — clients vertical now lives in Supabase. The list is
  // hydrated on mount via listClients(); other consumers see [] until
  // hydration completes (~50–250 ms on warm Wi-Fi). Pages that need
  // the loading state read `clientsLoading` from the context.
  const [clients, setClientsState] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState<boolean>(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientTags, setClientTagsState] = useState<ClientTag[]>([]);
  // tenantId now comes from the server layout via prop (STORY-037 G5).
  // tenantName + userEmail flow into the Sidebar so the brand row
  // renders the live tenant identity instead of a hardcoded string.
  const [smsTemplates, setSmsTemplatesState] = useState<SmsTemplate[]>([]);
  const [expenseCategories, setExpenseCategoriesState] = useState<ExpenseCategory[]>([]);
  // STORY audit (user bug «метка пролагивает при заходе»): раньше
  // dayCities стартовал с {} и заполнялся в useEffect после Supabase
  // round-trip. На первый paint labels резолвили в `teamDefault`
  // (ПАФ для всех дней), потом fill приходил — менялись на правильные
  // (НИК на ЧТ, ЛИМ на ПТ). Видно как flicker. Lazy initializer
  // подгружает map из localStorage синхронно — на первый paint уже
  // правильные labels. Supabase round-trip потом перезаписывает с
  // freshest server data, но видимого скачка не будет если localStorage
  // совпадает с базой (обычный случай).
  const [dayCities, setDayCitiesState] = useState<DayCityMap>(() => {
    if (typeof window === "undefined") return {};
    return loadDayCities();
  });
  const [dayExtras, setDayExtrasState] = useState<DayExtrasMap>({});
  const [calendarSettings, setCalendarSettingsState] = useState<CalendarSettings>(() => {
    if (typeof window === "undefined") {
      // SSR default — full shape so the type checker is happy.
      return {
        startHour: 9,
        endHour: 20,
        gridStep: 30,
        weekStart: "monday",
        timezone: "Europe/Nicosia",
        bufferMinutes: 0,
        hideCancelled: false,
        allowOvertime: false,
      };
    }
    return loadCalendarSettings();
  });
  const [cities, setCitiesState] = useState<City[]>([]);
  const [equipment, setEquipmentState] = useState<Equipment[]>([]);
  const [locationLabels, setLocationLabelsState] = useState<LocationLabel[]>([]);
  // Phase I37 — stubbed "current master". Seeded lazily from the
  // masters list when it loads. Persisted in localStorage for dev so
  // you stay logged in as the same master across reloads.
  const CURRENT_MASTER_KEY = "babun2:current-master";
  const [currentMasterId, setCurrentMasterIdState] = useState<string | null>(() =>
    getStorage().getRaw(CURRENT_MASTER_KEY),
  );
  const [fieldVisibility, setFieldVisibilityState] = useState<FormFieldVisibility>({
    show_address: true,
    show_comment: true,
    show_prepaid: true,
    show_payments: true,
    show_source: false,
    show_reminder: false,
  });
  const [requiredFields, setRequiredFieldsState] = useState<RequiredFields>({
    require_client: true,
    require_phone: true,
    require_services: true,
    require_address: false,
    require_comment: false,
  });
  // v662 — gate the tenant_state backup-save effect until the
  // hydration pass has run. Without this gate, the save fires on
  // first render with whatever is in localStorage (possibly empty if
  // iOS Safari evicted) and clobbers the server-side backup blob —
  // destroying the only safety net for fresh-device / evicted-cache
  // recovery scenarios.
  const [backupHydrated, setBackupHydrated] = useState(false);

  // Seed currentMasterId once masters are loaded. Defaults to first
  // admin, then first dispatcher, then any active master — whichever
  // is found first. Writes-through to localStorage so the setter is
  // persistent.
  //
  // v463 — bootstrap a default master on a fresh PWA install / new
  // device. Without this the personal calendar pill stays empty
  // (regression first reported 2026-05-09). The master is local-only
  // for now; STORY-057 will move masters to Supabase so the user
  // sees the same data across devices.
  useEffect(() => {
    if (currentMasterId && masters.some((m) => m.id === currentMasterId)) {
      return;
    }
    // v506 — guard against a race with the localStorage hydration
    // effect below. This effect is declared before the
    // `setMastersState(loadMasters())` effect, so on the very first
    // render `masters` is still the initial empty array even if
    // localStorage already has masters from a previous session. Without
    // this guard the bootstrap branch below saw `masters.length === 0`,
    // wrote a brand-new owner-master with a fresh UUID, and called
    // `saveMasters([defaultMaster])` — destroying any user-created
    // masters that lived in localStorage. The fix: peek at
    // localStorage directly; if it has masters, bail and let the
    // hydration effect populate state on the next render.
    if (masters.length === 0) {
      const persisted = loadMasters();
      if (persisted.length > 0) return;
    }
    // v662 — ALSO wait until the v505 tenant_state blob restore has
    // a chance to fire. Otherwise: fresh device, localStorage empty,
    // blob restore async in flight, bootstrap effect sees nothing
    // and creates a single default-admin master → that one master
    // now lives in localStorage → restoreEmptyStoresFromBlob skips
    // the masters branch (length 1 ≠ 0) → user loses the real 5
    // masters they had on the other device.
    if (!backupHydrated) return;
    if (masters.length === 0 && userEmail) {
      const localPart = userEmail.split("@")[0] || "Я";
      const displayName = localPart
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ") || "Я";
      const defaultMaster: Master = {
        id: crypto.randomUUID(),
        full_name: displayName,
        phone: "",
        team_id: null,
        role: "admin",
        is_active: true,
        permissions: defaultPermissionsForRole("admin"),
        created_at: new Date().toISOString(),
        login_email: userEmail,
      };
      setMastersState([defaultMaster]);
      saveMasters([defaultMaster]);
      setCurrentMasterIdState(defaultMaster.id);
      getStorage().setRaw(CURRENT_MASTER_KEY, defaultMaster.id);
      return;
    }
    const pick =
      masters.find((m) => m.is_active && m.role === "admin") ??
      masters.find((m) => m.is_active && m.role === "dispatcher") ??
      masters.find((m) => m.is_active) ??
      masters[0];
    if (pick) {
      setCurrentMasterIdState(pick.id);
      getStorage().setRaw(CURRENT_MASTER_KEY, pick.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masters, userEmail, backupHydrated]);

  const setCurrentMasterId = useCallback((id: string | null) => {
    setCurrentMasterIdState(id);
    if (id) getStorage().setRaw(CURRENT_MASTER_KEY, id);
    else getStorage().remove(CURRENT_MASTER_KEY);
  }, []);

  // Load all persisted state from localStorage on mount.
  // STORY-036: clients + tags moved to Supabase — they are loaded in
  // a separate effect below so we can surface loading/error state.
  useEffect(() => {
    // STORY-044 — schedules now hydrate from Supabase in the
    // schedule reload effect below; keep the localStorage fallback
    // empty here so the initial render doesn't flash stale data.
    setMastersState(loadMasters());
    setTeamsState(loadTeams());
    // STORY-042 — appointments hydrated from Supabase in a separate
    // effect below; no mount-time localStorage read.
    setServicesState(loadServices());
    setServiceCategoriesState(loadCategories());
    setSmsTemplatesState(loadTemplates());
    setExpenseCategoriesState(loadExpenseCategories());
    // STORY-044 — day_cities, day_extras, calendar_settings hydrate
    // from Supabase in the effect below.
    setCitiesState(loadCities());
    setEquipmentState(loadEquipment());
    setLocationLabelsState(loadLocationLabels());
    setFieldVisibilityState(loadFieldVisibility());
    setRequiredFieldsState(loadRequiredFields());
    // STORY-007: legacy key cleanup. Drafts are gone — any leftover
    // records would never surface in the UI again, so drop them so
    // storage stays tidy.
    getStorage().remove("babun-draft-clients");
  }, []);

  // STORY-036 — fetch clients + tags from Supabase. Surfaces
  // loading + error state via context so /dashboard/clients can
  // render a skeleton + retry banner.
  const reloadClients = useCallback(async () => {
    setClientsError(null);
    setClientsLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const [list, tagList] = await Promise.all([
        listClients(supabase, tenantId),
        listClientTags(supabase, tenantId),
      ]);
      // v662 — defensive merge against transient empty server reads.
      // Without this, a momentary RLS / auth-refresh / network flicker
      // that returns `[]` from listClients silently nuked the entire
      // client roster in React state. Pattern matches reloadAppointments
      // (v499) and reloadSchedule (v662).
      setClientsState((prev) => {
        if (list.length === 0 && prev.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadClients] empty server response — keeping",
            prev.length,
            "local rows (auth/RLS/network flicker)",
          );
          return prev;
        }
        return list;
      });
      setClientTagsState((prev) => {
        if (tagList.length === 0 && prev.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadClients] empty client_tags — keeping",
            prev.length,
            "local rows",
          );
          return prev;
        }
        return tagList;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось загрузить клиентов";
      setClientsError(msg);
    } finally {
      setClientsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void reloadClients();
  }, [reloadClients]);

  // STORY-042 — fetch appointments from Supabase. Excludes the
  // `photos` jsonb column to keep the calendar grid lean (photos can
  // be 50–500 KB base64 each); the appointment sheet calls
  // getAppointment(id) for the full row when needed.
  const reloadAppointments = useCallback(async () => {
    setAppointmentsError(null);
    setAppointmentsLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const list = await listAppointmentsRepo(supabase, tenantId);
      // v499 — DEFENSIVE merge against accidental data loss.
      // v482 already kept locally-persisted rows that the server
      // hadn't seen yet, but it BLINDLY accepted server-empty as
      // «truth» — and a transient empty response (auth flicker /
      // RLS race / network blip / wrong tenantId in flight) then
      // wiped `prev` state, which `saveAppointments` propagated to
      // localStorage. The user lost a screenful of events.
      //
      // New rule: server is preferred for fields that exist on
      // both sides, but a row that exists in `prev` (latest in-
      // memory) or `localStorage` (durable client snapshot) and is
      // ABSENT from server stays. Deletes via other devices won't
      // propagate to this device until that device's user touches
      // the row, but the trade-off is bullet-proof: data never
      // disappears mysteriously.
      setAppointmentsState((prev) => {
        const local =
          typeof window === "undefined" ? [] : loadAppointments();
        const byId = new Map<string, Appointment>();
        for (const a of prev) byId.set(a.id, a);
        for (const a of local) byId.set(a.id, a);
        for (const a of list) byId.set(a.id, a); // server wins on conflict
        const merged = Array.from(byId.values());
        if (list.length === 0 && prev.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadAppointments] empty server response — keeping",
            prev.length,
            "local rows; possible auth / RLS / network flicker",
          );
        }
        saveAppointments(merged);
        return merged;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось загрузить записи";
      setAppointmentsError(msg);
    } finally {
      setAppointmentsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void reloadAppointments();
  }, [reloadAppointments]);

  // STORY-044 — schedule + calendar_settings + day_cities + day_extras
  // now hydrate from Supabase. Failure for any single fetch is
  // silently logged so a transient outage doesn't block the dashboard
  // from rendering with empty defaults.
  // STORY-048 — extracted to a stable callback so realtime onResync
  // can call it after a reconnect to backfill missed events.
  const reloadSchedule = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowser();
      const [scheduleMap, calSettings, cityMap, extrasMap] =
        await Promise.all([
          listScheduleEntries(supabase, tenantId),
          getCalendarSettingsRepo(supabase, tenantId),
          listDayCitiesRepo(supabase, tenantId),
          listDayExtrasRepo(supabase, tenantId),
        ]);
      // v662 — DEFENSIVE merge against transient-empty server reads.
      //
      // Same shape as `reloadAppointments` (v499): a Supabase fetch
      // that returns an empty object is treated as "no info, keep
      // local" rather than "ground truth, wipe local". Reasons we
      // see this:
      //   • Auth refresh in flight — RLS briefly sees no rows.
      //   • Network blip on flaky 5G/wifi during the round-trip.
      //   • A wrong tenantId in flight while the user switches tenants.
      //   • Server-side RLS misconfig on a single table.
      //
      // None of these mean "the user deleted everything". Treat empty
      // as a no-op; keep `prev`. localStorage continues to back the
      // explicit write-through path so a refresh restores the user's
      // last edits even if the snapshot returned by the server is
      // wrong.
      setSchedulesState((prev) => {
        const incomingCount = Object.keys(scheduleMap).length;
        const prevCount = Object.keys(prev).length;
        if (incomingCount === 0 && prevCount > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadSchedule] empty schedules from server — keeping",
            prevCount,
            "local entries (auth/RLS/network flicker)",
          );
          return prev;
        }
        return scheduleMap;
      });
      // v449 — hydration must NOT clobber local work/open hours when
      // the DB row has them as undefined (older deploy where the
      // 20260507_001 migration hasn't applied yet). Merge: if the
      // server returned a value, take it; otherwise keep what we
      // already have. localStorage is the safety net — saves continue
      // through `setCalendarSettings → saveCalendarSettings` so a
      // refresh restores the user's last edits even if Supabase
      // forgets them.
      // v662 — extended the defensive merge to EVERY field: if the
      // server-returned value is null/undefined, keep what we have.
      // Previously only workStartHour, workEndHour, scrollOpenHour,
      // personalLabels, personalDefaultLabel were guarded. Other
      // fields like hideCancelled / allowOvertime / weekStart could
      // still be wiped by a stale server payload.
      setCalendarSettingsState((prev) => {
        const merged: CalendarSettings = { ...prev };
        for (const key of Object.keys(calSettings) as (keyof CalendarSettings)[]) {
          const v = calSettings[key];
          if (v !== undefined && v !== null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (merged as any)[key] = v;
          }
        }
        return merged;
      });
      // v662 — same defensive merge for day-cities + day-extras.
      // Empty map from server is treated as "no info" and ignored
      // unless we genuinely had nothing locally either.
      setDayCitiesState((prev) => {
        const incomingCount = Object.keys(cityMap).length;
        const prevCount = Object.keys(prev).length;
        if (incomingCount === 0 && prevCount > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadSchedule] empty day_cities from server — keeping",
            prevCount,
            "local entries (auth/RLS/network flicker)",
          );
          return prev;
        }
        // Persist to localStorage so a refresh sees the merged state.
        // (No-op when incoming === prev; we always re-write to keep
        // the on-disk copy in sync with the freshest server reply.)
        if (typeof window !== "undefined") {
          try {
            saveDayCities(cityMap);
          } catch {
            // ignore — quota / private-mode failures are non-fatal.
          }
        }
        return cityMap;
      });
      setDayExtrasState((prev) => {
        const incomingCount = Object.keys(extrasMap).length;
        const prevCount = Object.keys(prev).length;
        if (incomingCount === 0 && prevCount > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[reloadSchedule] empty day_extras from server — keeping",
            prevCount,
            "local entries (auth/RLS/network flicker)",
          );
          return prev;
        }
        return extrasMap;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("STORY-044: schedule hydration failed", err);
    }
  }, [tenantId]);

  useEffect(() => {
    void reloadSchedule();
  }, [reloadSchedule]);

  // CROSS-TENANT LEAK FIX (defence-in-depth). The auth-clear listener
  // (root layout) wipes on a SIGNED_IN whose user differs from the last
  // seen — that's the primary guard. THIS is belt-and-suspenders: if the
  // local cache on this device is stamped for a DIFFERENT tenant than
  // the active session (e.g. a cold PWA start that emits INITIAL_SESSION
  // rather than SIGNED_IN, so the listener never ran), refuse to show or
  // back it up — wipe localStorage + IDB and reload into a clean state.
  // Never fires on a first-ever load (owner unset), so legitimate
  // sessions are never disrupted.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const wiped = await enforceCacheOwner(tenantId);
      if (!cancelled && wiped && typeof window !== "undefined") {
        window.location.reload();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // v505 — tenant_state backup hydration. Restores localStorage-only
  // entities (teams / masters / services / sms-templates /
  // expense-categories / equipment / cities / location-labels) from the
  // jsonb blob on the server when the local store is empty. This is the
  // safety net for any path that wipes localStorage — iOS Safari storage
  // eviction, user clearing site data, corrupted Cache API entry, future
  // regression of the auth-clear listener, etc. v504 stopped the most
  // common one (spurious SIGNED_OUT), but the user lost real data once
  // already; we never want to be one bug away from that again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchTenantState(getSupabaseBrowser(), tenantId);
        if (cancelled || !blob) return;
        // v797 — capture which local stores were empty BEFORE the restore
        // writes to localStorage, so below we only push blob data into
        // React state for stores that were GENUINELY empty. Otherwise a
        // team the user just created (e.g. via «Создать календарь») gets
        // clobbered in memory by the stale blob → the «бах» (an old/other
        // team appears instead of the freshly created one).
        const teamsWasEmpty = loadTeams().length === 0;
        const restored = restoreEmptyStoresFromBlob(blob);
        if (!restored) return;
        // Reflect the just-restored data into the React state owned by
        // this layout. Without this, the dashboard would keep rendering
        // its empty initial state until the next reload.
        if (blob.masters?.length) setMastersState(blob.masters);
        if (blob.teams?.length && teamsWasEmpty) setTeamsState(blob.teams);
        if (blob.services?.length) setServicesState(blob.services);
        if (blob.serviceCategories?.length)
          setServiceCategoriesState(blob.serviceCategories);
        if (blob.smsTemplates?.length) setSmsTemplatesState(blob.smsTemplates);
        if (blob.expenseCategories?.length)
          setExpenseCategoriesState(blob.expenseCategories);
        if (blob.equipment?.length) setEquipmentState(blob.equipment);
        if (blob.cities?.length) setCitiesState(blob.cities);
        if (blob.locationLabels?.length)
          setLocationLabelsState(blob.locationLabels);
        // v662 — also push restored calendarSettings + dayCities into
        // React state so the calendar paints the recovered values
        // without a page reload.
        if (blob.calendarSettings) {
          setCalendarSettingsState((prev) => ({
            ...prev,
            ...blob.calendarSettings,
          }));
        }
        if (blob.dayCities && Object.keys(blob.dayCities).length > 0) {
          setDayCitiesState((prev) => {
            // Only fill if local state currently empty — never
            // clobber freshly-loaded server data with a stale backup.
            if (Object.keys(prev).length > 0) return prev;
            return blob.dayCities!;
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[tenant-state] hydration failed", err);
      } finally {
        // v662 — flip the gate so the debounced backup-save below can
        // start writing. Before this gate the save effect would fire
        // on first render with empty localStorage (iOS Safari
        // eviction) and immediately clobber the server backup with
        // a `{ masters:[], teams:[], … }` blob — destroying the only
        // recovery path. Now: no backup writes until either the
        // tenant_state blob was restored OR we've confirmed there
        // was nothing to restore.
        if (!cancelled) setBackupHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // v505 — debounced save of the local-only entity blob whenever any of
  // them changes. Collapses bursts of writes (e.g. brigade editor
  // tweaking multiple fields) into a single network round-trip.
  useEffect(() => {
    // v662 — never write a backup before the hydration pass has
    // finished. Otherwise the first render with empty localStorage
    // (post-eviction / fresh device pre-restore) immediately
    // clobbers the server blob with empties.
    if (!backupHydrated) return;
    scheduleTenantStateSave(getSupabaseBrowser(), tenantId);
  }, [
    backupHydrated,
    tenantId,
    masters,
    teams,
    services,
    serviceCategories,
    smsTemplates,
    expenseCategories,
    equipment,
    cities,
    locationLabels,
    // v662 — calendarSettings + dayCities now also flow into the
    // tenant_state backup blob. Their per-table tables remain the
    // primary store; this is the secondary safety net.
    calendarSettings,
    dayCities,
  ]);

  // STORY-048 — Supabase Realtime subscriptions for the seven
  // tenant-scoped tables that DashboardClientLayout owns. Each
  // event triggers the corresponding reload* function — simple,
  // correct (handles INSERT / UPDATE / DELETE uniformly), and
  // immune to row-shape mismatches between the realtime payload
  // and the repo adapter. wasDisconnected handling is provided
  // by the hook; onResync re-runs the same reload to backfill.
  // The realtime client lives in the singleton getSupabaseBrowser().
  const supabaseClient = getSupabaseBrowser();
  const refetchClients = useCallback(() => void reloadClients(), [reloadClients]);
  const refetchAppointments = useCallback(() => void reloadAppointments(), [reloadAppointments]);
  const refetchSchedule = useCallback(() => void reloadSchedule(), [reloadSchedule]);

  // STORY-054 G3 — onResync fires after a Supabase Realtime
  // reconnect. That's also our signal to drain any offline-queued
  // writes. Using the realtime hook reuses one network listener
  // instead of attaching a duplicate `online` event everywhere.
  const onResyncClients = useCallback(() => {
    void reloadClients();
    void kickReplayer({ supabase: supabaseClient });
  }, [reloadClients, supabaseClient]);
  const onResyncAppointments = useCallback(() => {
    void reloadAppointments();
    void kickReplayer({ supabase: supabaseClient });
  }, [reloadAppointments, supabaseClient]);
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "clients",
    tenantId,
    onInsert: refetchClients,
    onUpdate: refetchClients,
    onDelete: refetchClients,
    onResync: onResyncClients,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "client_tags",
    tenantId,
    onInsert: refetchClients,
    onUpdate: refetchClients,
    onDelete: refetchClients,
    onResync: onResyncClients,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "client_tag_assignments",
    tenantId,
    onInsert: refetchClients,
    onUpdate: refetchClients,
    onDelete: refetchClients,
    onResync: onResyncClients,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "appointments",
    tenantId,
    onInsert: refetchAppointments,
    onUpdate: refetchAppointments,
    onDelete: refetchAppointments,
    onResync: onResyncAppointments,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "team_schedules",
    tenantId,
    onInsert: refetchSchedule,
    onUpdate: refetchSchedule,
    onDelete: refetchSchedule,
    onResync: refetchSchedule,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "calendar_settings",
    tenantId,
    onInsert: refetchSchedule,
    onUpdate: refetchSchedule,
    onDelete: refetchSchedule,
    onResync: refetchSchedule,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "day_cities",
    tenantId,
    onInsert: refetchSchedule,
    onUpdate: refetchSchedule,
    onDelete: refetchSchedule,
    onResync: refetchSchedule,
  });
  useRealtimeTenantSync({
    supabase: supabaseClient,
    table: "day_extras",
    tenantId,
    onInsert: refetchSchedule,
    onUpdate: refetchSchedule,
    onDelete: refetchSchedule,
    onResync: refetchSchedule,
  });

  // ── Multi-device freshness: foreground refetch + re-arm + poll ────
  // Realtime (above) delivers live updates only while the tab is
  // foreground AND its websocket is alive. iOS PWAs suspend the socket
  // in the background, so a change made on another device / the web app
  // while this PWA was backgrounded is silently missed — the operator
  // reopens the app and the calendar is stale (user-reported). Three
  // layers close that gap:
  //   A. Refetch the calendar tables when the tab returns to the
  //      foreground (visibilitychange / focus), debounced ~2 s.
  //   B. Re-arm the realtime socket on foreground so live updates
  //      resume after an iOS background suspend. connect() is
  //      idempotent (no-op if already up); channels auto-rejoin and
  //      their onResync backfills anything missed.
  //   C. A slow 30 s poll while the tab is visible — a safety net for
  //      events realtime dropped without a clean reconnect (so two
  //      dispatchers watching the same calendar converge even if a
  //      socket silently died).
  useEffect(() => {
    if (!tenantId) return;
    if (typeof document === "undefined") return;
    let lastRefetch = Date.now();
    const refetchCalendar = (includeClients: boolean) => {
      lastRefetch = Date.now();
      refetchAppointments();
      refetchSchedule();
      if (includeClients) refetchClients();
    };
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      // B — best-effort socket revival (no-op if already connected).
      try {
        supabaseClient.realtime.connect();
      } catch {
        /* socket already up / unavailable — ignore */
      }
      // A — debounced backfill so a quick tab-switch doesn't spam.
      if (Date.now() - lastRefetch > 2000) refetchCalendar(true);
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    // C — safety-net poll, only while the tab is actually visible.
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") refetchCalendar(false);
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.clearInterval(pollId);
    };
  }, [
    tenantId,
    refetchAppointments,
    refetchSchedule,
    refetchClients,
    supabaseClient,
  ]);

  // STORY-007 (legacy): components in appointments / chats still call
  // `upsertClient` from @babun/shared/local/clients which writes to
  // localStorage and dispatches babun:clients-changed. We listen and
  // refetch from Supabase so the list page stays consistent. The
  // localStorage write itself is a no-op for the canonical store
  // until those verticals migrate (STORY-036b/c/d).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => void reloadClients();
    window.addEventListener("babun:clients-changed", reload);
    return () => window.removeEventListener("babun:clients-changed", reload);
  }, [reloadClients]);

  // STORY-044 — schedules now live in Supabase. Optimistic local
  // update + per-team upsert. The schedule editor passes the full
  // map; we diff against the previous state and write only the
  // changed teams to keep round-trips minimal.
  const handleSchedulesChange = useCallback(
    (next: ScheduleMap) => {
      setSchedulesState((prev) => {
        const supabase = getSupabaseBrowser();
        for (const [teamId, schedule] of Object.entries(next)) {
          if (prev[teamId] !== schedule) {
            void upsertScheduleEntry(supabase, tenantId, teamId, schedule).catch(
              (err) => {
                // eslint-disable-next-line no-console
                console.warn("STORY-044: upsertScheduleEntry failed", teamId, err);
              },
            );
          }
        }
        return next;
      });
    },
    [tenantId],
  );

  const handleMastersChange = useCallback((next: Master[]) => {
    setMastersState(next);
    saveMasters(next);
  }, []);

  const upsertMaster = useCallback((master: Master) => {
    setMastersState((prev) => {
      const idx = prev.findIndex((m) => m.id === master.id);
      const next = idx >= 0 ? prev.map((m, i) => (i === idx ? master : m)) : [...prev, master];
      saveMasters(next);
      logAudit({
        entity: "master",
        action: idx >= 0 ? "update" : "create",
        summary: master.full_name,
        entityId: master.id,
      });
      return next;
    });
  }, []);

  const deleteMaster = useCallback((id: string) => {
    setMastersState((prev) => {
      const target = prev.find((m) => m.id === id);
      logAudit({
        entity: "master",
        action: "delete",
        summary: target?.full_name || id,
        entityId: id,
      });
      const next = prev.filter((m) => m.id !== id);
      saveMasters(next);
      return next;
    });
  }, []);

  const handleTeamsChange = useCallback((next: Team[]) => {
    setTeamsState(next);
    saveTeams(next);
  }, []);

  const upsertTeam = useCallback((team: Team) => {
    setTeamsState((prev) => {
      const idx = prev.findIndex((t) => t.id === team.id);
      const isNew = idx < 0;
      const next = isNew ? [...prev, team] : prev.map((t, i) => (i === idx ? team : t));
      saveTeams(next);
      logAudit({
        entity: "team",
        action: isNew ? "create" : "update",
        summary: team.name,
        entityId: team.id,
      });
      if (isNew) {
        // Fire-and-forget: seed a default cash account for the new
        // brigade so /finances has somewhere to land transactions
        // immediately. The (tenant_id, brigade_id, name) unique on
        // the table makes this idempotent in case the team was re-
        // created or the user lands here after a reload.
        //
        // ИМЯ — «Наличные», как в глоссарии продукта (ТЗ счетов 2026-08-10
        // §7) и в мобильном автосоздании. Здесь заводилась «Наличка», и у
        // одного тенанта уживались два имени одной сущности: бригада,
        // созданная в вебе, получала «Наличку», созданная в приложении —
        // «Наличные», и в пикере приёма оплаты это две разные пилюли.
        void insertAccount(getSupabaseBrowser(), tenantId, {
          scope: "team",
          brigade_id: team.id,
          name: "Наличные",
          kind: "cash",
          opening_balance: 0,
          icon: "💵",
        }).catch((e) => {
          // unique-violation is fine (already exists); log everything
          // else for visibility but don't block the UI.
          if (!String(e).toLowerCase().includes("unique")) {
            // eslint-disable-next-line no-console
            console.warn("auto-seed cash account failed", e);
          }
        });
      }
      return next;
    });
  }, [tenantId]);

  const deleteTeam = useCallback((id: string) => {
    setTeamsState((prev) => {
      const target = prev.find((t) => t.id === id);
      logAudit({
        entity: "team",
        action: "delete",
        summary: target?.name || id,
        entityId: id,
      });
      const next = prev.filter((t) => t.id !== id);
      saveTeams(next);
      return next;
    });
  }, []);

  // STORY-042 — both upsert paths funnel through the repo. The
  // server allocates a UUID for new rows whose local id is the
  // legacy `apt_xxx` shape; `saved.id` is the source of truth after
  // the round-trip. Same race fallback as upsertClient.
  //
  // v473 — optimistic write. Previously we awaited the Supabase
  // round-trip BEFORE updating React state, which on a 4G/5G hop
  // made create/edit feel laggy («запись с задержкой»). Now the UI
  // updates instantly; the network call runs in the background and
  // we reconcile with the server-allocated id once it comes back.
  const upsertAppointment = useCallback(
    async (apt: Appointment) => {
      const inMemory = appointments.some((a) => a.id === apt.id);
      // v603 §4.4 — feed the local audit log so /dashboard/audit
      // surfaces every appointment write. Logged before the await
      // so the entry exists even if the network drops later.
      logAudit({
        entity: "appointment",
        action: inMemory ? "update" : "create",
        summary: `${apt.date} ${apt.time_start} · ${apt.comment?.slice(0, 60) || "—"}`,
        entityId: apt.id,
      });
      // v482 — sync localStorage mirror inside the state updater.
      // localStorage.setItem is fully synchronous: the write is on
      // disk by the time `saveAppointments` returns. This is the
      // ONLY safe path for iOS PWA — if the user creates an event
      // and immediately swipes the app away, the IDB transaction
      // inside `createAppointmentRepo` may not commit in time, but
      // localStorage already has the row.
      setAppointmentsState((prev) => {
        const idx = prev.findIndex((a) => a.id === apt.id);
        const next =
          idx >= 0
            ? prev.map((a, i) => (i === idx ? apt : a))
            : [...prev, apt];
        saveAppointments(next);
        return next;
      });
      try {
        const supabase = getSupabaseBrowser();
        let saved: Appointment;
        if (inMemory) {
          saved = await updateAppointmentRepo(supabase, apt.id, apt, tenantId);
        } else {
          try {
            saved = await createAppointmentRepo(supabase, apt, tenantId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            if (/duplicate key|already exists|23505/i.test(msg)) {
              saved = await updateAppointmentRepo(supabase, apt.id, apt, tenantId);
            } else {
              throw err;
            }
          }
        }
        if (saved.id !== apt.id) {
          // Server reassigned the id (legacy `apt_xxx` → UUID). Drop
          // the optimistic row and insert the canonical one.
          setAppointmentsState((prev) => {
            const filtered = prev.filter((a) => a.id !== apt.id);
            const idx = filtered.findIndex((a) => a.id === saved.id);
            const next =
              idx >= 0
                ? filtered.map((a, i) => (i === idx ? saved : a))
                : [...filtered, saved];
            saveAppointments(next);
            return next;
          });
        } else {
          setAppointmentsState((prev) => {
            const idx = prev.findIndex((a) => a.id === saved.id);
            const next =
              idx >= 0
                ? prev.map((a, i) => (i === idx ? saved : a))
                : [...prev, saved];
            saveAppointments(next);
            return next;
          });
        }
      } catch (err) {
        // v513 — surface the failure via the sync-error bus so the
        // dispatcher sees the red «Ошибка синхронизации» pill. Local
        // state + localStorage already have the optimistic row, so
        // they can keep working — but they need to know the server
        // didn't accept the write (RLS rejection, validation,
        // network error after the cached-wrapper queue gave up).
        // eslint-disable-next-line no-console
        console.warn("upsertAppointment failed", err);
        reportSyncError(err);
      }
    },
    [appointments, tenantId],
  );

  const deleteAppointment = useCallback(
    async (id: string) => {
      // v603 §4.4 — audit before the optimistic mutation so the
      // entry captures the row's last-known state.
      const target = appointments.find((a) => a.id === id);
      logAudit({
        entity: "appointment",
        action: "delete",
        summary: target
          ? `${target.date} ${target.time_start} · ${target.comment?.slice(0, 60) || "—"}`
          : id,
        entityId: id,
      });
      // v457 — optimistic delete. Previously we awaited the Supabase
      // round-trip BEFORE filtering the React state, which on a 4G/5G
      // hop made the deletion feel laggy ("записи удаляются с
      // задержкой"). Now the UI flips instantly; the network call
      // runs in the background and the realtime subscription will
      // re-add the row only if Supabase rejected the delete.
      // v482 — also mirror the delete into localStorage so a fast
      // app close after deletion doesn't resurrect the row on next
      // launch.
      setAppointmentsState((prev) => {
        const next = prev.filter((a) => a.id !== id);
        saveAppointments(next);
        return next;
      });
      try {
        const supabase = getSupabaseBrowser();
        await deleteAppointmentRepo(supabase, id, tenantId);
      } catch (err) {
        // v513 — same sync-error wiring as upsertAppointment. The
        // realtime subscription will re-insert the row if Supabase
        // rejected the delete; user sees both the row reappearing
        // AND the error pill so it's clear something happened.
        // eslint-disable-next-line no-console
        console.warn("deleteAppointment failed", err);
        reportSyncError(err);
      }
    },
    [tenantId],
  );

  const getAppointment = useCallback(
    (id: string) => appointments.find((a) => a.id === id),
    [appointments]
  );

  const handleServicesChange = useCallback((next: Service[]) => {
    setServicesState(next);
    saveServices(next);
  }, []);
  const upsertService = useCallback((svc: Service) => {
    setServicesState((prev) => {
      const idx = prev.findIndex((s) => s.id === svc.id);
      const next = idx >= 0 ? prev.map((s, i) => (i === idx ? svc : s)) : [...prev, svc];
      saveServices(next);
      logAudit({
        entity: "service",
        action: idx >= 0 ? "update" : "create",
        summary: svc.name,
        entityId: svc.id,
      });
      return next;
    });
  }, []);
  const deleteService = useCallback((id: string) => {
    setServicesState((prev) => {
      const target = prev.find((s) => s.id === id);
      logAudit({
        entity: "service",
        action: "delete",
        summary: target?.name || id,
        entityId: id,
      });
      const next = prev.filter((s) => s.id !== id);
      saveServices(next);
      return next;
    });
  }, []);
  const handleServiceCategoriesChange = useCallback((next: ServiceCategory[]) => {
    setServiceCategoriesState(next);
    saveCategories(next);
  }, []);

  // STORY-036 — bulk replace is a no-op against Supabase. Kept on the
  // context purely for API stability; nobody calls it externally today.
  const handleClientsChange = useCallback((next: Client[]) => {
    setClientsState(next);
  }, []);
  const upsertClient = useCallback(
    async (client: Client) => {
      const supabase = getSupabaseBrowser();
      const inMemory = clients.some((c) => c.id === client.id);
      logAudit({
        entity: "client",
        action: inMemory ? "update" : "create",
        summary: client.full_name || client.phone || "—",
        entityId: client.id,
      });
      let saved: Client;
      if (inMemory) {
        saved = await updateClientRepo(supabase, client.id, client, tenantId);
      } else {
        try {
          saved = await createClientRepo(supabase, client, tenantId);
        } catch (err) {
          // Race: clients[] hadn't loaded yet but the row already
          // exists. Fall back to update.
          const msg = err instanceof Error ? err.message : "";
          if (/duplicate key|already exists|23505/i.test(msg)) {
            saved = await updateClientRepo(supabase, client.id, client, tenantId);
          } else {
            throw err;
          }
        }
      }
      setClientsState((prev) => {
        const idx = prev.findIndex((c) => c.id === saved.id);
        return idx >= 0
          ? prev.map((c, i) => (i === idx ? saved : c))
          : [...prev, saved];
      });
    },
    [clients, tenantId],
  );
  const deleteClient = useCallback(
    async (id: string) => {
      const target = clients.find((c) => c.id === id);
      logAudit({
        entity: "client",
        action: "delete",
        summary: target?.full_name || target?.phone || id,
        entityId: id,
      });
      const supabase = getSupabaseBrowser();
      await deleteClientRepo(supabase, id, tenantId);
      setClientsState((prev) => prev.filter((c) => c.id !== id));
    },
    [clients, tenantId],
  );
  const handleClientTagsChange = useCallback((next: ClientTag[]) => {
    setClientTagsState(next);
  }, []);
  const upsertTag = useCallback(
    async (tag: ClientTag) => {
      const supabase = getSupabaseBrowser();
      const exists = clientTags.some((t) => t.id === tag.id);
      const saved = exists
        ? await updateClientTag(
            supabase,
            tag.id,
            { name: tag.name, color: tag.color },
            tenantId,
          )
        : await createClientTag(
            supabase,
            { name: tag.name, color: tag.color },
            tenantId,
          );
      setClientTagsState((prev) => {
        const idx = prev.findIndex((t) => t.id === saved.id);
        return idx >= 0
          ? prev.map((t, i) => (i === idx ? saved : t))
          : [...prev, saved];
      });
    },
    [clientTags, tenantId],
  );
  const deleteTag = useCallback(
    async (id: string) => {
      const supabase = getSupabaseBrowser();
      await deleteClientTag(supabase, id, tenantId);
      setClientTagsState((prev) => prev.filter((t) => t.id !== id));
    },
    [tenantId],
  );

  const handleSmsTemplatesChange = useCallback((next: SmsTemplate[]) => {
    setSmsTemplatesState(next);
    saveTemplates(next);
  }, []);
  const upsertSmsTemplate = useCallback((tpl: SmsTemplate) => {
    setSmsTemplatesState((prev) => {
      const idx = prev.findIndex((t) => t.id === tpl.id);
      const next = idx >= 0 ? prev.map((t, i) => (i === idx ? tpl : t)) : [...prev, tpl];
      saveTemplates(next);
      return next;
    });
  }, []);

  const handleExpenseCategoriesChange = useCallback((next: ExpenseCategory[]) => {
    setExpenseCategoriesState(next);
    saveExpenseCategories(next);
  }, []);

  const handleFieldVisibilityChange = useCallback((next: FormFieldVisibility) => {
    setFieldVisibilityState(next);
    saveFieldVisibility(next);
  }, []);

  const handleRequiredFieldsChange = useCallback((next: RequiredFields) => {
    setRequiredFieldsState(next);
    saveRequiredFields(next);
  }, []);

  const handleLogout = async () => {
    // STORY-037: real Supabase signOut, then bounce to /login.
    // router.refresh() forces the server layout to re-check auth so
    // the next render goes through the unauthenticated branch.
    await signOut();
    router.push("/login");
    router.refresh();
  };

  // Legacy callback — Sidebar now navigates via router internally
  const handleLegacyNavigate = (_d: DialogType) => {
    void _d;
  };

  const sidebarValue: SidebarContextValue = {
    open: () => setSidebarOpen(true),
    close: () => setSidebarOpen(false),
    toggle: () => setSidebarOpen((prev) => !prev),
  };

  const schedulesValue: SchedulesContextValue = {
    schedules,
    setSchedules: handleSchedulesChange,
  };

  const mastersValue: MastersContextValue = {
    masters,
    setMasters: handleMastersChange,
    upsertMaster,
    deleteMaster,
  };

  const teamsValue: TeamsContextValue = {
    teams,
    setTeams: handleTeamsChange,
    upsertTeam,
    deleteTeam,
    teamsLoaded: backupHydrated,
  };

  const appointmentsValue: AppointmentsContextValue = {
    appointments,
    appointmentsLoading,
    appointmentsError,
    reloadAppointments,
    upsertAppointment,
    deleteAppointment,
    getAppointment,
  };

  const formSettingsValue: FormSettingsContextValue = {
    fieldVisibility,
    setFieldVisibility: handleFieldVisibilityChange,
    requiredFields,
    setRequiredFields: handleRequiredFieldsChange,
  };

  const servicesValue: ServicesContextValue = {
    services,
    setServices: handleServicesChange,
    upsertService,
    deleteService,
    categories: serviceCategories,
    setCategories: handleServiceCategoriesChange,
  };

  const clientsValue: ClientsContextValue = {
    clients,
    clientsLoading,
    clientsError,
    reloadClients,
    setClients: handleClientsChange,
    upsertClient,
    deleteClient,
    tags: clientTags,
    setTags: handleClientTagsChange,
    upsertTag,
    deleteTag,
  };

  const smsTemplatesValue: SmsTemplatesContextValue = {
    templates: smsTemplates,
    setTemplates: handleSmsTemplatesChange,
    upsertTemplate: upsertSmsTemplate,
  };

  const expenseCategoriesValue: ExpenseCategoriesContextValue = {
    categories: expenseCategories,
    setCategories: handleExpenseCategoriesChange,
  };

  const handleSetCityFor = useCallback(
    (teamId: string, dateKey: string, city: string) => {
      // STORY-044 — optimistic local update + Supabase upsert.
      setDayCitiesState((prev) => setDayCity(prev, teamId, dateKey, city));
      const supabase = getSupabaseBrowser();
      void setDayCityRepo(supabase, tenantId, teamId, dateKey, city).catch(
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("STORY-044: setDayCity failed", teamId, dateKey, err);
        },
      );
    },
    [tenantId],
  );

  const handleGetCityFor = useCallback(
    (teamId: string | null, dateKey: string, teamDefault: string): string => {
      const assigned = getDayCity(dayCities, teamId, dateKey);
      // v693 — `__NONE__` is the sentinel written by re-tapping the
      // active label in CityPickerModal. It means «explicitly cleared,
      // do NOT fall back to the team default» — without it, tapping
      // a brigade's default city to remove the day's label silently
      // re-applied the same default on the next render.
      if (assigned === "__NONE__") return "";
      return assigned || teamDefault;
    },
    [dayCities]
  );

  const dayCitiesValue: DayCitiesContextValue = {
    dayCities,
    setCityFor: handleSetCityFor,
    getCityFor: handleGetCityFor,
  };

  const handleSetExtrasFor = useCallback(
    (teamId: string, dateKey: string, extras: DayExtra[]) => {
      // STORY-044 — optimistic local update + Supabase replace-all
      // for this (team, date) tuple. Repo handles the delete+insert.
      setDayExtrasState((prev) => setDayExtrasFor(prev, teamId, dateKey, extras));
      const supabase = getSupabaseBrowser();
      void setDayExtrasRepo(supabase, tenantId, teamId, dateKey, extras).catch(
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("STORY-044: setDayExtras failed", teamId, dateKey, err);
        },
      );
    },
    [tenantId],
  );

  const handleGetExtrasFor = useCallback(
    (teamId: string | null, dateKey: string): DayExtra[] => {
      return getDayExtras(dayExtras, teamId, dateKey);
    },
    [dayExtras]
  );

  const dayExtrasValue: DayExtrasContextValue = {
    dayExtras,
    getExtrasFor: handleGetExtrasFor,
    setExtrasFor: handleSetExtrasFor,
  };

  // STORY-044 — calendar settings are a singleton per tenant; upsert
  // through the repo (PRIMARY KEY = tenant_id, ON CONFLICT updates).
  // v443 — also persist to localStorage on every change. Previously
  // only Supabase was written, so a reload before the async repo
  // round-trip completed showed stale settings (loadCalendarSettings
  // reads from localStorage on initial mount).
  const handleCalendarSettingsChange = useCallback(
    (next: CalendarSettings) => {
      setCalendarSettingsState(next);
      saveCalendarSettings(next);
      const supabase = getSupabaseBrowser();
      void updateCalendarSettingsRepo(supabase, tenantId, next).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("STORY-044: updateCalendarSettings failed", err);
      });
    },
    [tenantId],
  );

  const calendarSettingsValue: CalendarSettingsContextValue = {
    calendarSettings,
    setCalendarSettings: handleCalendarSettingsChange,
  };

  const handleCitiesChange = useCallback((next: City[]) => {
    setCitiesState(next);
    saveCities(next);
  }, []);

  const citiesValue: CitiesContextValue = {
    cities,
    setCities: handleCitiesChange,
  };

  const handleLocationLabelsChange = useCallback((next: LocationLabel[]) => {
    setLocationLabelsState(next);
    saveLocationLabels(next);
  }, []);

  const locationLabelsValue: LocationLabelsContextValue = {
    locationLabels,
    setLocationLabels: handleLocationLabelsChange,
  };

  const handleEquipmentChange = useCallback((next: Equipment[]) => {
    setEquipmentState(next);
    saveEquipment(next);
  }, []);
  const upsertEquipment = useCallback(
    (e: Equipment) => {
      setEquipmentState((prev) => {
        const idx = prev.findIndex((x) => x.id === e.id);
        const next = idx >= 0 ? prev.map((x, i) => (i === idx ? e : x)) : [...prev, e];
        saveEquipment(next);
        return next;
      });
    },
    [],
  );
  const deleteEquipment = useCallback((id: string) => {
    setEquipmentState((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveEquipment(next);
      return next;
    });
  }, []);
  const equipmentValue: EquipmentContextValue = {
    equipment,
    setEquipment: handleEquipmentChange,
    upsertEquipment,
    deleteEquipment,
  };

  const currentMasterValue: CurrentMasterContextValue = {
    currentMasterId,
    setCurrentMasterId,
  };

  return (
    <TenantContext.Provider
      value={{
        id: tenantId,
        name: tenantName,
        email: userEmail,
        emailConfirmed,
      }}
    >
    <SidebarContext.Provider value={sidebarValue}>
      <CurrentMasterContext.Provider value={currentMasterValue}>
      <MastersContext.Provider value={mastersValue}>
      <TeamsContext.Provider value={teamsValue}>
      <AppointmentsContext.Provider value={appointmentsValue}>
      <FormSettingsContext.Provider value={formSettingsValue}>
      <ServicesContext.Provider value={servicesValue}>
      <ClientsContext.Provider value={clientsValue}>
      <SmsTemplatesContext.Provider value={smsTemplatesValue}>
      <ExpenseCategoriesContext.Provider value={expenseCategoriesValue}>
      <DayCitiesContext.Provider value={dayCitiesValue}>
      <DayExtrasContext.Provider value={dayExtrasValue}>
      <CalendarSettingsContext.Provider value={calendarSettingsValue}>
      <CitiesContext.Provider value={citiesValue}>
      <EquipmentContext.Provider value={equipmentValue}>
      <LocationLabelsContext.Provider value={locationLabelsValue}>
      <SchedulesContext.Provider value={schedulesValue}>
      <ConfirmProvider>
      <ToastProvider>
      <SyncToastBridge>
        <div
          className="h-[100dvh] flex overflow-hidden bg-[var(--surface-grouped)]"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
            paddingBottom: "env(safe-area-inset-bottom)",
            // v322 — kill iOS edge-swipe back navigation at the root
            // so swiping from the left edge of the Clients page no
            // longer pulls the Calendar in from underneath.
            touchAction: "pan-y",
            overscrollBehaviorX: "none",
          }}
        >
          <Sidebar
            onLogout={handleLogout}
            onNavigate={handleLegacyNavigate}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            tenantName={tenantName}
            userEmail={userEmail}
          />

          {/* Main content area, offset by sidebar width on lg+. Mobile
              gets bottom padding for the tab bar. `<main>` satisfies
              Lighthouse's `landmark-one-main` rule without breaking any
              existing layout. */}
          {/* STORY-060 — keyboard-accessible skip link. Visually hidden
              until focused (first Tab in the tab order). Lets keyboard
              and screen-reader users jump past the sidebar straight to
              page content. Style lives in globals.css (.babun-skip-link). */}
          <a href="#babun-main" className="babun-skip-link">
            Перейти к контенту
          </a>
          <main
            id="babun-main"
            className="flex-1 lg:ml-[240px] flex flex-col min-h-0 min-w-0 pb-[60px] lg:pb-0 relative"
            style={{
              touchAction: "pan-y",
              overscrollBehaviorX: "none",
            }}
          >
            {/* STORY-037 G7 — defensive banner when Supabase Confirm
                Email is ON (currently OFF per A3, so this is hidden). */}
            {!emailConfirmed && userEmail && (
              <UnconfirmedEmailBanner email={userEmail} />
            )}
            {children}

            {/* v328 — Edge guards.  iOS standalone PWA fires the
                native swipe-back / swipe-forward gesture from the
                first 20 px of either screen edge, *ignoring* CSS
                touch-action on inner elements (documented WebKit
                behaviour).  These two strips capture the touch
                first with `touch-action: none` and preventDefault
                on touchstart so the gesture never starts.  They
                sit above content (z-50) but only span 16 px wide —
                no real UI lives there.
                STORY-056 — desktop has no edge-swipe gesture, the
                strips would just trap mouse hover at the screen
                margins.  Hide on lg+. */}
            {!isDesktop && (
              <>
                <EdgeGuard side="left" />
                <EdgeGuard side="right" />
              </>
            )}
          </main>

          <BottomTabBar />
          {/* STORY-056 — splash + notifications prompt only make sense
              on mobile.  On desktop the user is in a real browser tab,
              the SW still registers silently, but the «Включить
              уведомления» modal is noise.  (PWA install prompts removed
              — see note at top of file.)  ServiceWorkerRegister stays
              unconditional — it does no UI, only side-effects
              (cache warm-up, version bump). */}
          {!isDesktop && (
            <>
              <SplashScreen tenantName={tenantName} />
              <EnableNotificationsPrompt />
            </>
          )}
          <ServiceWorkerRegister />
          {/* STORY-054 G4 — top-center status pill. Renders nothing
              when online + queue empty; shows «Без сети» offline
              and «Синхронизация: N» while there are pending writes.
              Tappable (online only) → opens SyncQueuePanel. The
              panel itself is a sibling so it survives if the queue
              empties while the user is reading it.
              STORY-056 — desktop has the sidebar's «Синхр.» row in
              the footer; the floating pill becomes redundant noise
              on a wide layout. */}
          {!isDesktop && (
            <OfflineIndicator onOpenPanel={() => setSyncPanelOpen(true)} />
          )}
          {syncPanelOpen && (
            <SyncQueuePanel onClose={() => setSyncPanelOpen(false)} />
          )}
        </div>
      </SyncToastBridge>
      </ToastProvider>
      </ConfirmProvider>
      </SchedulesContext.Provider>
      </LocationLabelsContext.Provider>
      </EquipmentContext.Provider>
      </CitiesContext.Provider>
      </CalendarSettingsContext.Provider>
      </DayExtrasContext.Provider>
      </DayCitiesContext.Provider>
      </ExpenseCategoriesContext.Provider>
      </SmsTemplatesContext.Provider>
      </ClientsContext.Provider>
      </ServicesContext.Provider>
      </FormSettingsContext.Provider>
      </AppointmentsContext.Provider>
      </TeamsContext.Provider>
      </MastersContext.Provider>
      </CurrentMasterContext.Provider>
    </SidebarContext.Provider>
    </TenantContext.Provider>
  );
}

/** STORY-052 G5b — bridges the cached-wrappers' `setSyncToast()`
 *  global hook into the ToastProvider. Must live BELOW the
 *  ToastProvider in the tree so `useToast()` resolves. Renders its
 *  children verbatim. */
function SyncToastBridge({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  // STORY-060 §F3.4 — bridge browser online/offline events into the
  // toast surface. Bridge sits BELOW ToastProvider so useToast() resolves.
  useOfflineToast();
  // STORY-060 §F3.5 — install the ring-buffer wrapper around
  // console.error so the bug-report modal has the last 20 errors to
  // attach. Idempotent; safe on every layout mount.
  useEffect(() => {
    installConsoleErrorBuffer();
  }, []);
  useEffect(() => {
    setSyncToast((msg) => {
      toast.show({ variant: "info", message: msg });
    });
    return () => {
      // Reset to no-op on unmount so a stale ref doesn't fire after
      // the provider is gone (e.g. logout → root layout swap).
      setSyncToast(() => {});
    };
  }, [toast]);
  return <>{children}</>;
}
