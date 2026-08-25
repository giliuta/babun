"use client";

// Centered popup for +Перевод. From-account → to-account + amount +
// optional note. Backed by createTransfer which writes a pair of
// transfer-type rows sharing the same transfer_group_id.

import { useEffect, useMemo, useState } from "react";
import DialogModal from "@/components/appointment/DialogModal";
import { formatEUR } from "@babun/shared/common/utils/money";
import type { Account } from "@babun/shared/local/finance/account";
import type { TransferDraft } from "@babun/shared/db/repositories/finance-transactions";
import type { Team } from "@babun/shared/local/masters";

interface TransferSheetProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  teams: Team[];
  onSubmit: (draft: TransferDraft) => Promise<void>;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TransferSheet({
  open,
  onClose,
  accounts,
  teams,
  onSubmit,
}: TransferSheetProps) {
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFromId(accounts[0]?.id ?? "");
      setToId(accounts[1]?.id ?? "");
      setAmount("");
      setDate(todayYmd());
      setNotes("");
      setSubmitting(false);
    }
  }, [open, accounts]);

  const numericAmount = useMemo(() => {
    const parsed = parseFloat(amount.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [amount]);

  const canSave =
    numericAmount > 0 && fromId !== "" && toId !== "" && fromId !== toId;

  const teamColor = (a: Account) =>
    teams.find((t) => t.id === a.brigade_id)?.color ?? "var(--label-quaternary)";

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const handleSave = async () => {
    if (!canSave || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        from_account_id: fromId,
        to_account_id: toId,
        amount: numericAmount,
        occurred_on: date,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      console.error("createTransfer failed", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      title="Новый перевод"
      footer={
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || submitting}
          className="w-full h-12 rounded-[var(--radius-pill)] font-semibold text-[14px] active:scale-[0.98] transition disabled:opacity-50 bg-[var(--accent)] text-[var(--label-on-accent)]"
        >
          {submitting ? "Сохраняю…" : `Перевести ${formatEUR(numericAmount || 0)}`}
        </button>
      }
    >
      <div className="px-3 py-3 space-y-3">
        <Field label="Откуда" required>
          <ChipRow>
            {accounts.map((a) => (
              <AccountChip
                key={a.id}
                account={a}
                dotColor={teamColor(a)}
                active={fromId === a.id}
                onClick={() => setFromId(a.id)}
              />
            ))}
          </ChipRow>
        </Field>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={swap}
            aria-label="Поменять местами"
            className="w-8 h-8 rounded-full bg-[var(--fill-tertiary)] text-[var(--accent)] inline-flex items-center justify-center text-[16px] active:scale-90 transition"
          >
            ⇅
          </button>
        </div>

        <Field label="Куда" required>
          <ChipRow>
            {accounts.map((a) => (
              <AccountChip
                key={a.id}
                account={a}
                dotColor={teamColor(a)}
                active={toId === a.id}
                disabled={a.id === fromId}
                onClick={() => setToId(a.id)}
              />
            ))}
          </ChipRow>
        </Field>

        <Field label="Сумма" required>
          <div className="flex items-center bg-[var(--fill-tertiary)] rounded-[10px] px-3 h-11">
            <span className="text-[15px] text-[var(--label-secondary)]">€</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="flex-1 ml-1 h-11 bg-transparent text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none tabular-nums"
            />
          </div>
        </Field>

        <Field label="Дата">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Примечание">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Например, инкассация"
            className={inputCls}
          />
        </Field>

        {fromId !== "" && toId === fromId && (
          <div className="text-[12px] text-[var(--system-red)]">
            Счёт-источник и счёт-получатель должны быть разными.
          </div>
        )}
      </div>
    </DialogModal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[var(--label-secondary)] mb-1 tracking-wide">
        {label}
        {required && <span className="text-[var(--system-red)] ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">{children}</div>
  );
}

function AccountChip({
  account,
  dotColor,
  active,
  disabled,
  onClick,
}: {
  account: Account;
  dotColor: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-medium border transition-colors disabled:opacity-35 ${
        active
          ? "bg-[var(--accent)] text-[var(--label-on-accent)] border-transparent"
          : "bg-[var(--surface-card)] text-[var(--label)] border-[var(--separator)]"
      }`}
    >
      <span
        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <span>{account.icon ?? "💵"}</span>
      <span className="whitespace-nowrap">{account.name}</span>
    </button>
  );
}

const inputCls =
  "w-full h-11 px-3.5 bg-[var(--fill-tertiary)] border border-transparent rounded-[10px] text-[15px] text-[var(--label)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:bg-[var(--surface-card)] focus:border-[var(--accent)] transition";
