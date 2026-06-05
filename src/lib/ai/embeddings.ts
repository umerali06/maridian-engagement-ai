import OpenAI from "openai";

let _client: OpenAI | null = null;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _client;
}

const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const DIMS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);

export async function embed(text: string): Promise<number[]> {
  const res = await client().embeddings.create({
    model: MODEL,
    input: text,
    dimensions: DIMS,
  });
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client().embeddings.create({
    model: MODEL,
    input: texts,
    dimensions: DIMS,
  });
  return res.data.map((d) => d.embedding);
}
