export const UVT: Record<number, number> = {
  2024: 47065,
  2025: 49799,
  2026: 52374,
};

export function uvt(year: number): number {
  return UVT[year] ?? UVT[2025];
}

/** Art. 241 E.T. — tarifa personas naturales residentes (UVT). */
export const RENTA_BRACKETS = [
  { upTo: 1090, rate: 0, subtract: 0 },
  { upTo: 1700, rate: 0.19, subtract: 207 },
  { upTo: 4100, rate: 0.28, subtract: 360 },
  { upTo: 8670, rate: 0.33, subtract: 565 },
  { upTo: 18970, rate: 0.35, subtract: 739 },
  { upTo: 31000, rate: 0.37, subtract: 1118 },
  { upTo: Infinity, rate: 0.39, subtract: 1738 },
] as const;

export function taxFromUvtTable(basePesos: number, year: number): number {
  const u = uvt(year);
  const baseUvt = basePesos / u;
  const bracket = RENTA_BRACKETS.find((b) => baseUvt <= b.upTo) ?? RENTA_BRACKETS[RENTA_BRACKETS.length - 1];
  const taxUvt = Math.max(0, baseUvt * bracket.rate - bracket.subtract);
  return Math.round(taxUvt * u);
}

export const CORPORATE_RATE = 0.35;
