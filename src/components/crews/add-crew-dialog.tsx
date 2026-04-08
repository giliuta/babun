"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createCrewAction } from "@/lib/actions/crews";
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
import { Plus } from "lucide-react";

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

export function AddCrewDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await createCrewAction(formData);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setOpen(false);
      toast.success("Бригада создана");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Добавить бригаду
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая бригада</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label>Название *</Label>
            <Input name="name" required />
          </div>
          <div className="space-y-2">
            <Label>Город *</Label>
            <Select name="city" required>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Лид</Label>
              <Input name="lead_name" />
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input name="phone" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Цвет</Label>
            <Input name="color" type="color" defaultValue="#3B82F6" />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
