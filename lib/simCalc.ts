import { BuckitState, SimDataPoint, WeekDate } from '@/types';
import { allWeeks, fmtDate } from './weeks';

export function buildSimData(s: BuckitState): SimDataPoint[] {
  const startIdx = Math.min(s.startWeek, s.endWeek);
  const endIdx = Math.max(s.startWeek, s.endWeek);
  const rate = s.rate;
  const dpw = s.days;
  const hpd = s.hours;
  const taxPct = s.tax / 100;
  const spendBudget = s.spend;
  const investPct = s.invest / 100;
  const mBills = s.bills;
  const fyReturn = s.taxreturn;
  const sCash = s.startCash;
  const sSave = s.startSave;
  const sInvest = s.startInvest;
  const bkts = s.buckets;
  const fillMode = s.fillMode;
  const breaks = s.breakWeeks;
  const ftWeeksArr = s.fullTimeWeeks;
  const ftDays = s.ftDays;

  const wHrs = dpw * hpd;
  const wGross = wHrs * rate;
  const wTax = wGross * taxPct;
  const wNet = wGross - wTax;
  const wBills = mBills / 4.345;

  const ftHrs = ftDays * hpd;
  const ftGross = ftHrs * rate;
  const ftTax = ftGross * taxPct;
  const ftNet = ftGross - ftTax;

  // FY refund lands on the first August-or-later week within the period
  let refundWeekNum = -1;
  for (let i = startIdx; i <= endIdx; i++) {
    if (allWeeks[i] && allWeeks[i].start.getMonth() >= 7) { refundWeekNum = i; break; }
  }

  // 'spread' drips starting balances in weekly instead of landing at week 1
  const totalPeriodWeeks = endIdx - startIdx + 1;
  const spread = s.startMode === 'spread';
  const dripLiq = spread ? (sCash + sSave) / totalPeriodWeeks : 0;
  const dripInv = spread ? sInvest / totalPeriodWeeks : 0;

  const data: SimDataPoint[] = [];
  let cGross = 0, cTax = 0, cNet = 0, cSpend = 0, cBills = 0, cHrs = 0, cCash = 0, cInvest = 0;
  let refundLanded = false;
  let workWeeksSoFar = 0, ftWeeksSoFar = 0;
  let cashDepleted = false;

  for (let i = startIdx; i <= endIdx; i++) {
    const isBreak = breaks.includes(i);
    const isFT = !isBreak && ftWeeksArr.includes(i);
    const wNum = i - startIdx + 1;

    const thisGross = isBreak ? 0 : isFT ? ftGross : wGross;
    const thisTax = isBreak ? 0 : isFT ? ftTax : wTax;
    const thisNet = isBreak ? 0 : isFT ? ftNet : wNet;
    const thisSpend = spendBudget;
    const thisBills = wBills;

    if (!isBreak) {
      workWeeksSoFar++;
      if (isFT) ftWeeksSoFar++;
      cHrs += isFT ? ftHrs : wHrs;
    }
    cGross += thisGross;
    cTax += thisTax;
    cNet += thisNet;
    cSpend += thisSpend;
    cBills += thisBills;

    const refundThisWeek = !refundLanded && fyReturn > 0 && refundWeekNum !== -1 && i >= refundWeekNum;
    if (refundThisWeek) refundLanded = true;
    const refundIncome = refundThisWeek ? fyReturn : 0;

    const surplus = thisNet + refundIncome - thisSpend - thisBills;
    let thisInvest = 0;
    if (surplus > 0) {
      thisInvest = surplus * investPct;
      cInvest += thisInvest;
    }
    cCash += surplus > 0 ? surplus - thisInvest : surplus;

    const liqBase = spread ? dripLiq * wNum : sCash + sSave;
    const invBase = spread ? dripInv * wNum : sInvest;
    const liq = liqBase + cCash;
    const inv = invBase + cInvest;
    const nw = liq + inv;

    // Buckets can only be funded with money that exists
    const fundable = Math.max(0, liq);
    const totalTarget = bkts.reduce((s, b) => s + (b.target || 0), 0);
    let shares: number[];
    if (fillMode === 'sequential') {
      let rem = fundable;
      shares = bkts.map(b => {
        const sh = Math.min(rem, b.target || 0);
        rem = Math.max(0, rem - sh);
        return sh;
      });
    } else {
      shares = bkts.map(b => totalTarget > 0 ? (b.target / totalTarget) * fundable : 0);
    }

    const events: { text: string; cls: string }[] = [];
    if (wNum === 1) events.push({ text: 'Period starts', cls: 'purple' });
    if (!cashDepleted && liq < 0) {
      cashDepleted = true;
      events.push({ text: `Cash depleted: spending exceeds available funds ($${Math.round(liq).toLocaleString()})`, cls: 'red' });
    } else if (cashDepleted && liq >= 0) {
      cashDepleted = false;
      events.push({ text: 'Back in the black: cash balance recovered', cls: 'green' });
    }
    if (isBreak) events.push({ text: 'Break week, no income', cls: 'yellow' });
    if (isFT) events.push({ text: `Full-time week (${ftDays} days)`, cls: 'green' });
    if (refundThisWeek) events.push({ text: `FY tax return received: +$${Math.round(fyReturn).toLocaleString()}`, cls: 'green' });

    if (data.length > 0) {
      const prevD = data[data.length - 1];
      bkts.forEach((b, bi) => {
        const prevPct = prevD.buckets[bi]?.pct || 0;
        const curFunded = Math.min(shares[bi], b.target);
        const curPct = b.target > 0 ? Math.min(100, Math.round((curFunded / b.target) * 100)) : 0;
        if (curPct >= 100 && prevPct < 100) {
          events.push({ text: `${b.name} bucket fully funded!`, cls: 'teal' });
        }
      });
    }

    if (i === endIdx) events.push({ text: 'Period complete', cls: 'purple' });
    const halfWay = Math.floor((endIdx - startIdx) / 2) + startIdx;
    if (i === halfWay) events.push({ text: 'Halfway through the period', cls: 'purple' });

    const wk: WeekDate | null = allWeeks[i] || null;

    data.push({
      weekIdx: i,
      weekNum: wNum,
      isBreak,
      isFT,
      refundThisWeek,
      wk,
      weeklyNet: thisNet,
      weeklyGross: thisGross,
      weeklyTax: thisTax,
      weeklySpend: thisSpend,
      weeklyBills: thisBills,
      weeklyCash: surplus > 0 ? surplus - thisInvest : 0,
      weeklyInvest: thisInvest,
      cGross: Math.round(cGross),
      cTax: Math.round(cTax),
      cNet: Math.round(cNet),
      cSpend: Math.round(cSpend),
      cBills: Math.round(cBills),
      cCash: Math.round(cCash),
      cInvest: Math.round(cInvest),
      liq: Math.round(liq),
      inv: Math.round(inv),
      nw: Math.round(nw),
      hours: Math.round(cHrs),
      workWeeks: workWeeksSoFar,
      breakWeeks: wNum - workWeeksSoFar,
      ftWeeks: ftWeeksSoFar,
      events,
      dripSaveWk: Math.round(dripLiq),
      dripInvWk: Math.round(dripInv),
      buckets: shares.map((sh, bi) => ({
        name: bkts[bi].name,
        target: bkts[bi].target,
        funded: Math.round(Math.min(sh, bkts[bi].target)),
        pct: bkts[bi].target > 0 ? Math.min(100, Math.round((sh / bkts[bi].target) * 100)) : 0,
      })),
    });
  }
  return data;
}

export { fmtDate };
