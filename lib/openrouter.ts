export const OPENROUTER_FREE_MODELS = [
  "z-ai/glm-5.2:free",
  "minimax/minimax-m3:free",
  "google/gemma-4-31b-it:free",
] as const;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OpenRouterSuccess = {
  model: string;
  content: string;
  attempts: string[];
};

function modelsFromEnv(): string[] {
  const extra = process.env.OPENROUTER_FREE_MODELS;
  if (extra) {
    return extra.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [...OPENROUTER_FREE_MODELS];
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object in model output");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export async function chatWithFallback(
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterSuccess> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  const attempts: string[] = [];
  const models = modelsFromEnv();
  let lastError = "no models";
  for (const model of models) {
    attempts.push(model);
    try {
      const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://taxus.vercel.app",
          "X-Title": "Taxus",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1200,
          temperature: 0.1,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `${model} HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) {
        lastError = `${model} HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) {
        lastError = `${model} empty`;
        continue;
      }
      return { model, content, attempts };
    } catch (err) {
      lastError = `${model} ${err instanceof Error ? err.message : "error"}`;
    }
  }
  throw new Error(`OpenRouter fallback exhausted: ${lastError} [${attempts.join(" -> ")}]`);
}
