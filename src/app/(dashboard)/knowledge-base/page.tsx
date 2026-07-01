import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";
import { DocumentUploader } from "./uploader";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage() {
  const supabase = await createClient();

  const { data: brands } = await supabase.from("brands").select("id, name").order("name");
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, source_type, chunk_count, created_at, brand_id, brands(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground">
          Sube PDFs, markdown o txt. Si un PDF escaneado no tiene texto seleccionable, se usa OCR cuando está configurado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subir documento</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentUploader brands={brands || []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos ({docs?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {(docs || []).map((d) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const brand = d.brands as any;
              return (
                <div key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {brand?.name} · {d.chunk_count} chunks · {formatRelative(d.created_at)}
                    </div>
                  </div>
                  <Badge variant="secondary">{d.source_type}</Badge>
                </div>
              );
            })}
            {(!docs || docs.length === 0) && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay documentos. Sube el primero arriba ☝️
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
