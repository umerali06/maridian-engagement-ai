import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";
import { LearningActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function LearningsPage() {
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("learnings")
    .select("id, category, insight, severity, suggested_fix, status, created_at, brands(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: applied } = await supabase
    .from("learnings")
    .select("id, insight, applied_at, brands(name)")
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(20);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Learnings</h1>
        <p className="text-sm text-muted-foreground">
          Insights del loop nocturno. Aprueba los buenos → se inyectan en el system prompt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pendientes ({pending?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(pending || []).map((l) => (
            <div key={l.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{l.category}</Badge>
                <Badge variant={l.severity === "high" ? "destructive" : "secondary"}>{l.severity}</Badge>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <span className="text-xs text-muted-foreground">{(l.brands as any)?.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatRelative(l.created_at)}</span>
              </div>
              <div className="text-sm">{l.insight}</div>
              {l.suggested_fix && (
                <div className="text-sm text-muted-foreground italic">→ {l.suggested_fix}</div>
              )}
              <LearningActions learningId={l.id} />
            </div>
          ))}
          {(!pending || pending.length === 0) && (
            <div className="py-6 text-center text-sm text-muted-foreground">No hay learnings pendientes.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aplicados ({applied?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {(applied || []).map((l) => (
              <div key={l.id} className="py-2 text-sm">
                <div>{l.insight}</div>
                <div className="text-xs text-muted-foreground">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(l.brands as any)?.name} · {l.applied_at && formatRelative(l.applied_at)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
