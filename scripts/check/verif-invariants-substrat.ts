// scripts/check/verif-invariants-substrat.ts
// Substrat TS chargé via `node --import tsx/esm` (Step 3). Découvre au runtime les
// codepoints que trim() considère blancs — aucune liste codée en dur (AR13).
// Le détecteur .mjs garde sa propre copie pour rester exécutable sous node --test nu.

export function estBlanc(cp: number): boolean {
  return String.fromCharCode(cp).trim() === "";
}

export function whitespaceTrimSet(): Set<number> {
  const blancs = new Set<number>();
  for (let cp = 0; cp <= 0xffff; cp++) if (estBlanc(cp)) blancs.add(cp);
  return blancs;
}
