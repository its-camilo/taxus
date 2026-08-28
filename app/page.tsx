"use client";

import { useMemo, useState } from "react";
import type { Casilla, DeclarationDraft, ExogenaLine, ExternalDocSummary, FormCode, SheetSummary, Taxpayer } from "@/lib/types";

type Step = "upload" | "review" | "done";

function casillaOverrides(casillas: Casilla[]): { numeric: Record<string, number>; text: Record<string, string> } {
  const numeric: Record<string, number> = {};
  const text: Record<string, string> = {};
  for (const c of casillas) {
    if (typeof c.value === "number") {
      numeric[c.id] = c.value;
    } else if (c.value !== undefined && c.value !== "") {
      text[c.id] = String(c.value);
    }
  }
  return { numeric, text };
}

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileList | null>(null);
  const [formPref, setFormPref] = useState<"auto" | FormCode>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reviews, setReviews] = useState<DeclarationDraft["reviews"]>([]);
  const [draft, setDraft] = useState<DeclarationDraft | null>(null);
  const [blobUrl, setBlobUrl] = useState("");

  const overrides = useMemo(() => casillaOverrides(draft?.casillas ?? []), [draft]);

  async function onParse(event: React.FormEvent) {
    event.preventDefault();
    if (!files?.length) {
      setError("Seleccione la información exógena.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("form", formPref);
      for (const f of Array.from(files)) {
        fd.append("files", f);
      }
      const parsed = await fetch("/api/parse", { method: "POST", body: fd }).then(async (r) => {
        const j = await r.json();
        if (!r.ok) {
          throw new Error(j.error ?? "No se pudo leer el archivo");
        }
        return j as {
          taxpayer: Taxpayer;
          lines: ExogenaLine[];
          warnings: string[];
          sheets: SheetSummary[];
          externalDocs: ExternalDocSummary[];
          form: FormCode;
        };
      });
      setWarnings(parsed.warnings ?? []);
      const proposed = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: parsed.form,
          taxpayer: parsed.taxpayer,
          lines: parsed.lines,
          sheets: parsed.sheets,
          externalDocs: parsed.externalDocs,
        }),
      }).then((r) => r.json() as Promise<DeclarationDraft>);
      setDraft(proposed);
      setReviews(proposed.reviews ?? []);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onEditCasilla(id: string, raw: string) {
    if (!draft) {
      return;
    }
    const casilla = draft.casillas.find((c) => c.id === id);
    if (!casilla) {
      return;
    }

    const nextNumeric = { ...overrides.numeric };
    const nextText = { ...overrides.text };

    if (typeof casilla.value === "number") {
      const nextVal = Number(raw.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(nextVal)) {
        return;
      }
      nextNumeric[id] = nextVal;
    } else {
      nextText[id] = raw;
    }

    const res = await fetch("/api/recalc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form: draft.form,
        taxpayer: draft.taxpayer,
        lines: draft.lines,
        overrides: nextNumeric,
        textOverrides: nextText,
      }),
    }).then((r) => r.json() as Promise<{ casillas: Casilla[] }>);

    const updatedText = casillaOverrides(res.casillas).text;
    const nextTaxpayer =
      draft.form === "210"
        ? {
            ...draft.taxpayer,
            year: Number(updatedText["1"]) || draft.taxpayer.year,
            documentNumber: updatedText["5"] ?? draft.taxpayer.documentNumber,
            dv: updatedText["6"] ?? draft.taxpayer.dv,
            firstLastName: updatedText["7"] ?? draft.taxpayer.firstLastName,
            secondLastName: updatedText["8"] ?? draft.taxpayer.secondLastName,
            firstName: updatedText["9"] ?? draft.taxpayer.firstName,
            otherNames: updatedText["10"] ?? draft.taxpayer.otherNames,
            fullName:
              [
                updatedText["7"] ?? draft.taxpayer.firstLastName,
                updatedText["8"] ?? draft.taxpayer.secondLastName,
                updatedText["9"] ?? draft.taxpayer.firstName,
                updatedText["10"] ?? draft.taxpayer.otherNames,
              ]
                .filter(Boolean)
                .join(" ") || draft.taxpayer.fullName,
          }
        : {
            ...draft.taxpayer,
            year: Number(updatedText["1"]) || draft.taxpayer.year,
            documentNumber: updatedText["5"] ?? draft.taxpayer.documentNumber,
            dv: updatedText["6"] ?? draft.taxpayer.dv,
            fullName: updatedText["11"] ?? draft.taxpayer.fullName,
          };

    setDraft({ ...draft, taxpayer: nextTaxpayer, casillas: res.casillas });
  }

  async function onPdf() {
    if (!draft) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: draft.form, casillas: draft.casillas }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "No se pudo generar el PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const reviewRounds = [...new Set((reviews ?? []).map((r) => r.round))];

  return (
    <main className="shell">
      <header className="mast">
        <div>
          <h1>Taxus</h1>
          <p>
            Borrador de declaración de renta (formularios 110 y 210) a partir de su información exógena y el Estatuto
            Tributario.
          </p>
        </div>
        <div className="badge">AG 2025/2026</div>
      </header>

      {step === "upload" && (
        <form className="panel" onSubmit={onParse}>
          <div className="drop">
            <label htmlFor="files">Información exógena y soportes</label>
            <input id="files" type="file" multiple accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => setFiles(e.target.files)} />
            <p>XLSX de terceros DIAN, más CSV/PDF/XLSX de bancos u otros informantes.</p>
          </div>
          <div className="row" style={{ marginTop: 20 }}>
            <div>
              <label htmlFor="form">Formulario</label>
              <select id="form" value={formPref} onChange={(e) => setFormPref(e.target.value as typeof formPref)}>
                <option value="auto">Detectar (C.C. → 210, NIT sociedad → 110)</option>
                <option value="210">210 personas naturales</option>
                <option value="110">110 jurídicas / no residentes</option>
              </select>
            </div>
          </div>
          {error && <p className="warn">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? "Revisando documentos…" : "Armar casillas"}
            </button>
          </div>
        </form>
      )}

      {step === "review" && draft && (
        <section className="panel">
          <h2>
            Formulario {draft.form} · {draft.taxpayer.fullName} · {draft.year}
          </h2>
          <p>Revise y corrija todos los campos. Los totales se recalculan al editar montos.</p>
          {warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          {reviewRounds.map((round) => (
            <details key={round} className="review-pass">
              <summary>
                Ronda {round} — {(reviews ?? []).filter((r) => r.round === round).length} revisiones{" "}
                {(reviews ?? []).filter((r) => r.round === round).every((r) => r.ok) ? "✓" : "!"}
              </summary>
              <ul>
                {(reviews ?? [])
                  .filter((r) => r.round === round)
                  .map((r) => (
                    <li key={`${r.round}-${r.pass}-${r.agent}`}>
                      <strong>{r.agent ?? r.label}</strong>: {r.label} {r.ok ? "✓" : "!"}
                      <ul>
                        {r.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </details>
          ))}
          <table>
            <thead>
              <tr>
                <th>Casilla</th>
                <th>Concepto</th>
                <th>Valor</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {draft.casillas.map((c) => (
                <tr key={c.id}>
                  <td className="id">{c.id}</td>
                  <td>{c.label}</td>
                  <td>
                    <input
                      type={typeof c.value === "number" ? "number" : "text"}
                      defaultValue={c.value}
                      key={`${c.id}-${c.value}`}
                      onBlur={(e) => onEditCasilla(c.id, e.target.value)}
                    />
                  </td>
                  <td>
                    {c.source}
                    {c.citations[0] ? ` · ${c.citations[0]}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="warn">{error}</p>}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setStep("upload")}>
              Volver
            </button>
            <button type="button" disabled={busy} onClick={onPdf}>
              {busy ? "Componiendo…" : "Continuar y generar PDF"}
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="panel">
          <h2>PDF listo</h2>
          <p>Descargue el formulario diligenciado (página 1 de la plantilla DIAN).</p>
          {blobUrl && (
            <div className="actions">
              <a href={blobUrl} download={`formulario-${draft?.form ?? "210"}.pdf`}>
                <button type="button">Descargar PDF</button>
              </a>
              <button type="button" className="ghost" onClick={() => setStep("review")}>
                Ajustar casillas
              </button>
            </div>
          )}
        </section>
      )}

      <p className="fine">
        Taxus es una herramienta de apoyo. Las plantillas coinciden byte a byte con los PDF publicados por la DIAN en
        Formularios 2025 (vigentes para AG 2023 y siguientes; los archivos 2026 del repositorio son idénticos). Verifique
        cada casilla; no es asesoría tributaria ni presentación oficial.
      </p>
    </main>
  );
}
