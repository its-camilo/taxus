import ExcelJS from "exceljs";
import type { AmountKind, ExogenaLine, ParseResult, SheetSummary, Taxpayer } from "../types";

const FORMAT_KIND: Record<string, AmountKind> = {
  "2276": "trabajo_ingreso",
  "1020": "capital_rendimiento",
  "1021": "capital_rendimiento",
  "5248": "no_laboral_ingreso",
  "1007": "no_laboral_ingreso",
  "1647": "no_laboral_ingreso",
  "1019": "patrimonio_activo",
  "2273": "patrimonio_activo",
  "1008": "patrimonio_activo",
  "1023": "ignore",
  "1006": "ignore",
};

const MONEY_HEADERS: Record<string, string[]> = {
  "2276": [
    "Certificado - Total ingresos brutos rentas de trabajo y pensión",
  ],
  "1020": [
    "CDT Rendimientos Causados ponderado por titular",
    "CDT Rendimientos Pagados",
    "CDT Retención prácticada",
    "Total Retención fuente  CDT MES",
    "CDT Saldo Final ponderado por titular",
  ],
  "1021": [
    "Inversiones  durante el año en Carteras Colectivas",
    "Rendimientos Causados Cartera Colectiva",
    "Saldo Final Cartera Colectiva",
  ],
  "5248": ["Ingresos brutos Cuentas en participación"],
  "1007": [
    "Compra, Costo o Gasto operacional",
    "Compra, Costo  o Gasto no operacional",
  ],
  "1647": [
    "Ingreso distribuido al tercero",
    "Retención distribuida al tercero",
  ],
  "1019": [
    "Total Saldo Final Periodo de la Cuenta",
    "Saldo Final Periodo.Cuenta ahorros GMF Num.1 Art 879 E.T.",
    "Saldo Final Periodo.Depósito Electrónico exento GMF Num.1 Art 879 E.T.",
    "Saldo Final Periodo.Depósito Electrónico exento GMF Otros conceptos",
  ],
  "2273": ["Saldo total Deceval", "Saldo final título Mes"],
  "1008": ["Cuenta por pagar como cliente"],
};

function cellStr(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function cellNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function splitName(full: string): Pick<Taxpayer, "firstLastName" | "secondLastName" | "firstName" | "otherNames"> {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length >= 4) {
    return {
      firstLastName: parts[0],
      secondLastName: parts[1],
      firstName: parts[2],
      otherNames: parts.slice(3).join(" "),
    };
  }
  if (parts.length === 3) {
    return { firstLastName: parts[0], secondLastName: parts[1], firstName: parts[2] };
  }
  if (parts.length === 2) {
    return { firstLastName: parts[0], firstName: parts[1] };
  }
  return { firstName: full };
}

function detectForm(docType: string): Taxpayer["suggestedForm"] {
  const t = docType.toUpperCase().replace(/\s/g, "");
  if (t.includes("NIT") || t.includes("N.I.T")) {
    return "110";
  }
  return "210";
}

function headerValue(row: ExcelJS.Row, col = 3): string {
  return cellStr(row.getCell(col).value);
}

function extractHeaderTaxpayer(sheet: ExcelJS.Worksheet): Pick<
  Taxpayer,
  "year" | "documentType" | "documentNumber" | "fullName" | "firstLastName" | "secondLastName" | "firstName" | "otherNames" | "suggestedForm"
> {
  let year = new Date().getFullYear() - 1;
  let documentType = "C.C.";
  let documentNumber = "";
  let fullName = "";

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 11) {
      return;
    }
    const label = cellStr(row.getCell(1).value).toLowerCase();
    const value = headerValue(row) || headerValue(row, 2);
    if (!label) {
      return;
    }
    if (label.startsWith("año") && /^\d{4}$/.test(value)) {
      year = Number(value);
      return;
    }
    if (label.includes("tipo de documento") && value) {
      documentType = value;
      return;
    }
    if (label.includes("identificación") && value) {
      documentNumber = value.replace(/\s/g, "");
      return;
    }
    if ((label.includes("nombres") || label.includes("razón social")) && value && !label.includes("tipo")) {
      fullName = value;
    }
  });

  return {
    year,
    documentType,
    documentNumber,
    fullName,
    ...splitName(fullName),
    suggestedForm: detectForm(documentType),
  };
}

function headerIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) {
      map[h.trim()] = i;
    }
  });
  return map;
}

function pick(row: unknown[], idx: Record<string, number>, name: string): unknown {
  const i = idx[name];
  return i === undefined ? undefined : row[i];
}

function kindForHeader(formato: string, header: string): AmountKind {
  const base = FORMAT_KIND[formato] ?? "ambiguous";
  const h = header.toLowerCase();
  if (h.includes("retenci")) {
    return "retencion";
  }
  if (h.includes("saldo")) {
    return "patrimonio_activo";
  }
  if (formato === "1007") {
    return "ambiguous";
  }
  return base;
}

function parseSheet1001(sheet: ExcelJS.Worksheet, sheetName: string): ExogenaLine[] {
  const lines: ExogenaLine[] = [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell.value);
  });
  const idx = headerIndex(headers);
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.value;
    });
    const informante = cellStr(
      pick(values, idx, "Razón Social Informante") ?? pick(values, idx, "Nombre / Razón Social"),
    );
    if (!informante) {
      return;
    }
    const rete = cellNum(pick(values, idx, "Retención en la fuente practicada renta (cas40)"));
    if (rete) {
      lines.push({
        formato: "1001",
        concepto: cellStr(pick(values, idx, "Cód. Concepto")),
        conceptoNombre: cellStr(pick(values, idx, "Desc. Concepto")),
        informante,
        monto: rete,
        tipoMonto: "retencion_renta",
        kind: "retencion",
        evidencia: `1001 ${informante}`,
        sheetName,
      });
    }
    for (const [header, i] of Object.entries(idx)) {
      if (i === undefined || !/retenci|pago|valor|monto/i.test(header)) {
        continue;
      }
      const monto = cellNum(values[i]);
      if (monto === 0 || header.includes("Retención en la fuente practicada renta (cas40)")) {
        continue;
      }
      lines.push({
        formato: "1001",
        concepto: cellStr(pick(values, idx, "Cód. Concepto")),
        conceptoNombre: header,
        informante,
        monto,
        tipoMonto: header,
        kind: /retenci/i.test(header) ? "retencion" : "ambiguous",
        evidencia: `1001 ${informante} ${header}`,
        sheetName,
      });
    }
  });
  return lines;
}

function parseGenericSheet(sheet: ExcelJS.Worksheet, sheetName: string): ExogenaLine[] {
  const lines: ExogenaLine[] = [];
  const formatoMatch = sheetName.match(/\b(\d{4})\b/);
  const formatoHint = formatoMatch?.[1];
  let headerRowNum = 1;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 15) {
      return;
    }
    const first = cellStr(row.getCell(1).value).toLowerCase();
    if (
      first.includes("código de formato") ||
      first.includes("codigo de formato") ||
      first.includes("cód. concepto") ||
      first.includes("razón social")
    ) {
      headerRowNum = rowNumber;
    }
  });
  const headerRow = sheet.getRow(headerRowNum);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell.value);
  });
  const idx = headerIndex(headers);
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) {
      return;
    }
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.value;
    });
    const formato =
      cellStr(pick(values, idx, "Código de Formato")) ||
      formatoHint ||
      "";
    const informante = cellStr(
      pick(values, idx, "Nombre / Razón Social") ??
        pick(values, idx, "Razón Social Informante") ??
        pick(values, idx, "Razón Social"),
    );
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (!header) {
        continue;
      }
      const monto = cellNum(values[i]);
      if (monto === 0) {
        continue;
      }
      const isMoney =
        /monto|valor|ingreso|saldo|rendim|retenci|pago|total|compra|costo|gasto|invers/i.test(header) ||
        i >= 20;
      if (!isMoney) {
        continue;
      }
      const fmt = /^\d{4}$/.test(formato) ? formato : formatoHint ?? "hoja";
      lines.push({
        formato: fmt,
        informante: informante || sheetName,
        monto,
        tipoMonto: header,
        kind: fmt in FORMAT_KIND ? kindForHeader(fmt, header) : "ambiguous",
        evidencia: `${sheetName} ${header}`,
        sheetName,
      });
    }
  });
  return lines;
}

function dedupeLines(lines: ExogenaLine[]): ExogenaLine[] {
  const seen = new Set<string>();
  const out: ExogenaLine[] = [];
  for (const line of lines) {
    const key = `${line.sheetName ?? ""}|${line.formato ?? ""}|${line.tipoMonto}|${line.monto}|${line.informante}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return out;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  let headerRow = 12;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 20) {
      return;
    }
    const first = cellStr(row.getCell(1).value).toLowerCase();
    if (first.includes("código de formato") || first === "codigo de formato") {
      headerRow = rowNumber;
    }
  });
  return headerRow;
}

export async function parseExogenaWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings: string[] = [];
  const allLines: ExogenaLine[] = [];
  const sheets: SheetSummary[] = [];

  const general = wb.worksheets.find((s) =>
    s.name.toLowerCase().includes("reporteinformadogeneral"),
  );

  for (const sheet of wb.worksheets) {
    const sheetName = sheet.name.trim();
    const isGeneral = sheet.name.toLowerCase().includes("reporteinformadogeneral");
    const is1001 = sheet.name.toLowerCase().includes("1001");
    let sheetLines: ExogenaLine[] = [];

    if (isGeneral) {
      const headerRowNum = findHeaderRow(sheet);
      const headerRow = sheet.getRow(headerRowNum);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col - 1] = cellStr(cell.value);
      });
      const idx = headerIndex(headers);

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) {
          return;
        }
        const values: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          values[col - 1] = cell.value;
        });
        const formato = cellStr(pick(values, idx, "Código de Formato"));
        if (!formato || !/^\d+$/.test(formato)) {
          return;
        }
        const informante = cellStr(pick(values, idx, "Nombre / Razón Social"));
        const concepto = cellStr(pick(values, idx, "Código Concepto"));
        const conceptoNombre = cellStr(pick(values, idx, "Nombre Concepto"));
        const wanted = MONEY_HEADERS[formato] ?? [];
        const used = wanted.length > 0 ? wanted : headers.filter((h, i) => i >= 20 && cellNum(values[i]) !== 0);
        for (const header of used) {
          const i = idx[header];
          if (i === undefined) {
            continue;
          }
          const monto = cellNum(values[i]);
          if (monto === 0) {
            continue;
          }
          sheetLines.push({
            formato,
            concepto,
            conceptoNombre,
            informante,
            nitInformante: cellStr(pick(values, idx, "NIT")),
            monto,
            tipoMonto: header,
            kind: kindForHeader(formato, header),
            evidencia: `${formato} ${informante} ${header}`,
            sheetName,
          });
        }
      });
    } else if (is1001) {
      sheetLines = parseSheet1001(sheet, sheetName);
    } else {
      sheetLines = parseGenericSheet(sheet, sheetName);
    }

    sheets.push({
      name: sheetName,
      rowCount: sheet.rowCount,
      linesExtracted: sheetLines.length,
    });
    allLines.push(...sheetLines);
  }

  if (!general) {
    warnings.push("No se encontró la hoja reporteInformadoGeneralXls.");
  }

  const lines = dedupeLines(allLines);

  const header = general ? extractHeaderTaxpayer(general) : null;
  const first = general?.getRow(13);
  const docType = header?.documentType || cellStr(first?.getCell(11).value);
  const docNumber = header?.documentNumber || cellStr(first?.getCell(12).value);
  const fullName = header?.fullName || cellStr(first?.getCell(14).value);
  const year = header?.year || Number(first?.getCell(5).value) || new Date().getFullYear() - 1;

  const taxpayer: Taxpayer = {
    year,
    documentType: docType || "C.C.",
    documentNumber: docNumber,
    fullName,
    ...(header?.fullName
      ? {
          firstLastName: header.firstLastName,
          secondLastName: header.secondLastName,
          firstName: header.firstName,
          otherNames: header.otherNames,
        }
      : splitName(fullName)),
    suggestedForm: detectForm(docType || "C.C."),
  };

  if (lines.length === 0) {
    warnings.push("No se extrajeron montos. Verifique que el archivo sea información exógena DIAN.");
  }

  const emptySheets = sheets.filter((s) => s.linesExtracted === 0);
  if (emptySheets.length > 0) {
    warnings.push(`Hojas sin montos extraídos: ${emptySheets.map((s) => s.name).join(", ")}`);
  }

  return { taxpayer, lines, warnings, sheets };
}

export function parseCsvComplement(text: string, filename: string): ExogenaLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase());
  const montoIdx = headers.findIndex((h) => /monto|valor|amount/.test(h));
  const entIdx = headers.findIndex((h) => /entidad|banco|informante|nombre/.test(h));
  const concIdx = headers.findIndex((h) => /concepto|desc/.test(h));
  const lines: ExogenaLine[] = [];
  for (const row of rows.slice(1)) {
    const cols = row.split(/[,;\t]/);
    const monto = cellNum(cols[montoIdx] ?? cols[cols.length - 1]);
    if (!monto) {
      continue;
    }
    const concepto = concIdx >= 0 ? cols[concIdx] : filename;
    lines.push({
      informante: entIdx >= 0 ? cols[entIdx] : filename,
      monto,
      tipoMonto: "complementario",
      concepto,
      kind: "ambiguous",
      evidencia: `csv:${filename}`,
    });
  }
  return lines;
}

export function parsePdfTextAsLines(text: string, filename: string): ExogenaLine[] {
  const amounts = [...text.matchAll(/\$?\s*([\d.]{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?/g)];
  const lines: ExogenaLine[] = [];
  for (const m of amounts.slice(0, 40)) {
    const monto = Number(m[1].replace(/\./g, ""));
    if (monto >= 1000) {
      lines.push({
        informante: filename,
        monto,
        tipoMonto: "pdf_texto",
        kind: "ambiguous",
        evidencia: `pdf:${filename}`,
      });
    }
  }
  return lines;
}
