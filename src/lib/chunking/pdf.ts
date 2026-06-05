import pdfParse from "pdf-parse";

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 100;
const CHARS_PER_TOKEN = 4; // rough heuristic for Spanish/English mix

export type Chunk = {
  content: string;
  index: number;
  tokenCount: number;
};

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return cleanText(data.text);
}

function cleanText(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Splits text into ~800-token chunks with ~100-token overlap, respecting paragraph
 * and sentence boundaries when possible.
 */
export function chunkText(text: string): Chunk[] {
  const targetChars = TARGET_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  const chunks: Chunk[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim().length === 0) return;
    chunks.push({
      content: buf.trim(),
      index: chunks.length,
      tokenCount: Math.ceil(buf.length / CHARS_PER_TOKEN),
    });
    // Overlap: keep last N chars
    buf = buf.length > overlapChars ? buf.slice(-overlapChars) : "";
  };

  for (const para of paragraphs) {
    if (buf.length + para.length + 2 > targetChars && buf.length > 0) {
      flush();
    }
    // If a single paragraph is bigger than target, split it into sentences
    if (para.length > targetChars) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (buf.length + s.length + 1 > targetChars && buf.length > 0) flush();
        buf += (buf ? " " : "") + s;
      }
    } else {
      buf += (buf ? "\n\n" : "") + para;
    }
  }
  if (buf.trim().length > 0) {
    chunks.push({
      content: buf.trim(),
      index: chunks.length,
      tokenCount: Math.ceil(buf.length / CHARS_PER_TOKEN),
    });
  }
  return chunks;
}
