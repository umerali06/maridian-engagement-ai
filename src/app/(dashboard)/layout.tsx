import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MessageSquare, BookOpen, Building2, Settings, LayoutDashboard, Brain, LogOut } from "lucide-react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nav = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/conversations", label: "Conversaciones", icon: MessageSquare },
    { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
    { href: "/learnings", label: "Learnings", icon: Brain },
    { href: "/brands", label: "Brands", icon: Building2 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="font-semibold">Meridian AI</div>
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <form action="/api/auth/signout" method="post" className="p-2 border-t">
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent w-full text-left">
            <LogOut className="h-4 w-4" />
            Salir
          </button>
        </form>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
