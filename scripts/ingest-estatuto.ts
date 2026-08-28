import { ESTATUTO_CORPUS } from "../lib/rag/estatuto";

const INDEX = "taxus-estatuto";
const NS = "et-nacional";

async function main() {
  const key = process.env.PINECONE_API_KEY;
  const host = process.env.PINECONE_HOST ?? "https://taxus-estatuto-dfebtv3.svc.aped-4627-b74a.pinecone.io";
  if (!key) {
    console.log("PINECONE_API_KEY missing; skip upsert (local corpus still works).");
    return;
  }
  const records = ESTATUTO_CORPUS.map((a) => ({
    _id: a.id,
    chunk: a.chunk,
    article: a.article,
    title: a.title,
    url: a.url,
    book: "I",
  }));
  const res = await fetch(`${host}/records/namespaces/${NS}/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": key,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({ records }),
  });
  console.log("upsert", res.status, await res.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
