"use client";

// Sprint 033 Phase I18 — Brigade services as a direct editor.
//
// User reframed the page:
//  · "Зачем мне выбирать услуги? Это не надо, просто добавлять их и
//    редактировать." → removed the per-service selection checkbox.
//    Every visible row IS in the brigade.
//  · "Группы: Чистка, Ремонт… я туда вношу услуги" → categories
//    surface as named groups. User can create a new group via
//    "Новая группа" and a service via "Новая услуга".
//  · "При удерживании могу переместить верх" → @dnd-kit with a
//    delay sensor so long-press picks the row up and vertical drag
//    swaps it with its neighbours. Sort order persisted on Service.
//
// Gestures:
//  · Tap row → opens edit modal (single action — no selection state)
//  · Long-press + drag vertically → reorder within the group
//  · Swipe left → red «Удалить» (removes this brigade from the
//    service's brigade_ids; if it was the only brigade, the service
//    is deactivated globally)

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Check,
  Copy,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "@babun/shared/icons";
import { haptic } from "@/lib/haptics";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { useServices, useTeams } from "@/components/layout/DashboardClientLayout";
import {
  createBlankService,
  WEEKDAY_LABELS,
  type PriceTier,
  type Service,
  type ServiceCategory,
  type ServiceMaterialCost,
  type Weekday,
} from "@babun/shared/local/services";
import { PRESET_COLOR_VALUES } from "@babun/shared/common/utils/colors";
import { generateId } from "@babun/shared/local/masters";
import BrigadeSectionShell from "@/components/teams/BrigadeSectionShell";
import ContextMenu, {
  type ContextMenuOption,
} from "@/components/ui/ContextMenu";
import SwipeableRow from "@/components/ui/SwipeableRow";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

// Sort helpers — services sort by explicit sort_order asc, then created_at.
const sortServices = (a: Service, b: Service) => {
  const ao = a.sort_order ?? Number.POSITIVE_INFINITY;
  const bo = b.sort_order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
};

// Sprint 034 — duration quick-pick presets. "Своё" reveals a numeric
// field for anything off this grid.
const PRESET_DURATIONS = [15, 30, 45, 60, 90, 120];

export default function BrigadeServicesPage({ params }: RouteParams) {
  const { id } = use(params);
  const confirm = useConfirm();
  const { teams } = useTeams();
  const { services, categories, upsertService, setCategories } = useServices();
  const team = teams.find((t) => t.id === id);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Service | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<{
    service: Service;
    anchor: { x: number; y: number };
  } | null>(null);
  // Group (category) management — long-press / ⋯ on a group header.
  // Sprint 034 — closes the "нельзя удалить группу" gap: a group can
  // now be renamed, recoloured, and deleted right from the list.
  const [groupMenu, setGroupMenu] = useState<{
    cat: ServiceCategory;
    anchor: { x: number; y: number };
  } | null>(null);
  const [groupEdit, setGroupEdit] = useState<ServiceCategory | null>(null);

  // Services belonging to this brigade (either explicitly listed or
  // legacy entries with empty brigade_ids = all brigades).
  const brigadeServices = useMemo(() => {
    if (!team) return [];
    return services
      .filter(
        (s) =>
          s.is_active !== false &&
          (s.brigade_ids.length === 0 || s.brigade_ids.includes(team.id)),
      )
      .sort(sortServices);
  }, [services, team]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return brigadeServices;
    return brigadeServices.filter((s) => normalize(s.name).includes(q));
  }, [brigadeServices, query]);

  // Sprint 033 Phase I20 — categories shown on THIS brigade's page
  // are scoped: only categories that have at least one active
  // service attached to this brigade are listed. Global
  // `categories` is still the storage of truth (ServiceCategory
  // lives at tenant level), but this brigade only sees what IT
  // uses. Fixes "откуда оно берёт группу если не в одной команде —
  // не указано". Empty brigades force the user to create a group
  // first via the modal.
  const brigadeCategories = useMemo(() => {
    const usedIds = new Set<string>();
    brigadeServices.forEach((s) => {
      if (s.category_id) usedIds.add(s.category_id);
    });
    return categories.filter((c) => usedIds.has(c.id));
  }, [brigadeServices, categories]);

  const categoriesWithServices = useMemo(() => {
    return brigadeCategories
      .map((cat) => ({
        cat,
        list: filtered.filter((s) => s.category_id === cat.id),
      }))
      .filter((x) => x.list.length > 0 || !query);
  }, [brigadeCategories, filtered, query]);

  const orphanServices = useMemo(
    () =>
      filtered.filter(
        (s) =>
          !s.category_id ||
          !brigadeCategories.some((c) => c.id === s.category_id),
      ),
    [filtered, brigadeCategories],
  );

  // DnD — activate drag after 500 ms hold with <6 px movement, so
  // taps and horizontal swipes still belong to SwipeableRow.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 500, tolerance: 6 },
    }),
  );

  if (!team) {
    return (
      <BrigadeSectionShell brigadeId={id} title="Услуги" hideSave>
        <div className="bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] px-4 py-6 text-center text-[13px] text-[var(--label-tertiary)]">
          Команда не найдена.
        </div>
      </BrigadeSectionShell>
    );
  }

  const removeFromBrigade = async (svc: Service) => {
    const usedElsewhere =
      svc.brigade_ids.filter((b) => b !== team.id).length > 0;
    if (svc.brigade_ids.length === 0) {
      // Legacy "everyone" service — confirm before global deletion.
      const ok = await confirm({
        title: `Удалить услугу «${svc.name}»?`,
        message: "Эта услуга была доступна всем командам и пропадёт полностью.",
        confirmLabel: "Удалить",
      });
      if (!ok) return;
      haptic("warning");
      upsertService({ ...svc, is_active: false, brigade_ids: [] });
      return;
    }
    if (usedElsewhere) {
      haptic("warning");
      upsertService({
        ...svc,
        brigade_ids: svc.brigade_ids.filter((b) => b !== team.id),
      });
      return;
    }
    const ok = await confirm({
      title: `Удалить услугу «${svc.name}»?`,
      message: "Эта услуга используется только этой командой и пропадёт полностью.",
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    haptic("warning");
    upsertService({ ...svc, is_active: false, brigade_ids: [] });
  };

  // Duplicate — copy the service under a new id with "(копия)"
  // suffix. Exposed from the long-press context menu.
  const duplicateService = (svc: Service) => {
    haptic("tap");
    upsertService({
      ...svc,
      id: generateId("svc"),
      name: `${svc.name} (копия)`,
      sort_order: undefined, // sit at the end
      created_at: new Date().toISOString(),
    });
  };

  // Drop handler — reorders services within one category by writing
  // sort_order on the new sequence. Persists via upsertService.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    haptic("tap");
    // Find which category the dragged item belongs to — reorder in
    // that bucket only. Cross-category drag would move the service's
    // category_id and is out of scope for this pass.
    const activeSvc = services.find((s) => s.id === active.id);
    if (!activeSvc) return;
    const bucket = brigadeServices.filter(
      (s) => s.category_id === activeSvc.category_id,
    );
    const oldIdx = bucket.findIndex((s) => s.id === active.id);
    const newIdx = bucket.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(bucket, oldIdx, newIdx);
    // Assign sort_order in 10s so future inserts have gaps.
    reordered.forEach((svc, i) => {
      const next = (i + 1) * 10;
      if (svc.sort_order !== next) {
        upsertService({ ...svc, sort_order: next });
      }
    });
  };

  // ─── Group actions (rename / recolour / delete) ──────────────────
  const handleUpdateGroup = (catId: string, name: string, color: string) => {
    haptic("tap");
    setCategories(
      categories.map((c) =>
        c.id === catId ? { ...c, name: name.trim(), color } : c,
      ),
    );
  };

  const handleDeleteGroup = async (cat: ServiceCategory) => {
    setGroupMenu(null);
    // Count every service carrying this category — categories live at
    // tenant level, so deletion reassigns ALL of them (not just this
    // brigade's) to «Без группы». The services themselves are kept.
    const affected = services.filter((s) => s.category_id === cat.id);
    const ok = await confirm({
      title: `Удалить группу «${cat.name}»?`,
      message: affected.length
        ? "Услуги из неё не удалятся — станут «Без группы». Это можно отменить, создав группу заново."
        : "В группе нет услуг.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    haptic("warning");
    affected.forEach((s) => upsertService({ ...s, category_id: null }));
    setCategories(categories.filter((c) => c.id !== cat.id));
  };

  const totalCount = brigadeServices.length;

  return (
    <BrigadeSectionShell brigadeId={id} title="Услуги" hideSave>
      {totalCount === 0 && !query ? (
        <EmptyState onAddService={() => setAddOpen(true)} />
      ) : (
        <>
          {/* Search only — group creation lives inside the service
              form modal now. Dedicated "Новая группа" action was
              removed 2026-04-22 per user feedback: groups are an
              internal detail of service creation, not a first-class
              entry point. */}
          <div className="relative">
            <Search
              size={16}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--label-tertiary)] pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию"
              className="w-full h-10 pl-9 pr-9 rounded-[10px] bg-[var(--fill-tertiary)] text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:bg-[var(--surface-card)] focus:ring-2 focus:ring-[var(--accent)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-[var(--fill-secondary)] text-[var(--label-tertiary)] press-scale"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {categoriesWithServices.map(({ cat, list }) => (
              <CategorySection
                key={cat.id}
                cat={cat}
                list={list}
                onTap={(svc) => setEditing(svc)}
                onLongPress={(svc, anchor) => setMenu({ service: svc, anchor })}
                onRemove={removeFromBrigade}
                onAddService={() => {
                  setAddOpen(true);
                  // Default category will be picked up by the modal.
                }}
                onGroupMenu={(anchor) => setGroupMenu({ cat, anchor })}
              />
            ))}

            {orphanServices.length > 0 && (
              <CategorySection
                cat={{
                  id: "__orphans__",
                  name: "Без группы",
                  color: "#8E8E93",
                }}
                list={orphanServices}
                onTap={(svc) => setEditing(svc)}
                onLongPress={(svc, anchor) => setMenu({ service: svc, anchor })}
                onRemove={removeFromBrigade}
                onAddService={() => setAddOpen(true)}
              />
            )}
          </DndContext>

          {/* Add new service */}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] active:bg-[var(--fill-quaternary)] transition press-scale"
          >
            <span className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--accent-tint)] text-[var(--accent)] shrink-0">
              <Plus size={18} strokeWidth={2.5} />
            </span>
            <span className="flex-1 text-[15px] font-medium text-[var(--accent)]">
              Новая услуга
            </span>
          </button>

          {filtered.length === 0 && query && (
            <div className="bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] px-4 py-5 text-center text-[13px] text-[var(--label-tertiary)]">
              Ничего не найдено по запросу «{query}».
            </div>
          )}

          <div className="px-4 pt-0.5 text-[12px] leading-snug text-[var(--label-tertiary)]">
            Тап — редактировать. Долгое нажатие — меню. Потяните за ручку&nbsp;☰ — переместить. Свайп влево — удалить.
          </div>
        </>
      )}

      <ServiceFormModal
        open={addOpen}
        mode="create"
        brigadeId={team.id}
        categories={brigadeCategories}
        onClose={() => setAddOpen(false)}
        onSubmit={(svc) => {
          upsertService(svc);
          setAddOpen(false);
        }}
        onCreateCategory={(name, color) => {
          const cat: ServiceCategory = {
            id: generateId("cat"),
            name: name.trim(),
            color,
          };
          setCategories([...categories, cat]);
          return cat.id;
        }}
      />
      <ServiceFormModal
        open={!!editing}
        mode="edit"
        service={editing}
        brigadeId={team.id}
        categories={brigadeCategories}
        onClose={() => setEditing(null)}
        onSubmit={(svc) => {
          upsertService(svc);
          setEditing(null);
        }}
        onCreateCategory={(name, color) => {
          const cat: ServiceCategory = {
            id: generateId("cat"),
            name: name.trim(),
            color,
          };
          setCategories([...categories, cat]);
          return cat.id;
        }}
      />
      <ContextMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        title={menu?.service.name}
        options={
          menu
            ? [
                {
                  label: "Редактировать",
                  icon: <Pencil size={18} strokeWidth={2} />,
                  onSelect: () => setEditing(menu.service),
                },
                {
                  label: "Дублировать",
                  icon: <Copy size={18} strokeWidth={2} />,
                  onSelect: () => duplicateService(menu.service),
                },
                {
                  label: "Удалить",
                  icon: <Trash2 size={18} strokeWidth={2} />,
                  danger: true,
                  onSelect: () => removeFromBrigade(menu.service),
                },
              ] as ContextMenuOption[]
            : []
        }
      />

      {/* Sprint 034 — group management menu (⋯ on a group header). */}
      <ContextMenu
        open={!!groupMenu}
        onClose={() => setGroupMenu(null)}
        anchor={groupMenu?.anchor ?? null}
        title={groupMenu?.cat.name}
        options={
          groupMenu
            ? [
                {
                  label: "Переименовать",
                  icon: <Pencil size={18} strokeWidth={2} />,
                  onSelect: () => {
                    const c = groupMenu.cat;
                    setGroupMenu(null);
                    setGroupEdit(c);
                  },
                },
                {
                  label: "Изменить цвет",
                  icon: (
                    <span
                      className="w-[18px] h-[18px] rounded-full"
                      style={{ backgroundColor: groupMenu.cat.color }}
                    />
                  ),
                  onSelect: () => {
                    const c = groupMenu.cat;
                    setGroupMenu(null);
                    setGroupEdit(c);
                  },
                },
                {
                  label: "Удалить группу",
                  icon: <Trash2 size={18} strokeWidth={2} />,
                  danger: true,
                  onSelect: () => handleDeleteGroup(groupMenu.cat),
                },
              ] as ContextMenuOption[]
            : []
        }
      />

      <CategoryFormModal
        open={!!groupEdit}
        mode="edit"
        initialName={groupEdit?.name ?? ""}
        initialColor={groupEdit?.color ?? GROUP_COLORS[0]}
        onClose={() => setGroupEdit(null)}
        onSubmit={(name, color) => {
          if (groupEdit) handleUpdateGroup(groupEdit.id, name, color);
          setGroupEdit(null);
        }}
      />
    </BrigadeSectionShell>
  );
}

// ─── Category group card ──────────────────────────────────────────

function CategorySection({
  cat,
  list,
  onTap,
  onLongPress,
  onRemove,
  onAddService,
  onGroupMenu,
}: {
  cat: ServiceCategory;
  list: Service[];
  onTap: (svc: Service) => void;
  onLongPress: (svc: Service, anchor: { x: number; y: number }) => void;
  onRemove: (svc: Service) => void;
  onAddService: () => void;
  /** Open the group-management menu (rename / colour / delete). Omitted
   *  for the pseudo «Без группы» bucket, which can't be edited. */
  onGroupMenu?: (anchor: { x: number; y: number }) => void;
}) {
  return (
    <div>
      <div className="px-4 pb-1.5 flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: cat.color }}
        />
        <div className="flex-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--label-secondary)] truncate">
          {cat.name}
        </div>
        {onGroupMenu && (
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onGroupMenu({ x: r.left + r.width / 2, y: r.bottom });
            }}
            aria-label="Меню группы"
            className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full bg-[var(--fill-tertiary)] text-[var(--label-secondary)] press-scale"
          >
            <MoreHorizontal size={15} strokeWidth={2.5} />
          </button>
        )}
        <button
          type="button"
          onClick={onAddService}
          aria-label="Добавить услугу в группу"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full bg-[var(--fill-tertiary)] text-[var(--accent)] press-scale"
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
      </div>
      <div className="bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden divide-y divide-[var(--separator)]">
        <SortableContext
          items={list.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {list.map((s) => (
            <SortableServiceRow
              key={s.id}
              service={s}
              cat={cat}
              onTap={() => onTap(s)}
              onLongPress={(a) => onLongPress(s, a)}
              onRemove={() => onRemove(s)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ─── Sortable row wrapper ─────────────────────────────────────────

function SortableServiceRow({
  service,
  cat,
  onTap,
  onLongPress,
  onRemove,
}: {
  service: Service;
  cat: ServiceCategory;
  onTap: () => void;
  onLongPress: (anchor: { x: number; y: number }) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    position: "relative",
    boxShadow: isDragging
      ? "0 10px 24px rgba(0,0,0,0.18)"
      : undefined,
    background: isDragging ? "var(--surface-card)" : undefined,
    opacity: isDragging ? 0.95 : 1,
  };

  const gestures = useLongPressOrTap({
    onTap,
    onLongPress,
    // Skip timer when the user taps the drag handle — that gesture
    // belongs to dnd-kit. We identify it via a data-attribute on
    // the handle element so we don't have to wrestle with event
    // propagation.
    isInsideDragHandle: (t) =>
      !!(t as HTMLElement | null)?.closest("[data-drag-handle]"),
  });

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SwipeableRow
        rightActions={[
          {
            label: "Удалить",
            color: "bg-[var(--system-red)]",
            icon: <Trash2 size={16} strokeWidth={2} />,
            onSelect: onRemove,
          },
        ]}
      >
        <div
          {...gestures}
          className="flex items-center gap-3 px-4 min-h-[56px] py-2 cursor-pointer select-none active:bg-[var(--fill-quaternary)] transition"
          style={{
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            touchAction: "pan-y",
          }}
        >
          <span
            className="w-2 h-8 rounded-full shrink-0"
            style={{ backgroundColor: cat.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] text-[var(--label)] truncate">
              {service.name}
            </div>
            <div className="text-[12px] text-[var(--label-secondary)] flex items-center gap-1.5 flex-wrap tabular-nums">
              <span>
                {service.duration_minutes > 0
                  ? `${service.duration_minutes} мин · `
                  : ""}
                €{service.price}
              </span>
              {service.price_tiers?.[0] &&
                service.price_tiers[0].min_qty > 1 &&
                service.price_tiers[0].price_per_unit > 0 && (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-tint)] text-[var(--accent)]">
                    от {service.price_tiers[0].min_qty} · €
                    {service.price_tiers[0].price_per_unit}
                  </span>
                )}
            </div>
          </div>
          {/* Drag handle — dnd-kit listeners live HERE only, so long-
              press elsewhere in the row goes to the context-menu
              hook instead of drag. data-drag-handle lets the hook
              bail out on taps that land on this element. */}
          <span
            {...listeners}
            data-drag-handle
            aria-label="Перетащить"
            className="shrink-0 w-10 h-10 -mr-2 flex items-center justify-center text-[var(--label-quaternary)] touch-none"
          >
            <GripVertical size={18} strokeWidth={2} />
          </span>
        </div>
      </SwipeableRow>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────

function EmptyState({
  onAddService,
}: {
  onAddService: () => void;
}) {
  return (
    <div className="px-6 pt-10 pb-4 flex flex-col items-center text-center gap-3">
      <span className="w-16 h-16 rounded-full bg-[var(--accent-tint)] flex items-center justify-center text-[var(--accent)]">
        <Plus size={28} strokeWidth={2.2} />
      </span>
      <div>
        <div className="text-[17px] font-semibold text-[var(--label)]">
          Пока нет услуг
        </div>
        <div className="mt-1 text-[13px] leading-snug text-[var(--label-secondary)]">
          Добавьте первую — группу можно создать в&nbsp;самой форме услуги.
        </div>
      </div>
      <button
        type="button"
        onClick={onAddService}
        className="mt-3 h-11 px-5 rounded-full bg-[var(--accent)] text-[var(--label-on-accent)] text-[15px] font-semibold press-scale"
      >
        Новая услуга
      </button>
    </div>
  );
}

// ─── Service form modal ──────────────────────────────────────────

function ServiceFormModal({
  open,
  mode,
  service,
  brigadeId,
  categories,
  onClose,
  onSubmit,
  onCreateCategory,
}: {
  open: boolean;
  mode: "create" | "edit";
  service?: Service | null;
  brigadeId: string;
  categories: ServiceCategory[];
  onClose: () => void;
  onSubmit: (svc: Service) => void;
  /** Called when user taps "+ Новая группа" inside the service form.
   *  Creates a new category and returns its id so the modal can
   *  auto-select it. */
  onCreateCategory: (name: string, color: string) => string;
}) {
  const [categoryId, setCategoryId] = useState<string>("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(GROUP_COLORS[0]);
  const [colorManuallyPicked, setColorManuallyPicked] = useState(false);
  const [min, setMin] = useState(60);
  const [price, setPrice] = useState(0);
  // Sprint 034 — simplified per user feedback ("слишком много
  // ступенчатости"). A single optional volume price (от N шт → €X),
  // persisted as a one-entry price_tiers ladder; the price & duration
  // LADDERS are retired. Availability (weekdays / online / active)
  // moves under «Дополнительно».
  const [volOpen, setVolOpen] = useState(false);
  const [volQty, setVolQty] = useState(0);
  const [volPrice, setVolPrice] = useState(0);
  const [materialCosts, setMaterialCosts] = useState<ServiceMaterialCost[]>([]);
  const [days, setDays] = useState<Weekday[]>([]);
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(true);
  const [custom, setCustom] = useState(false); // duration "Своё" field
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [inlineCatOpen, setInlineCatOpen] = useState(false);
  // Sprint 033 Phase I21 — groups created inline during this modal
  // session aren't in the scoped `categories` prop yet (brigade-
  // scoped list requires at least 1 service in the brigade using
  // the group). To give the user immediate feedback that their
  // new group exists AND is selected, we stash just-created
  // categories locally and render them alongside the prop list.
  // They vanish on modal close — but the service they just created
  // pulls the group into `brigadeCategories` on next open anyway.
  const [pendingCategories, setPendingCategories] = useState<ServiceCategory[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  useMemoizedInit(open, () => {
    if (mode === "edit" && service) {
      setCategoryId(service.category_id ?? "");
      setName(service.name);
      setColor(service.color || GROUP_COLORS[0]);
      setColorManuallyPicked(true); // don't stomp existing colour
      setMin(service.duration_minutes);
      setCustom(
        service.duration_minutes > 0 &&
          !PRESET_DURATIONS.includes(service.duration_minutes),
      );
      setPrice(service.price);
      // Volume price — first price tier (single-step model). Legacy
      // bulk_threshold/bulk_price was already migrated to price_tiers
      // by loadServices(); we read the first tier and ignore the rest.
      const tier = (service.price_tiers ?? [])[0];
      setVolQty(tier?.min_qty ?? 0);
      setVolPrice(tier?.price_per_unit ?? 0);
      setVolOpen(!!tier);
      const costs = service.material_costs ?? [];
      setMaterialCosts(costs);
      setDays(service.available_weekdays ?? []);
      setOnline(service.online_enabled ?? true);
      setActive(service.is_active ?? true);
      setShowAdvanced(
        costs.length > 0 || (service.available_weekdays?.length ?? 0) > 0,
      );
    } else {
      setCategoryId("");
      setName("");
      setColor(GROUP_COLORS[0]);
      setColorManuallyPicked(false);
      setMin(60);
      setCustom(false);
      setPrice(0);
      setVolOpen(false);
      setVolQty(0);
      setVolPrice(0);
      setMaterialCosts([]);
      setDays([]);
      setOnline(true);
      setActive(true);
      setShowAdvanced(false);
    }
    // Reset pending cats whenever the modal (re)opens so we don't
    // carry orphans from a previous cancelled session.
    setPendingCategories([]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  });

  useEscClose(open, onClose);

  // Union of scoped-from-brigade + just-created-here. Shown as pills.
  const visibleCategories = useMemo(
    () => [...categories, ...pendingCategories],
    [categories, pendingCategories],
  );

  // When user picks a group and hasn't manually overridden the colour,
  // the service adopts the group's colour. This is the common case —
  // one click on «Чистка» → blue service tile.
  const pickCategory = (id: string) => {
    haptic("tap");
    setCategoryId(id);
    if (!colorManuallyPicked) {
      const cat = visibleCategories.find((c) => c.id === id);
      if (cat) setColor(cat.color);
    }
  };

  if (!open) return null;

  const hasCategories = visibleCategories.length > 0;
  // Sprint 033 Phase I24 — duration and price can be 0. Some services
  // don't charge (in-scope repair under warranty) or don't block
  // calendar time (phone consultation). Only name and group are
  // hard-required.
  const canSubmit = name.trim().length > 0 && categoryId.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    haptic("tap");
    // Drop unnamed / negative material lines; keep cost_per_unit in
    // sync as their sum (the finances page reads it for net revenue).
    const cleanMaterials = materialCosts.filter(
      (m) => m.name.trim().length > 0 && m.amount >= 0,
    );
    const sumCostPerUnit = cleanMaterials.reduce(
      (s, m) => s + Math.max(0, m.amount),
      0,
    );
    // Single optional volume step → one-entry price_tiers ladder.
    // Legacy bulk_* fields are zeroed; the duration ladder is retired.
    const tiers: PriceTier[] | undefined =
      volOpen && volQty > 1 && volPrice > 0
        ? [{ min_qty: volQty, price_per_unit: volPrice }]
        : undefined;
    const patch = {
      name: name.trim(),
      color,
      duration_minutes: Math.max(0, min),
      price: Math.max(0, price),
      category_id: categoryId,
      price_tiers: tiers,
      duration_tiers: undefined,
      bulk_threshold: 0,
      bulk_price: 0,
      material_costs: cleanMaterials,
      cost_per_unit: sumCostPerUnit,
      available_weekdays: days,
      online_enabled: online,
      is_active: active,
    };
    if (mode === "edit" && service) {
      onSubmit({ ...service, ...patch });
    } else {
      onSubmit(createBlankService({ ...patch, brigade_ids: [brigadeId] }));
    }
  };

  // ── Weekday availability ───────────────────────────────────────
  const toggleDay = (day: Weekday) => {
    setDays((d) =>
      d.includes(day)
        ? d.filter((x) => x !== day)
        : ([...d, day].sort((a, b) => a - b) as Weekday[]),
    );
  };

  // ── Material-cost handlers ─────────────────────────────────────
  const addMaterial = () => {
    haptic("tap");
    setMaterialCosts([
      ...materialCosts,
      { id: generateId("mat"), name: "", amount: 0 },
    ]);
  };
  const updateMaterial = (
    id: string,
    patch: Partial<ServiceMaterialCost>,
  ) => {
    setMaterialCosts(
      materialCosts.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };
  const removeMaterial = (id: string) => {
    haptic("warning");
    setMaterialCosts(materialCosts.filter((m) => m.id !== id));
  };

  // Live read-outs for the price card.
  const matSum = materialCosts.reduce(
    (s, m) => s + Math.max(0, m.amount || 0),
    0,
  );
  const margin = price - matSum;
  const volPct =
    volQty > 1 && volPrice > 0 && price > 0
      ? Math.round((1 - volPrice / price) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--surface-overlay)] backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] bg-[var(--surface-grouped)] rounded-[16px] overflow-hidden shadow-[var(--shadow-sheet)] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — Отмена · title · Сохранить. Save lives here now
            (no bottom button bar) to keep the form compact. */}
        <div className="flex items-center gap-2 px-3 h-12 bg-[var(--surface-card)] border-b border-[var(--separator)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-[15px] text-[var(--accent)] px-1 press-scale"
          >
            Отмена
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold text-[var(--label)] tracking-tight">
            {mode === "create" ? "Новая услуга" : "Услуга"}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-8 px-3.5 rounded-full bg-[var(--accent)] text-[var(--label-on-accent)] text-[14px] font-semibold press-scale disabled:bg-[var(--fill-tertiary)] disabled:text-[var(--label-tertiary)] disabled:pointer-events-none"
          >
            Сохранить
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* 1. GROUP — required, first. */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1">
              Группа <span className="text-[var(--system-red)]">*</span>
            </label>
            {hasCategories ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {visibleCategories.map((c) => {
                  const picked = c.id === categoryId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCategory(c.id)}
                      className={`h-8 px-3 rounded-full text-[13px] font-medium press-scale flex items-center gap-1.5 transition ${
                        picked
                          ? "bg-[var(--accent)] text-[var(--label-on-accent)]"
                          : "bg-[var(--surface-card)] text-[var(--label)]"
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setInlineCatOpen(true)}
                  className="h-8 px-3 rounded-full text-[13px] font-medium press-scale flex items-center gap-1.5 bg-[var(--accent-tint)] text-[var(--accent)]"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  Новая группа
                </button>
              </div>
            ) : (
              <div className="mt-1 bg-[var(--surface-card)] rounded-[10px] px-3 py-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-[var(--accent-tint)] text-[var(--accent)] flex items-center justify-center shrink-0">
                  <FolderPlus size={16} strokeWidth={2} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--label)] leading-snug">
                    Сначала создайте группу — без неё нельзя добавить услугу.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInlineCatOpen(true)}
                  className="shrink-0 h-9 px-3 rounded-full bg-[var(--accent)] text-[var(--label-on-accent)] text-[13px] font-semibold press-scale"
                >
                  Создать
                </button>
              </div>
            )}
          </div>

          {/* 2. NAME */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1">
              Название <span className="text-[var(--system-red)]">*</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Название услуги"
              className="mt-1 w-full h-11 px-3 rounded-[10px] bg-[var(--surface-card)] text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              maxLength={80}
            />
          </div>

          {/* DURATION — quick-pick chips in one scrollable row. "Своё"
              reveals a numeric field for off-grid values. */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1">
              Длительность
            </label>
            <div className="mt-1 flex gap-1.5 overflow-x-auto scrollbar-hide">
              {PRESET_DURATIONS.map((p) => {
                const on = !custom && min === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      setCustom(false);
                      setMin(p);
                    }}
                    className={`shrink-0 h-9 min-w-[44px] px-3 rounded-[10px] text-[15px] font-semibold press-scale ${
                      on
                        ? "bg-[var(--accent)] text-[var(--label-on-accent)]"
                        : "bg-[var(--surface-card)] text-[var(--label)]"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  setCustom(true);
                  if (PRESET_DURATIONS.includes(min)) setMin(0);
                }}
                className={`shrink-0 h-9 px-3 rounded-[10px] text-[14px] font-medium press-scale ${
                  custom && !PRESET_DURATIONS.includes(min)
                    ? "bg-[var(--accent)] text-[var(--label-on-accent)]"
                    : "bg-[var(--surface-card)] text-[var(--label-secondary)]"
                }`}
              >
                {custom && min > 0 && !PRESET_DURATIONS.includes(min)
                  ? `${min} м`
                  : "Своё"}
              </button>
            </div>
            {custom && !PRESET_DURATIONS.includes(min) && (
              <div className="mt-2 flex items-center gap-2 bg-[var(--surface-card)] rounded-[10px] pr-3 focus-within:ring-2 focus-within:ring-[var(--accent)]">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  value={min === 0 ? "" : String(min)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setMin(digits === "" ? 0 : parseInt(digits, 10));
                  }}
                  placeholder="минут"
                  className="flex-1 min-w-0 h-11 pl-3 bg-transparent text-[15px] text-[var(--label)] focus:outline-none"
                />
                <span className="text-[13px] text-[var(--label-secondary)]">
                  мин
                </span>
              </div>
            )}
          </div>

          {/* PRICE — base price + live margin + one optional volume step. */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1">
              Цена
            </label>
            <div className="mt-1 flex items-center gap-2 bg-[var(--surface-card)] rounded-[10px] pl-3 focus-within:ring-2 focus-within:ring-[var(--accent)]">
              <span className="text-[15px] text-[var(--label-secondary)]">€</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={price === 0 ? "" : String(price)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setPrice(digits === "" ? 0 : parseInt(digits, 10));
                }}
                placeholder="0"
                className="flex-1 min-w-0 h-11 pr-3 bg-transparent text-[15px] text-[var(--label)] focus:outline-none"
              />
            </div>
            {materialCosts.length > 0 && (
              <div className="mt-1.5 px-1 text-[12px] font-semibold text-[var(--system-green)]">
                маржа €{margin} · €{price} − €{matSum} расход
              </div>
            )}
            {volOpen ? (
              <div className="mt-2 bg-[var(--surface-card)] rounded-[10px] p-2.5">
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--label-tertiary)]">
                  <span>от</span>
                  <div className="flex items-center gap-1 bg-[var(--fill-tertiary)] rounded-[8px] px-2 h-9">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={volQty === 0 ? "" : String(volQty)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setVolQty(digits === "" ? 0 : parseInt(digits, 10));
                      }}
                      placeholder="3"
                      className="w-8 bg-transparent text-[14px] text-[var(--label)] text-right focus:outline-none tabular-nums"
                    />
                    <span className="text-[12px] text-[var(--label-secondary)]">
                      шт
                    </span>
                  </div>
                  <span>по</span>
                  <div className="flex items-center gap-1 bg-[var(--fill-tertiary)] rounded-[8px] px-2 h-9">
                    <span className="text-[12px] text-[var(--label-secondary)]">
                      €
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={volPrice === 0 ? "" : String(volPrice)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setVolPrice(digits === "" ? 0 : parseInt(digits, 10));
                      }}
                      placeholder="0"
                      className="w-10 bg-transparent text-[14px] text-[var(--label)] text-right focus:outline-none tabular-nums"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("warning");
                      setVolOpen(false);
                      setVolQty(0);
                      setVolPrice(0);
                    }}
                    aria-label="Убрать объёмную цену"
                    className="ml-auto w-8 h-8 flex items-center justify-center rounded-full text-[var(--label-tertiary)] active:bg-[var(--fill-quaternary)] press-scale"
                  >
                    <X size={15} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="mt-1.5 text-[12px] font-semibold text-[var(--system-green)]">
                  {volQty > 1 && volPrice > 0
                    ? `от ${volQty} шт → €${volPrice} вместо €${price}${
                        volPct > 0 ? ` · −${volPct}%` : ""
                      }`
                    : "От какого количества цена за штуку ниже."}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  setVolOpen(true);
                  if (!volQty) setVolQty(3);
                  if (!volPrice) setVolPrice(Math.max(0, price - 5));
                }}
                className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accent)] press-scale"
              >
                <Plus size={14} strokeWidth={2.5} />
                Цена за объём
              </button>
            )}
          </div>

          {/* Дополнительно — расход материалов · доступность · цвет.
              Collapsed by default to keep the form short. */}
          <ExtraSection
            open={showAdvanced}
            onToggle={() => setShowAdvanced(!showAdvanced)}
            title="Дополнительно"
          >
            {/* Materials */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                Расход материалов
              </div>
              {materialCosts.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={m.name}
                    onChange={(e) =>
                      updateMaterial(m.id, { name: e.target.value })
                    }
                    placeholder="Название расхода"
                    className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[var(--fill-tertiary)] text-[14px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    maxLength={40}
                  />
                  <div className="flex items-center gap-1.5 bg-[var(--fill-tertiary)] rounded-[8px] pl-2.5 w-[90px] shrink-0">
                    <span className="text-[12px] text-[var(--label-secondary)]">
                      €
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={m.amount === 0 ? "" : String(m.amount)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        updateMaterial(m.id, {
                          amount: digits === "" ? 0 : parseInt(digits, 10),
                        });
                      }}
                      placeholder="0"
                      className="flex-1 min-w-0 h-9 pr-2.5 bg-transparent text-[14px] text-[var(--label)] text-right focus:outline-none tabular-nums"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMaterial(m.id)}
                    aria-label="Удалить расход"
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-[var(--label-tertiary)] active:bg-[var(--fill-quaternary)] press-scale"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addMaterial}
                className="w-full h-9 flex items-center justify-center gap-1.5 rounded-[8px] bg-[var(--accent-tint)] text-[var(--accent)] text-[13px] font-medium press-scale"
              >
                <Plus size={14} strokeWidth={2.5} />
                Добавить расход
              </button>
              {materialCosts.length > 0 && (
                <div className="flex items-center justify-between text-[12px] text-[var(--label-secondary)] pt-0.5">
                  <span>На 1 шт · маржа €{margin}</span>
                  <span className="font-semibold text-[var(--system-red)]">
                    −€{matSum}
                  </span>
                </div>
              )}
            </div>

            {/* Availability — weekdays + online + active. */}
            <div className="space-y-2 pt-2 mt-2 border-t border-[var(--separator)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                Доступность
              </div>
              <div className="flex gap-1">
                {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={`flex-1 h-9 rounded-[8px] text-[12px] font-semibold press-scale ${
                        on
                          ? "bg-[var(--accent)] text-[var(--label-on-accent)]"
                          : "bg-[var(--fill-tertiary)] text-[var(--label-secondary)]"
                      }`}
                    >
                      {WEEKDAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-[var(--label-tertiary)]">
                Пусто = любой день.
              </div>
              <ToggleRow
                label="Онлайн-запись"
                hint="клиент может выбрать сам"
                value={online}
                onChange={() => setOnline((v) => !v)}
              />
              <ToggleRow
                label="Услуга активна"
                hint="видна в новых записях"
                value={active}
                onChange={() => setActive((v) => !v)}
              />
            </div>

            {/* Colour — defaults to the group colour. */}
            <div className="space-y-2 pt-2 mt-2 border-t border-[var(--separator)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                Цвет{" "}
                <span className="normal-case font-medium text-[var(--label-tertiary)]">
                  · по умолчанию из группы
                </span>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {GROUP_COLORS.map((c) => {
                  const picked = c === color;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        haptic("tap");
                        setColor(c);
                        setColorManuallyPicked(true);
                      }}
                      className="relative w-full aspect-square rounded-full press-scale flex items-center justify-center"
                      style={{ backgroundColor: c }}
                    >
                      {picked && (
                        <Check
                          size={16}
                          strokeWidth={3}
                          className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </ExtraSection>

        </div>
      </div>

      {/* Nested "Новая группа" modal — opened from the group row.
          Uses z-[70] so it stacks above this modal. */}
      <CategoryFormModal
        open={inlineCatOpen}
        onClose={() => setInlineCatOpen(false)}
        onSubmit={(n, c) => {
          const id = onCreateCategory(n, c);
          // Mirror the brand-new category into the local pill list so
          // the user sees it as an immediately-selectable pill and
          // the empty-state prompt goes away even though the brigade-
          // scoped `categories` prop hasn't re-scoped yet.
          setPendingCategories((prev) => [
            ...prev,
            { id, name: n.trim(), color: c },
          ]);
          setInlineCatOpen(false);
          setCategoryId(id);
          if (!colorManuallyPicked) setColor(c);
        }}
      />
    </div>
  );
}

// ─── Category form modal (create group) ──────────────────────────
// Phase I20 — use the unified PRESET_COLOR_VALUES palette everywhere
// a colour is picked, so brigade / Метка / group / service all share
// the same 13-colour palette. Local GROUP_COLORS retired.
const GROUP_COLORS = PRESET_COLOR_VALUES;

function CategoryFormModal({
  open,
  onClose,
  onSubmit,
  mode = "create",
  initialName = "",
  initialColor,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, color: string) => void;
  /** "edit" prefills name + colour and swaps the title / submit label.
   *  Used by the group ⋯ menu (rename / recolour). */
  mode?: "create" | "edit";
  initialName?: string;
  initialColor?: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useMemoizedInit(open, () => {
    setName(initialName);
    setColor(initialColor ?? GROUP_COLORS[0]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  });

  useEscClose(open, onClose);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <div
      // z-[70] so it stacks above ServiceFormModal (z-[60]) when
      // opened inline via "+ Новая группа".
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--surface-overlay)] backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] bg-[var(--surface-grouped)] rounded-[16px] overflow-hidden shadow-[var(--shadow-sheet)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 bg-[var(--surface-card)] border-b border-[var(--separator)] text-center">
          <div className="text-[17px] font-semibold text-[var(--label)] tracking-tight">
            {mode === "edit" ? "Группа" : "Новая группа"}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1">
              Название
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) onSubmit(trimmed, color);
              }}
              placeholder="Название группы"
              className="mt-1 w-full h-11 px-3 rounded-[10px] bg-[var(--surface-card)] text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              maxLength={40}
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] px-1 mb-1.5">
              Цвет
            </div>
            <div className="bg-[var(--surface-card)] rounded-[10px] p-3">
              <div className="grid grid-cols-7 gap-2">
                {GROUP_COLORS.map((c) => {
                  const picked = c === color;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        haptic("tap");
                        setColor(c);
                      }}
                      className="relative w-full aspect-square rounded-full press-scale flex items-center justify-center"
                      style={{ backgroundColor: c }}
                    >
                      {picked && (
                        <Check
                          size={16}
                          strokeWidth={3}
                          className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-1 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-[10px] bg-[var(--fill-tertiary)] text-[15px] font-medium text-[var(--label)] press-scale"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => canSubmit && onSubmit(trimmed, color)}
            disabled={!canSubmit}
            className="flex-1 h-11 rounded-[10px] bg-[var(--accent)] text-[15px] font-semibold text-[var(--label-on-accent)] press-scale disabled:bg-[var(--fill-tertiary)] disabled:text-[var(--label-tertiary)] disabled:pointer-events-none"
          >
            {mode === "edit" ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toggle row (label + iOS-style switch) ───────────────────────
function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="w-full flex items-center gap-3 py-1 text-left press-scale"
    >
      <span className="flex-1">
        <span className="block text-[14px] text-[var(--label)]">{label}</span>
        {hint && (
          <span className="block text-[11px] text-[var(--label-tertiary)]">
            {hint}
          </span>
        )}
      </span>
      <span
        className={`relative w-[46px] h-[28px] rounded-full transition-colors shrink-0 ${
          value ? "bg-[var(--system-green)]" : "bg-[var(--fill-primary)]"
        }`}
      >
        <span
          className={`absolute top-[2px] w-[24px] h-[24px] rounded-full bg-white shadow transition-all ${
            value ? "left-[20px]" : "left-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

// ─── Collapsible sub-card with title + children ──────────────────
function ExtraSection({
  open,
  onToggle,
  title,
  hint,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-1 py-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--label-secondary)] press-scale"
      >
        <ChevronDown
          size={14}
          strokeWidth={2.5}
          className={`transition-transform ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
        {title}
      </button>
      {open && (
        <div className="mt-1 bg-[var(--surface-card)] rounded-[10px] p-3 space-y-2">
          {children}
          {hint && (
            <div className="text-[11px] text-[var(--label-tertiary)] leading-snug pt-1">
              {hint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Long-press + tap hook (same shape as cities / masters) ────

function useLongPressOrTap({
  onTap,
  onLongPress,
  isInsideDragHandle,
  delay = 500,
}: {
  onTap: () => void;
  onLongPress: (anchor: { x: number; y: number }) => void;
  /** Optional target guard — return true to bail out entirely so the
   *  drag handle element retains exclusive ownership of the gesture. */
  isInsideDragHandle?: (target: EventTarget | null) => boolean;
  delay?: number;
}) {
  const timer = useRef<number | null>(null);
  const triggered = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (isInsideDragHandle?.(e.target)) {
        origin.current = null;
        return;
      }
      triggered.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        triggered.current = true;
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(12);
        }
        if (origin.current) onLongPress(origin.current);
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!origin.current || timer.current == null) return;
      const dx = Math.abs(e.clientX - origin.current.x);
      const dy = Math.abs(e.clientY - origin.current.y);
      if (dx > 10 || dy > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick: (e: React.MouseEvent) => {
      if (triggered.current) {
        e.preventDefault();
        e.stopPropagation();
        triggered.current = false;
        return;
      }
      onTap();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
    },
  };
}

// ─── Tiny hook helpers ────────────────────────────────────────────

function useMemoizedInit(active: boolean, init: () => void | (() => void)) {
  useEffect(() => {
    if (!active) return;
    return init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

function useEscClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}
