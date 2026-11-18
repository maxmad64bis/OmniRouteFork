// Substrat TS du prédicat `id_classe_par_le_predicat` (T11 Step 3).
// Le fichier amont `router-id.ts:14` n'existe PAS à la base release/v3.8.55 du fork
// (vérifié : `find <worktree> -name router-id.ts` → 0). Ce helper en porte la
// sémantique minimale : un ID de routing se reconnaît à ses segments après le
// premier `/` (auto, auto-*, auto:*, free, pareto-code, bodybuilder).
// Exécution : node --import tsx/esm -e 'import("./…").then(…)'
// (le one-liner `node -e 'import("./…ts")'` échoue en ERR_MODULE_NOT_FOUND — C-22).

export function isRouterEntryId(id: string): boolean {
  const segments = String(id).split("/").slice(1);
  return (
    segments.some(
      (segment) =>
        segment === "auto" ||
        segment.startsWith("auto-") ||
        segment.startsWith("auto:") ||
        segment === "free" ||
        segment === "pareto-code" ||
        segment === "bodybuilder"
    ) || /^(?:auto:|free$|pareto-code$|bodybuilder$)/i.test(String(id))
  );
}
