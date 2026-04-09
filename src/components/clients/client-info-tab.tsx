"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateClientAction } from "@/lib/actions/clients";
import { cities, clientSources, languages } from "@/lib/validations/client";
import { PhoneLink } from "@/components/shared/phone-link";
import { WhatsAppLink } from "@/components/shared/whatsapp-link";
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
import { Pencil, Save, X } from "lucide-react";
import type { Database } from "@/types/database";

type Client = Database["public"]["Tables"]["clients"]["Row"];

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

const sourceLabels: Record<string, string> = {
  manual: "Вручную",
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  referral: "Рекомендация",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  website: "Сайт",
  bazaraki: "Bazaraki",
  repeat: "Повторный",
};

export function ClientInfoTab({ client }: { client: Client }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await updateClientAction(client.id, formData);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setEditing(false);
      toast.success("Клиент обновлён");
    }
  }

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Контактные данные</h3>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Редактировать
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Имя" value={client.full_name} />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Телефон</p>
            <div className="mt-1 flex items-center gap-3">
              <PhoneLink phone={client.phone} />
              <WhatsAppLink phone={client.phone} />
            </div>
          </div>
          <Field label="Доп. телефон" value={client.phone_secondary} mono />
          <Field label="Email" value={client.email} />
          <Field
            label="Город"
            value={client.city ? cityLabels[client.city] : null}
            badge
          />
          <Field
            label="Источник"
            value={client.source ? sourceLabels[client.source] : null}
            badge
          />
          <Field label="Адрес" value={client.address} />
          <Field label="Детали адреса" value={client.address_details} />
          <Field label="Язык" value={client.language?.toUpperCase()} />
          <Field label="VIP" value={client.is_vip ? "Да" : "Нет"} />
        </div>
        {client.notes && (
          <div>
            <p className="text-sm font-medium text-muted-foreground">Заметки</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Редактирование</h3>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(false)}
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={loading}>
            <Save className="mr-2 h-3.5 w-3.5" />
            {loading ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Имя</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={client.full_name}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Телефон</Label>
          <Input id="phone" name="phone" defaultValue={client.phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone_secondary">Доп. телефон</Label>
          <Input
            id="phone_secondary"
            name="phone_secondary"
            defaultValue={client.phone_secondary ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" defaultValue={client.email ?? ""} />
        </div>
        <div className="space-y-2">
          <Label>Город</Label>
          <Select name="city" defaultValue={client.city ?? undefined}>
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
          <Label>Источник</Label>
          <Select name="source" defaultValue={client.source ?? undefined}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите" />
            </SelectTrigger>
            <SelectContent>
              {clientSources.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Адрес</Label>
          <Input
            id="address"
            name="address"
            defaultValue={client.address ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address_details">Детали адреса</Label>
          <Input
            id="address_details"
            name="address_details"
            defaultValue={client.address_details ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label>Язык</Label>
          <Select name="language" defaultValue={client.language ?? "ru"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((l) => (
                <SelectItem key={l} value={l}>
                  {l.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Заметки</Label>
        <textarea
          id="notes"
          name="notes"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          defaultValue={client.notes ?? ""}
        />
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  mono,
  badge: isBadge,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  badge?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {value ? (
        isBadge ? (
          <Badge variant="outline" className="mt-1">
            {value}
          </Badge>
        ) : (
          <p className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
        )
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}
