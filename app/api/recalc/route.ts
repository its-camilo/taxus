import { NextResponse } from "next/server";
import { recalc } from "@/lib/engine/forms";
import type { ExogenaLine, FormCode, Taxpayer } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    form: FormCode;
    taxpayer: Taxpayer;
    lines: ExogenaLine[];
    overrides: Record<string, number>;
    textOverrides?: Record<string, string>;
  };
  const casillas = recalc(
    body.form,
    body.taxpayer,
    body.lines,
    body.overrides ?? {},
    body.textOverrides ?? {},
  );
  return NextResponse.json({ casillas });
}
