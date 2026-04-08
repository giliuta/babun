import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PhoneLink } from "@/components/shared/phone-link";

interface TeamMember {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
}

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  worker: "Работник",
};

const roleColors: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  manager: "bg-blue-100 text-blue-800",
  worker: "bg-gray-100 text-gray-800",
};

export function TeamList({ members }: { members: TeamMember[] }) {
  return (
    <div className="space-y-3">
      {members.map((m) => {
        const initials = m.full_name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);

        return (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-lg border p-3"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.full_name}</span>
                <Badge variant="outline" className={roleColors[m.role]}>
                  {roleLabels[m.role] ?? m.role}
                </Badge>
                {!m.is_active && <Badge variant="secondary">Неактивен</Badge>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {m.email && <span>{m.email}</span>}
                {m.phone && <PhoneLink phone={m.phone} className="text-xs" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
