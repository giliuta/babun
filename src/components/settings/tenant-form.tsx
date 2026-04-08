"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateTenantAction } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";

interface TenantFormProps {
  tenant: { name: string; plan: string | null };
  isOwner: boolean;
}

export function TenantForm({ tenant, isOwner }: TenantFormProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    const result = await updateTenantAction(formData);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else toast.success("Настройки компании обновлены");
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Название компании</Label>
          <Input
            id="name"
            name="name"
            defaultValue={tenant.name}
            disabled={!isOwner}
          />
        </div>
        <div className="space-y-2">
          <Label>Тариф</Label>
          <Input
            value={tenant.plan ?? "free"}
            disabled
            className="capitalize"
          />
        </div>
      </div>
      {isOwner && (
        <Button type="submit" disabled={loading}>
          <Save className="mr-2 h-4 w-4" />
          {loading ? "Сохранение..." : "Сохранить"}
        </Button>
      )}
    </form>
  );
}
