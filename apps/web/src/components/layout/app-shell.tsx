"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversas", label: "Conversas", icon: MessageSquareText },
  { href: "/agendamentos", label: "Agendamentos", icon: CalendarDays },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const activeNav = navItems.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  );

  return (
    <div className="min-h-screen bg-[#101412] text-foreground lg:grid lg:grid-cols-[244px_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-primary-foreground focus:shadow-xl"
      >
        Pular para o conteúdo principal
      </a>

      {/* Sidebar */}
      <aside
        aria-label="Navegação do painel"
        className="border-b border-border bg-[#131814] lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 flex flex-col justify-between"
      >
        <div>
          {/* Logo / Brand */}
          <div className="flex h-16 items-center gap-3 px-6 border-b border-border/50">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Bot size={18} />
            </span>
            <div className="leading-tight">
              <span className="font-semibold tracking-tight text-foreground">Mariana</span>
              <span className="block text-[11px] text-muted-foreground">Assistente IA</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:px-3">
            <span className="hidden px-3 pt-3 pb-2 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground lg:block">
              Operação
            </span>
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  }`}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Operational Security Card */}
        <div className="hidden p-4 lg:block">
          <div className="rounded-xl border border-border bg-card p-3.5 text-xs text-muted-foreground">
            <div className="mb-1.5 flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck size={14} className="text-primary" />
              <span>Acesso Restrito</span>
            </div>
            <p className="leading-relaxed">
              Autenticação protegida por camada reversa externa. A chave administrativa é restrita ao servidor.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <section className="flex flex-col min-w-0">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-[#101412]/90 px-5 backdrop-blur-md sm:px-8">
          <div>
            <p className="text-sm font-medium text-foreground">
              {activeNav?.label ?? "Mariana"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Painel Operacional Mariana
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            <span>Dados da API em tempo real</span>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 p-5 sm:p-8">
          {children}
        </main>
      </section>
    </div>
  );
}
