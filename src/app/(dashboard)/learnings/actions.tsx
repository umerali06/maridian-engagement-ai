"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LearningActions({ learningId }: { learningId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function decide(status: "applied" | "rejected") {
    setLoading(true);
    const updates: Record<string, unknown> = { status };
    if (status === "applied") updates.applied_at = new Date().toISOString();
    await supabase.from("learnings").update(updates).eq("id", learningId);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2 pt-1">
      <Button size="sm" onClick={() => decide("applied")} disabled={loading}>
        Aplicar
      </Button>
      <Button size="sm" variant="outline" onClick={() => decide("rejected")} disabled={loading}>
        Rechazar
      </Button>
    </div>
  );
}
