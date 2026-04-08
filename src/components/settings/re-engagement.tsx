"use client";

import { useState } from "react";
import { sendReEngagementAction } from "@/lib/actions/marketing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Send } from "lucide-react";

type InactiveClient = {
  id: string;
  full_name: string;
  phone: string;
  city: string | null;
  last_service_date: string | null;
  total_orders: number;
  total_revenue: number;
  language: string | null;
};

interface ReEngagementProps {
  clients: InactiveClient[];
  templates: { id: string; name: string; channel: string }[];
}

export function ReEngagement({ clients, templates }: ReEngagementProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function toggleAll() {
    if (selected.size === clients.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(clients.map((c) => c.id)));
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleSend() {
    if (selected.size === 0 || !templateId) return;
    setLoading(true);
    setResult(null);
    const res = await sendReEngagementAction(Array.from(selected), templateId);
    setLoading(false);
    if (res.error) {
      setResult(`Ошибка: ${res.error}`);
    } else {
      setResult(
        `Отправлено: ${(res.data as { sent: number })?.sent ?? 0} уведомлений`,
      );
      setSelected(new Set());
    }
  }

  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Все клиенты активны!</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.channel})
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={selected.size === 0 || !templateId || loading}
          onClick={handleSend}
        >
          <Send className="mr-2 h-4 w-4" />
          {loading ? "Отправка..." : `Отправить (${selected.size})`}
        </Button>
      </div>
      {result && (
        <div className="rounded-md bg-muted p-3 text-sm">{result}</div>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selected.size === clients.length}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Город</TableHead>
              <TableHead>Последний сервис</TableHead>
              <TableHead>Заказы</TableHead>
              <TableHead className="text-right">Выручка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </TableCell>
                <TableCell className="font-medium">{c.full_name}</TableCell>
                <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                <TableCell>{c.city ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-orange-600">
                    {c.last_service_date ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell>{c.total_orders}</TableCell>
                <TableCell className="text-right font-mono">
                  €{Number(c.total_revenue).toFixed(0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
