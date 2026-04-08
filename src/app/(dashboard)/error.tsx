"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // In production, Next.js strips error messages, so we check env vars on client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isNotConfigured =
    !supabaseUrl ||
    supabaseUrl === "https://xxx.supabase.co" ||
    !supabaseUrl.includes("supabase.co");

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="max-w-lg text-center">
        {isNotConfigured ? (
          <>
            <h2 className="text-2xl font-semibold">Настройте Supabase</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Для работы CRM необходимо подключить Supabase. Добавьте
              переменные окружения на Vercel (Settings → Environment
              Variables) или в{" "}
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
              в Supabase SQL Editor.
            </p>
            <button
              onClick={reset}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Попробовать снова
            </button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">Что-то пошло не так</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Произошла ошибка при загрузке данных. Проверьте что миграция
              применена и Supabase доступен.
            </p>
            {error.digest && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Digest: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Попробовать снова
            </button>
          </>
        )}
      </div>
    </div>
  );
}
