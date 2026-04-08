"use client";

export default function DashboardError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const isSupabaseError =
    error.message?.includes("Supabase not configured") ||
    error.message?.includes("fetch failed") ||
    error.message?.includes("NEXT_PUBLIC_SUPABASE");

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="max-w-md text-center">
        {isSupabaseError ? (
          <>
            <h2 className="text-2xl font-semibold">Настройте Supabase</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Для работы CRM необходимо настроить подключение к Supabase.
              Укажите реальные значения в{" "}
              <code className="rounded bg-muted px-1">.env.local</code>:
            </p>
            <pre className="mt-4 rounded-lg bg-muted p-4 text-left text-xs">
              {`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key`}
            </pre>
            <p className="mt-4 text-sm text-muted-foreground">
              Затем примените миграцию{" "}
              <code className="rounded bg-muted px-1">
                supabase/migrations/00001_initial_schema.sql
              </code>{" "}
              в Supabase SQL Editor и перезапустите приложение.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">Что-то пошло не так</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {error.message}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
