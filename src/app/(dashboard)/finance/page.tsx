import {
  getPayments,
  getExpenses,
  getSalaryRecords,
  getPnlData,
} from "@/lib/queries/finance";
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
import { AddExpenseDialog } from "@/components/finance/add-expense-dialog";
import { PnlChart } from "@/components/finance/pnl-chart";
import { categoryLabels } from "@/lib/validations/finance";

const methodLabels: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  revolut: "Revolut",
};

export default async function FinancePage() {
  const year = new Date().getFullYear();
  const [payments, expenses, salaries, pnlData] = await Promise.all([
    getPayments(),
    getExpenses(),
    getSalaryRecords(),
    getPnlData(year),
  ]);

  const totalIncome = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Финансы</h1>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Доходы</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-green-600">
            €{totalIncome.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Расходы</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-red-600">
            €{totalExpenses.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Прибыль</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-blue-600">
            €{(totalIncome - totalExpenses).toFixed(2)}
          </p>
        </div>
      </div>

      <Tabs defaultValue="payments">
        <TabsList>
          <TabsTrigger value="payments">
            Платежи ({payments.length})
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Расходы ({expenses.length})
          </TabsTrigger>
          <TabsTrigger value="salaries">
            Зарплаты ({salaries.length})
          </TabsTrigger>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="mt-4">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет платежей</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Метод</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Примечание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        {new Date(p.paid_at).toLocaleDateString("ru-RU")}
                      </TableCell>
                      <TableCell>
                        {methodLabels[p.method] ?? p.method}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(p.amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="expenses" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <AddExpenseDialog />
          </div>
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет расходов</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Описание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {categoryLabels[e.category] ?? e.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(e.amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.description ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="salaries" className="mt-4">
          {salaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет записей о зарплатах
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Сотрудник</TableHead>
                    <TableHead>Период</TableHead>
                    <TableHead className="text-right">Оклад</TableHead>
                    <TableHead className="text-right">Бонус</TableHead>
                    <TableHead className="text-right">Удержания</TableHead>
                    <TableHead className="text-right">Итого</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salaries.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.profile_name}
                      </TableCell>
                      <TableCell>
                        {s.period_start} — {s.period_end}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(s.base_amount).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(s.bonus_amount).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(s.deductions).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        €{Number(s.total).toFixed(0)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.status === "paid" ? "default" : "outline"}
                        >
                          {s.status === "paid" ? "Выплачено" : "Ожидание"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pnl" className="mt-4 space-y-4">
          <h3 className="text-lg font-medium">P&L {year}</h3>
          <PnlChart data={pnlData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
