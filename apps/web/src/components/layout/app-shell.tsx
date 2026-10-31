"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, LayoutDashboard, MessageSquareText, PanelLeft, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";

const nav = [{ href: "/", label: "Visão geral", icon: LayoutDashboard }, { href: "/leads", label: "Leads", icon: Users }, { href: "/conversas", label: "Conversas", icon: MessageSquareText }, { href: "/agendamentos", label: "Agendamentos", icon: CalendarDays }, { href: "/configuracoes", label: "Configurações", icon: Settings }];
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen bg-[#101412] lg:grid lg:grid-cols-[244px_1fr]">
    <aside className="border-b border-border bg-[#131814] lg:fixed lg:inset-y-0 lg:w-[244px] lg:border-r lg:border-b-0">
      <div className="flex h-16 items-center gap-3 px-5"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot size={18}/></span><span className="font-semibold tracking-tight">Mariana</span></div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3"><span className="hidden px-3 pt-4 pb-2 text-xs text-muted-foreground lg:block">Operação</span>{nav.map(({ href, label, icon: Icon }) => { const active = href === "/" ? pathname === href : pathname.startsWith(href); return <Link key={href} href={href} className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={17}/>{label}</Link>; })}</nav>
      <div className="hidden absolute inset-x-5 bottom-5 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground lg:block"><span className="mb-1 flex items-center gap-2 text-foreground"><PanelLeft size={14} className="text-primary"/> Painel operacional</span>Dados protegidos pela camada de acesso externa.</div>
    </aside>
    <section className="min-w-0"><header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8"><div><p className="text-sm font-medium">Mariana</p><p className="text-xs text-muted-foreground">Central de atendimento</p></div><span className="flex items-center gap-2 text-xs text-muted-foreground"><i className="size-2 rounded-full bg-primary"/> Dados em tempo real</span></header><main className="mx-auto w-full max-w-7xl p-5 sm:p-8">{children}</main></section>
  </div>;
}
