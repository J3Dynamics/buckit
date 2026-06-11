import { BuckitState, CalcResult, ComputedState, Bucket } from '@/types';
import { allWeeks } from './weeks';

export function atoTax(taxableIncome: number): { tax: number; bracket: string } {
  const brackets = [
    { threshold: 18200, rate: 0, base: 0 },
    { threshold: 45000, rate: 0.16, base: 0 },
    { threshold: 135000, rate: 0.30, base: 4288 },
    { threshold: 190000, rate: 0.37, base: 31288 },
    { threshold: Infinity, rate: 0.45, base: 51638 },
  ];
  let bracketName = '$0 - $18,200 (0%)';
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    const prev = i === 0 ? 0 : brackets[i - 1].threshold;
    if (taxableIncome <= b.threshold) {
      tax = b.base + b.rate * (taxableIncome - prev);
      const rPct = Math.round(b.rate * 100);
      bracketName = i === 0
        ? '$0 - $18,200 (0%)'
        : `$${prev.toLocaleString()} - ${b.threshold === Infinity ? '$190k+' : '$' + b.threshold.toLocaleString()} (${rPct}%)`;
      break;
    }
  }
  return { tax: Math.round(tax), bracket: bracketName };
}

export function bucketShares(cashTotal: number, buckets: Bucket[], fillMode: string): number[] {
  const totalTarget = buckets.reduce((s, b) => s + (b.target || 0), 0);
  if (fillMode === 'sequential') {
    let remaining = cashTotal;
    return buckets.map(b => {
      const share = Math.min(remaining, b.target || 0);
      remaining = Math.max(0, remaining - share);
      return share;
    });
  }
  return buckets.map(b => totalTarget > 0 ? (b.target / totalTarget) * cashTotal : 0);
}

export function compute(state: BuckitState): CalcResult {
  const {
    startWeek: startIdx, endWeek: endIdx,
    rate, ftDays, days: daysPerWeek, hours: hoursPerDay,
    tax: taxPctRaw, spend: weeklySpendBudget,
    invest: investPctRaw, bills: monthlyBills,
    taxreturn: fyReturn,
    startCash: sCash, startSave: sSave, startInvest: sInvest,
    marketReturn: marketReturnAnn, startMode,
    buckets, breakWeeks, fullTimeWeeks, fillMode,
  } = state;

  const taxPct = taxPctRaw / 100;
  const investPct = investPctRaw / 100;

  const actualStart = Math.min(startIdx, endIdx);
  const actualEnd = Math.max(startIdx, endIdx);
  const totalPeriodWeeks = actualEnd - actualStart + 1;

  const breakCount = breakWeeks.filter(w => w >= actualStart && w <= actualEnd).length;
  const ftCount = fullTimeWeeks.filter(w => w >= actualStart && w <= actualEnd && !breakWeeks.includes(w)).length;
  const numWeeks = totalPeriodWeeks - breakCount;
  void ftCount;

  const weeklyHours = daysPerWeek * hoursPerDay;
  const ftWeeklyHours = ftDays * hoursPerDay;
  const weeklyGross = weeklyHours * rate;
  const weeklyTax = weeklyGross * taxPct;
  const weeklyNet = weeklyGross - weeklyTax;
  const weeklySpend = weeklySpendBudget;
  const weeklyBills = monthlyBills / 4.345;
  const weeklySurplus = Math.max(0, weeklyNet - weeklySpend - weeklyBills);
  const weeklyShortfall = Math.max(0, weeklySpend + weeklyBills - weeklyNet);
  const weeklyInvest = weeklySurplus * investPct;
  const weeklyCash = weeklySurplus - weeklyInvest;
  const ftWeeklyNet = ftWeeklyHours * rate * (1 - taxPct);

  let totalGross = 0, totalTax = 0, totalNet = 0, totalSpend = 0, totalBillsSum = 0;
  let totalCash = 0, totalInvested = 0, totalHours = 0;
  const wkRate = Math.pow(1 + marketReturnAnn / 100, 1 / 52) - 1;
  // 'spread' drips the starting portfolio in weekly instead of week 1
  const spread = startMode === 'spread';
  const dripInvest = spread ? sInvest / totalPeriodWeeks : 0;
  let portfolio = spread ? 0 : sInvest;
  const growthPerWeek: number[] = [portfolio];
  const contribPerWeek: number[] = [portfolio];
  let totalContrib = portfolio;
  // FY refund lands on the first August-or-later week within the period
  let refundWeekIdx = -1;
  for (let i = actualStart; i <= actualEnd; i++) {
    if (allWeeks[i] && allWeeks[i].start.getMonth() >= 7) { refundWeekIdx = i; break; }
  }
  let refundLanded = false;

  // Track liquid funds week by week to detect the point cash runs out
  const dripCash = spread ? (sCash + sSave) / totalPeriodWeeks : 0;
  let liquid = spread ? 0 : sCash + sSave;
  let runOutWeek: number | null = null;

  for (let i = actualStart; i <= actualEnd; i++) {
    const isBreak = breakWeeks.includes(i);
    const isFT = !isBreak && fullTimeWeeks.includes(i);
    const wkGross = isBreak ? 0 : isFT ? ftWeeklyHours * rate : weeklyGross;
    const wkTax = isBreak ? 0 : wkGross * taxPct;
    const wkNet = wkGross - wkTax;
    const refundThisWeek = !refundLanded && fyReturn > 0 && refundWeekIdx !== -1 && i >= refundWeekIdx;
    if (refundThisWeek) refundLanded = true;
    const refundIncome = refundThisWeek ? fyReturn : 0;
    const surplus = wkNet + refundIncome - weeklySpend - weeklyBills;
    let wkInvest = 0;
    totalGross += wkGross;
    totalTax += wkTax;
    totalNet += wkNet;
    totalSpend += weeklySpend;
    totalBillsSum += weeklyBills;
    if (surplus > 0) {
      wkInvest = surplus * investPct;
      totalInvested += wkInvest;
      totalCash += surplus * (1 - investPct);
    } else {
      totalCash += surplus;
    }
    portfolio = portfolio * (1 + wkRate) + wkInvest + dripInvest;
    totalContrib += wkInvest + dripInvest;
    growthPerWeek.push(portfolio);
    contribPerWeek.push(totalContrib);
    totalHours += isBreak ? 0 : isFT ? ftWeeklyHours : weeklyHours;
    liquid += dripCash + (surplus > 0 ? surplus * (1 - investPct) : surplus);
    if (runOutWeek === null && liquid < 0) runOutWeek = i - actualStart + 1;
  }

  const cashBalance = sCash + sSave + totalCash;
  const ato = atoTax(totalGross);
  const lito = totalGross <= 45881 ? Math.min(700, Math.round(totalGross * 0.05)) : 0;
  const actualTaxOwed = Math.max(0, ato.tax - lito);
  const taxRefund = totalTax - actualTaxOwed;
  const shares = bucketShares(Math.max(0, cashBalance), buckets, fillMode);

  return {
    weekly: {
      gross: Math.round(weeklyGross),
      tax: Math.round(weeklyTax),
      net: Math.round(weeklyNet),
      spend: Math.round(weeklySpend),
      saved: Math.round(weeklySurplus),
      cash: Math.round(weeklyCash),
      invested: Math.round(weeklyInvest),
    },
    totalGross: Math.round(totalGross),
    totalTax: Math.round(totalTax),
    totalNet: Math.round(totalNet),
    totalSpent: Math.round(totalSpend),
    monthlyBills,
    totalBills: Math.round(totalBillsSum),
    totalSaved: Math.round(totalCash + totalInvested),
    totalCashSavings: Math.round(totalCash),
    totalInvested: Math.round(totalInvested),
    totalHours,
    numWeeks,
    taxOwed: Math.round(actualTaxOwed),
    taxRefund: Math.round(taxRefund),
    litoOffset: lito,
    marginalBracket: ato.bracket,
    startingCash: sCash,
    startingSavings: sSave,
    startingInvestments: sInvest,
    totalInvestments: Math.round(totalInvested + sInvest),
    fyReturn,
    cashBalance: Math.round(cashBalance),
    weeklyShortfall: Math.round(weeklyShortfall),
    runOutWeek,
    buckets: shares.map((share, i) => ({
      name: buckets[i].name,
      target: buckets[i].target,
      funded: Math.round(share),
      pct: buckets[i].target > 0 ? Math.round((share / buckets[i].target) * 100) : 0,
    })),
    weeklyGross,
    weeklyTax,
    weeklyNet,
    weeklySpend,
    weeklySurplus,
    weeklyCash,
    weeklyInvest,
    weeklyBills,
    ftWeeklyNet,
    ftWeeklyHours,
    totalPeriodWeeks,
    growthPerWeek,
    contribPerWeek,
  };
}

export function toComputedState(r: CalcResult): ComputedState {
  return {
    weekly: r.weekly,
    totalGross: r.totalGross,
    totalTax: r.totalTax,
    totalNet: r.totalNet,
    totalSpent: r.totalSpent,
    monthlyBills: r.monthlyBills,
    totalBills: r.totalBills,
    totalSaved: r.totalSaved,
    totalCashSavings: r.totalCashSavings,
    totalInvested: r.totalInvested,
    totalHours: r.totalHours,
    numWeeks: r.numWeeks,
    taxOwed: r.taxOwed,
    taxRefund: r.taxRefund,
    litoOffset: r.litoOffset,
    marginalBracket: r.marginalBracket,
    startingCash: r.startingCash,
    startingSavings: r.startingSavings,
    startingInvestments: r.startingInvestments,
    totalInvestments: r.totalInvestments,
    fyReturn: r.fyReturn,
    cashBalance: r.cashBalance,
    weeklyShortfall: r.weeklyShortfall,
    runOutWeek: r.runOutWeek,
    buckets: r.buckets,
  };
}
