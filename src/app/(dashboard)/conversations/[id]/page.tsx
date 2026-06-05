import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";
import { HandoffControls } from "./handoff-controls";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select(
      "id, status, summary, handoff_reason, handed_off_at, handed_off_to, created_at, subscribers(full_name, platform, profile_pic, detected_persona, lead_score)",
    )
    .eq("id", id)
    .single();

  if (!conv) return notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, tool_input, created_at, latency_ms, model")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = conv.subscribers as any;

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{sub?.full_name || "Anónimo"}</span>
              <Badge variant={conv.status === "handed_off" ? "warning" : "success"}>{conv.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[70vh] overflow-y-auto">
            {(messages ?? []).map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-secondary"
                      : m.role === "assistant"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground italic"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  <div className="text-[10px] opacity-60 mt-1">
                    {formatRelative(m.created_at)}
                    {m.latency_ms ? ` · ${m.latency_ms}ms` : ""}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Subscriber</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row label="Plataforma" value={sub?.platform} />
            <Row label="Persona" value={sub?.detected_persona || "—"} />
            <Row label="Lead score" value={sub?.lead_score?.toString() || "0"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <HandoffControls conversationId={id} status={conv.status} />
          </CardContent>
        </Card>

        {conv.handoff_reason && (
          <Card>
            <CardHeader>
              <CardTitle>Handoff</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Razón:</span> {conv.handoff_reason}
              </div>
              {conv.handed_off_at && (
                <div>
                  <span className="text-muted-foreground">Cuándo:</span> {formatRelative(conv.handed_off_at)}
                </div>
              )}
              {conv.handed_off_to && (
                <div>
                  <span className="text-muted-foreground">A:</span> {conv.handed_off_to}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
