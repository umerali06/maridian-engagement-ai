"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function HandoffControls({ conversationId, status }: { conversationId: string; status: string }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function act(action: "takeover" | "resolve" | "return_to_ai") {
    setLoading(true);
    const res = await fetch("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, action, notes }),
    });
    setLoading(false);
    if (res.ok) {
      setNotes("");
      router.refresh();
    } else {
      alert("Error: " + (await res.text()));
    }
  }

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="Notas (opcional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
      />
      <div className="flex flex-col gap-2">
        {status === "active" && (
          <Button onClick={() => act("takeover")} disabled={loading} variant="default">
            Tomar conversación (handoff)
          </Button>
        )}
        {status === "handed_off" && (
          <>
            <Button onClick={() => act("resolve")} disabled={loading} variant="default">
              Marcar resuelto y cerrar
            </Button>
            <Button onClick={() => act("return_to_ai")} disabled={loading} variant="outline">
              Devolver al AI
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
