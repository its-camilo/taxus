import { NextResponse } from "next/server";
import { fillFormPdf } from "@/lib/pdf/overlay";
import type { Casilla, FormCode } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { form: FormCode; casillas: Casilla[] };
  const bytes = await fillFormPdf(body.form, body.casillas);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new NextResponse(copy, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="formulario-${body.form}.pdf"`,
    },
  });
}
