"use client";

// Create OR edit an account (money bucket) for a brigade. Centered modal.
// kind → preset icon; name defaults from the kind but stays editable.
// Create saves via onSubmit (useAccounts.add); edit via onUpdate; the
// «Удалить счёт» button soft-closes via onDelete (two-tap confirm).

import { useEffect, useState } from "react";
import type { Team } from "@babun/shared/local/masters";
import type { Account, AccountKind } from "@babun/shared/local/finance/account";
import type { AccountDraft } from "@babun/shared/db/repositories/accounts";

const KINDS: Array<{ kind: AccountKind; label: string; icon: string }> = [
  { kind: "cash", label: "Наличные", icon: "💵" },
  { kind: "card", label: "Карта", icon: "💳" },
  { kind: "bank", label: "Банк", icon: "🏦" },
  { kind: "other", label: "Другое", icon: "📦" },
];

interface AddAccountSheetProps {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  defaultBrigadeId?: string;
  /** When set, the sheet edits this account instead of creating. */
  account?: Account;
  onSubmit?: (draft: AccountDraft) => Promise<void>;
  onUpdate?: (id: string, patch: Partial<AccountDraft>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function AddAccountSheet({
  open,
  onClose,
  teams,
  defaultBrigadeId,
  account,
  onSubmit,
  onUpdate,
  onDelete,
}: AddAccountSheetProps) {
  const editing = !!account;
  // Parent mounts this only while open, so initialisers run fresh on each open.
  const [brigadeId, setBrigadeId] = useState(
    account?.brigade_id ?? defaultBrigadeId ?? teams[0]?.id ?? "",
  );
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "cash");
  const [name, setName] = useState(account?.name ?? "Наличные");
  const [opening, setOpening] = useState(
    account ? String(account.opening_balance) : "",
  );
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const pickKind = (k: AccountKind, label: string) => {
    setKind(k);
    setName((prev) => {
      const isDefault = KINDS.some((x) => x.label === prev) || prev.trim() === "";
      return isDefault ? label : prev;
    });
  };

  const openingNum = (() => {
    const n = parseFloat(opening.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  })();
  const canSave = brigadeId !== "" && name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const icon = KINDS.find((x) => x.kind === kind)?.icon ?? null;
      const draft: AccountDraft = {
        scope: "team",
        brigade_id: brigadeId,
        name: name.trim(),
        kind,
        opening_balance: openingNum,
        icon,
      };
      if (editing && account && onUpdate) {
        await onUpdate(account.id, draft);
      } else if (onSubmit) {
        await onSubmit(draft);
      }
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!account || !onDelete) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSaving(true);
    try {
      await onDelete(account.id);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-[var(--surface-overlay)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[var(--surface-card)] rounded-[20px] shadow-[var(--shadow-sheet)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-3">
          <div className="text-[17px] font-semibold text-[var(--label)]">
            {editing ? "Счёт" : "Новый счёт"}
          </div>
        </div>

        <div className="px-4 pb-4 space-y-3">
          {teams.length > 1 && (
            <div>
              <div className="text-[12px] font-medium text-[var(--label-secondary)] mb-1.5">
                Бригада
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setBrigadeId(t.id)}
                    className={`flex-shrink-0 h-8 px-3 rounded-full text-[12px] font-semibold border transition ${
                      brigadeId === t.id
                        ? "bg-[var(--accent)] text-[var(--label-on-accent)] border-transparent"
                        : "bg-[var(--surface-card)] text-[var(--label)] border-[var(--separator)]"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[12px] font-medium text-[var(--label-secondary)] mb-1.5">
              Тип счёта
            </div>
            <div className="flex gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => pickKind(k.kind, k.label)}
                  className={`flex-1 h-12 rounded-[12px] border flex flex-col items-center justify-center gap-0.5 transition ${
                    kind === k.kind
                      ? "bg-[var(--accent-tint)] border-[var(--accent)]"
                      : "bg-[var(--surface-card)] border-[var(--separator)]"
                  }`}
                >
                  <span className="text-[18px] leading-none">{k.icon}</span>
                  <span className="text-[10px] text-[var(--label-secondary)]">
                    {k.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[12px] font-medium text-[var(--label-secondary)] mb-1.5">
              Название
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Карта Юры"
              className="w-full h-11 px-3.5 bg-[var(--fill-tertiary)] rounded-[10px] text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <div className="text-[12px] font-medium text-[var(--label-secondary)] mb-1.5">
              {editing ? "Баланс" : "Начальный баланс"}
            </div>
            <div className="flex items-center h-11 px-3.5 bg-[var(--fill-tertiary)] rounded-[10px]">
              <span className="text-[15px] text-[var(--label-secondary)]">€</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0"
                className="flex-1 ml-1 h-11 bg-transparent text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none tabular-nums"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 text-[14px] font-medium text-[var(--label-secondary)]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 h-11 rounded-[var(--radius-pill)] text-[14px] font-semibold bg-[var(--accent)] text-[var(--label-on-accent)] disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : editing ? "Сохранить" : "Создать"}
            </button>
          </div>

          {editing && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="w-full h-10 rounded-[var(--radius-pill)] text-[14px] font-semibold text-[var(--system-red)] active:bg-[var(--fill-quaternary)] transition"
            >
              {deleteArmed ? "Нажмите ещё раз — удалить" : "Удалить счёт"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
