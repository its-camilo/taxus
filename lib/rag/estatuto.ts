export type EstatutoArticle = {
  id: string;
  article: string;
  title: string;
  url: string;
  chunk: string;
};

export const ESTATUTO_CORPUS: EstatutoArticle[] = [
  {
    id: "art-103",
    article: "103",
    title: "Se consideran rentas de trabajo",
    url: "https://estatuto.co/103",
    chunk:
      "Art. 103. Se consideran rentas de trabajo las obtenidas por personas naturales por concepto de salarios, comisiones, prestaciones sociales, viáticos, gastos de representación, honorarios, emolumentos eclesiásticos, compensaciones recibidas por el trabajo asociado cooperativo y, en general, las compensaciones por servicios personales.",
  },
  {
    id: "art-206",
    article: "206",
    title: "Rentas de trabajo exentas",
    url: "https://estatuto.co/206",
    chunk:
      "Art. 206. Rentas de trabajo exentas. Están gravados con el impuesto sobre la renta y complementarios la totalidad de los pagos o abonos en cuenta provenientes de la relación laboral o legal y reglamentaria, con excepción de las rentas exentas, entre ellas el 25% del valor total de los pagos laborales, limitada anualmente a 790 UVT, numeral 10.",
  },
  {
    id: "art-241",
    article: "241",
    title: "Tarifa para personas naturales residentes",
    url: "https://estatuto.co/241",
    chunk:
      "Art. 241. La tarifa del impuesto sobre la renta de las personas naturales residentes y asignaciones y donaciones modales se determina según la tabla en UVT (0%, 19%, 28%, 33%, 35%, 37%, 39%).",
  },
  {
    id: "art-240",
    article: "240",
    title: "Tarifa para sociedades nacionales",
    url: "https://estatuto.co/240",
    chunk:
      "Art. 240. La tarifa general del impuesto sobre la renta aplicable a las sociedades nacionales y asimiladas es del 35%.",
  },
  {
    id: "art-330",
    article: "330",
    title: "Determinación cedular",
    url: "https://estatuto.co/330",
    chunk:
      "Art. 330. Determinación cedular. La renta líquida gravable y el impuesto de las personas naturales residentes se determina de forma cedular: cédula general (trabajo, capital y no laborales), pensiones, dividendos y ganancias ocasionales.",
  },
  {
    id: "art-336",
    article: "336",
    title: "Renta líquida gravable de la cédula general",
    url: "https://estatuto.co/336",
    chunk:
      "Art. 336. De la suma de rentas líquidas cedulares se podrán restar las rentas exentas y deducciones imputables, cuyo valor no podrá exceder el 40% del resultado de restar de la suma de rentas incluyendo ingresos no constitutivos, ni 1340 UVT. El 25% de rentas de trabajo del art. 206 num. 10 se sujeta a este límite.",
  },
  {
    id: "art-387",
    article: "387",
    title: "Deducciones por dependientes y medicina prepagada",
    url: "https://estatuto.co/387",
    chunk:
      "Art. 387. Los asalariados pueden deducir, entre otros, intereses de vivienda, medicina prepagada y 72 UVT mensuales por dependientes, con los límites legales.",
  },
  {
    id: "art-26",
    article: "26",
    title: "Los ingresos son base de la renta líquida",
    url: "https://estatuto.co/26",
    chunk:
      "Art. 26. La renta líquida está constituida por la totalidad de los ingresos ordinarios y extraordinarios realizados en el año o período gravable, que no hayan sido exceptuados, menos las devoluciones, rebajas, descuentos, costos y deducciones.",
  },
  {
    id: "art-283",
    article: "283",
    title: "Deudas",
    url: "https://estatuto.co/283",
    chunk:
      "Art. 283. El valor de las deudas corresponde al saldo insoluto a 31 de diciembre. Quienes no estén obligados a llevar contabilidad solo pueden solicitar pasivos de fecha cierta.",
  },
];

function score(query: string, article: EstatutoArticle): number {
  const q = query.toLowerCase();
  const hay = `${article.article} ${article.title} ${article.chunk}`.toLowerCase();
  return q
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
}

export function searchLocalCorpus(query: string, k = 5): EstatutoArticle[] {
  return [...ESTATUTO_CORPUS]
    .map((a) => ({ a, s: score(query, a) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.a);
}

export async function retrieveEstatuto(query: string): Promise<EstatutoArticle[]> {
  const host = process.env.PINECONE_HOST;
  const key = process.env.PINECONE_API_KEY;
  if (!key || !host) {
    return searchLocalCorpus(query);
  }
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}/records/namespaces/et-nacional/search`, {
      method: "POST",
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
        "X-Pinecone-API-Version": "2025-04",
      },
      body: JSON.stringify({
        query: { top_k: 8, inputs: { text: query } },
      }),
    });
    if (!res.ok) {
      return searchLocalCorpus(query);
    }
    const data = (await res.json()) as {
      result?: { hits?: { fields?: Record<string, string> }[] };
    };
    const hits = data.result?.hits ?? [];
    if (hits.length === 0) {
      return searchLocalCorpus(query);
    }
    return hits.map((h, i) => ({
      id: h.fields?.id ?? `hit-${i}`,
      article: h.fields?.article ?? "",
      title: h.fields?.title ?? "",
      url: h.fields?.url ?? "",
      chunk: h.fields?.chunk ?? "",
    }));
  } catch {
    return searchLocalCorpus(query);
  }
}
