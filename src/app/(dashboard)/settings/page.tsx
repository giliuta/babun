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
import { ReEngagement } from "@/components/settings/re-engagement";
import { NotificationTemplates } from "@/components/settings/notification-templates";

export default async function SettingsPage() {
  const [inactiveClients, reminders, templates, logs] = await Promise.all([
    getReEngagementClients(3),
    getUpcomingReminders(),
    getNotificationTemplates(),
    getNotificationLog(50),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Настройки и маркетинг
      </h1>

      <Tabs defaultValue="re-engagement">
        <TabsList>
          <TabsTrigger value="re-engagement">
            Ре-энгейджмент ({inactiveClients.length})
          </TabsTrigger>
          <TabsTrigger value="reminders">
            Напоминания ({reminders.length})
          </TabsTrigger>
          <TabsTrigger value="templates">
            Шаблоны ({templates.length})
          </TabsTrigger>
          <TabsTrigger value="log">Лог уведомлений</TabsTrigger>
        </TabsList>

        <TabsContent value="re-engagement" className="mt-4">
          <div className="mb-3">
            <h3 className="text-lg font-medium">
              Клиенты без сервиса 3+ месяца
            </h3>
            <p className="text-sm text-muted-foreground">
              Выберите клиентов и отправьте уведомление через шаблон
            </p>
          </div>
          <ReEngagement
            clients={inactiveClients}
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              channel: t.channel,
            }))}
          />
        </TabsContent>

        <TabsContent value="reminders" className="mt-4">
          <div className="mb-3">
            <h3 className="text-lg font-medium">
              Предстоящие сервисные напоминания
            </h3>
            <p className="text-sm text-muted-foreground">
              Клиенты с запланированной датой следующего сервиса в ближайшие 14
              дней
            </p>
          </div>
          {reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет предстоящих напоминаний
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Город</TableHead>
                    <TableHead>Дата сервиса</TableHead>
                    <TableHead>Язык</TableHead>
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
                      <TableCell>{r.language?.toUpperCase() ?? "RU"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <div className="mb-3">
            <h3 className="text-lg font-medium">Шаблоны уведомлений</h3>
            <p className="text-sm text-muted-foreground">
              Шаблоны для авто-уведомлений и маркетинговых рассылок
            </p>
          </div>
          <NotificationTemplates templates={templates} />
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <div className="mb-3">
            <h3 className="text-lg font-medium">Лог уведомлений</h3>
            <p className="text-sm text-muted-foreground">
              Последние 50 отправленных уведомлений
            </p>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет отправленных уведомлений
            </p>
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
