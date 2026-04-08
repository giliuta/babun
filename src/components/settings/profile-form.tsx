"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateProfileAction } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Save } from "lucide-react";

interface ProfileFormProps {
  profile: {
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
  };
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const [loading, setLoading] = useState(false);

  const initials = profile.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    const result = await updateProfileAction(formData);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else toast.success("Профиль обновлён");
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{profile.full_name}</p>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
          <p className="text-xs capitalize text-muted-foreground">
            {profile.role}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Имя</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={profile.full_name}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Телефон</Label>
          <Input id="phone" name="phone" defaultValue={profile.phone ?? ""} />
        </div>
      </div>
      <Button type="submit" disabled={loading}>
        <Save className="mr-2 h-4 w-4" />
        {loading ? "Сохранение..." : "Сохранить"}
      </Button>
    </form>
  );
}
