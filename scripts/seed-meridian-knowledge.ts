/**
 * Seed initial Meridian knowledge base from local files.
 *
 * Usage:
 *   npx tsx scripts/seed-meridian-knowledge.ts ./path/to/blueprint.pdf ./path/to/kpis.pdf
 *
 * Or set MERIDIAN_SEED_FILES (comma-separated paths).
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

const BRAND_SLUG = process.env.DEFAULT_BRAND_SLUG || "meridian";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = 800 * CHARS_PER_TOKEN;
const OVERLAP_CHARS = 100 * CHARS_PER_TOKEN;

function chunkText(text: string): Array<{ content: string; index: number; tokenCount: number }> {
  const paras = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).filter((p) => p.trim());
  const chunks: Array<{ content: string; index: number; tokenCount: number }> = [];
  let buf = "";
  const flush = () => {
    if (!buf.trim()) return;
    chunks.push({ content: buf.trim(), index: chunks.length, tokenCount: Math.ceil(buf.length / CHARS_PER_TOKEN) });
    buf = buf.length > OVERLAP_CHARS ? buf.slice(-OVERLAP_CHARS) : "";
  };
  for (const p of paras) {
    if (buf.length + p.length + 2 > TARGET_CHARS && buf.length) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return chunks;
}

async function embedBatch(texts: string[]) {
  const r = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
    dimensions: 1536,
  });
  return r.data.map((d) => d.embedding);
}

async function main() {
  const filesArg = process.argv.slice(2);
  const files = filesArg.length > 0 ? filesArg : (process.env.MERIDIAN_SEED_FILES || "").split(",").filter(Boolean);
  if (files.length === 0) {
    console.error("Usage: tsx scripts/seed-meridian-knowledge.ts <file1> [file2] ...");
    process.exit(1);
  }

  const { data: brand } = await supabase.from("brands").select("id").eq("slug", BRAND_SLUG).single();
  if (!brand) {
    console.error(`Brand '${BRAND_SLUG}' not found. Run the migration first.`);
    process.exit(1);
  }

  for (const filePath of files) {
    console.log(`\n→ ${filePath}`);
    const ext = extname(filePath).slice(1).toLowerCase();
    let text = "";
    if (ext === "pdf") {
      text = (await pdfParse(readFileSync(filePath))).text;
    } else if (["txt", "md"].includes(ext)) {
      text = readFileSync(filePath, "utf-8");
    } else if (ext === "docx") {
      // Convert DOCX → plain text via Mac's built-in textutil
      const out = join(tmpdir(), `${Date.now()}.txt`);
      execSync(`textutil -convert txt -output "${out}" "${filePath}"`);
      text = readFileSync(out, "utf-8");
    } else {
      console.warn(`  skipping unsupported ext: ${ext}`);
      continue;
    }

    const chunks = chunkText(text);
    console.log(`  ${chunks.length} chunks`);

    const { data: doc } = await supabase
      .from("documents")
      .insert({
        brand_id: brand.id,
        title: basename(filePath),
        source_type: ext === "pdf" ? "pdf" : ext === "md" ? "md" : "txt",
        chunk_count: chunks.length,
      })
      .select("id")
      .single();
    if (!doc) {
      console.error("  failed to create document row");
      continue;
    }

    for (let i = 0; i < chunks.length; i += 50) {
      const slice = chunks.slice(i, i + 50);
      const embs = await embedBatch(slice.map((c) => c.content));
      await supabase.from("document_chunks").insert(
        slice.map((c, idx) => ({
          document_id: doc.id,
          brand_id: brand.id,
          content: c.content,
          chunk_index: c.index,
          token_count: c.tokenCount,
          embedding: embs[idx] as unknown as string,
        })),
      );
      console.log(`  embedded ${Math.min(i + 50, chunks.length)}/${chunks.length}`);
    }
  }
  console.log("\n✓ Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
