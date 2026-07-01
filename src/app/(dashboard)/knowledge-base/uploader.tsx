"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DocumentUploader({ brands }: { brands: Array<{ id: string; name: string }> }) {
  const [brandId, setBrandId] = useState(brands[0]?.id || "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ chunks?: number; extraction_method?: string; error?: string }>({});
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !brandId) return;
    setStatus("uploading");
    const form = new FormData();
    form.append("file", file);
    form.append("brand_id", brandId);
    if (title) form.append("title", title);

    const res = await fetch("/api/documents/upload", { method: "POST", body: form });
    const data = await res.json();
    if (res.ok) {
      setStatus("done");
      setResult({ chunks: data.chunks, extraction_method: data.extraction_method });
      setFile(null);
      setTitle("");
      router.refresh();
    } else {
      setStatus("error");
      setResult({ error: data.error });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Brand</Label>
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Título (opcional)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Blueprint Meridian v10" />
        </div>
      </div>
      <div>
        <Label>Archivo (PDF, TXT, MD)</Label>
        <Input
          type="file"
          accept=".pdf,.txt,.md"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          required
        />
      </div>
      <Button type="submit" disabled={status === "uploading" || !file}>
        {status === "uploading" ? "Procesando..." : "Subir y procesar"}
      </Button>
      {status === "done" && (
        <div className="text-sm text-emerald-700">
          ✓ Procesado en {result.chunks} chunks
          {result.extraction_method === "ocr" ? " usando OCR." : "."}
        </div>
      )}
      {status === "error" && <div className="text-sm text-destructive">Error: {result.error}</div>}
    </form>
  );
}
