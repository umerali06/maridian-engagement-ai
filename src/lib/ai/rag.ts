import { createAdminClient } from "@/lib/supabase/admin";
import { embed } from "./embeddings";

export type RetrievedChunk = {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

export async function retrieve(
  brandId: string,
  query: string,
  opts: { topK?: number; threshold?: number } = {},
): Promise<RetrievedChunk[]> {
  const { topK = 5, threshold = 0.45 } = opts;
  const embedding = await embed(query);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding as unknown as string, // pgvector accepts JSON array
    match_brand_id: brandId,
    match_threshold: threshold,
    match_count: topK,
  });
  if (error) {
    console.error("[rag] match_chunks error", error);
    return [];
  }
  return (data || []) as RetrievedChunk[];
}

export function formatChunksAsContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map(
      (c, i) =>
        `[Documento ${i + 1} — relevancia ${(c.similarity * 100).toFixed(0)}%]\n${c.content}`,
    )
    .join("\n\n---\n\n");
}
