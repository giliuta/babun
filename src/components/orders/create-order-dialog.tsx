"use client";

import { useState } from "react";
import { createOrderAction } from "@/lib/actions/orders";
import { cities } from "@/lib/validations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Minus } from "lucide-react";

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

interface CreateOrderDialogProps {
  clients: {
    id: string;
    full_name: string;
    phone: string;
    city: string | null;
    address: string | null;
  }[];
  crews: { id: string; name: string; city: string }[];
  services: {
    id: string;
    name: string;
    price: number;
    price_bulk: number | null;
    bulk_threshold: number | null;
  }[];
}

export function CreateOrderDialog({
  clients,
  crews,
  services,
}: CreateOrderDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");

  // Step 2
  const [items, setItems] = useState<
    { service_id: string; quantity: number }[]
  >([]);

  // Step 3
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [crewId, setCrewId] = useState("");
  const [notes, setNotes] = useState("");

  const filteredClients = clientSearch
    ? clients.filter(
        (c) =>
          c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          c.phone.includes(clientSearch),
      )
    : clients.slice(0, 10);

  function calculateTotal() {
    const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
    return items.reduce((sum, item) => {
      const svc = services.find((s) => s.id === item.service_id);
      if (!svc) return sum;
      const useBulk = totalUnits >= (svc.bulk_threshold ?? 3) && svc.price_bulk;
      const price = useBulk ? Number(svc.price_bulk) : Number(svc.price);
      return sum + price * item.quantity;
    }, 0);
  }

  function addItem(serviceId: string) {
    const existing = items.find((i) => i.service_id === serviceId);
    if (existing) {
      setItems(
        items.map((i) =>
          i.service_id === serviceId ? { ...i, quantity: i.quantity + 1 } : i,
        ),
      );
    } else {
      setItems([...items, { service_id: serviceId, quantity: 1 }]);
    }
  }

  function removeItem(serviceId: string) {
    const existing = items.find((i) => i.service_id === serviceId);
    if (existing && existing.quantity > 1) {
      setItems(
        items.map((i) =>
          i.service_id === serviceId ? { ...i, quantity: i.quantity - 1 } : i,
        ),
      );
    } else {
      setItems(items.filter((i) => i.service_id !== serviceId));
    }
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);

    const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
    const orderItems = items.map((item) => {
      const svc = services.find((s) => s.id === item.service_id)!;
      const useBulk = totalUnits >= (svc.bulk_threshold ?? 3) && svc.price_bulk;
      const price = useBulk ? Number(svc.price_bulk) : Number(svc.price);
      return {
        service_id: item.service_id,
        description: svc.name,
        quantity: item.quantity,
        unit_price: price,
        total: price * item.quantity,
      };
    });

    const result = await createOrderAction({
      client_id: clientId,
      city: city as "limassol" | "paphos" | "larnaca" | "nicosia",
      address: address || undefined,
      scheduled_date: scheduledDate || undefined,
      crew_id: crewId || undefined,
      client_notes: notes || undefined,
      items: orderItems,
    });

    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setOpen(false);
      resetForm();
    }
  }

  function resetForm() {
    setStep(1);
    setClientId("");
    setClientSearch("");
    setItems([]);
    setCity("");
    setAddress("");
    setScheduledDate("");
    setCrewId("");
    setNotes("");
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Новый заказ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый заказ — Шаг {step}/3</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Поиск клиента</Label>
              <Input
                placeholder="Имя или телефон..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClientId(c.id);
                    if (c.city) setCity(c.city);
                    if (c.address) setAddress(c.address);
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                    clientId === c.id ? "bg-accent" : ""
                  }`}
                >
                  <span className="font-medium">{c.full_name}</span>
                  <span className="ml-2 font-mono text-muted-foreground">
                    {c.phone}
                  </span>
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={!clientId}
              onClick={() => setStep(2)}
            >
              Далее
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              {services.map((svc) => {
                const item = items.find((i) => i.service_id === svc.id);
                return (
                  <div
                    key={svc.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{svc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        €{Number(svc.price).toFixed(0)}
                        {svc.price_bulk &&
                          ` / €${Number(svc.price_bulk).toFixed(0)} от ${svc.bulk_threshold ?? 3} шт`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeItem(svc.id)}
                        disabled={!item}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm font-medium">
                        {item?.quantity ?? 0}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => addItem(svc.id)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Итого:</span>
              <span className="text-lg font-semibold font-mono">
                €{calculateTotal().toFixed(2)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Назад
              </Button>
              <Button
                className="flex-1"
                disabled={items.length === 0}
                onClick={() => setStep(3)}
              >
                Далее
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Город</Label>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите" />
                  </SelectTrigger>
                  <SelectContent>
                    {cities.map((c) => (
                      <SelectItem key={c} value={c}>
                        {cityLabels[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Бригада</Label>
                <Select value={crewId} onValueChange={setCrewId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите" />
                  </SelectTrigger>
                  <SelectContent>
                    {crews.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Адрес</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Дата</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Заметки</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Назад
              </Button>
              <Button
                className="flex-1"
                disabled={!city || loading}
                onClick={handleSubmit}
              >
                {loading
                  ? "Создание..."
                  : `Создать заказ · €${calculateTotal().toFixed(0)}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
