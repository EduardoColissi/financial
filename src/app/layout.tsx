import type { Metadata, Viewport } from "next";
import "./globals.css";
import { mono, sans } from "./fonts";

export const metadata: Metadata = {
  title: "Meu Caixa",
  description: "Painel de finanças pessoais",
  // Dado financeiro pessoal nunca pode acabar num índice de busca.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#0b1f19",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
