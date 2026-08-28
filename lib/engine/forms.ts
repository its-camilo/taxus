import type { Casilla, DeclarationDraft, ExogenaLine, FormCode, Taxpayer } from "../types";
import { CORPORATE_RATE, taxFromUvtTable, uvt } from "./uvt";

export const LABELS_210: Record<string, string> = {
  "1": "Año gravable",
  "5": "NIT / documento",
  "6": "DV",
  "7": "Primer apellido",
  "8": "Segundo apellido",
  "9": "Primer nombre",
  "10": "Otros nombres",
  "24": "Actividad económica",
  "29": "Patrimonio bruto",
  "30": "Deudas",
  "31": "Patrimonio líquido (29-30)",
  "32": "Ingresos brutos rentas de trabajo",
  "33": "INCRNGO rentas de trabajo",
  "34": "Renta líquida rentas de trabajo",
  "35": "Aportes voluntarios AFC/FVP trabajo",
  "36": "Otras rentas exentas trabajo",
  "37": "Total rentas exentas trabajo",
  "40": "Deducciones imputables trabajo",
  "41": "Exentas y deducciones limitadas trabajo",
  "42": "Renta líquida ordinaria trabajo",
  "43": "Ingresos trabajo sin relación laboral",
  "58": "Ingresos brutos rentas de capital",
  "59": "INCRNGO rentas de capital",
  "61": "Renta líquida capital",
  "73": "Renta líquida ordinaria capital",
  "74": "Ingresos brutos rentas no laborales",
  "78": "Renta líquida no laboral",
  "90": "Renta líquida ordinaria no laboral",
  "91": "Renta líquida cédula general",
  "97": "Renta líquida gravable cédula general",
  "98": "Renta presuntiva",
  "99": "Ingresos cédula de pensiones",
  "104": "Dividendos y participaciones",
  "112": "Ingresos ganancias ocasionales",
  "116": "Impuesto cédula general",
  "121": "Total impuesto rentas líquidas gravables",
  "126": "Impuesto neto de renta",
  "132": "Retenciones año gravable",
  "136": "Total saldo a pagar",
  "137": "Total saldo a favor",
  "980": "Pago total",
};

export const LABELS_110: Record<string, string> = {
  "1": "Año gravable",
  "5": "NIT",
  "6": "DV",
  "11": "Razón social",
  "24": "Actividad económica",
  "36": "Efectivo y equivalentes",
  "37": "Inversiones",
  "44": "Total patrimonio bruto",
  "45": "Pasivos",
  "46": "Total patrimonio líquido",
  "47": "Ingresos brutos actividades ordinarias",
  "48": "Ingresos financieros",
  "57": "Otros ingresos",
  "58": "Total ingresos brutos",
  "59": "Devoluciones, rebajas y descuentos",
  "60": "INCRNGO",
  "61": "Total ingresos netos",
  "62": "Costos",
  "67": "Total costos y gastos deducibles",
  "72": "Renta líquida ordinaria del ejercicio",
  "75": "Renta líquida",
  "76": "Renta presuntiva",
  "79": "Renta líquida gravable",
  "84": "Impuesto sobre rentas líquidas gravables",
  "94": "Impuesto neto de renta",
  "99": "Total impuesto a cargo",
  "106": "Otras retenciones",
  "111": "Saldo a pagar por impuesto",
  "113": "Total saldo a pagar",
  "114": "Total saldo a favor",
  "980": "Pago total",
};

function money(n: number): number {
  return Math.max(0, Math.round(n));
}

function sum(lines: ExogenaLine[], kind: ExogenaLine["kind"], headerMatch?: RegExp): number {
  return lines
    .filter((l) => l.kind === kind && (!headerMatch || headerMatch.test(l.tipoMonto)))
    .reduce((a, l) => a + l.monto, 0);
}

function c(
  id: string,
  labels: Record<string, string>,
  value: string | number,
  source: string,
  computed = false,
  citations: string[] = [],
): Casilla {
  return {
    id,
    label: labels[id] ?? `Casilla ${id}`,
    value,
    computed,
    source,
    citations,
  };
}

export function build210(
  taxpayer: Taxpayer,
  lines: ExogenaLine[],
  overrides: Record<string, number> = {},
  textOverrides: Record<string, string> = {},
): Casilla[] {
  const labels = LABELS_210;
  const year = taxpayer.year;
  const trabajo = sum(lines, "trabajo_ingreso", /ingresos brutos|trabajo y pensión/i) || sum(lines, "trabajo_ingreso");
  const capitalRend = lines
    .filter((l) => l.formato === "1020" || l.formato === "1021")
    .filter((l) => /rendim/i.test(l.tipoMonto))
    .reduce((a, l) => a + l.monto, 0);
  const noLab = sum(lines, "no_laboral_ingreso", /ingresos|ingreso distribuido/i);
  const patrimonio = lines
    .filter((l) => l.kind === "patrimonio_activo" && /saldo final/i.test(l.tipoMonto))
    .reduce((a, l) => a + l.monto, 0);
  const rete = sum(lines, "retencion");

  const raw: Record<string, number> = {
    29: patrimonio,
    30: 0,
    32: trabajo,
    33: 0,
    35: 0,
    36: 0,
    40: 0,
    43: 0,
    58: capitalRend,
    59: 0,
    74: noLab,
    98: 0,
    99: 0,
    104: 0,
    112: 0,
    132: rete,
    ...overrides,
  };

  raw[31] = money(raw[29] - raw[30]);
  const exempt25 = money(Math.min((raw[32] - raw[33]) * 0.25, 790 * uvt(year)));
  raw[36] = raw[36] || exempt25;
  raw[37] = money(raw[35] + raw[36]);
  const rlTrabajo = money(raw[32] - raw[33]);
  raw[34] = rlTrabajo;
  const limit40 = money(Math.min((rlTrabajo - raw[43]) * 0.4, 1340 * uvt(year)));
  raw[41] = money(Math.min(raw[37] + raw[40], limit40, rlTrabajo));
  raw[42] = money(Math.max(0, rlTrabajo - raw[41]));
  raw[61] = money(raw[58] - raw[59]);
  raw[73] = raw[61];
  raw[78] = money(raw[74]);
  raw[90] = raw[78];
  raw[91] = money(raw[42] + raw[73] + raw[90]);
  raw[97] = money(Math.max(raw[91], raw[98]));
  raw[116] = taxFromUvtTable(raw[97], year);
  raw[121] = raw[116];
  raw[126] = raw[121];
  const net = money(raw[126] - raw[132]);
  raw[136] = net > 0 ? net : 0;
  raw[137] = net < 0 ? money(-net) : 0;
  raw[980] = raw[136];

  const order = [
    "1", "5", "6", "7", "8", "9", "10", "29", "30", "31", "32", "33", "34", "35", "36", "37",
    "40", "41", "42", "43", "58", "59", "61", "73", "74", "78", "90", "91", "97", "98",
    "99", "104", "112", "116", "121", "126", "132", "136", "137", "980",
  ];
  const text: Record<string, string> = {
    "1": String(year),
    "5": taxpayer.documentNumber,
    "6": taxpayer.dv ?? "",
    "7": taxpayer.firstLastName ?? "",
    "8": taxpayer.secondLastName ?? "",
    "9": taxpayer.firstName ?? "",
    "10": taxpayer.otherNames ?? "",
    ...textOverrides,
  };
  const sources: Record<string, string> = {
    "32": "Formato 2276 — rentas de trabajo",
    "58": "Formatos 1020/1021 — rendimientos",
    "74": "Formatos 5248/1007/1647",
    "29": "Saldos de cuentas e inversiones (1019/1020/1021)",
    "132": "Retenciones 1001/1647/CDT",
    "36": "Renta exenta 25% art. 206 num. 10 E.T.",
    "41": "Límite 40% / 1.340 UVT art. 336 E.T.",
    "116": "Tarifa art. 241 E.T.",
  };
  return order.map((id) => {
    if (text[id] !== undefined) {
      return c(id, labels, text[id], "Identificación del informado", false);
    }
    const computed = ["31", "34", "37", "41", "42", "61", "73", "78", "90", "91", "97", "116", "121", "126", "136", "137", "980"].includes(id);
    return c(id, labels, money(raw[Number(id)] ?? 0), sources[id] ?? (computed ? "Calculado" : "Información exógena"), computed, sources[id] ? [sources[id]] : []);
  });
}

export function build110(
  taxpayer: Taxpayer,
  lines: ExogenaLine[],
  overrides: Record<string, number> = {},
  textOverrides: Record<string, string> = {},
): Casilla[] {
  const labels = LABELS_110;
  const ingresosOrd = sum(lines, "no_laboral_ingreso") + sum(lines, "trabajo_ingreso");
  const financieros = lines.filter((l) => /rendim/i.test(l.tipoMonto)).reduce((a, l) => a + l.monto, 0);
  const efectivo = lines
    .filter((l) => l.kind === "patrimonio_activo" && /saldo final/i.test(l.tipoMonto))
    .reduce((a, l) => a + l.monto, 0);
  const rete = sum(lines, "retencion");
  const raw: Record<string, number> = {
    36: efectivo,
    37: 0,
    45: 0,
    47: ingresosOrd,
    48: financieros,
    57: 0,
    59: 0,
    60: 0,
    62: 0,
    76: 0,
    106: rete,
    ...overrides,
  };
  raw[44] = money(raw[36] + raw[37]);
  raw[46] = money(raw[44] - raw[45]);
  raw[58] = money(raw[47] + raw[48] + raw[57]);
  raw[61] = money(raw[58] - raw[59] - raw[60]);
  raw[67] = money(raw[62]);
  raw[72] = money(raw[61] - raw[67]);
  raw[75] = raw[72];
  raw[79] = money(Math.max(raw[75], raw[76]));
  raw[84] = money(raw[79] * CORPORATE_RATE);
  raw[94] = raw[84];
  raw[99] = raw[94];
  const net = money(raw[99] - raw[106]);
  raw[111] = net > 0 ? net : 0;
  raw[113] = raw[111];
  raw[114] = net < 0 ? money(-net) : 0;
  raw[980] = raw[113];

  const order = ["1", "5", "6", "11", "36", "37", "44", "45", "46", "47", "48", "57", "58", "59", "60", "61", "62", "67", "72", "75", "76", "79", "84", "94", "99", "106", "111", "113", "114", "980"];
  const text: Record<string, string> = {
    "1": String(taxpayer.year),
    "5": taxpayer.documentNumber,
    "6": taxpayer.dv ?? "",
    "11": taxpayer.fullName,
    ...textOverrides,
  };
  return order.map((id) => {
    if (text[id] !== undefined) {
      return c(id, labels, text[id], "Identificación");
    }
    const computed = ["44", "46", "58", "61", "67", "72", "75", "79", "84", "94", "99", "111", "113", "114", "980"].includes(id);
    return c(id, labels, money(raw[Number(id)] ?? 0), computed ? "Calculado" : "Información exógena", computed);
  });
}

export function applyOverrides(
  casillas: Casilla[],
  overrides: Record<string, number | string>,
): Casilla[] {
  return casillas.map((c) => {
    if (overrides[c.id] === undefined) {
      return c;
    }
    return { ...c, value: overrides[c.id], computed: false, source: "Editado por el usuario" };
  });
}

export function taxpayerFromCasillas(form: FormCode, base: Taxpayer, textOverrides: Record<string, string>): Taxpayer {
  if (form === "110") {
    const fullName = textOverrides["11"] ?? base.fullName;
    return {
      ...base,
      year: Number(textOverrides["1"]) || base.year,
      documentNumber: textOverrides["5"] ?? base.documentNumber,
      dv: textOverrides["6"] ?? base.dv,
      fullName,
    };
  }
  const firstLastName = textOverrides["7"] ?? base.firstLastName;
  const secondLastName = textOverrides["8"] ?? base.secondLastName;
  const firstName = textOverrides["9"] ?? base.firstName;
  const otherNames = textOverrides["10"] ?? base.otherNames;
  const fullName =
    [firstLastName, secondLastName, firstName, otherNames].filter(Boolean).join(" ") || base.fullName;
  return {
    ...base,
    year: Number(textOverrides["1"]) || base.year,
    documentNumber: textOverrides["5"] ?? base.documentNumber,
    dv: textOverrides["6"] ?? base.dv,
    firstLastName,
    secondLastName,
    firstName,
    otherNames,
    fullName,
  };
}

export function recalc(
  form: FormCode,
  taxpayer: Taxpayer,
  lines: ExogenaLine[],
  overrides: Record<string, number>,
  textOverrides: Record<string, string> = {},
): Casilla[] {
  const tp = taxpayerFromCasillas(form, taxpayer, textOverrides);
  return form === "110"
    ? build110(tp, lines, overrides, textOverrides)
    : build210(tp, lines, overrides, textOverrides);
}

export function toDraft(form: FormCode, taxpayer: Taxpayer, lines: ExogenaLine[]): DeclarationDraft {
  return {
    form,
    year: taxpayer.year,
    taxpayer,
    lines,
    casillas: form === "110" ? build110(taxpayer, lines) : build210(taxpayer, lines),
  };
}
