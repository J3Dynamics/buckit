import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { BuckitState, Bucket, FillMode } from '@/types';
import { default2026EndIdx, getCurrentWeekIdx, LEGACY_WEEK_OFFSET } from './weeks';

export const CARD_DEFAULTS = ['wk-summary','totals','paycheck','gross','net','weekly-bar','buckets','taxreturn','invest-growth','simulator'];

export const DEFAULT_STATE: BuckitState = {
  startWeek: 0,
  endWeek: default2026EndIdx,
  rate: 25, ftDays: 5, days: 3, hours: 5, tax: 15,
  spend: 200, invest: 50, bills: 0, taxreturn: 0,
  startCash: 0, startSave: 0, startInvest: 0, marketReturn: 8,
  startMode: 'upfront',
  buckets: [
    { name: 'Emergency Fund', target: 2000 },
    { name: 'Travel', target: 1500 },
    { name: 'Tech', target: 1000 },
  ],
  breakWeeks: [], fullTimeWeeks: [],
  fillMode: 'proportional',
  cardOrder: CARD_DEFAULTS,
};

export function pickState(s: BuckitState): BuckitState {
  return {
    startWeek: s.startWeek, endWeek: s.endWeek,
    rate: s.rate, ftDays: s.ftDays, days: s.days, hours: s.hours, tax: s.tax,
    spend: s.spend, invest: s.invest, bills: s.bills, taxreturn: s.taxreturn,
    startCash: s.startCash, startSave: s.startSave, startInvest: s.startInvest,
    marketReturn: s.marketReturn, startMode: s.startMode,
    buckets: s.buckets, breakWeeks: s.breakWeeks, fullTimeWeeks: s.fullTimeWeeks,
    fillMode: s.fillMode, cardOrder: s.cardOrder,
  };
}

export function normalizeState(p: Record<string, unknown>, base: BuckitState): BuckitState {
  return {
    startWeek: Number(p.startWeek ?? base.startWeek),
    endWeek: Number(p.endWeek ?? base.endWeek),
    rate: Number(p.rate ?? base.rate),
    ftDays: Number(p.ftDays ?? base.ftDays),
    days: Number(p.days ?? base.days),
    hours: Number(p.hours ?? base.hours),
    tax: Number(p.tax ?? base.tax),
    spend: Number(p.spend ?? base.spend),
    invest: Number(p.invest ?? base.invest),
    bills: Number(p.bills ?? base.bills),
    taxreturn: Number(p.taxreturn ?? base.taxreturn),
    startCash: Number(p.startCash ?? base.startCash),
    startSave: Number(p.startSave ?? base.startSave),
    startInvest: Number(p.startInvest ?? base.startInvest),
    marketReturn: Number(p.marketReturn ?? base.marketReturn),
    startMode: p.startMode === 'spread' ? 'spread' : p.startMode === 'upfront' ? 'upfront' : base.startMode,
    buckets: Array.isArray(p.buckets) ? (p.buckets as Bucket[]) : base.buckets,
    breakWeeks: Array.isArray(p.breakWeeks) ? (p.breakWeeks as unknown[]).map(Number) : base.breakWeeks,
    fullTimeWeeks: Array.isArray(p.fullTimeWeeks) ? (p.fullTimeWeeks as unknown[]).map(Number) : base.fullTimeWeeks,
    fillMode: (p.fillMode === 'sequential' ? 'sequential' : 'proportional') as FillMode,
    cardOrder: Array.isArray(p.cardOrder) ? (p.cardOrder as string[]) : base.cardOrder,
  };
}

interface BuckitStore extends BuckitState {
  hydrated: boolean;
  patch: (p: Partial<BuckitState>) => void;
  replace: (s: BuckitState) => void;
}

// Pre-zustand versions stored the state flat (no {state, version} wrapper)
// with numbers as strings; wrap legacy payloads as v0 so migrate() runs.
const legacyAwareStorage = {
  getItem: (name: string): string | null => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && 'state' in p && 'version' in p) return raw;
      return JSON.stringify({ state: p, version: 0 });
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => localStorage.setItem(name, value),
  removeItem: (name: string) => localStorage.removeItem(name),
};

export const useBuckitStore = create<BuckitStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      hydrated: false,
      patch: (p) => set(p),
      replace: (s) => set(s),
    }),
    {
      name: 'buckit-state',
      version: 2,
      storage: createJSONStorage(() => legacyAwareStorage),
      partialize: (s) => pickState(s),
      // v0/v1 week indices were relative to 5 Jan 2026; the range now starts
      // at FY25-26, so older saves shift by LEGACY_WEEK_OFFSET.
      migrate: (persisted, version) => {
        const s = normalizeState(persisted as Record<string, unknown>, DEFAULT_STATE);
        if (version < 2) {
          s.startWeek += LEGACY_WEEK_OFFSET;
          s.endWeek += LEGACY_WEEK_OFFSET;
          s.breakWeeks = s.breakWeeks.map(w => w + LEGACY_WEEK_OFFSET);
          s.fullTimeWeeks = s.fullTimeWeeks.map(w => w + LEGACY_WEEK_OFFSET);
        }
        return s;
      },
      skipHydration: true,
    },
  ),
);

export async function hydrateStore(): Promise<void> {
  const firstRun = localStorage.getItem('buckit-state') === null;
  await useBuckitStore.persist.rehydrate();
  if (firstRun) {
    useBuckitStore.getState().patch({ startWeek: getCurrentWeekIdx(), endWeek: default2026EndIdx });
  }
  useBuckitStore.setState({ hydrated: true });
}
