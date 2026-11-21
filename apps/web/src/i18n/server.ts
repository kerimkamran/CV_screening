import { tr } from './index';

/**
 * Messages the service sends, shown in the viewer's language (I18-05). The service writes plain
 * English; the common sentences have an Azerbaijani entry (az.server.ts) and are found by their
 * exact text. A few carry a name, a number or a time, so they are written here as a template with
 * {holes}: the hole values are put back unchanged (names, numbers, times), or translated where the
 * value is itself a label (`translate`). Anything else shows as sent, never as a code.
 */
export type ServerTemplate = {
  en: string;
  /** Holes whose value is a label (translated as a sentence of its own). */
  translate?: string[];
  /** Holes whose value is itself a message from the service. */
  nested?: string[];
};

export const SERVER_TEMPLATES: ServerTemplate[] = [
  { en: '{name} is already added. Add more models to it, or replace its key.' },
  { en: '"{a}" must be between 2 and 40 characters' },
  { en: '"{a}" is already read as {label}' },
  { en: '{by} already changed this to {mark}.', translate: ['mark'] },
  { en: 'Up to {max} CVs per download.' },
  // Wording key upload.limit.server: the 413 TOO_MANY_FILES backstop (S3-UP-01).
  { en: 'Up to {max} files per upload.' },
  { en: 'Changed by {name} at {time}. Reload to see their version.', translate: ['name'] },
  { en: '{feature} is switched off', translate: ['feature'] },
  { en: 'provider responded {status}' },
  { en: 'Unknown setting "{key}"' },
  { en: '{label} is required', translate: ['label'] },
  { en: '{label} has an unsupported value', translate: ['label'] },
  {
    en: '{error}. Showing the documented models; you can also type a model id.',
    nested: ['error'],
  },
  { en: '{provider} / {model} answered in the expected shape.' },
  // A provider's own error, said with the company's name in front. Keep last: it matches any "x: y".
  { en: '{name}: {message}', nested: ['message'] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers = SERVER_TEMPLATES.map((t) => ({
  ...t,
  re: new RegExp(
    '^' +
      t.en
        .split(/(\{\w+\})/)
        .map((p) => (/^\{\w+\}$/.test(p) ? `(?<${p.slice(1, -1)}>[\\s\\S]+?)` : escape(p)))
        .join('') +
      '$',
  ),
}));

/** Translates a message from the service: an exact sentence, or a template with its holes filled. */
export function trServer(message: string): string {
  const exact = tr(message);
  if (exact !== message) return exact;
  for (const m of matchers) {
    const found = m.re.exec(message);
    if (!found?.groups) continue;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(found.groups)) {
      vars[k] = m.translate?.includes(k) ? tr(v) : m.nested?.includes(k) ? trServer(v) : v;
    }
    return tr(m.en, vars);
  }
  return message;
}
