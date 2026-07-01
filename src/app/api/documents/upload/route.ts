import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPdfText, chunkText } from "@/lib/chunking/pdf";
import { embedBatch } from "@/lib/ai/embeddings";
import { extractTextWithOcr, isOcrConfigured } from "@/lib/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EMBED_BATCH_SIZE = 50;
const MIN_EXTRACTED_TEXT_CHARS = 50;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const brandId = form.get("brand_id") as string | null;
  const title = (form.get("title") as string | null) || file?.name || "Untitled";

  if (!file || !brandId) {
    return NextResponse.json({ error: "file and brand_id required" }, { status: 400 });
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("brand_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // 1. Upload raw file to Storage
  const arrayBuf = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${brandId}/${Date.now()}-${file.name.replace(/[^a-z0-9.-]/gi, "_")}`;
  const { error: uploadErr } = await admin.storage.from("kb").upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadErr) {
    console.error("[upload] storage upload failed", uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // 2. Extract text (PDF for now; extend later)
  let text = "";
  let extractionMethod: "native" | "ocr" = "native";
  if (ext === "pdf") {
    text = await extractPdfText(buffer);
    if (text.trim().length < MIN_EXTRACTED_TEXT_CHARS && isOcrConfigured()) {
      try {
        const ocrText = await extractTextWithOcr({
          buffer,
          filename: file.name,
          mimeType: file.type || "application/pdf",
        });
        if (ocrText.trim()) {
          text = ocrText;
          extractionMethod = "ocr";
        }
      } catch (e) {
        console.error("[upload] OCR extraction failed", e);
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: `OCR extraction failed: ${message}` }, { status: 502 });
      }
    }
  } else if (["txt", "md"].includes(ext)) {
    text = buffer.toString("utf-8");
  } else {
    return NextResponse.json({ error: `unsupported file type: ${ext}` }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json(
      {
        error: isOcrConfigured()
          ? "no text extracted"
          : "no text extracted; configure OCR_HTTP_ENDPOINT for scanned PDFs",
      },
      { status: 400 },
    );
  }

  // 3. Chunk
  const chunks = chunkText(text);

  // 4. Create document row
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .insert({
      brand_id: brandId,
      title,
      source_type: ext === "pdf" ? "pdf" : ext === "md" ? "md" : "txt",
      file_path: path,
      chunk_count: chunks.length,
      metadata: { extraction_method: extractionMethod },
      created_by: user.id,
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    return NextResponse.json({ error: docErr?.message || "doc insert failed" }, { status: 500 });
  }

  // 5. Embed + insert chunks in batches
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((c) => c.content));
    const rows = batch.map((c, idx) => ({
      document_id: doc.id,
      brand_id: brandId,
      content: c.content,
      chunk_index: c.index,
      token_count: c.tokenCount,
      embedding: embeddings[idx] as unknown as string,
    }));
    const { error: chunkErr } = await admin.from("document_chunks").insert(rows);
    if (chunkErr) {
      console.error("[upload] chunk insert failed", chunkErr);
      return NextResponse.json({ error: chunkErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    document_id: doc.id,
    chunks: chunks.length,
    extraction_method: extractionMethod,
    preview: text.slice(0, 300),
  });
}
