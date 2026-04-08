"use client";

import { useState } from "react";
import { toast } from "sonner";
import { recordPaymentAction } from "@/lib/actions/orders";
import { paymentMethods } from "@/lib/validations/order";
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
import { CreditCard } from "lucide-react";

const methodLabels: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  revolut: "Revolut",
};

interface PaymentDialogProps {
  orderId: string;
  clientId: string;
  remaining: number;
}

export function PaymentDialog({
  orderId,
  clientId,
  remaining,
}: PaymentDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await recordPaymentAction({
      order_id: orderId,
      client_id: clientId,
      amount: parseFloat(formData.get("amount") as string),
      method: formData.get("method") as string,
      notes: (formData.get("notes") as string) || undefined,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setOpen(false);
      toast.success("Оплата записана");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CreditCard className="mr-2 h-4 w-4" />
          Записать оплату
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Записать оплату</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="amount">Сумма (€)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              defaultValue={remaining.toFixed(2)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Метод</Label>
            <Select name="method" defaultValue="cash">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {methodLabels[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Примечание</Label>
            <Input id="notes" name="notes" />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Записать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
