import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [{ count: convCount }, { count: msgCount }, { count: handoffCount }, { count: pendingLearnings }] =
    await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("messages").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabase
        .from("handoffs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("resolved", false),
      supabase.from("learnings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

  const { data: recent } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, message_count, subscribers(full_name, platform)")
    .order("last_message_at", { ascending: false })
    .limit(10);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Últimos 7 días</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Conversaciones" value={convCount ?? 0} />
        <StatCard label="Mensajes" value={msgCount ?? 0} />
        <StatCard label="Handoffs sin resolver" value={handoffCount ?? 0} highlight={(handoffCount ?? 0) > 0} />
        <StatCard label="Learnings pendientes" value={pendingLearnings ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversaciones recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {(recent ?? []).map((c) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sub = c.subscribers as any;
              return (
                <Link
                  key={c.id}
                  href={`/conversations/${c.id}`}
                  className="flex items-center justify-between py-3 hover:bg-accent/50 px-2 -mx-2 rounded"
                >
                  <div>
                    <div className="font-medium">{sub?.full_name || "Anónimo"}</div>
                    <div className="text-xs text-muted-foreground">
                      {sub?.platform} • {c.message_count} mensajes
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </Link>
              );
            })}
            {(!recent || recent.length === 0) && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Aún no hay conversaciones. Envía un DM a la cuenta conectada para probar.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold ${highlight ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "warning" | "success" | "outline"; label: string }> = {
    active: { variant: "success", label: "Activa" },
    handed_off: { variant: "warning", label: "Con humano" },
    closed: { variant: "secondary", label: "Cerrada" },
  };
  const conf = map[status] || { variant: "outline" as const, label: status };
  return <Badge variant={conf.variant}>{conf.label}</Badge>;
}
