import type { MetadataRoute } from "next";

/**
 * Nenhum buscador entra.
 *
 * O gate ja' impede a leitura, mas `robots.txt` e o cabecalho `X-Robots-Tag`
 * cobrem o caso em que uma URL vaza (link colado num chat, historico
 * compartilhado): sem isto, o titulo da pagina ainda poderia acabar num indice.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
