// Client-side PDF invoice generator. Runs inside the browser (jsPDF),
// produces a Blob, and downloads it or lets callers hand it off to
// navigator.share. No backend. Photos are optionally appended as a
// second page so the client can prove "before/after" to their building
// manager.
//
// Cyprus-specific:
//   - VAT 19 % by default, but the mode (inclusive / exclusive / off)
//     is driven by CompanyInfo so turning VAT off for personal cash
//     jobs just flips a setting.
//   - Labels are Russian because the dispatcher and the client both
//     read Russian; company address / VAT reg are free text so Greek
//     or English can be pasted verbatim.

import jsPDF from "jspdf";
import type { Appointment, PhotoKind } from "../appointments";
import type { Client } from "../clients";
import type { Service } from "../services";
import type { Team } from "../masters";
import type { CompanyInfo } from "./company";
import { splitVat } from "./vat";
import { appointmentTotal } from "./appointment-calc";

export interface InvoiceOptions {
  appointment: Appointment;
  client: Client | null;
  services: Service[];
  team: Team | null;
  company: CompanyInfo;
  /** If true, attach before/after photos on a second page. */
  includePhotos?: boolean;
  /** STORY-049 — photos for the export. Caller fetches them via
   *  listPhotosForAppointment and passes the AppointmentPhotoRecord[]
   *  shape (or any compatible {url, kind, caption}). When empty/
   *  undefined, the photos page is omitted regardless of includePhotos. */
  photos?: { url: string; kind: PhotoKind; caption: string }[];
}

export function generateInvoicePDF(opts: InvoiceOptions): { blob: Blob; filename: string } {
  const { appointment, client, services, team, company } = opts;

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const rightEdge = pageWidth - margin;
  let cursorY = margin;

  // ─── Header ──────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(company.name || "Invoice", margin, cursorY + 6);

  const invoiceNumber = formatInvoiceNumber(appointment);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Invoice #${invoiceNumber}`, rightEdge, cursorY + 4, { align: "right" });
  doc.text(
    formatDateRu(appointment.date),
    rightEdge,
    cursorY + 10,
    { align: "right" }
  );
  cursorY += 18;

  // Company block
  doc.setFontSize(9);
  const companyLines = [
    company.legal_form && `${company.legal_form}`,
    company.address,
    company.vat_number && `VAT: ${company.vat_number}`,
    company.phone,
    company.email,
    company.website,
  ].filter(Boolean) as string[];
  for (const line of companyLines) {
    doc.text(line, margin, cursorY);
    cursorY += 4;
  }
  cursorY += 4;

  // Separator
  doc.setDrawColor(220);
  doc.line(margin, cursorY, rightEdge, cursorY);
  cursorY += 6;

  // ─── Client block ─────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Bill to", margin, cursorY);
  cursorY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (client) {
    doc.text(client.full_name, margin, cursorY);
    cursorY += 4;
    if (client.phone) {
      doc.text(client.phone, margin, cursorY);
      cursorY += 4;
    }
  } else if (appointment.comment) {
    doc.text(appointment.comment, margin, cursorY);
    cursorY += 4;
  } else {
    doc.text("—", margin, cursorY);
    cursorY += 4;
  }
  if (appointment.address) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(appointment.address, margin, cursorY);
    doc.setTextColor(0);
    cursorY += 4;
  }
  cursorY += 4;

  // ─── Service lines table ──────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Service", margin, cursorY);
  doc.text("Qty", rightEdge - 55, cursorY, { align: "right" });
  doc.text("Unit", rightEdge - 30, cursorY, { align: "right" });
  doc.text("Total", rightEdge, cursorY, { align: "right" });
  doc.setTextColor(0);
  cursorY += 2;
  doc.line(margin, cursorY, rightEdge, cursorY);
  cursorY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const servicesById = new Map(services.map((s) => [s.id, s]));
  for (const line of appointment.services) {
    const catalog = servicesById.get(line.serviceId);
    const name = catalog?.name ?? line.serviceId;
    const lineTotal = Math.round(
      Math.max(
        0,
        line.quantity * line.pricePerUnit -
          (line.discount
            ? line.discount.type === "percent"
              ? (line.quantity * line.pricePerUnit * line.discount.value) / 100
              : line.discount.value
            : 0)
      )
    );
    doc.text(truncate(name, 38), margin, cursorY);
    doc.text(String(line.quantity), rightEdge - 55, cursorY, { align: "right" });
    doc.text(formatMoney(line.pricePerUnit), rightEdge - 30, cursorY, { align: "right" });
    doc.text(formatMoney(lineTotal), rightEdge, cursorY, { align: "right" });
    cursorY += 6;
  }

  // Global discount line
  const subtotal = appointment.services.reduce(
    (acc, l) =>
      acc +
      Math.max(
        0,
        l.quantity * l.pricePerUnit -
          (l.discount
            ? l.discount.type === "percent"
              ? (l.quantity * l.pricePerUnit * l.discount.value) / 100
              : l.discount.value
            : 0)
      ),
    0
  );
  const rawTotal = appointmentTotal(
    appointment.services,
    appointment.global_discount
  );
  const globalOff = Math.max(0, subtotal - rawTotal);

  cursorY += 2;
  doc.line(margin, cursorY, rightEdge, cursorY);
  cursorY += 5;

  // ─── Totals ──────────────────────────────────────────────────────────
  const gross = appointment.total_amount;
  const vat = splitVat(gross, company.vat_mode, company.vat_rate_percent);

  const rightCol = rightEdge;
  const labelCol = rightEdge - 55;
  doc.setFontSize(10);

  const drawRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, labelCol, cursorY, { align: "right" });
    doc.text(value, rightCol, cursorY, { align: "right" });
    cursorY += 6;
  };

  drawRow("Subtotal", formatMoney(subtotal));
  if (globalOff > 0) drawRow("Discount", `−${formatMoney(globalOff)}`);
  if (vat.mode !== "off") {
    drawRow(
      `VAT ${vat.rate}%${vat.mode === "inclusive" ? " (incl.)" : ""}`,
      formatMoney(vat.vat)
    );
    if (vat.mode === "inclusive") drawRow("Net", formatMoney(vat.net));
  }
  drawRow("Total", `€${formatMoney(vat.gross)}`, true);

  // ─── Footer ──────────────────────────────────────────────────────────
  cursorY += 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120);
  if (team) {
    doc.text(`Brigade: ${team.name}`, margin, cursorY);
    cursorY += 4;
  }
  if (appointment.status === "completed") {
    doc.text("Paid — thank you.", margin, cursorY);
  } else {
    doc.text("Pending payment.", margin, cursorY);
  }

  // ─── Photos page ──────────────────────────────────────────────────────
  // STORY-049 — photos no longer ride on the appointment row. The
  // receipt-export flow now needs to pass them in via opts.photos
  // (lifted from listPhotosForAppointment by the caller). Until that
  // call site is plumbed, the photos page is silently skipped.
  if (opts.includePhotos && (opts.photos?.length ?? 0) > 0) {
    doc.addPage();
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Photos", margin, margin + 6);

    let y = margin + 14;
    const cellW = (pageWidth - margin * 2 - 4) / 2;
    const cellH = 60;
    const photos = opts.photos ?? [];
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      if (row > 0 && col === 0) y += cellH + 8;
      if (y + cellH > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      const x = margin + col * (cellW + 4);
      try {
        // jsPDF accepts public URLs but the renderer may not fetch
        // cross-origin in some environments; the catch below preserves
        // export resilience.
        doc.addImage(ph.url, "JPEG", x, y, cellW, cellH, undefined, "FAST");
      } catch {
        // skip unreadable photos rather than crash the whole export
      }
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(kindLabel(ph.kind) + (ph.caption ? ` · ${ph.caption}` : ""), x, y + cellH + 4);
      doc.setTextColor(0);
    }
  }

  const blob = doc.output("blob");
  const filename = `invoice-${invoiceNumber}.pdf`;
  return { blob, filename };
}

function formatMoney(n: number): string {
  return Math.round(n).toString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function kindLabel(kind: string): string {
  if (kind === "before") return "До";
  if (kind === "after") return "После";
  return "Фото";
}

function formatInvoiceNumber(appointment: Appointment): string {
  // Short human id: AirFix doesn't have a legal counter yet, so we just
  // derive it from the appointment date + id suffix. Regenerates on
  // every export but remains stable for the same record.
  const dateCompact = appointment.date.replace(/-/g, "");
  const short = appointment.id.replace(/[^a-z0-9]/gi, "").slice(-5).toUpperCase();
  return `${dateCompact}-${short}`;
}

function formatDateRu(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
