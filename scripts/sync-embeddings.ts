/**
 * One-time sync: embed each college's program document and write
 * `src/data/colleges.embeddings.json`. Run with `npm run sync:embeddings`.
 *
 * Separate from `sync-scorecard.ts` so embeddings can be regenerated without
 * re-fetching the API. Requires the Google API key (env -> macOS Keychain),
 * used only here at sync time — never at runtime.
 *
 * Calibration note: `SEMANTIC_FLOOR`/`SEMANTIC_CEIL` in `src/lib/embeddings.ts`
 * are educated defaults. After a run, eyeball a few real interest->program
 * cosine values (e.g. "coding" vs a CS-heavy school) and nudge the band there.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadColleges } from "../src/lib/dataset";
import {
  programDocument,
  encodeVector,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
} from "../src/lib/embeddings";
import { getEmbeddingProvider } from "../src/lib/embeddings-provider";

const BATCH = 100;

async function main() {
  const colleges = loadColleges().filter((c) => c.programs.length > 0);
  const embedder = getEmbeddingProvider();
  const vectors: Record<string, string> = {};

  for (let i = 0; i < colleges.length; i += BATCH) {
    const chunk = colleges.slice(i, i + BATCH);
    const docs = chunk.map((c) => programDocument(c.programs));
    const embs = await embedder.embed(docs);
    chunk.forEach((c, j) => {
      const v = embs[j];
      if (v) vectors[c.id] = encodeVector(v);
    });
    console.log(`  embedded ${Math.min(i + BATCH, colleges.length)}/${colleges.length}`);
  }

  const artifact = { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, vectors };
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "colleges.embeddings.json"
  );
  writeFileSync(out, `${JSON.stringify(artifact)}\n`);
  console.log(`Wrote ${Object.keys(vectors).length} vectors to ${out}.`);
}

void main();
