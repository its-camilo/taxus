import { chatWithFallback, extractJson } from "../openrouter";
import { retrieveEstatuto } from "./estatuto";
import type { ExogenaLine, FormCode, Taxpayer } from "../types";

export type ReviewPass = {
  pass: number;
  label: string;
  ok: boolean;
  notes: string[];
};

export type TripleReviewResult = {
  passes: ReviewPass[];
  lines: ExogenaLine[];
  ready: boolean;
};

const REVIEW_PASSES = 3;

function sumByKind(lines: ExogenaLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    out[line.kind] = (out[line.kind] ?? 0) + line.monto;
  }
  return out;
}

function sumByFormato(lines: ExogenaLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    const key = line.formato ?? "sin_formato";
    out[key] = (out[key] ?? 0) + line.monto;
  }
  return out;
}

function pass1Structural(lines: ExogenaLine[], taxpayer: Taxpayer): ReviewPass {
  const notes: string[] = [];
  if (!taxpayer.documentNumber) {
    notes.push("Falta número de identificación en el encabezado del Excel.");
  }
  if (!taxpayer.fullName) {
    notes.push("Falta nombre o razón social en el recuadro superior del Excel.");
  }
  if (lines.length === 0) {
    notes.push("No hay líneas de exógena para revisar.");
  }
  const ambiguous = lines.filter((l) => l.kind === "ambiguous");
  if (ambiguous.length > 0) {
    notes.push(`${ambiguous.length} línea(s) ambiguas pendientes de clasificación.`);
  }
  const byFormato = sumByFormato(lines);
  for (const [fmt, total] of Object.entries(byFormato)) {
    if (total > 0) {
      notes.push(`Formato ${fmt}: ${Math.round(total).toLocaleString("es-CO")} en montos reportados.`);
    }
  }
  const pdfLines = lines.filter((l) => l.evidencia.startsWith("pdf:"));
  if (pdfLines.length > 0) {
    notes.push(`${pdfLines.length} monto(s) extraído(s) de PDFs complementarios.`);
  }
  return {
    pass: 1,
    label: "Integridad de fuentes (Excel y PDFs)",
    ok: lines.length > 0 && Boolean(taxpayer.documentNumber) && Boolean(taxpayer.fullName),
    notes,
  };
}

async function pass2Estatuto(lines: ExogenaLine[], form: FormCode): Promise<ReviewPass> {
  const notes: string[] = [];
  const byKind = sumByKind(lines);
  const queries: string[] = [];
  if ((byKind.trabajo_ingreso ?? 0) > 0) {
    queries.push("rentas de trabajo artículo 103 ingresos laborales");
  }
  if ((byKind.capital_rendimiento ?? 0) > 0) {
    queries.push("rentas de capital rendimientos financieros cédula");
  }
  if ((byKind.no_laboral_ingreso ?? 0) > 0) {
    queries.push("rentas no laborales ingresos ocasionales");
  }
  if ((byKind.patrimonio_activo ?? 0) > 0) {
    queries.push("patrimonio bruto activos saldos finales");
  }
  if ((byKind.retencion ?? 0) > 0) {
    queries.push("retención en la fuente renta artículo");
  }
  if (form === "210") {
    queries.push("rentas exentas deducciones límite 40 por ciento artículo 336");
    queries.push("tarifa personas naturales artículo 241");
  } else {
    queries.push("renta líquida gravable sociedades artículo 240");
  }

  const articles = new Set<string>();
  for (const q of queries.slice(0, 6)) {
    const hits = await retrieveEstatuto(q);
    for (const h of hits.slice(0, 2)) {
      articles.add(h.article);
      notes.push(`Art. ${h.article} E.T.: ${h.title}`);
    }
  }
  if (articles.size === 0) {
    notes.push("No se recuperaron artículos del Estatuto; se usará corpus local.");
  }
  return {
    pass: 2,
    label: "Alineación con Estatuto Tributario (RAG)",
    ok: articles.size > 0 || lines.length > 0,
    notes,
  };
}

async function pass3Consolidation(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  form: FormCode,
  prior: ReviewPass[],
): Promise<{ pass: ReviewPass; lines: ExogenaLine[] }> {
  const notes: string[] = [];
  let next = lines;

  if (!process.env.OPENROUTER_API_KEY) {
    notes.push("Sin OPENROUTER_API_KEY: revisión final solo con reglas locales.");
    notes.push(...prior.flatMap((p) => p.notes.slice(0, 2)));
    return {
      pass: {
        pass: 3,
        label: "Consolidación y validación final",
        ok: prior.every((p) => p.ok),
        notes,
      },
      lines: next,
    };
  }

  const docs = await retrieveEstatuto(
    `declaración renta formulario ${form} persona ${taxpayer.documentType} clasificación rentas`,
  );
  const context = docs.map((d) => `[Art. ${d.article}] ${d.chunk}`).join("\n");
  const summary = lines
    .slice(0, 40)
    .map(
      (l, i) =>
        `${i}. fmt=${l.formato ?? "?"} kind=${l.kind} ${l.tipoMonto}=${l.monto} ${l.informante}`,
    )
    .join("\n");

  try {
    const { content } = await chatWithFallback([
      {
        role: "system",
        content:
          'Revisa información exógena DIAN Colombia contra el Estatuto Tributario. No inventes montos. Responde JSON {"ok":true,"notes":["..."],"adjustments":[{"index":0,"kind":"trabajo_ingreso|capital_rendimiento|no_laboral_ingreso|patrimonio_activo|patrimonio_pasivo|retencion|ignore","citation":"art X"}]}.',
      },
      {
        role: "user",
        content: `Formulario ${form}. Contribuyente: ${taxpayer.fullName} ${taxpayer.documentType} ${taxpayer.documentNumber} AG ${taxpayer.year}.\n\nEstatuto:\n${context}\n\nRevisiones previas:\n${prior.map((p) => `${p.label}: ${p.notes.join("; ")}`).join("\n")}\n\nLíneas:\n${summary}`,
      },
    ]);
    const parsed = extractJson(content) as {
      ok?: boolean;
      notes?: string[];
      adjustments?: { index: number; kind: string; citation?: string }[];
    };
    if (parsed.notes?.length) {
      notes.push(...parsed.notes);
    }
    const kinds = new Set([
      "trabajo_ingreso",
      "capital_rendimiento",
      "no_laboral_ingreso",
      "patrimonio_activo",
      "patrimonio_pasivo",
      "retencion",
      "ignore",
    ]);
    next = [...lines];
    for (const adj of parsed.adjustments ?? []) {
      const target = lines[adj.index];
      if (!target || !kinds.has(adj.kind)) {
        continue;
      }
      next[adj.index] = {
        ...target,
        kind: adj.kind as ExogenaLine["kind"],
        evidencia: adj.citation ? `${target.evidencia} (${adj.citation})` : target.evidencia,
      };
    }
    return {
      pass: {
        pass: 3,
        label: "Consolidación y validación final",
        ok: parsed.ok !== false,
        notes: notes.length ? notes : ["Revisión consolidada sin observaciones críticas."],
      },
      lines: next,
    };
  } catch (err) {
    notes.push(`Revisión LLM no disponible: ${err instanceof Error ? err.message : "error"}`);
    notes.push("Se continúa con clasificación y reglas locales.");
    return {
      pass: {
        pass: 3,
        label: "Consolidación y validación final",
        ok: prior.every((p) => p.ok),
        notes,
      },
      lines: next,
    };
  }
}

export async function tripleReviewSources(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  form: FormCode,
): Promise<TripleReviewResult> {
  const passes: ReviewPass[] = [];
  let current = lines;

  for (let round = 0; round < REVIEW_PASSES; round += 1) {
    if (round === 0) {
      passes.push(pass1Structural(current, taxpayer));
    } else if (round === 1) {
      passes.push(await pass2Estatuto(current, form));
    } else {
      const { pass, lines: adjusted } = await pass3Consolidation(current, taxpayer, form, passes);
      passes.push(pass);
      current = adjusted;
    }
  }

  return {
    passes,
    lines: current,
    ready: passes.every((p) => p.ok) || passes[2]?.ok !== false,
  };
}
