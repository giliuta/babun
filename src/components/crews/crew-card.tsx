"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateCrewAction, deleteCrewAction } from "@/lib/actions/crews";
import { cities } from "@/lib/validations/client";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PhoneLink } from "@/components/shared/phone-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, Save, X, MapPin, User } from "lucide-react";
import type { Database } from "@/types/database";

type Crew = Database["public"]["Tables"]["crews"]["Row"];

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

interface CrewCardProps {
  crew: Crew;
  stats: { orders: number; revenue: number };
  members: { id: string; full_name: string; role: string }[];
}

export function CrewCard({ crew, stats, members }: CrewCardProps) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave(formData: FormData) {
    setLoading(true);
    await updateCrewAction(crew.id, formData);
    setLoading(false);
    setEditing(false);
  }

  async function handleDelete() {
    await deleteCrewAction(crew.id);
    toast.success("Бригада деактивирована");
  }

  if (editing) {
    return (
      <div className="rounded-lg border p-4">
        <form action={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Название</Label>
              <Input name="name" defaultValue={crew.name} />
            </div>
            <div className="space-y-1">
              <Label>Город</Label>
              <Select name="city" defaultValue={crew.city}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="space-y-1">
              <Label>Лид</Label>
              <Input name="lead_name" defaultValue={crew.lead_name ?? ""} />
            </div>
            <div className="space-y-1">
              <Label>Телефон</Label>
              <Input name="phone" defaultValue={crew.phone ?? ""} />
            </div>
            <div className="space-y-1">
              <Label>Цвет</Label>
              <Input
                name="color"
                type="color"
                defaultValue={crew.color ?? "#3B82F6"}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={loading}>
              <Save className="mr-1 h-3.5 w-3.5" />
              Сохранить
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setEditing(false)}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Отмена
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-full"
            style={{ backgroundColor: crew.color ?? "#3B82F6" }}
          />
          <div>
            <h3 className="font-medium">{crew.name}</h3>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {cityLabels[crew.city] ?? crew.city}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            }
            title="Деактивировать бригаду?"
            description={`Бригада "${crew.name}" будет деактивирована.`}
            confirmLabel="Деактивировать"
            onConfirm={handleDelete}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Заказов/мес</p>
          <p className="font-semibold">{stats.orders}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Выручка</p>
          <p className="font-semibold font-mono">€{stats.revenue.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Ср. чек</p>
          <p className="font-semibold font-mono">
            €{stats.orders > 0 ? (stats.revenue / stats.orders).toFixed(0) : 0}
          </p>
        </div>
      </div>

      {crew.lead_name && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{crew.lead_name}</span>
          {crew.phone && (
            <span className="ml-2">
              <PhoneLink phone={crew.phone} />
            </span>
          )}
        </div>
      )}

      {members.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {members.map((m) => (
            <Badge key={m.id} variant="outline" className="text-xs">
              {m.full_name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
