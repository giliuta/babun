// Client-side PDF generator for the ledger invoice / receipt (the new
// Supabase-backed `invoices` table). Runs in the browser (jsPDF), returns
// a Blob, and lets callers download it or hand it to navigator.share.
//
// Structural labels are English (jsPDF's standard Helvetica is Latin-1
// only — Cyrillic free-text like a company or client name still prints,
// but built-in labels must stay Latin to render cleanly). This mirrors
// the legacy generateInvoicePDF in ./invoice.
//
// "Receipt" mode (no due date, status paid) and "Invoice" mode share the
// same layout — the title flips on `kind`.

import jsPDF from "jspdf";
import type { CompanyInfo } from "./company";

export interface LedgerInvoicePdfLine {
  title: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface LedgerInvoicePdfInput {
  kind: "invoice" | "receipt";
  number: string;
  issued_on: string; // YYYY-MM-DD
  due_on?: string | null;
  currency: string; // "EUR"
  subtotal_net: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  notes?: string | null;
  lines: LedgerInvoicePdfLine[];
  company: CompanyInfo;
  clientName?: string | null;
}

export function generateLedgerInvoicePDF(input: LedgerInvoicePdfInput): {
  blob: Blob;
  filename: string;
} {
  const {
    kind,
    number,
    issued_on,
    due_on,
    currency,
    subtotal_net,
    vat_percent,
    vat_amount,
    total,
    notes,
    lines,
    company,
    clientName,
  } = input;

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const rightEdge = pageWidth - margin;
  let y = margin;

  const money = (n: number) => `${currency} ${n.toFixed(2)}`;

  // ─── Header ───────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(company.name || "Company", margin, y + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(kind === "receipt" ? "RECEIPT" : "INVOICE", rightEdge, y + 4, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`# ${number}`, rightEdge, y + 10, { align: "right" });
  y += 18;

  // Company block
  doc.setFontSize(9);
  doc.setTextColor(90);
  const companyLines = [
    company.legal_form || null,
    company.address || null,
    company.vat_number ? `VAT: ${company.vat_number}` : null,
    [company.phone, company.email].filter(Boolean).join("  ·  ") || null,
    company.website || null,
  ].filter(Boolean) as string[];
  for (const line of companyLines) {
    doc.text(line, margin, y);
    y += 4.5;
  }
  doc.setTextColor(0);
  y += 4;

  // ─── Bill-to + dates ──────────────────────────────────────────────────
  const blockTop = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Bill to", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(clientName?.trim() || "—", margin, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Issued: ${formatDate(issued_on)}`, rightEdge, blockTop, {
    align: "right",
  });
  if (due_on) {
    doc.text(`Due: ${formatDate(due_on)}`, rightEdge, blockTop + 5, {
      align: "right",
    });
  }
  y += 14;

  // ─── Line items table ─────────────────────────────────────────────────
  doc.setDrawColor(210);
  doc.line(margin, y, rightEdge, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Description", margin, y);
  doc.text("Qty", rightEdge - 60, y, { align: "right" });
  doc.text("Unit", rightEdge - 32, y, { align: "right" });
  doc.text("Total", rightEdge, y, { align: "right" });
  y += 3;
  doc.line(margin, y, rightEdge, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of lines) {
    doc.text(truncate(line.title, 42), margin, y);
    doc.text(trimNum(line.qty), rightEdge - 60, y, { align: "right" });
    doc.text(money(line.unit_price), rightEdge - 32, y, { align: "right" });
    doc.text(money(line.total), rightEdge, y, { align: "right" });
    y += 6;
  }

  y += 2;
  doc.line(margin, y, rightEdge, y);
  y += 6;

  // ─── Totals ───────────────────────────────────────────────────────────
  const labelCol = rightEdge - 40;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 12 : 10);
    doc.text(label, labelCol, y, { align: "right" });
    doc.text(value, rightEdge, y, { align: "right" });
    y += bold ? 8 : 6;
  };
  totalRow("Subtotal", money(subtotal_net));
  if (vat_amount > 0) totalRow(`VAT ${trimNum(vat_percent)}%`, money(vat_amount));
  totalRow("Total", money(total), true);

  // ─── Notes / footer ───────────────────────────────────────────────────
  if (notes && notes.trim()) {
    y += 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(90);
    const wrapped = doc.splitTextToSize(notes.trim(), rightEdge - margin);
    doc.text(wrapped, margin, y);
    doc.setTextColor(0);
  }

  if (kind === "receipt") {
    const footY = doc.internal.pageSize.getHeight() - margin;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Paid — thank you.", margin, footY);
    doc.setTextColor(0);
  }

  const blob = doc.output("blob");
  const filename = `${kind === "receipt" ? "receipt" : "invoice"}-${number}.pdf`;
  return { blob, filename };
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
