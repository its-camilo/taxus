import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Casilla, FormCode } from "../types";
import coords110 from "./coords-110.json";
import coords210 from "./coords-210.json";

export type FieldCoord = {
  x: number;
  y: number;
  w: number;
  size: number;
  align: "left" | "right";
  kind: "text" | "money";
};

const PAGE_H = 792;

function formatMoney(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("es-CO");
}

export function pdfY(topY: number, size: number): number {
  return PAGE_H - topY - size;
}

export function formatCasillaValue(casilla: Casilla, kind: FieldCoord["kind"]): string {
  if (kind === "money") {
    const n = typeof casilla.value === "number" ? casilla.value : Number(String(casilla.value).replace(/\D/g, ""));
    if (!Number.isFinite(n) || n === 0) {
      return "";
    }
    return formatMoney(n);
  }
  return String(casilla.value ?? "");
}

export function resolveTemplatePath(form: FormCode, cwd = process.cwd()): string {
  return path.join(cwd, "lib", "pdf", "templates", `form-${form}-p1.pdf`);
}

function sanitizePdfText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

export async function fillFormPdf(
  form: FormCode,
  casillas: Casilla[],
  options?: { templateBytes?: Uint8Array; cwd?: string },
): Promise<Uint8Array> {
  const bytes =
    options?.templateBytes ??
    new Uint8Array(await readFile(resolveTemplatePath(form, options?.cwd)));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = doc.getPages()[0];
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const coords = (form === "110" ? coords110 : coords210) as Record<string, FieldCoord>;

  for (const casilla of casillas) {
    const box = coords[casilla.id];
    if (!box) {
      continue;
    }
    const raw = formatCasillaValue(casilla, box.kind);
    if (!raw) {
      continue;
    }
    const text = box.kind === "text" ? sanitizePdfText(raw) : raw;
    if (!text) {
      continue;
    }
    const size = box.size;
    const width = font.widthOfTextAtSize(text, size);
    const x = box.align === "right" ? box.x + box.w - width - 2 : box.x + 2;
    page.drawText(text, {
      x: Math.max(box.x, x),
      y: pdfY(box.y, size),
      size,
      font,
      color: rgb(0.05, 0.07, 0.18),
    });
  }

  return doc.save();
}

export function fieldBox(form: FormCode, id: string): FieldCoord | undefined {
  const coords = (form === "110" ? coords110 : coords210) as Record<string, FieldCoord>;
  return coords[id];
}
