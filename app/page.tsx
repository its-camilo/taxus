"use client";

import { useMemo, useState } from "react";
import type { Casilla, DeclarationDraft, ExogenaLine, FormCode, Taxpayer } from "@/lib/types";

type Step = "upload" | "review" | "done";

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<FileList | null>(null);
  const [formPref, setFormPref] = useState<"auto" | FormCode>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState<DeclarationDraft | null>(null);
  const [blobUrl, setBlobUrl] = useState("");

  const overrides = useMemo(() => {
    const o: Record<string, number> = {};
    for (const c of draft?.casillas ?? []) {
      if (typeof c.value === "number") {
        o[c.id] = c.value;
      }
    }
    return o;
  }, [draft]);

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
        return j as { taxpayer: Taxpayer; lines: ExogenaLine[]; warnings: string[]; form: FormCode };
      });
      setWarnings(parsed.warnings ?? []);
      const proposed = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: parsed.form, taxpayer: parsed.taxpayer, lines: parsed.lines }),
      }).then((r) => r.json() as Promise<DeclarationDraft>);
      setDraft(proposed);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onEdit(id: string, raw: string) {
    if (!draft) {
      return;
    }
    const nextVal = Number(raw.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(nextVal)) {
      return;
    }
    const nextOverrides = { ...overrides, [id]: nextVal };
    const res = await fetch("/api/recalc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form: draft.form,
        taxpayer: draft.taxpayer,
        lines: draft.lines,
        overrides: nextOverrides,
      }),
    }).then((r) => r.json() as Promise<{ casillas: Casilla[] }>);
    setDraft({ ...draft, casillas: res.casillas });
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
        throw new Error("No se pudo generar el PDF");
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
        <div className="badge">No es Muisca · AG 2025/2026</div>
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
              {busy ? "Leyendo…" : "Armar casillas"}
            </button>
          </div>
        </form>
      )}

      {step === "review" && draft && (
        <section className="panel">
          <h2>
            Formulario {draft.form} · {draft.taxpayer.fullName} · {draft.year}
          </h2>
          <p>Revise y corrija. Los totales se recalculan. El PDF oficial se genera al continuar.</p>
          {warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
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
                    {typeof c.value === "number" ? (
                      <input
                        type="number"
                        defaultValue={c.value}
                        key={`${c.id}-${c.value}`}
                        onBlur={(e) => onEdit(c.id, e.target.value)}
                      />
                    ) : (
                      c.value
                    )}
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
          <p>Descargue el formulario diligenciado (página 1 de la plantilla DIAN). No sustituye la presentación en Muisca.</p>
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
