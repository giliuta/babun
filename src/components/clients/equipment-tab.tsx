"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  createEquipmentAction,
  updateEquipmentAction,
  deleteEquipmentAction,
} from "@/lib/actions/clients";
import { equipmentTypes } from "@/lib/validations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";
import type { Database } from "@/types/database";

type Equipment = Database["public"]["Tables"]["client_equipment"]["Row"];

interface EquipmentTabProps {
  clientId: string;
  equipment: Equipment[];
}

export function EquipmentTab({ clientId, equipment }: EquipmentTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAdd(formData: FormData) {
    formData.set("client_id", clientId);
    setError(null);
    setLoading(true);
    const result = await createEquipmentAction(formData);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setAddOpen(false);
      toast.success("Оборудование добавлено");
    }
  }

  async function handleEdit(id: string, formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await updateEquipmentAction(id, clientId, formData);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setEditingId(null);
      toast.success("Оборудование обновлено");
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteEquipmentAction(id, clientId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Оборудование удалено");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Оборудование</h3>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Добавить
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Новое оборудование</DialogTitle>
            </DialogHeader>
            <EquipmentForm
              onSubmit={handleAdd}
              loading={loading}
              error={error}
              onCancel={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {equipment.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Нет добавленного оборудования
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Бренд</TableHead>
                <TableHead>Модель</TableHead>
                <TableHead>Расположение</TableHead>
                <TableHead>Последняя чистка</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipment.map((eq) =>
                editingId === eq.id ? (
                  <TableRow key={eq.id}>
                    <TableCell colSpan={6} className="p-4">
                      <EquipmentForm
                        defaultValues={eq}
                        onSubmit={(fd) => handleEdit(eq.id, fd)}
                        loading={loading}
                        error={error}
                        onCancel={() => setEditingId(null)}
                        inline
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={eq.id}>
                    <TableCell>
                      <Badge
                        variant={eq.type === "indoor" ? "default" : "secondary"}
                      >
                        {eq.type === "indoor" ? "Внутренний" : "Наружный"}
                      </Badge>
                    </TableCell>
                    <TableCell>{eq.brand || "—"}</TableCell>
                    <TableCell>{eq.model || "—"}</TableCell>
                    <TableCell>{eq.location_in_house || "—"}</TableCell>
                    <TableCell>{eq.last_cleaned || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingId(eq.id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(eq.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EquipmentForm({
  defaultValues,
  onSubmit,
  loading,
  error,
  onCancel,
  inline,
}: {
  defaultValues?: Partial<Equipment>;
  onSubmit: (fd: FormData) => void;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  inline?: boolean;
}) {
  return (
    <form action={onSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className={inline ? "grid grid-cols-5 gap-3" : "grid gap-4"}>
        <div className="space-y-2">
          <Label>Тип</Label>
          <Select name="type" defaultValue={defaultValues?.type ?? "indoor"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {equipmentTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "indoor" ? "Внутренний" : "Наружный"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand">Бренд</Label>
          <Input
            id="brand"
            name="brand"
            defaultValue={defaultValues?.brand ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Модель</Label>
          <Input
            id="model"
            name="model"
            defaultValue={defaultValues?.model ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location_in_house">Расположение</Label>
          <Input
            id="location_in_house"
            name="location_in_house"
            placeholder="Спальня, гостиная..."
            defaultValue={defaultValues?.location_in_house ?? ""}
          />
        </div>
        {inline && (
          <div className="flex items-end gap-1">
            <Button type="submit" size="sm" disabled={loading}>
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {!inline && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      )}
    </form>
  );
}
