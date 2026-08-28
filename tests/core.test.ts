import ExcelJS from "exceljs";
import { parseCsvComplement, parseExogenaWorkbook, parsePdfTextAsLines } from "@/lib/exogena/parse";
import { build110, build210, recalc } from "@/lib/engine/forms";
import { taxFromUvtTable, uvt } from "@/lib/engine/uvt";
import { extractJson, chatWithFallback, OPENROUTER_FREE_MODELS } from "@/lib/openrouter";
import { searchLocalCorpus } from "@/lib/rag/estatuto";
import { fillFormPdf, formatCasillaValue, pdfY, fieldBox } from "@/lib/pdf/overlay";
import type { Taxpayer, ExogenaLine, Casilla } from "@/lib/types";
import { describe, expect, it } from "vitest";

const taxpayer: Taxpayer = {
  year: 2025,
  documentType: "C.C.",
  documentNumber: "1000000000",
  fullName: "PEREZ GOMEZ ANA MARIA",
  firstLastName: "PEREZ",
  secondLastName: "GOMEZ",
  firstName: "ANA",
  otherNames: "MARIA",
  suggestedForm: "210",
};

function line(partial: Partial<ExogenaLine> & Pick<ExogenaLine, "monto" | "kind">): ExogenaLine {
  return {
    informante: "Banco",
    tipoMonto: "test",
    evidencia: "test",
    ...partial,
  };
}

async function sampleWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("reporteInformadoGeneralXls");
  for (let i = 1; i <= 11; i += 1) {
    ws.addRow(["meta"]);
  }
  ws.addRow([
    "Código de Formato",
    "Nombre del Formato",
    "Código Concepto",
    "Nombre Concepto",
    "Año Vigencia",
    "Periodo",
    "Número de Solicitud",
    "Estado",
    "NIT",
    "Nombre / Razón Social",
    "Tipo de Documento",
    "Número de Documento",
    "Dígito de Verificación",
    "Razón Social",
    "Rol Persona",
    "País",
    "Departamento",
    "Municipio",
    "Dirección",
    "Reportado Como",
    "CDT Rendimientos Causados ponderado por titular",
    "CDT Rendimientos Pagados",
    "Certificado - Total ingresos brutos rentas de trabajo y pensión",
    "Ingresos brutos Cuentas en participación",
    "Retención distribuida al tercero",
    "Total Saldo Final Periodo de la Cuenta",
  ]);
  ws.addRow([
    "2276",
    "Rentas de trabajo",
    "",
    "Sin Concepto",
    2025,
    1,
    1,
    "OK",
    "800000000",
    "UNIVERSIDAD",
    "C. C.",
    "1000000000",
    "",
    "PEREZ GOMEZ ANA MARIA",
    "Informado",
    "COLOMBIA",
    "",
    "",
    "",
    "",
    "",
    "",
    711750,
  ]);
  ws.addRow([
    "1020",
    "CDT",
    "",
    "",
    2025,
    1,
    1,
    "OK",
    "800000001",
    "NU",
    "C. C.",
    "1000000000",
    "",
    "PEREZ GOMEZ ANA MARIA",
    "Informado",
    "COLOMBIA",
    "",
    "",
    "",
    "",
    12000,
    0,
  ]);
  ws.addRow([
    "5248",
    "CTP",
    "4030",
    "ctp",
    2025,
    1,
    1,
    "OK",
    "800000002",
    "IMEVI",
    "C. C.",
    "1000000000",
    "",
    "PEREZ GOMEZ ANA MARIA",
    "Informado",
    "COLOMBIA",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    70000,
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("uvt and tarif", () => {
  it("uses UVT 2025", () => {
    expect(uvt(2025)).toBe(49799);
  });
  it("taxes zero below first bracket", () => {
    expect(taxFromUvtTable(0, 2025)).toBe(0);
    expect(taxFromUvtTable(1000, 2025)).toBe(0);
  });
  it("applies 19% after 1090 UVT", () => {
    const tax = taxFromUvtTable(2000 * 49799, 2025);
    expect(tax).toBeGreaterThan(0);
  });
});

describe("exogena parser", () => {
  it("maps 2276 trabajo, 1020 rendimientos and 5248 no laboral", async () => {
    const parsed = await parseExogenaWorkbook(await sampleWorkbook());
    expect(parsed.taxpayer.documentNumber).toBe("1000000000");
    expect(parsed.taxpayer.suggestedForm).toBe("210");
    const trabajo = parsed.lines.filter((l) => l.formato === "2276");
    expect(trabajo[0]?.monto).toBe(711750);
    expect(trabajo[0]?.kind).toBe("trabajo_ingreso");
    expect(parsed.lines.some((l) => l.formato === "1020" && l.kind === "capital_rendimiento")).toBe(true);
    expect(parsed.lines.some((l) => l.formato === "5248" && l.monto === 70000)).toBe(true);
  });

  it("parses complementary csv", () => {
    const lines = parseCsvComplement("entidad,concepto,valor\nBancolombia,rendimientos,1500\n", "b.csv");
    expect(lines[0]?.monto).toBe(1500);
    expect(lines[0]?.kind).toBe("ambiguous");
  });

  it("extracts amounts from pdf text", () => {
    const lines = parsePdfTextAsLines("Certificado $1.250.000", "c.pdf");
    expect(lines[0]?.monto).toBe(1250000);
  });
});

describe("form engines", () => {
  const lines: ExogenaLine[] = [
    line({ monto: 711750, kind: "trabajo_ingreso", formato: "2276", tipoMonto: "Certificado - Total ingresos brutos rentas de trabajo y pensión" }),
    line({ monto: 12000, kind: "capital_rendimiento", formato: "1020", tipoMonto: "CDT Rendimientos Causados ponderado por titular" }),
    line({ monto: 70000, kind: "no_laboral_ingreso", formato: "5248", tipoMonto: "Ingresos brutos Cuentas en participación" }),
    line({ monto: 500000, kind: "patrimonio_activo", tipoMonto: "Total Saldo Final Periodo de la Cuenta" }),
    line({ monto: 8000, kind: "retencion", formato: "1001", tipoMonto: "retencion_renta" }),
  ];

  it("210: patrimonio líquido and work income", () => {
    const cas = build210(taxpayer, lines);
    const get = (id: string) => cas.find((c) => c.id === id)?.value;
    expect(get("32")).toBe(711750);
    expect(get("58")).toBe(12000);
    expect(get("74")).toBe(70000);
    expect(get("29")).toBe(500000);
    expect(get("31")).toBe(500000);
    expect(get("132")).toBe(8000);
    expect(Number(get("42"))).toBeGreaterThan(0);
  });

  it("210 recalc honors overrides then recomputes 31", () => {
    const cas = recalc("210", taxpayer, lines, { 29: 800000, 30: 100000, 32: 711750 });
    expect(cas.find((c) => c.id === "31")?.value).toBe(700000);
  });

  it("110: 44 = sum assets, 46 = 44-45, 58 = ingresos", () => {
    const juridico: Taxpayer = { ...taxpayer, suggestedForm: "110", documentType: "NIT" };
    const cas = build110(juridico, lines);
    const get = (id: string) => Number(cas.find((c) => c.id === id)?.value);
    expect(get("44")).toBe(get("36") + get("37"));
    expect(get("46")).toBe(get("44") - get("45"));
    expect(get("58")).toBe(get("47") + get("48") + get("57"));
    expect(get("61")).toBe(get("58") - get("59") - get("60"));
    expect(get("79")).toBe(Math.max(get("75"), get("76")));
  });
});

describe("openrouter fallback", () => {
  it("exposes three free models", () => {
    expect(OPENROUTER_FREE_MODELS).toHaveLength(3);
    expect(OPENROUTER_FREE_MODELS.every((m) => m.endsWith(":free"))).toBe(true);
  });

  it("extracts JSON from fences", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("falls back to the second model", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n += 1;
      if (n === 1) {
        return new Response("busy", { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }), { status: 200 });
    };
    const out = await chatWithFallback([{ role: "user", content: "hi" }], fetchImpl);
    expect(out.model).toBe(OPENROUTER_FREE_MODELS[1]);
    expect(out.attempts).toEqual([OPENROUTER_FREE_MODELS[0], OPENROUTER_FREE_MODELS[1]]);
  });

  it("exhausts the chain", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl: typeof fetch = async () => new Response("no", { status: 500 });
    await expect(chatWithFallback([{ role: "user", content: "hi" }], fetchImpl)).rejects.toThrow(/exhausted/);
  });
});

describe("rag corpus", () => {
  it("finds art 336 for exentas", () => {
    const hits = searchLocalCorpus("límite rentas exentas cuarenta por ciento mil trescientas cuarenta UVT");
    expect(hits[0]?.article).toBe("336");
  });
});

describe("overrides and classify fallback", () => {
  it("marks edited casillas", async () => {
    const { applyOverrides } = await import("@/lib/engine/forms");
    const cas = build210(taxpayer, [
      line({
        monto: 100,
        kind: "trabajo_ingreso",
        formato: "2276",
        tipoMonto: "Certificado - Total ingresos brutos rentas de trabajo y pensión",
      }),
    ]);
    const next = applyOverrides(cas, { "32": 1 });
    expect(next.find((c) => c.id === "32")?.source).toContain("Editado");
  });

  it("classifies ambiguous lines as no laboral without API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { classifyAmbiguousLines } = await import("@/lib/rag/classify");
    const out = await classifyAmbiguousLines([
      line({ monto: 10, kind: "ambiguous", tipoMonto: "complementario" }),
    ]);
    expect(out[0]?.kind).toBe("no_laboral_ingreso");
  });
});

describe("pdf overlay", () => {
  it("converts top-left y to pdf-lib y", () => {
    expect(pdfY(0, 8)).toBe(784);
  });

  it("formats money with es-CO thousands", () => {
    const c: Casilla = { id: "32", label: "x", value: 711750, computed: false, source: "", citations: [] };
    expect(formatCasillaValue(c, "money")).toMatch(/711/);
  });

  it("places 110 casilla 32-equivalent 47 inside mapped box", () => {
    const box = fieldBox("110", "47");
    expect(box).toBeTruthy();
    expect(box!.w).toBeGreaterThan(50);
  });

  it("writes marker values onto official templates", async () => {
    const cas: Casilla[] = [
      { id: "1", label: "Año", value: "2025", computed: false, source: "", citations: [] },
      { id: "32", label: "trabajo", value: 999999, computed: false, source: "", citations: [] },
      { id: "47", label: "ing", value: 888888, computed: false, source: "", citations: [] },
    ];
    const bytes210 = await fillFormPdf("210", cas);
    const bytes110 = await fillFormPdf("110", cas);
    expect(bytes210.byteLength).toBeGreaterThan(1000);
    expect(bytes110.byteLength).toBeGreaterThan(1000);
    const { PDFDocument } = await import("pdf-lib");
    const d = await PDFDocument.load(bytes210, { ignoreEncryption: true });
    expect(d.getPageCount()).toBe(1);
  });

  it("does not overlap adjacent 110 money boxes on x", () => {
    const a = fieldBox("110", "36")!;
    const b = fieldBox("110", "77")!;
    expect(a.x + a.w).toBeLessThan(b.x + 5);
  });
});
