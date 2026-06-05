import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelative, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  let q = supabase
    .from("conversations")
    .select("id, status, last_message_at, message_count, summary, subscribers(full_name, platform, profile_pic)")
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data: conversations } = await q;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Conversaciones</h1>
        <div className="flex gap-2">
          <FilterLink href="/conversations" current={!status} label="Todas" />
          <FilterLink href="/conversations?status=active" current={status === "active"} label="Activas" />
          <FilterLink
            href="/conversations?status=handed_off"
            current={status === "handed_off"}
            label="Con humano"
          />
          <FilterLink href="/conversations?status=closed" current={status === "closed"} label="Cerradas" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {(conversations ?? []).map((c) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sub = c.subscribers as any;
              return (
                <Link
                  key={c.id}
                  href={`/conversations/${c.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                    {(sub?.full_name?.[0] || "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{sub?.full_name || "Anónimo"}</div>
                      <span className="text-xs text-muted-foreground">{sub?.platform}</span>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {c.summary ? truncate(c.summary, 90) : `${c.message_count} mensajes`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={c.status} />
                    <span className="text-xs text-muted-foreground">{formatRelative(c.last_message_at)}</span>
                  </div>
                </Link>
              );
            })}
            {(!conversations || conversations.length === 0) && (
              <div className="p-8 text-center text-sm text-muted-foreground">No hay conversaciones aún.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterLink({ href, current, label }: { href: string; current: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-sm rounded-md ${current ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
    >
      {label}
    </Link>
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
