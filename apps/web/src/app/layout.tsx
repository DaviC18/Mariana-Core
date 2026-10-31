import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = { title: "Mariana | Operação", description: "Painel operacional da Mariana" };
export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="pt-BR" className="dark"><body><AppShell>{children}</AppShell></body></html>;
}
