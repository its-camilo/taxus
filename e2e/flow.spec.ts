import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function fixtureXlsx(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("reporteInformadoGeneralXls");
  for (let i = 1; i <= 11; i += 1) {
    ws.addRow(["meta"]);
  }
  ws.addRow([
    "Código de Formato",
    "Nombre del Formato",
    "Código Concepto",
    "Nombre Concepto",
    "Año Vigencia",
    "Periodo",
    "Número de Solicitud",
    "Estado",
    "NIT",
    "Nombre / Razón Social",
    "Tipo de Documento",
    "Número de Documento",
    "Dígito de Verificación",
    "Razón Social",
    "Rol Persona",
    "País",
    "Departamento",
    "Municipio",
    "Dirección",
    "Reportado Como",
    "CDT Rendimientos Causados ponderado por titular",
    "CDT Rendimientos Pagados",
    "Certificado - Total ingresos brutos rentas de trabajo y pensión",
    "Ingresos brutos Cuentas en participación",
  ]);
  ws.addRow([
    "2276", "Rentas", "", "", 2025, 1, 1, "OK", "1", "UNAL", "C. C.", "1001", "",
    "PRUEBA USUARIO", "", "", "", "", "", "", "", "", 500000,
  ]);
  const file = path.join(os.tmpdir(), "taxus-e2e.xlsx");
  const buf = await wb.xlsx.writeBuffer();
  await writeFile(file, Buffer.from(buf));
  return file;
}

test("upload review and download pdf", async ({ page }) => {
  const xlsx = await fixtureXlsx();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Taxus" })).toBeVisible();
  await page.locator("#files").setInputFiles(xlsx);
  await page.getByRole("button", { name: "Armar casillas" }).click();
  await expect(page.getByText("Formulario 210")).toBeVisible({ timeout: 60_000 });
  const trabajo = page.locator("tr", { hasText: "Ingresos brutos rentas de trabajo" }).locator("input");
  await trabajo.fill("600000");
  await trabajo.blur();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Continuar y generar PDF/ }).click().then(async () => {
      await page.getByRole("button", { name: "Descargar PDF" }).click();
    }),
  ]);
  expect(download.suggestedFilename()).toMatch(/formulario-210\.pdf/);
});
