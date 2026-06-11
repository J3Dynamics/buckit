import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'state.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StateData = Record<string, any>;

let memState: StateData = {};
const sseClients = new Set<ReadableStreamDefaultController>();

export function loadStateFromDisk(): StateData {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

export function getState(): StateData {
  if (Object.keys(memState).length === 0) {
    memState = loadStateFromDisk();
  }
  return memState;
}

let flushTimer: NodeJS.Timeout | null = null;

function flushToDisk(): void {
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(memState, null, 2));
  renameSync(tmp, STATE_FILE);
}

export function setState(data: StateData): void {
  memState = data;
  notifyClients(data);
  // Write-behind: serve reads from memory, persist to disk only after the
  // burst of updates settles. state.json exists for restarts and external
  // readers (send_summary.py, Jarvis curl access).
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushToDisk, 1000);
}

function notifyClients(data: StateData): void {
  const encoder = new TextEncoder();
  const msg = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const dead: ReadableStreamDefaultController[] = [];
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(msg);
    } catch {
      dead.push(ctrl);
    }
  }
  dead.forEach(c => sseClients.delete(c));
}

export function addSseClient(ctrl: ReadableStreamDefaultController): void {
  sseClients.add(ctrl);
}

export function removeSseClient(ctrl: ReadableStreamDefaultController): void {
  sseClients.delete(ctrl);
}
