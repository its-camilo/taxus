import { NextResponse } from "next/server";
import { toDraft } from "@/lib/engine/forms";
import { classifyAmbiguousLines } from "@/lib/rag/classify";
import type { ExogenaLine, FormCode, Taxpayer } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    form: FormCode;
    taxpayer: Taxpayer;
    lines: ExogenaLine[];
  };
  const lines = await classifyAmbiguousLines(body.lines ?? []);
  const draft = toDraft(body.form, body.taxpayer, lines);
  return NextResponse.json(draft);
}
