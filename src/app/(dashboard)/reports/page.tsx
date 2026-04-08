import {
  getRevenueByCity,
  getRevenueByCrew,
  getOrderFunnel,
  getClientLtv,
  getExpenseBreakdown,
} from "@/lib/queries/reports";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RevenueByCity,
  RevenueByCrew,
  OrderFunnel,
  ExpenseBreakdown,
  ClientLtvTable,
} from "@/components/reports/report-charts";

export default async function ReportsPage() {
  const [revenueByCity, revenueByCrew, funnel, clientLtv, expenseBreakdown] =
    await Promise.all([
      getRevenueByCity(),
      getRevenueByCrew(),
      getOrderFunnel(),
      getClientLtv(),
      getExpenseBreakdown(),
    ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Отчёты</h1>

      <Tabs defaultValue="revenue">
        <TabsList>
          <TabsTrigger value="revenue">Выручка</TabsTrigger>
          <TabsTrigger value="funnel">Воронка</TabsTrigger>
          <TabsTrigger value="clients">Клиенты LTV</TabsTrigger>
          <TabsTrigger value="expenses">Расходы</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4 space-y-6">
          <div>
            <h3 className="mb-3 text-lg font-medium">Выручка по городам</h3>
            {revenueByCity.length > 0 ? (
              <RevenueByCity data={revenueByCity} />
            ) : (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            )}
          </div>
          <div>
            <h3 className="mb-3 text-lg font-medium">Выручка по бригадам</h3>
            {revenueByCrew.length > 0 ? (
              <RevenueByCrew data={revenueByCrew} />
            ) : (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <h3 className="mb-3 text-lg font-medium">Воронка заказов</h3>
          {funnel.length > 0 ? (
            <OrderFunnel data={funnel} />
          ) : (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          )}
        </TabsContent>

        <TabsContent value="clients" className="mt-4">
          <h3 className="mb-3 text-lg font-medium">Топ клиентов по выручке</h3>
          {clientLtv.length > 0 ? (
            <ClientLtvTable data={clientLtv} />
          ) : (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          )}
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <h3 className="mb-3 text-lg font-medium">Структура расходов</h3>
          {expenseBreakdown.length > 0 ? (
            <ExpenseBreakdown data={expenseBreakdown} />
          ) : (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
