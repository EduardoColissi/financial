import type { NextConfig } from "next";

/**
 * Cabecalhos de seguranca.
 *
 * Valem para TODA resposta, inclusive as que o gate deixa passar. Sao baratos e
 * fecham as portas que nao dependem de autenticacao: enquadrar o painel num
 * iframe de outro site, vazar a URL no `Referer` ao clicar num link externo, e
 * o navegador adivinhar o tipo de um arquivo servido.
 */
const securityHeaders = [
  // Painel pessoal nunca precisa ser embutido em lugar nenhum.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A URL carrega o mes; nem isso precisa vazar para terceiros.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  // Um ano, incluindo subdominios. So' tem efeito em https.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
