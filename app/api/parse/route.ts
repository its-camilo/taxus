import { NextResponse } from "next/server";
import { parseCsvComplement, parseExogenaWorkbook, parsePdfTextAsLines } from "@/lib/exogena/parse";
import { extractText } from "unpdf";
import type { ExogenaLine, ExternalDocSummary, FormCode } from "@/lib/types";

export const maxDuration = 60;

function asForm(v: string | null): FormCode | "auto" {
  if (v === "110" || v === "210" || v === "auto") {
    return v;
  }
  return "auto";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Suba al menos un archivo" }, { status: 400 });
  }
  const requested = asForm(String(form.get("form") ?? "auto"));
  let lines: ExogenaLine[] = [];
  let taxpayer = {
    year: new Date().getFullYear() - 1,
    documentType: "C.C.",
    documentNumber: "",
    fullName: "",
    suggestedForm: "210" as FormCode,
  };
  const warnings: string[] = [];
  const sheets: { name: string; rowCount: number; linesExtracted: number }[] = [];
  const externalDocs: ExternalDocSummary[] = [];

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const parsed = await parseExogenaWorkbook(buf);
      if (parsed.lines.length > 0) {
        taxpayer = parsed.taxpayer;
        lines = lines.concat(parsed.lines);
      } else {
        warnings.push(`${file.name}: sin filas de exógena reconocidas`);
      }
      warnings.push(...parsed.warnings);
      sheets.push(...parsed.sheets);
    } else if (name.endsWith(".csv")) {
      const text = new TextDecoder().decode(buf);
      const csvLines = parseCsvComplement(text, file.name);
      lines = lines.concat(csvLines);
      externalDocs.push({ name: file.name, type: "csv", linesExtracted: csvLines.length });
    } else if (name.endsWith(".pdf")) {
      try {
        const extracted = await extractText(new Uint8Array(buf));
        const raw = (extracted as { text?: unknown }).text ?? extracted;
        const joined = Array.isArray(raw) ? raw.join("\n") : String(raw);
        const pdfLines = parsePdfTextAsLines(joined, file.name);
        lines = lines.concat(pdfLines);
        externalDocs.push({ name: file.name, type: "pdf", linesExtracted: pdfLines.length });
      } catch {
        warnings.push(`${file.name}: no se pudo leer el texto del PDF`);
      }
    } else {
      warnings.push(`${file.name}: extensión no soportada`);
    }
  }

  const formCode: FormCode = requested === "auto" ? taxpayer.suggestedForm : requested;
  return NextResponse.json({
    taxpayer: { ...taxpayer, suggestedForm: formCode },
    lines,
    warnings,
    sheets,
    externalDocs,
    form: formCode,
  });
}
