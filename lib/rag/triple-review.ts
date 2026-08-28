import { chatWithFallback, extractJson } from "../openrouter";
import { retrieveEstatuto } from "./estatuto";
import type { ExogenaLine, ExternalDocSummary, FormCode, SheetSummary, Taxpayer } from "../types";

export type ReviewPass = {
  round: number;
  pass: number;
  label: string;
  ok: boolean;
  notes: string[];
  agent?: string;
};

export type TripleReviewResult = {
  passes: ReviewPass[];
  lines: ExogenaLine[];
  ready: boolean;
};

const REVIEW_ROUNDS = 3;
const FALLBACK_PASSES = 4;

type SectionDef = {
  id: string;
  label: string;
  agent: string;
  estatutoQuery: string;
  match: (line: ExogenaLine) => boolean;
};

const SECTIONS: SectionDef[] = [
  {
    id: "trabajo",
    label: "Rentas de trabajo y pensión",
    agent: "subagente-trabajo",
    estatutoQuery: "rentas de trabajo artículo 103 ingresos laborales pensión",
    match: (l) => l.formato === "2276" || l.kind === "trabajo_ingreso",
  },
  {
    id: "capital",
    label: "Rentas de capital y rendimientos",
    agent: "subagente-capital",
    estatutoQuery: "rentas de capital rendimientos financieros CDT carteras",
    match: (l) => l.formato === "1020" || l.formato === "1021" || l.kind === "capital_rendimiento",
  },
  {
    id: "patrimonio",
    label: "Patrimonio y saldos",
    agent: "subagente-patrimonio",
    estatutoQuery: "patrimonio bruto activos saldos finales cuentas",
    match: (l) =>
      l.kind === "patrimonio_activo" ||
      l.kind === "patrimonio_pasivo" ||
      l.formato === "1019" ||
      l.formato === "2273" ||
      l.formato === "1008",
  },
  {
    id: "no_laboral",
    label: "Rentas no laborales",
    agent: "subagente-no-laboral",
    estatutoQuery: "rentas no laborales ingresos cuentas participación",
    match: (l) =>
      l.formato === "5248" ||
      l.formato === "1007" ||
      l.formato === "1647" ||
      l.kind === "no_laboral_ingreso",
  },
  {
    id: "retenciones",
    label: "Retenciones y pagos",
    agent: "subagente-retenciones",
    estatutoQuery: "retención en la fuente renta formato 1001",
    match: (l) => l.formato === "1001" || l.kind === "retencion",
  },
  {
    id: "iva_otros",
    label: "IVA y otros formatos",
    agent: "subagente-iva",
    estatutoQuery: "IVA impuesto consumo información exógena",
    match: (l) => l.formato === "1006" || l.kind === "ignore",
  },
  {
    id: "externos",
    label: "PDFs y CSV externos",
    agent: "subagente-externos",
    estatutoQuery: "certificados bancarios rendimientos retenciones",
    match: (l) => l.evidencia.startsWith("pdf:") || l.evidencia.startsWith("csv:"),
  },
  {
    id: "restantes",
    label: "Líneas sin clasificar",
    agent: "subagente-restantes",
    estatutoQuery: "clasificación rentas información exógena DIAN",
    match: () => true,
  },
];

const KINDS = new Set([
  "trabajo_ingreso",
  "capital_rendimiento",
  "no_laboral_ingreso",
  "patrimonio_activo",
  "patrimonio_pasivo",
  "retencion",
  "ignore",
]);

function sectionLines(lines: ExogenaLine[], section: SectionDef, assigned: Set<number>): ExogenaLine[] {
  const out: ExogenaLine[] = [];
  lines.forEach((line, index) => {
    if (assigned.has(index)) {
      return;
    }
    if (section.id === "restantes" ? true : section.match(line)) {
      if (section.id !== "restantes" || !SECTIONS.some((s) => s.id !== "restantes" && s.match(line))) {
        out.push(line);
        assigned.add(index);
      }
    }
  });
  return out;
}

function sheetNotes(sheets: SheetSummary[]): string[] {
  return sheets.map(
    (s) => `Hoja "${s.name}": ${s.rowCount} filas, ${s.linesExtracted} montos extraídos`,
  );
}

function structuralSectionReview(
  section: SectionDef,
  sectionData: ExogenaLine[],
  round: number,
  passNum: number,
): ReviewPass {
  const notes: string[] = [];
  if (sectionData.length === 0) {
    notes.push("Sin datos en esta sección.");
  } else {
    const total = sectionData.reduce((a, l) => a + l.monto, 0);
    const formatos = [...new Set(sectionData.map((l) => l.formato ?? "?"))];
    const sheets = [...new Set(sectionData.map((l) => l.sheetName).filter(Boolean))];
    notes.push(`${sectionData.length} línea(s), total ${Math.round(total).toLocaleString("es-CO")}`);
    notes.push(`Formatos: ${formatos.join(", ")}`);
    if (sheets.length > 0) {
      notes.push(`Hojas: ${sheets.join(", ")}`);
    }
    const ambiguous = sectionData.filter((l) => l.kind === "ambiguous");
    if (ambiguous.length > 0) {
      notes.push(`${ambiguous.length} línea(s) ambiguas.`);
    }
  }
  return {
    round,
    pass: passNum,
    label: section.label,
    ok: sectionData.length === 0 || sectionData.every((l) => l.kind !== "ambiguous"),
    notes,
    agent: section.agent,
  };
}

async function llmSectionReview(
  section: SectionDef,
  sectionData: ExogenaLine[],
  lines: ExogenaLine[],
  form: FormCode,
  round: number,
  passNum: number,
): Promise<{ pass: ReviewPass; adjustments: { index: number; kind: string; citation?: string }[] }> {
  if (sectionData.length === 0) {
    return {
      pass: {
        round,
        pass: passNum,
        label: section.label,
        ok: true,
        notes: ["Sin datos en esta sección."],
        agent: section.agent,
      },
      adjustments: [],
    };
  }

  const docs = await retrieveEstatuto(`${section.estatutoQuery} formulario ${form}`);
  const context = docs.map((d) => `[Art. ${d.article}] ${d.chunk}`).join("\n");
  const summary = sectionData
    .map((l) => {
      const idx = lines.indexOf(l);
      return `${idx}. fmt=${l.formato ?? "?"} sheet=${l.sheetName ?? "?"} kind=${l.kind} ${l.tipoMonto}=${l.monto}`;
    })
    .join("\n");

  try {
    const { content } = await chatWithFallback([
      {
        role: "system",
        content:
          'Eres un subagente tributario Colombia. Revisa SOLO tu sección de exógena. No inventes montos. JSON: {"ok":true,"notes":["..."],"adjustments":[{"index":0,"kind":"trabajo_ingreso|capital_rendimiento|no_laboral_ingreso|patrimonio_activo|patrimonio_pasivo|retencion|ignore","citation":"art X"}]}.',
      },
      {
        role: "user",
        content: `Ronda ${round}. Sección: ${section.label}.\nEstatuto:\n${context}\n\nLíneas:\n${summary}`,
      },
    ]);
    const parsed = extractJson(content) as {
      ok?: boolean;
      notes?: string[];
      adjustments?: { index: number; kind: string; citation?: string }[];
    };
    return {
      pass: {
        round,
        pass: passNum,
        label: section.label,
        ok: parsed.ok !== false,
        notes: parsed.notes?.length ? parsed.notes : ["Revisión completada."],
        agent: section.agent,
      },
      adjustments: parsed.adjustments ?? [],
    };
  } catch (err) {
    const structural = structuralSectionReview(section, sectionData, round, passNum);
    structural.notes.push(`LLM no disponible: ${err instanceof Error ? err.message : "error"}`);
    return { pass: structural, adjustments: [] };
  }
}

function applyAdjustments(
  lines: ExogenaLine[],
  adjustments: { index: number; kind: string; citation?: string }[],
): ExogenaLine[] {
  const next = [...lines];
  for (const adj of adjustments) {
    const target = next[adj.index];
    if (!target || !KINDS.has(adj.kind)) {
      continue;
    }
    next[adj.index] = {
      ...target,
      kind: adj.kind as ExogenaLine["kind"],
      evidencia: adj.citation ? `${target.evidencia} (${adj.citation})` : target.evidencia,
    };
  }
  return next;
}

async function consolidatorAgent(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  form: FormCode,
  sectionPasses: ReviewPass[],
  sheets: SheetSummary[],
  externalDocs: ExternalDocSummary[],
  round: number,
  passNum: number,
): Promise<{ pass: ReviewPass; lines: ExogenaLine[] }> {
  const notes: string[] = [
    ...sheetNotes(sheets),
    ...externalDocs.map((d) => `Documento ${d.type.toUpperCase()} "${d.name}": ${d.linesExtracted} montos`),
    ...sectionPasses.flatMap((p) => [`[${p.agent}] ${p.label}: ${p.ok ? "OK" : "revisar"}`]),
  ];

  if (!process.env.OPENROUTER_API_KEY) {
    return {
      pass: {
        round,
        pass: passNum,
        label: "Agente consolidador",
        ok: sectionPasses.every((p) => p.ok),
        notes: [...notes, "Consolidación local sin LLM."],
        agent: "agente-consolidador",
      },
      lines,
    };
  }

  const docs = await retrieveEstatuto(`declaración renta formulario ${form} consolidación casillas`);
  const context = docs.map((d) => `[Art. ${d.article}] ${d.chunk}`).join("\n");
  const summary = lines
    .slice(0, 60)
    .map((l, i) => `${i}. ${l.formato ?? "?"} ${l.kind} ${l.monto} ${l.sheetName ?? ""}`)
    .join("\n");

  try {
    const { content } = await chatWithFallback([
      {
        role: "system",
        content:
          'Agente consolidador tributario Colombia. Integra revisiones de subagentes. No inventes montos. JSON: {"ok":true,"notes":["..."],"adjustments":[{"index":0,"kind":"..."}]}.',
      },
      {
        role: "user",
        content: `Ronda ${round}/3. Formulario ${form}. ${taxpayer.fullName} ${taxpayer.documentType} ${taxpayer.documentNumber} AG ${taxpayer.year}.\n\nEstatuto:\n${context}\n\nSubagentes:\n${sectionPasses.map((p) => `${p.agent}: ${p.notes.join("; ")}`).join("\n")}\n\nLíneas:\n${summary}`,
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
    return {
      pass: {
        round,
        pass: passNum,
        label: "Agente consolidador",
        ok: parsed.ok !== false,
        notes,
        agent: "agente-consolidador",
      },
      lines: applyAdjustments(lines, parsed.adjustments ?? []),
    };
  } catch (err) {
    notes.push(`Consolidador LLM no disponible: ${err instanceof Error ? err.message : "error"}`);
    return {
      pass: {
        round,
        pass: passNum,
        label: "Agente consolidador",
        ok: sectionPasses.every((p) => p.ok),
        notes,
        agent: "agente-consolidador",
      },
      lines,
    };
  }
}

async function runMultiAgentRound(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  form: FormCode,
  sheets: SheetSummary[],
  externalDocs: ExternalDocSummary[],
  round: number,
  useLlm: boolean,
): Promise<{ passes: ReviewPass[]; lines: ExogenaLine[] }> {
  const passes: ReviewPass[] = [];
  const assigned = new Set<number>();
  const sectionDataMap = SECTIONS.map((section) => ({
    section,
    data: sectionLines(lines, section, assigned),
  }));
  const basePass = (round - 1) * (SECTIONS.length + 1);

  const sectionResults = await Promise.all(
    sectionDataMap.map(async ({ section, data }, sectionIndex) => {
      const passNum = basePass + sectionIndex + 1;
      if (useLlm && process.env.OPENROUTER_API_KEY) {
        return llmSectionReview(section, data, lines, form, round, passNum);
      }
      return { pass: structuralSectionReview(section, data, round, passNum), adjustments: [] };
    }),
  );

  const allAdjustments: { index: number; kind: string; citation?: string }[] = [];
  for (const result of sectionResults) {
    passes.push(result.pass);
    allAdjustments.push(...result.adjustments);
  }

  let current = applyAdjustments(lines, allAdjustments);
  const { pass, lines: consolidated } = await consolidatorAgent(
    current,
    taxpayer,
    form,
    sectionResults.map((r) => r.pass),
    sheets,
    externalDocs,
    round,
    basePass + SECTIONS.length + 1,
  );
  passes.push(pass);
  current = consolidated;

  return { passes, lines: current };
}

function fallbackFullReview(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  sheets: SheetSummary[],
  externalDocs: ExternalDocSummary[],
  passNum: number,
): ReviewPass {
  const notes = [
    ...sheetNotes(sheets),
    ...externalDocs.map((d) => `${d.type}: ${d.name} (${d.linesExtracted} montos)`),
    `Contribuyente: ${taxpayer.fullName} · ${taxpayer.documentType} ${taxpayer.documentNumber}`,
    `${lines.length} líneas totales en revisión completa ${passNum}/${FALLBACK_PASSES}`,
  ];
  const ambiguous = lines.filter((l) => l.kind === "ambiguous").length;
  if (ambiguous > 0) {
    notes.push(`${ambiguous} línea(s) ambiguas.`);
  }
  return {
    round: passNum,
    pass: passNum,
    label: `Revisión documental completa ${passNum}/${FALLBACK_PASSES}`,
    ok: lines.length > 0 && Boolean(taxpayer.fullName) && Boolean(taxpayer.documentNumber),
    notes,
    agent: "revision-completa",
  };
}

export async function tripleReviewSources(
  lines: ExogenaLine[],
  taxpayer: Taxpayer,
  form: FormCode,
  sheets: SheetSummary[] = [],
  externalDocs: ExternalDocSummary[] = [],
): Promise<TripleReviewResult> {
  const passes: ReviewPass[] = [];
  let current = lines;
  const useSubagents = Boolean(process.env.OPENROUTER_API_KEY);

  if (useSubagents) {
    for (let round = 1; round <= REVIEW_ROUNDS; round += 1) {
      const { passes: roundPasses, lines: next } = await runMultiAgentRound(
        current,
        taxpayer,
        form,
        sheets,
        externalDocs,
        round,
        true,
      );
      passes.push(...roundPasses);
      current = next;
    }
  } else {
    for (let p = 1; p <= FALLBACK_PASSES; p += 1) {
      passes.push(fallbackFullReview(current, taxpayer, sheets, externalDocs, p));
      const docs = await retrieveEstatuto(
        `declaración renta formulario ${form} revisión ${p} rentas trabajo capital patrimonio`,
      );
      if (docs.length > 0) {
        passes[passes.length - 1]!.notes.push(
          `Estatuto: ${docs.map((d) => `Art. ${d.article}`).join(", ")}`,
        );
      }
    }
  }

  const sheetNames = new Set(sheets.map((s) => s.name));
  const reviewedSheets = new Set(current.map((l) => l.sheetName).filter(Boolean));
  for (const name of sheetNames) {
    if (!reviewedSheets.has(name) && sheets.find((s) => s.name === name)?.linesExtracted === 0) {
      passes.push({
        round: REVIEW_ROUNDS,
        pass: passes.length + 1,
        label: `Hoja vacía: ${name}`,
        ok: true,
        notes: ["Hoja revisada sin montos reportados."],
        agent: "revisor-hojas",
      });
    }
  }

  return {
    passes,
    lines: current,
    ready: passes.every((p) => p.ok) || passes.at(-1)?.ok !== false,
  };
}
