export type FormCode = "110" | "210";

export type AmountKind =
  | "trabajo_ingreso"
  | "capital_rendimiento"
  | "no_laboral_ingreso"
  | "patrimonio_activo"
  | "patrimonio_pasivo"
  | "retencion"
  | "ignore"
  | "ambiguous";

export type ExogenaLine = {
  formato?: string;
  concepto?: string;
  conceptoNombre?: string;
  informante: string;
  nitInformante?: string;
  monto: number;
  tipoMonto: string;
  kind: AmountKind;
  evidencia: string;
};

export type Taxpayer = {
  year: number;
  documentType: string;
  documentNumber: string;
  dv?: string;
  fullName: string;
  firstLastName?: string;
  secondLastName?: string;
  firstName?: string;
  otherNames?: string;
  suggestedForm: FormCode;
};

export type ParseResult = {
  taxpayer: Taxpayer;
  lines: ExogenaLine[];
  warnings: string[];
};

export type Casilla = {
  id: string;
  label: string;
  value: string | number;
  computed: boolean;
  source: string;
  citations: string[];
};

export type DeclarationDraft = {
  form: FormCode;
  year: number;
  taxpayer: Taxpayer;
  casillas: Casilla[];
  lines: ExogenaLine[];
  reviews?: { pass: number; label: string; ok: boolean; notes: string[] }[];
};
