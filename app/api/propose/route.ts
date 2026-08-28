import { NextResponse } from "next/server";
import { toDraft } from "@/lib/engine/forms";
import { classifyAmbiguousLines } from "@/lib/rag/classify";
import { tripleReviewSources } from "@/lib/rag/triple-review";
import type { ExogenaLine, FormCode, Taxpayer } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    form: FormCode;
    taxpayer: Taxpayer;
    lines: ExogenaLine[];
  };
  const classified = await classifyAmbiguousLines(body.lines ?? []);
  const reviewed = await tripleReviewSources(classified, body.taxpayer, body.form);
  const draft = toDraft(body.form, body.taxpayer, reviewed.lines);
  return NextResponse.json({ ...draft, reviews: reviewed.passes });
}
