// Group lifecycle — direct port of upstream slidev-sync-server (MIT, Smile-SA).

import type { States } from "./protocol.js";

export interface Group {
  created: Date;
  states: States;
  updated: Date;
}

export type Groups = Map<string, Group>;

const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;

export function removeOldGroup(groups: Groups, id: string): void {
  const group = groups.get(id);
  if (!group) return;
  if (Date.now() - group.updated.getTime() > THREE_DAYS_MS) {
    groups.delete(id);
  }
}

export function removeOldGroups(groups: Groups): void {
  for (const id of groups.keys()) {
    removeOldGroup(groups, id);
  }
}

export function initGroup(groups: Groups, id: string, states: States = {}): void {
  const now = new Date();
  groups.set(id, { created: now, states, updated: now });
}

export function replaceGroup(groups: Groups, id: string, states: States): void {
  const group = groups.get(id);
  if (!group) return;
  for (const key of Object.keys(states)) {
    group.states[key] = states[key];
  }
  group.updated = new Date();
}

export function patchGroup(groups: Groups, id: string, states: States): void {
  const group = groups.get(id);
  if (!group) return;
  for (const key of Object.keys(states)) {
    group.states[key] = { ...group.states[key], ...states[key] };
  }
  group.updated = new Date();
}
