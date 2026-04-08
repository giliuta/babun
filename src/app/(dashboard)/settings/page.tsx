import { createClient } from "@/lib/supabase/server";
import {
  getReEngagementClients,
  getUpcomingReminders,
  getNotificationTemplates,
  getNotificationLog,
} from "@/lib/queries/marketing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProfileForm } from "@/components/settings/profile-form";
import { TenantForm } from "@/components/settings/tenant-form";
import { TeamList } from "@/components/settings/team-list";
import { ReEngagement } from "@/components/settings/re-engagement";
import { NotificationTemplates } from "@/components/settings/notification-templates";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, Bell } from "lucide-react";

export default async function SettingsPage() {
  const supabase = await createClient();

  // Get current user profile + tenant
  let profile = null;
  let tenant = null;
  let teamMembers: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    is_active: boolean;
  }[] = [];

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, email, phone, role, tenant_id")
        .eq("id", user.id)
        .single();

      if (p) {
        profile = p;
        const { data: t } = await supabase
          .from("tenants")
          .select("name, plan")
          .eq("id", p.tenant_id)
          .single();
        tenant = t;

        const { data: members } = await supabase
          .from("profiles")
          .select("id, full_name, email, phone, role, is_active")
          .eq("tenant_id", p.tenant_id)
          .order("role");
        teamMembers = members ?? [];
      }
    }
  } catch {
    // ignore
  }

  const [inactiveClients, reminders, templates, logs] = await Promise.all([
    getReEngagementClients(3),
    getUpcomingReminders(),
    getNotificationTemplates(),
    getNotificationLog(50),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Профиль, компания, команда и маркетинг
        </p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Профиль</TabsTrigger>
          <TabsTrigger value="company">Компания</TabsTrigger>
          <TabsTrigger value="team">Команда ({teamMembers.length})</TabsTrigger>
          <TabsTrigger value="marketing">Маркетинг</TabsTrigger>
          <TabsTrigger value="templates">
            Шаблоны ({templates.length})
          </TabsTrigger>
          <TabsTrigger value="log">Лог</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          {profile ? (
            <ProfileForm profile={profile} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить профиль
            </p>
          )}
        </TabsContent>

        <TabsContent value="company" className="mt-6">
          {tenant && profile ? (
            <TenantForm tenant={tenant} isOwner={profile.role === "owner"} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить данные компании
            </p>
          )}
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          {teamMembers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Пока только вы"
              description="Добавьте сотрудников через Supabase Auth dashboard"
            />
          ) : (
            <TeamList members={teamMembers} />
          )}
        </TabsContent>

        <TabsContent value="marketing" className="mt-6 space-y-8">
          <div>
            <h3 className="mb-1 text-lg font-medium">
              Клиенты без сервиса 3+ месяца
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Выберите клиентов и отправьте уведомление
            </p>
            <ReEngagement
              clients={inactiveClients}
              templates={templates.map((t) => ({
                id: t.id,
                name: t.name,
                channel: t.channel,
              }))}
            />
          </div>

          <div>
            <h3 className="mb-1 text-lg font-medium">
              Предстоящие напоминания ({reminders.length})
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Клиенты с next_service_date в ближайшие 14 дней
            </p>
            {reminders.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="Нет предстоящих напоминаний"
                description="Установите дату следующего сервиса в карточке клиента"
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Город</TableHead>
                      <TableHead>Дата сервиса</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reminders.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.full_name}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {r.phone}
                        </TableCell>
                        <TableCell>{r.city ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.next_service_date}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <NotificationTemplates templates={templates} />
        </TabsContent>

        <TabsContent value="log" className="mt-6">
          <h3 className="mb-3 text-lg font-medium">Последние уведомления</h3>
          {logs.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Нет отправленных уведомлений"
              description="Уведомления появятся здесь после отправки"
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Канал</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Содержание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">
                        {new Date(l.created_at).toLocaleDateString("ru-RU")}
                      </TableCell>
                      <TableCell>{l.client_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{l.channel}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            l.status === "sent"
                              ? "default"
                              : l.status === "failed"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {l.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {l.content}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
