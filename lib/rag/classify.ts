import { chatWithFallback, extractJson } from "../openrouter";
import { retrieveEstatuto } from "./estatuto";
import type { AmountKind, ExogenaLine } from "../types";

const KINDS: AmountKind[] = [
  "trabajo_ingreso",
  "capital_rendimiento",
  "no_laboral_ingreso",
  "patrimonio_activo",
  "patrimonio_pasivo",
  "retencion",
  "ignore",
  "ambiguous",
];

function isKind(v: string): v is AmountKind {
  return (KINDS as string[]).includes(v);
}

export async function classifyAmbiguousLines(lines: ExogenaLine[]): Promise<ExogenaLine[]> {
  const ambiguous = lines.filter((l) => l.kind === "ambiguous");
  if (ambiguous.length === 0) {
    return lines;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return lines.map((l) =>
      l.kind === "ambiguous" ? { ...l, kind: "no_laboral_ingreso" as const, evidencia: `${l.evidencia} (sin LLM)` } : l,
    );
  }
  const query = ambiguous
    .slice(0, 12)
    .map((l) => `${l.formato ?? ""} ${l.concepto ?? ""} ${l.tipoMonto} ${l.informante}`)
    .join("\n");
  const docs = await retrieveEstatuto(`clasificación rentas de trabajo capital no laborales retenciones ${query}`);
  const context = docs.map((d) => `[Art. ${d.article}] ${d.chunk}`).join("\n");
  try {
    const { content } = await chatWithFallback([
      {
        role: "system",
        content:
          "Clasifica líneas de información exógena DIAN Colombia. No inventes montos. Responde JSON {\"items\":[{\"index\":0,\"kind\":\"trabajo_ingreso|capital_rendimiento|no_laboral_ingreso|patrimonio_activo|patrimonio_pasivo|retencion|ignore\",\"citation\":\"art X\"}]}.",
      },
      {
        role: "user",
        content: `Estatuto:\n${context}\n\nLíneas:\n${ambiguous
          .slice(0, 12)
          .map((l, i) => `${i}. formato=${l.formato} concepto=${l.concepto} header=${l.tipoMonto} monto=${l.monto} ${l.informante}`)
          .join("\n")}`,
      },
    ]);
    const parsed = extractJson(content) as { items?: { index: number; kind: string; citation?: string }[] };
    const next = [...lines];
    for (const item of parsed.items ?? []) {
      const target = ambiguous[item.index];
      if (!target || !isKind(item.kind) || item.kind === "ambiguous") {
        continue;
      }
      const idx = next.indexOf(target);
      if (idx >= 0) {
        next[idx] = {
          ...target,
          kind: item.kind,
          evidencia: item.citation ? `${target.evidencia} (${item.citation})` : target.evidencia,
        };
      }
    }
    return next;
  } catch {
    return lines;
  }
}
