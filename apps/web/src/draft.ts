/**
 * A draft is what was typed, plus the saved version it was typed on. Restoring it onto a newer
 * version takes only the fields the person changed, so a colleague's edit to another field is
 * not written back to its old value (SD-54). An old draft without a base replaces everything.
 */
export interface DraftOf<F> {
  form: F;
  base?: F;
  at: string;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeDraftOnto<F extends object>(d: DraftOf<F>, current: F): F {
  if (!d.base) return d.form;
  const out = { ...current } as Record<string, unknown>;
  const base = d.base as Record<string, unknown>;
  for (const [k, v] of Object.entries(d.form)) if (!sameValue(v, base[k])) out[k] = v;
  return out as F;
}
