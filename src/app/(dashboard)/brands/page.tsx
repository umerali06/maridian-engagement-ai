import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const supabase = await createClient();
  const { data: brands } = await supabase
    .from("brands")
    .select("id, slug, name, active, landing_base_url, manychat_accounts(id, platform, display_name, active)")
    .order("name");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Brands</h1>
        <p className="text-sm text-muted-foreground">Cada brand es un cliente o cuenta independiente.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(brands || []).map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>{b.name}</span>
                {b.active ? <Badge variant="success">Activo</Badge> : <Badge variant="secondary">Inactivo</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Slug:</span> {b.slug}
              </div>
              {b.landing_base_url && (
                <div>
                  <span className="text-muted-foreground">Landing:</span> {b.landing_base_url}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Cuentas ManyChat:</span>{" "}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(b.manychat_accounts as any[])?.length || 0}
              </div>
              <div className="flex gap-1 flex-wrap pt-1">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(b.manychat_accounts as any[])?.map((a) => (
                  <Badge key={a.id} variant="outline">
                    {a.platform}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="text-sm text-muted-foreground">
        Para crear un nuevo brand, usa SQL en Supabase o el endpoint <code>POST /api/brands</code>.
      </div>
    </div>
  );
}
