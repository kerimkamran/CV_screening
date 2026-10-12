import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import type { MatchBand } from './results-logic';

/** The assistant (design spec 6.6). It explains the stored match; it never scores or decides. */

export type Intent =
  | 'ask'
  | 'why'
  | 'weakest'
  | 'change'
  | 'interview'
  | 'compare'
  | 'challenge'
  | 'missing'
  | 'strongest'
  | 'check';

export interface AssistantConfig {
  enabled: boolean;
  name: string;
  features: {
    challenge: boolean;
    compare: boolean;
    interview: boolean;
    challengeRecruiter: boolean;
  };
  unavailableMessage: string;
}

export interface RequirementRef {
  id: string;
  text: string;
  state: 'Found' | 'Partly found' | 'Not found in this CV' | 'Unclear';
  candidate: string;
}
export interface Answer {
  kind: 'answer' | 'decline' | 'hold' | 'unread' | 'unverified' | 'unavailable';
  headline: string;
  claims: { text: string; source: string; quote?: string; requirement?: RequirementRef }[];
  cantSee: string;
  questions: { text: string; source: string; requirement?: RequirementRef }[];
  outcome: 'held' | 'gap' | null;
  handoff: { requirementId: string; text: string; to: 'preferred' }[];
  facts: string[];
  flags: string[];
  about: string[];
  offer?: string[];
}
export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: { text?: string; intent?: Intent; read?: string | null } & Partial<Answer>;
  at: string;
}

export interface Starter {
  intent: Intent;
  label: string;
}

/** Starter chips by band (spec 6.6.1). "Challenge this match" is a separate, optional action. */
export function startersFor(band: MatchBand): Starter[] {
  const always: Starter[] = [
    { intent: 'why', label: 'Explain more' },
    { intent: 'missing', label: 'Deeper evaluation' },
    { intent: 'weakest', label: 'Weakest point' },
    { intent: 'interview', label: 'Interview questions' },
    { intent: 'compare', label: 'Compare with…' },
  ];
  if (band === 'partial' || band === 'limited') {
    return [...always, { intent: 'strongest', label: 'What is the strongest case for this one?' }];
  }
  return always;
}

/** The product line shown with the assistant's name (Ask bar hint, panel greeting). */
export const SLOGAN = 'Sən istə, Senai tapsın';

// ------------------------------------------------------------------ the Ask bar and the panel

const bus = {
  pending: '',
  target: null as AssistantRegistration | null,
  scope: null as { id: string; title: string } | null,
  listeners: new Set<() => void>(),
};
const ping = () => bus.listeners.forEach((l) => l());
const useBus = <T>(read: () => T) =>
  useSyncExternalStore(
    (l) => {
      bus.listeners.add(l);
      return () => bus.listeners.delete(l);
    },
    read,
    read,
  );

/** What a report page tells the panel: who is being discussed, and what it may offer. */
export interface AssistantRegistration {
  target: { screeningId: string; label: string; band: MatchBand };
  others: { screeningId: string; label: string }[];
  onEditRequirement: (requirementId: string, text: string) => void;
}
export function registerAssistantTarget(r: AssistantRegistration | null): void {
  bus.target = r;
  ping();
}
export const useAssistantRegistration = () => useBus(() => bus.target);

/** The vacancy page the person is on: the Ask bar searches inside it unless the question names another. */
export function setAssistantScope(s: { id: string; title: string } | null): void {
  bus.scope = s;
  ping();
}
export const useAssistantScope = () => useBus(() => bus.scope);

/** The Ask bar hands a question to the panel, which opens and sends it. */
export function askSenAI(question: string): void {
  bus.pending = question;
  setAssistantOpen(true);
  ping();
}
export function takePendingQuestion(): string {
  const q = bus.pending;
  bus.pending = '';
  return q;
}
export const usePendingQuestion = () => useBus(() => bus.pending);

export const SKILL_MARK: Record<RequirementRef['state'], string> = {
  Found: '✓',
  'Partly found': '~',
  'Not found in this CV': '✗',
  Unclear: '?',
};

// ------------------------------------------------------------------ open state, per user

const store = {
  open: false,
  userKey: '',
  listeners: new Set<() => void>(),
};
const emit = () => store.listeners.forEach((l) => l());

const readOpen = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/** The panel starts closed; once a person opens it, that is remembered for them. */
export function rememberUser(userId: string): void {
  const key = `cv-assistant-open:${userId}`;
  if (store.userKey === key) return;
  store.userKey = key;
  store.open = readOpen(key);
  emit();
}

export function setAssistantOpen(open: boolean): void {
  store.open = open;
  try {
    if (store.userKey) localStorage.setItem(store.userKey, open ? '1' : '0');
  } catch {
    /* storage can be blocked; the panel still works for this visit */
  }
  emit();
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    () => store.open,
    () => false,
  );
}

let cached: AssistantConfig | null = null;
/** Whether the assistant is on, and what it is called. Off or unreachable means nothing is drawn. */
export function useAssistantConfig(): AssistantConfig | null {
  const [cfg, setCfg] = useState<AssistantConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    api.get<AssistantConfig>('/assistant/config').then(
      (c) => {
        cached = c;
        if (alive) setCfg(c);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return cfg && cfg.enabled ? cfg : null;
}
export const resetAssistantConfigCache = () => {
  cached = null;
};
