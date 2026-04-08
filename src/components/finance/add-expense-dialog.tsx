"use client";

import { useState } from "react";
import { createExpenseAction } from "@/lib/actions/finance";
import { expenseCategories, categoryLabels } from "@/lib/validations/finance";
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

export function AddExpenseDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await createExpenseAction(formData);
    setLoading(false);
    if (result.error) setError(result.error);
    else setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Добавить расход
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый расход</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label>Категория *</Label>
            <Select name="category" required>
              <SelectTrigger>
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {expenseCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {categoryLabels[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Сумма (€) *</Label>
              <Input name="amount" type="number" step="0.01" required />
            </div>
            <div className="space-y-2">
              <Label>Дата *</Label>
              <Input
                name="date"
                type="date"
                defaultValue={new Date().toISOString().split("T")[0]}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Описание</Label>
            <Input name="description" />
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
              {loading ? "Сохранение..." : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
