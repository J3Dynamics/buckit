export interface Bucket {
  name: string;
  target: number;
}

export type FillMode = 'proportional' | 'sequential';

// How starting balances enter the projection: all at week 1, or contributed
// evenly across the work period.
export type StartMode = 'upfront' | 'spread';

export interface BuckitState {
  startWeek: number;
  endWeek: number;
  rate: number;
  ftDays: number;
  days: number;
  hours: number;
  tax: number;
  spend: number;
  invest: number;
  bills: number;
  taxreturn: number;
  startCash: number;
  startSave: number;
  startInvest: number;
  marketReturn: number;
  startMode: StartMode;
  buckets: Bucket[];
  breakWeeks: number[];
  fullTimeWeeks: number[];
  fillMode: FillMode;
  cardOrder: string[];
}

export interface ComputedState {
  weekly: {
    gross: number;
    tax: number;
    net: number;
    spend: number;
    saved: number;
    cash: number;
    invested: number;
  };
  totalGross: number;
  totalTax: number;
  totalNet: number;
  totalSpent: number;
  monthlyBills: number;
  totalBills: number;
  totalSaved: number;
  totalCashSavings: number;
  totalInvested: number;
  totalHours: number;
  numWeeks: number;
  taxOwed: number;
  taxRefund: number;
  litoOffset: number;
  marginalBracket: string;
  startingCash: number;
  startingSavings: number;
  startingInvestments: number;
  totalInvestments: number;
  fyReturn: number;
  cashBalance: number;
  weeklyShortfall: number;
  runOutWeek: number | null;
  buckets: { name: string; target: number; funded: number; pct: number }[];
}

export interface CalcResult extends ComputedState {
  weeklyGross: number;
  weeklyTax: number;
  weeklyNet: number;
  weeklySpend: number;
  weeklySurplus: number;
  weeklyCash: number;
  weeklyInvest: number;
  weeklyBills: number;
  ftWeeklyNet: number;
  ftWeeklyHours: number;
  totalPeriodWeeks: number;
  growthPerWeek: number[];
  contribPerWeek: number[];
}

export interface WeekDate {
  num: number;
  start: Date;
  end: Date;
  label: string;
}

export interface SimWeekData {
  week: number;
  label: string;
  isBreak: boolean;
  isFT: boolean;
  refundThisWeek?: boolean;
  net: number;
  spend: number;
  bills: number;
  cash: number;
  invest: number;
  liq: number;
  nw: number;
}

export interface SimComputedState {
  totalWeeks: number;
  workWeeks: number;
  breakWeeks: number;
  ftWeeks: number;
  totalHours: number;
  cGross: number;
  cTax: number;
  cNet: number;
  cSpend: number;
  cBills: number;
  cCash: number;
  cInvest: number;
  spendingPower: number;
  investments: number;
  netWorth: number;
  buckets: { name: string; target: number; funded: number; pct: number }[];
  weeks: SimWeekData[];
}

export interface PersistedState extends BuckitState {
  _computed?: ComputedState;
  _simComputed?: SimComputedState;
}

export interface SimDataPoint {
  weekIdx: number;
  weekNum: number;
  isBreak: boolean;
  isFT: boolean;
  refundThisWeek: boolean;
  wk: WeekDate | null;
  weeklyNet: number;
  weeklyGross: number;
  weeklyTax: number;
  weeklySpend: number;
  weeklyBills: number;
  weeklyCash: number;
  weeklyInvest: number;
  cGross: number;
  cTax: number;
  cNet: number;
  cSpend: number;
  cBills: number;
  cCash: number;
  cInvest: number;
  liq: number;
  inv: number;
  nw: number;
  hours: number;
  workWeeks: number;
  breakWeeks: number;
  ftWeeks: number;
  events: { text: string; cls: string }[];
  buckets: { name: string; target: number; funded: number; pct: number }[];
  dripSaveWk: number;
  dripInvWk: number;
}
