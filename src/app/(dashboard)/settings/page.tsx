import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const checks = [
    { label: "ANTHROPIC_API_KEY", set: !!process.env.ANTHROPIC_API_KEY },
    { label: "OPENAI_API_KEY", set: !!process.env.OPENAI_API_KEY },
    { label: "MANYCHAT_WEBHOOK_SECRET", set: !!process.env.MANYCHAT_WEBHOOK_SECRET },
    { label: "CRON_SECRET", set: !!process.env.CRON_SECRET },
    { label: "TELEGRAM_BOT_TOKEN", set: !!process.env.TELEGRAM_BOT_TOKEN },
    { label: "NEXT_PUBLIC_APP_URL", set: !!process.env.NEXT_PUBLIC_APP_URL },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Cuenta</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">{user?.email}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variables de entorno</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {checks.map((c) => (
              <div key={c.label} className="flex justify-between items-center py-2 text-sm">
                <code className="font-mono text-xs">{c.label}</code>
                {c.set ? (
                  <span className="text-emerald-600">✓ configurado</span>
                ) : (
                  <span className="text-destructive">✗ falta</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Para editar, ve a Vercel → Project → Settings → Environment Variables (o tu .env.local en dev).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
