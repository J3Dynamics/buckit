'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { BuckitState, CalcResult, Bucket, FillMode } from '@/types';
import { compute, toComputedState, atoTax, bucketShares } from '@/lib/calc';
import { allWeeks, getCurrentWeekIdx, default2026EndIdx, fmtDate, FY_END } from '@/lib/weeks';
import { useBuckitStore, hydrateStore, pickState, normalizeState, DEFAULT_STATE, CARD_DEFAULTS } from '@/lib/store';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);
ChartJS.defaults.font.family = "'JetBrains Mono', monospace";
ChartJS.defaults.font.size = 10;

const HALF_CARDS = new Set(['gross','net','weekly-bar','taxreturn']);

const COLORS = {
  grid: '#141a24', tick: '#3d4555',
  purple: '#7c6aef', green: '#2dd4a0', teal: '#22d3c5',
  yellow: '#f0c45a', red: '#f0544c', white: '#c9d1d9',
};

function fmt(v: number): string {
  return '$' + Math.round(Math.abs(v)).toLocaleString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const WP_MIN_MONTH = new Date(allWeeks[0].start.getFullYear(), allWeeks[0].start.getMonth(), 1);
const WP_MAX_MONTH = new Date(FY_END.getFullYear(), FY_END.getMonth(), 1);

function WeekPicker({ label, value, rangeStart, rangeEnd, onChange }: {
  label: string; value: number; rangeStart: number; rangeEnd: number; onChange: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(WP_MIN_MONTH);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sel = allWeeks[value] ?? allWeeks[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) setViewMonth(new Date(sel.start.getFullYear(), sel.start.getMonth(), 1));
    setOpen(o => !o);
  }

  function shiftMonth(delta: number) {
    setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  const atMin = viewMonth <= WP_MIN_MONTH;
  const atMax = viewMonth >= WP_MAX_MONTH;
  const lastOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);

  // Week rows: every Monday from the one on/before the 1st through month end
  const rows: { idx: number; days: Date[] }[] = [];
  const firstMon = new Date(viewMonth);
  firstMon.setDate(1 - ((viewMonth.getDay() + 6) % 7));
  for (let mon = new Date(firstMon); mon <= lastOfMonth; mon.setDate(mon.getDate() + 7)) {
    const idx = allWeeks.findIndex(w => w.start.getTime() === mon.getTime());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      return d;
    });
    rows.push({ idx, days });
  }

  const lo = Math.min(rangeStart, rangeEnd);
  const hi = Math.max(rangeStart, rangeEnd);

  return (
    <div className="wp" ref={wrapRef}>
      <span className="ws-label">{label}</span>
      <button type="button" className="wp-btn" onClick={toggle}>
        <span>{fmtDate(sel.start)} - {fmtDate(sel.end)} &rsquo;{String(sel.start.getFullYear()).slice(2)}</span>
        <span className="wp-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="wp-pop">
          <div className="wp-head">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={atMin}>‹</button>
            <span>{viewMonth.toLocaleString('en', { month: 'long' })} {viewMonth.getFullYear()}</span>
            <button type="button" onClick={() => shiftMonth(1)} disabled={atMax}>›</button>
          </div>
          <div className="wp-dows">
            {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => <span key={d} className="wp-dow">{d}</span>)}
          </div>
          {rows.map((row, r) => (
            <div
              key={r}
              className={
                'wp-row' +
                (row.idx === -1 ? ' dis' : '') +
                (row.idx === value ? ' sel' : '') +
                (row.idx !== -1 && row.idx >= lo && row.idx <= hi && row.idx !== value ? ' inrange' : '')
              }
              onClick={() => {
                if (row.idx === -1) return;
                onChange(row.idx);
                setOpen(false);
              }}
            >
              {row.days.map((d, i) => (
                <span key={i} className={'wp-day' + (d.getMonth() !== viewMonth.getMonth() ? ' out' : '')}>
                  {d.getDate()}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SliderField({ label, id, value, min, max, step, display, onSlider, onDirectInput, tip }: {
  label: string; id: string; value: number; min: number; max: number; step: number;
  display: string; onSlider: (v: number) => void; onDirectInput: (v: number) => void; tip?: string;
}) {
  const [editing, setEditing] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="field">
      <label>
        <span>
          {label}
          {tip && (
            <span className="tooltip-icon">
              ?<span className="tip">{tip}</span>
            </span>
          )}
        </span>
        <input
          className="val"
          value={isFocused ? editing : display}
          onChange={e => setEditing(e.target.value)}
          onFocus={() => { setIsFocused(true); setEditing(String(value)); }}
          onBlur={() => {
            setIsFocused(false);
            const v = parseFloat(editing.replace(/[^0-9.]/g, ''));
            if (!isNaN(v)) onDirectInput(Math.max(min, Math.min(max, v)));
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </label>
      <input
        type="range" id={id} min={min} max={max} step={step} value={value}
        onChange={e => onSlider(Number(e.target.value))}
      />
    </div>
  );
}

function BreakGrid({ startIdx, endIdx, breakWeeks, fullTimeWeeks, onChange }: {
  startIdx: number; endIdx: number;
  breakWeeks: number[]; fullTimeWeeks: number[];
  onChange: (bw: number[], fw: number[]) => void;
}) {
  const s = Math.min(startIdx, endIdx);
  const e = Math.max(startIdx, endIdx);
  const bwFiltered = breakWeeks.filter(w => w >= s && w <= e);
  const fwFiltered = fullTimeWeeks.filter(w => w >= s && w <= e);

  const bkParts: string[] = [];
  if (bwFiltered.length) bkParts.push(`${bwFiltered.length} off`);
  if (fwFiltered.length) bkParts.push(`${fwFiltered.length} FT`);

  const chips = [];
  for (let i = s; i <= e; i++) {
    const isBreak = bwFiltered.includes(i);
    const isFT = fwFiltered.includes(i);
    chips.push({ i, isBreak, isFT, label: allWeeks[i].num });
  }

  function toggle(i: number) {
    let bw = [...bwFiltered.filter(w => w !== i)];
    let fw = fwFiltered.filter(w => w !== i);
    if (!bwFiltered.includes(i)) bw = [...bw, i];
    onChange(
      [...breakWeeks.filter(w => w < s || w > e), ...bw],
      [...fullTimeWeeks.filter(w => w < s || w > e), ...fw],
    );
  }

  function toggleFT(i: number, e2: React.MouseEvent) {
    e2.preventDefault();
    let bw = bwFiltered.filter(w => w !== i);
    let fw = [...fwFiltered.filter(w => w !== i)];
    if (!fwFiltered.includes(i)) fw = [...fw, i];
    onChange(
      [...breakWeeks.filter(w => w < s || w > e), ...bw],
      [...fullTimeWeeks.filter(w => w < s || w > e), ...fw],
    );
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span className="ws-label" style={{ margin: 0 }}>Weeks</span>
        <span className="ws-label" style={{ margin: 0 }}>
          {bwFiltered.length > 0 && <span style={{ color: 'var(--accent3)' }}>{bwFiltered.length} off </span>}
          {fwFiltered.length > 0 && <span style={{ color: '#4caf50' }}>{fwFiltered.length} FT</span>}
        </span>
      </div>
      <div className="break-grid">
        {chips.map(({ i, isBreak, isFT, label }) => (
          <div
            key={i}
            className={`break-chip${isBreak ? ' on' : ''}${isFT ? ' ft' : ''}`}
            title={allWeeks[i].label + (isBreak ? ' (off)' : isFT ? ' (full-time)' : '')}
            onClick={() => toggle(i)}
            onContextMenu={e2 => toggleFT(i, e2)}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function BucketsCard({ cashBalance, buckets, fillMode, onBuckets, onFillMode }: {
  cashBalance: number;
  buckets: Bucket[];
  fillMode: FillMode;
  onBuckets: (b: Bucket[]) => void;
  onFillMode: (m: FillMode) => void;
}) {
  const shares = bucketShares(Math.max(0, cashBalance), buckets, fillMode);
  const totalTarget = buckets.reduce((s, b) => s + (b.target || 0), 0);
  const surplus = cashBalance - totalTarget;
  const fullCount = buckets.filter((b, i) => b.target > 0 && shares[i] >= b.target).length;
  const surplusColor = surplus >= 0 ? 'var(--green)' : 'var(--red)';

  function updateName(idx: number, name: string) {
    const b = [...buckets]; b[idx] = { ...b[idx], name }; onBuckets(b);
  }
  function updateTarget(idx: number, target: number) {
    const b = [...buckets]; b[idx] = { ...b[idx], target }; onBuckets(b);
  }
  function remove(idx: number) {
    onBuckets(buckets.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= buckets.length) return;
    const b = [...buckets];
    [b[idx], b[j]] = [b[j], b[idx]];
    onBuckets(b);
  }
  function add() {
    onBuckets([...buckets, { name: 'New Goal', target: 500 }]);
  }

  return (
    <div className="card" data-card="buckets">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ margin: 0, border: 'none', padding: 0 }}>Savings Buckets</h2>
        <div className="invest-toggle">
          <button className={fillMode === 'proportional' ? 'active' : ''} onClick={() => onFillMode('proportional')}>Together</button>
          <button className={fillMode === 'sequential' ? 'active' : ''} onClick={() => onFillMode('sequential')}>Sequential</button>
        </div>
      </div>
      <div className="buckets-wrap">
        <div style={{ display: 'contents' }}>
          {buckets.map((b, i) => {
            const share = shares[i];
            const pct = b.target > 0 ? Math.min(100, (share / b.target) * 100) : 0;
            const full = pct >= 100;
            return (
              <BucketItem
                key={i} idx={i} bucket={b} share={share} pct={pct} full={full}
                isFirst={i === 0} isLast={i === buckets.length - 1}
                onNameChange={name => updateName(i, name)}
                onTargetChange={target => updateTarget(i, target)}
                onRemove={() => remove(i)}
                onMove={dir => move(i, dir)}
              />
            );
          })}
        </div>
        <button className="bucket-add" onClick={add}>+</button>
      </div>
      <div className="buckets-info">
        <div className="bi-stat">
          <span className="bi-val" style={{ color: 'var(--accent2)' }}>{fmt(totalTarget)}</span>
          <span className="bi-lbl">Total Target</span>
        </div>
        <div className="bi-stat">
          <span className="bi-val" style={{ color: 'var(--accent2)' }}>{fmt(cashBalance)}</span>
          <span className="bi-lbl">Available</span>
        </div>
        <div className="bi-stat">
          <span className="bi-val" style={{ color: surplusColor }}>{surplus >= 0 ? '+' : ''}{fmt(surplus)}</span>
          <span className="bi-lbl">{surplus >= 0 ? 'Surplus' : 'Shortfall'}</span>
        </div>
        <div className="bi-stat">
          <span className="bi-val" style={{ color: fullCount === buckets.length ? 'var(--green)' : 'var(--accent3)' }}>
            {fullCount}/{buckets.length}
          </span>
          <span className="bi-lbl">Funded</span>
        </div>
      </div>
    </div>
  );
}

function BucketItem({ idx, bucket, share, pct, full, isFirst, isLast, onNameChange, onTargetChange, onRemove, onMove }: {
  idx: number; bucket: Bucket; share: number; pct: number; full: boolean;
  isFirst: boolean; isLast: boolean;
  onNameChange: (v: string) => void;
  onTargetChange: (v: number) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [targetEdit, setTargetEdit] = useState('');
  const [editingTarget, setEditingTarget] = useState(false);

  return (
    <div className={`bucket${full ? ' full' : ''}`}>
      <input
        className="bucket-name"
        value={bucket.name}
        spellCheck={false}
        onChange={e => onNameChange(e.target.value)}
      />
      <div className="bucket-handle" />
      <div className="bucket-body-wrap">
        <div className="bucket-glow" />
        <div className="bucket-body">
          <div className={`bucket-fill${full ? ' complete' : ''}`} style={{ height: `${Math.min(pct, 100)}%` }} />
          <div className="bucket-pct-label">{Math.round(pct)}%</div>
        </div>
      </div>
      <div className="bucket-target-wrap">
        <span>$</span>
        <input
          className="bucket-target"
          type="text"
          inputMode="numeric"
          value={editingTarget ? targetEdit : bucket.target.toLocaleString()}
          onFocus={() => { setEditingTarget(true); setTargetEdit(String(bucket.target)); }}
          onChange={e => setTargetEdit(e.target.value)}
          onBlur={() => {
            setEditingTarget(false);
            const v = parseInt(targetEdit.replace(/[^0-9]/g, ''), 10) || 0;
            onTargetChange(v);
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="bucket-funded">{fmt(share)} / {fmt(bucket.target)}</div>
      <button className="bucket-remove" onClick={onRemove}>&times;</button>
      <div className="bucket-arrows">
        <button className={`bucket-move left${isFirst ? ' invisible' : ''}`} onClick={() => onMove(-1)}>‹</button>
        <button className={`bucket-move right${isLast ? ' invisible' : ''}`} onClick={() => onMove(1)}>›</button>
      </div>
    </div>
  );
}

function PaycheckCard({ r, daysPerWeek }: { r: CalcResult; daysPerWeek: number }) {
  const { weeklyGross, weeklyNet, weeklySpend, weeklyBills, weeklySurplus, weeklyInvest } = r;

  const wkHrs = r.totalHours / (r.numWeeks || 1);
  const netPerHr = wkHrs > 0 ? weeklyNet / wkHrs : 0;
  const hrsSpend = netPerHr > 0 ? weeklySpend / netPerHr : 0;
  const hrsBills = netPerHr > 0 ? weeklyBills / netPerHr : 0;
  const hrsSave = netPerHr > 0 ? weeklySurplus / netPerHr : 0;
  const maxHrs = wkHrs || 1;
  const pctH = (v: number) => Math.max(0.5, (v / maxHrs) * 100) + '%';
  const effHourly = wkHrs > 0 ? weeklyNet / wkHrs : 0;
  const dailyTakeHome = daysPerWeek > 0 ? weeklyNet / daysPerWeek : 0;
  const monthlyNet = weeklyNet * 4.345;
  const monthlySave = weeklySurplus * 4.345;
  const monthlyInvest = weeklyInvest * 4.345;
  const savingsRate = weeklyNet > 0 ? (weeklySurplus / weeklyNet * 100) : 0;

  return (
    <div className="card" data-card="paycheck">
      <h2>Weekly Paycheck Breakdown</h2>
      <div className="paycheck">
        <div className="paycheck-header">Effective rates</div>
        <div className="pk-stat-row">
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: COLORS.green }}>${effHourly.toFixed(2)}</span>
            <span className="pk-stat-lbl">/ hr after tax</span>
          </div>
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: COLORS.teal }}>{fmt(dailyTakeHome)}</span>
            <span className="pk-stat-lbl">/ day take-home</span>
          </div>
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: savingsRate >= 50 ? COLORS.green : COLORS.yellow }}>{Math.round(savingsRate)}%</span>
            <span className="pk-stat-lbl">savings rate</span>
          </div>
        </div>
        <hr className="paycheck-divider" />
        <div className="paycheck-header">Hours worked to cover</div>
        <div className="paycheck-row">
          <span className="pk-label">Spending</span>
          <div className="pk-bar-bg"><div className="pk-bar" style={{ width: pctH(hrsSpend), background: COLORS.white }} /></div>
          <span className="pk-val" style={{ color: COLORS.white }}>{hrsSpend.toFixed(1)}h</span>
        </div>
        {hrsBills > 0 && (
          <div className="paycheck-row">
            <span className="pk-label">Bills</span>
            <div className="pk-bar-bg"><div className="pk-bar" style={{ width: pctH(hrsBills), background: '#e17055' }} /></div>
            <span className="pk-val" style={{ color: '#e17055' }}>{hrsBills.toFixed(1)}h</span>
          </div>
        )}
        <div className="paycheck-row">
          <span className="pk-label">Savings</span>
          <div className="pk-bar-bg"><div className="pk-bar" style={{ width: pctH(hrsSave), background: COLORS.teal }} /></div>
          <span className="pk-val" style={{ color: COLORS.teal }}>{hrsSave.toFixed(1)}h</span>
        </div>
        <hr className="paycheck-divider" />
        <div className="paycheck-header">Monthly projection</div>
        <div className="pk-stat-row">
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: COLORS.green }}>{fmt(monthlyNet)}</span>
            <span className="pk-stat-lbl">net income</span>
          </div>
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: COLORS.teal }}>{fmt(monthlySave - monthlyInvest)}</span>
            <span className="pk-stat-lbl">cash saved</span>
          </div>
          <div className="pk-stat">
            <span className="pk-stat-val" style={{ color: COLORS.yellow }}>{fmt(monthlyInvest)}</span>
            <span className="pk-stat-lbl">invested</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaxReturnCard({ r }: { r: CalcResult }) {
  const { totalGross, totalTax, taxRefund, litoOffset, marginalBracket } = r;
  const ato = atoTax(totalGross);
  const isRefund = taxRefund >= 0;

  return (
    <div className="card" data-card="taxreturn" data-size="half">
      <h2>FY26-27 Tax Return</h2>
      <div className="tax-return">
        <div className="tr-row">
          <span className="tr-label">Taxable Income</span>
          <span className="tr-val" style={{ color: COLORS.purple }}>{fmt(totalGross)}</span>
        </div>
        <div className="tr-row">
          <span className="tr-label">Tax Withheld (flat rate)</span>
          <span className="tr-val" style={{ color: COLORS.red }}>{fmt(totalTax)}</span>
        </div>
        <div className="tr-row">
          <span className="tr-label">Actual Tax Owed (ATO)</span>
          <span className="tr-val" style={{ color: COLORS.yellow }}>{fmt(ato.tax)}</span>
        </div>
        {litoOffset > 0 && (
          <div className="tr-row">
            <span className="tr-label">LITO Offset</span>
            <span className="tr-val" style={{ color: COLORS.green }}>-{fmt(litoOffset)}</span>
          </div>
        )}
        <div className="tr-row">
          <span className="tr-label">Net Tax Liability</span>
          <span className="tr-val" style={{ color: COLORS.yellow }}>{fmt(r.taxOwed)}</span>
        </div>
        <div className="tr-refund">
          <div className="tr-refund-label">{isRefund ? 'Estimated Refund' : 'Amount Owed'}</div>
          <div className="tr-refund-val" style={{ color: isRefund ? COLORS.green : COLORS.red }}>
            {isRefund ? '+' : '-'}{fmt(taxRefund)}
          </div>
        </div>
        <div className="tr-bracket">Marginal bracket: {marginalBracket}</div>
      </div>
    </div>
  );
}

function BillCoverageCard({ r }: { r: CalcResult }) {
  const monthlyBurn = r.monthlyBills + (r.weeklySpend * 4.345);
  const months = monthlyBurn > 0 ? r.cashBalance / monthlyBurn : Infinity;
  const cappedMonths = Math.min(months, 36);
  const pct = Math.min(100, (cappedMonths / 24) * 100);
  const color = months >= 12 ? 'var(--green)' : months >= 6 ? 'var(--accent3)' : 'var(--red)';
  const disp = months >= 99 ? '∞' : months.toFixed(1);

  return (
    <div className="card" data-card="net" data-size="half">
      <h2>Bill Coverage</h2>
      <div className="bc-main">
        <div className="bc-months" style={{ color }}>{disp}</div>
        <div className="bc-label">months runway</div>
        <div className="bc-bar-wrap"><div className="bc-bar" style={{ width: `${pct}%`, background: color }} /></div>
        <div className="bc-breakdown">
          <div className="bc-row"><span className="bc-row-label">Spending Power</span><span className="bc-row-val" style={{ color: 'var(--accent2)' }}>{fmt(r.cashBalance)}</span></div>
          <div className="bc-row"><span className="bc-row-label">Monthly Burn</span><span className="bc-row-val" style={{ color: 'var(--red)' }}>{fmt(monthlyBurn)}</span></div>
          <div className="bc-row"><span className="bc-row-label">Bills / mo</span><span className="bc-row-val">{fmt(r.monthlyBills)}</span></div>
          <div className="bc-row"><span className="bc-row-label">Spend / mo</span><span className="bc-row-val">{fmt(r.weeklySpend * 4.345)}</span></div>
        </div>
      </div>
    </div>
  );
}

function InvestGrowthCard({ r, state }: { r: CalcResult; state: BuckitState }) {
  const [selectedProjection, setSelectedProjection] = useState(0);
  const [marketReturnLocal, setMarketReturnLocal] = useState(state.marketReturn);
  const [mrEditStr, setMrEditStr] = useState('');
  const [editingMr, setEditingMr] = useState(false);

  useEffect(() => { setMarketReturnLocal(state.marketReturn); }, [state.marketReturn]);

  const { growthPerWeek, contribPerWeek, numWeeks, startInvest: sInvest } = { ...r, startInvest: state.startInvest };
  const endPortfolio = growthPerWeek[growthPerWeek.length - 1] ?? 0;
  const endContrib = contribPerWeek[contribPerWeek.length - 1] ?? 0;
  const avgWeeklyInvest = numWeeks > 0 ? (endContrib - sInvest) / numWeeks : r.weeklyInvest;
  const wkRate = Math.pow(1 + marketReturnLocal / 100, 1 / 52) - 1;

  function project(years: number) {
    const wks = Math.round(years * 52);
    let b = endPortfolio, c = endContrib;
    for (let i = 0; i < wks; i++) { b = b * (1 + wkRate) + avgWeeklyInvest; c += avgWeeklyInvest; }
    return { val: b, contrib: c, gains: b - c };
  }

  const end = { val: endPortfolio, contrib: endContrib, gains: endPortfolio - endContrib };
  const projections = [
    { years: 0, label: 'End of period', ...end },
    { years: 1, label: '1 Year', ...project(1) },
    { years: 5, label: '5 Years', ...project(5) },
    { years: 10, label: '10 Years', ...project(10) },
  ];

  const sel = projections[selectedProjection] || projections[0];
  const extraWks = Math.round(sel.years * 52);
  const chartGrowth = [...growthPerWeek];
  const chartContrib = [...contribPerWeek];
  if (extraWks > 0) {
    let b = endPortfolio, c = endContrib;
    for (let i = 0; i < extraWks; i++) {
      b = b * (1 + wkRate) + avgWeeklyInvest;
      c += avgWeeklyInvest;
      chartGrowth.push(b);
      chartContrib.push(c);
    }
  }

  const totalPts = chartGrowth.length;
  const labels = chartGrowth.map((_, i) => {
    if (i === 0) return 'Start';
    if (i <= numWeeks) return 'W' + i;
    const monthsOut = Math.round((i - numWeeks) / 4.345);
    if (monthsOut < 12) return monthsOut + 'mo';
    return ((monthsOut / 12).toFixed(1).replace(/\.0$/, '')) + 'yr';
  });
  const maxTicks = 20;
  const step = totalPts > maxTicks * 2 ? Math.ceil(totalPts / maxTicks) : totalPts > maxTicks ? 2 : 1;
  const sparseLabels = labels.map((l, i) => i % step === 0 || i === totalPts - 1 ? l : '');

  const chartData = {
    labels: sparseLabels,
    datasets: [
      {
        label: 'Portfolio',
        data: chartGrowth.map(v => Math.round(v)),
        borderColor: COLORS.yellow,
        backgroundColor: 'rgba(240,196,90,0.1)',
        fill: true, tension: 0, pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Contributions',
        data: chartContrib.map(v => Math.round(v)),
        borderColor: COLORS.white,
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        fill: false, tension: 0, pointRadius: 0, borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: COLORS.tick, font: { size: 10 }, boxWidth: 12, padding: 12 } },
      tooltip: { mode: 'index' as const, intersect: false, callbacks: { label: (ctx: { dataset: { label?: string }; raw: unknown }) => ctx.dataset.label + ': $' + Math.round(ctx.raw as number).toLocaleString() } },
    },
    interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
    scales: {
      x: { ticks: { color: COLORS.tick, font: { size: 9 } }, grid: { color: COLORS.grid } },
      y: { ticks: { color: COLORS.tick, font: { size: 9 }, callback: (v: unknown) => '$' + (v as number).toLocaleString() }, grid: { color: COLORS.grid } },
    },
  };

  return (
    <div className="card" data-card="invest-growth">
      <h2>Growth Projections</h2>
      <div className="invest-ctrl">
        <label>Avg Annual Return</label>
        <input
          type="range" min={1} max={20} step={0.5} value={marketReturnLocal}
          onChange={e => setMarketReturnLocal(Number(e.target.value))}
        />
        <input
          className="invest-rate-val"
          value={editingMr ? mrEditStr : marketReturnLocal + '%'}
          onFocus={() => { setEditingMr(true); setMrEditStr(String(marketReturnLocal)); }}
          onChange={e => setMrEditStr(e.target.value)}
          onBlur={() => {
            setEditingMr(false);
            const v = parseFloat(mrEditStr.replace(/[^0-9.]/g, ''));
            if (!isNaN(v)) setMarketReturnLocal(Math.max(1, Math.min(20, v)));
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="chart-container" style={{ height: 220 }}>
        <Line data={chartData} options={chartOptions} />
      </div>
      <div className="invest-milestones">
        {projections.map((p, idx) => (
          <div key={idx} className={`invest-ms${idx === selectedProjection ? ' active' : ''}`} onClick={() => setSelectedProjection(idx)}>
            <span className="invest-ms-val" style={{ color: COLORS.yellow }}>{fmt(p.val)}</span>
            <span className="invest-ms-lbl">{p.label}</span>
            <span className="invest-ms-sub">{fmt(p.gains)} gains</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulatorPreviewCard({ r, state }: { r: CalcResult; state: BuckitState }) {
  const { startWeek, endWeek, breakWeeks, fullTimeWeeks } = state;
  const actualStart = Math.min(startWeek, endWeek);
  const actualEnd = Math.max(startWeek, endWeek);
  const maxNet = Math.max(r.weeklyNet, r.ftWeeklyNet) || 1;
  const bars = [];
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  for (let i = actualStart; i <= actualEnd; i++) {
    const isBreak = breakWeeks.includes(i);
    const isFT = !isBreak && fullTimeWeeks.includes(i);
    const net = isBreak ? 0 : isFT ? r.ftWeeklyNet : r.weeklyNet;
    const pct = isBreak ? 8 : Math.max(4, (net / maxNet) * 100);
    const col = isBreak ? 'var(--accent3)' : isFT ? '#4caf50' : 'var(--accent)';
    const op = isBreak ? 0.3 : isFT ? 0.5 : 0.4;
    const wNum = i - actualStart + 1;
    const tag = isBreak ? 'Break' : isFT ? 'Full-Time' : 'Part-Time';
    const tipText = `W${wNum}: ${tag}` + (isBreak ? '' : ` · $${Math.round(net)}`);
    bars.push({ pct, col, op, tipText, defaultOp: op });
  }

  return (
    <div className="card" data-card="simulator" style={{ position: 'relative', overflow: 'visible' }}>
      <h2>Simulator</h2>
      {tooltip && (
        <div style={{
          position: 'absolute', background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '3px 8px', fontSize: '0.72rem', color: 'var(--text)',
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20,
          left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)',
        }}>
          {tooltip.text}
        </div>
      )}
      <div id="simWaveform">
        {bars.map((bar, i) => (
          <div
            key={i}
            style={{ flex: 1, height: `${bar.pct}%`, background: bar.col, borderRadius: 2, minWidth: 3, opacity: bar.op, transition: 'opacity 0.1s' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.opacity = '1';
              const el = e.currentTarget as HTMLDivElement;
              const rect = el.getBoundingClientRect();
              const card = el.closest('.card')!.getBoundingClientRect();
              const wf = el.parentElement!.getBoundingClientRect();
              setTooltip({ text: bar.tipText, x: rect.left - card.left + rect.width / 2, y: wf.top - card.top - 26 });
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.opacity = String(bar.defaultOp);
              setTooltip(null);
            }}
          />
        ))}
      </div>
      <Link
        href="/sim"
        style={{
          display: 'block', textAlign: 'center', padding: 8,
          background: 'var(--accent2)', color: 'var(--bg)', borderRadius: 4,
          textDecoration: 'none', fontSize: '0.72rem', letterSpacing: 2,
          textTransform: 'uppercase', fontWeight: 600, transition: 'opacity 0.2s',
        }}
        onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseOut={e => (e.currentTarget.style.opacity = '1')}
      >
        Open Simulator
      </Link>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function BuckitPage() {
  const store = useBuckitStore();
  const hydrated = store.hydrated;
  const state = useMemo(() => pickState(store), [store]);
  const pushTsRef = useRef(0);

  const computed = useMemo(() => compute(state), [state]);

  // Sync to server (debounced); localStorage is handled by the persist middleware
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      pushTsRef.current = Date.now();
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state, _computed: toComputedState(computed) }),
      }).catch(() => {});
    }, 80);
    return () => clearTimeout(t);
  }, [state, computed, hydrated]);

  // Hydrate from localStorage, then server, then live SSE updates.
  // If the API is absent (static hosting), localStorage is the whole story.
  useEffect(() => {
    let es: EventSource | null = null;
    hydrateStore().then(() =>
      fetch('/api/state').then(r => {
        if (!r.ok) return;
        return r.json().then((s) => {
          if (Object.keys(s).length > 0) applyServerState(s);
          es = new EventSource('/api/events');
          es.onmessage = (e) => {
            if (Date.now() - pushTsRef.current < 500) return;
            try {
              const data = JSON.parse(e.data);
              if (Object.keys(data).length > 0) applyServerState(data);
            } catch {}
          };
        });
      })
    ).catch(() => {});
    return () => es?.close();
  }, []);

  function applyServerState(s: Record<string, unknown>) {
    const cur = pickState(useBuckitStore.getState());
    useBuckitStore.getState().replace(normalizeState(s, cur));
  }

  function upd(patch: Partial<BuckitState>) {
    store.patch(patch);
  }

  // Card drag-and-drop
  const chartsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false, cardId: '', ghost: null as HTMLElement | null,
    placeholder: null as HTMLElement | null, offsetX: 0, offsetY: 0,
  });

  const onCardMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest('[data-card]') as HTMLElement | null;
    if (!card) return;
    if ((e.target as HTMLElement).closest('input, button, select, canvas, a, .buckets-wrap, .buckets-info, .invest-ms, .invest-ctrl')) return;
    e.preventDefault();

    const rect = card.getBoundingClientRect();
    dragRef.current.active = true;
    dragRef.current.cardId = card.dataset.card!;
    dragRef.current.offsetX = e.clientX - rect.left;
    dragRef.current.offsetY = e.clientY - rect.top;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = card.querySelector('h2')?.textContent || '';
    ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px`;
    document.body.appendChild(ghost);
    dragRef.current.ghost = ghost;

    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    ph.style.height = rect.height + 'px';
    if (card.dataset.size === 'half') ph.dataset.size = 'half';
    card.parentNode!.insertBefore(ph, card);
    dragRef.current.placeholder = ph;
    card.style.display = 'none';

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);
  }, []);

  function onDocMove(e: MouseEvent) {
    const dr = dragRef.current;
    if (!dr.ghost || !chartsRef.current) return;
    dr.ghost.style.left = (e.clientX - dr.offsetX) + 'px';
    dr.ghost.style.top = (e.clientY - dr.offsetY) + 'px';

    const cards = [...chartsRef.current.querySelectorAll<HTMLElement>(':scope > .card[data-card]')]
      .filter(c => c.dataset.card !== dr.cardId);
    const ch = chartsRef.current;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height * 0.5) { ch.insertBefore(dr.placeholder!, c); return; }
    }
    ch.appendChild(dr.placeholder!);
  }

  function onDocUp() {
    document.removeEventListener('mousemove', onDocMove);
    document.removeEventListener('mouseup', onDocUp);
    const dr = dragRef.current;
    if (!dr.ghost || !chartsRef.current) return;

    const draggedCard = chartsRef.current.querySelector<HTMLElement>(`[data-card="${dr.cardId}"]`);
    if (draggedCard) {
      draggedCard.style.display = '';
      dr.placeholder!.parentNode!.insertBefore(draggedCard, dr.placeholder!);
    }
    dr.placeholder!.remove();
    dr.ghost.remove();
    dr.ghost = null; dr.placeholder = null; dr.active = false;

    const newOrder = [...chartsRef.current.querySelectorAll<HTMLElement>(':scope > [data-card]')]
      .map(c => c.dataset.card!);
    useBuckitStore.getState().patch({ cardOrder: newOrder });
  }

  // Reset
  const [showModal, setShowModal] = useState(false);

  function doReset() {
    store.replace({
      ...DEFAULT_STATE,
      startWeek: getCurrentWeekIdx(),
      endWeek: default2026EndIdx,
      cardOrder: CARD_DEFAULTS,
    });
    setShowModal(false);
  }

  // Render nothing until the persisted state is loaded; the server prerender
  // matches this, which keeps hydration clean.
  if (!hydrated) return <div className="calc-page" />;

  // Build ordered card list
  const orderedCards = state.cardOrder.filter(id => CARD_DEFAULTS.includes(id));
  const missing = CARD_DEFAULTS.filter(id => !orderedCards.includes(id));
  const allCards = [...orderedCards, ...missing];

  const chartBaseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: COLORS.tick, font: { size: 10 }, boxWidth: 12, padding: 12 } } },
    scales: {
      x: { ticks: { color: COLORS.tick, font: { size: 9 } }, grid: { color: COLORS.grid } },
      y: { ticks: { color: COLORS.tick, font: { size: 9 }, callback: (v: unknown) => '$' + (v as number).toLocaleString() }, grid: { color: COLORS.grid } },
    },
  };

  const doughnutData = {
    labels: ['Tax', 'Spending', 'Bills', 'Available', 'Invested'],
    datasets: [{
      data: [computed.totalTax, computed.totalSpent, computed.totalBills, computed.totalCashSavings, computed.totalInvested],
      backgroundColor: [COLORS.red, COLORS.white, '#e17055', COLORS.teal, COLORS.yellow],
      borderWidth: 0,
    }],
  };

  const weeklyBarData = {
    labels: ['Weekly Pay'],
    datasets: [
      { label: 'Tax', data: [computed.weekly.tax], backgroundColor: COLORS.red },
      { label: 'Spending', data: [computed.weekly.spend], backgroundColor: COLORS.white },
      { label: 'Bills', data: [Math.round(computed.weeklyBills)], backgroundColor: '#e17055' },
      { label: 'Available', data: [computed.weekly.cash], backgroundColor: COLORS.teal },
      { label: 'Invested', data: [computed.weekly.invested], backgroundColor: COLORS.yellow },
    ],
  };

  return (
    <div className="calc-page">
      <h1>BUCK<span style={{ fontSize: '1.8em', lineHeight: 0, verticalAlign: '-0.15em', color: '#4caf50' }}>$</span>IT</h1>
      <p className="subtitle">
        FY25-27 Projection{' '}
        <button className="reset-btn" onClick={() => setShowModal(true)}>reset</button>
      </p>

      {(computed.weeklyShortfall > 0 || computed.runOutWeek !== null) && (
        <div className="deficit-banner">
          {computed.weeklyShortfall > 0 && (
            <span>Spending exceeds income by {fmt(computed.weeklyShortfall)}/week.</span>
          )}{' '}
          {computed.runOutWeek !== null ? (
            <span>
              Cash runs out in week {computed.runOutWeek}
              {allWeeks[Math.min(state.startWeek, state.endWeek) + computed.runOutWeek - 1]
                ? ` (${fmtDate(allWeeks[Math.min(state.startWeek, state.endWeek) + computed.runOutWeek - 1].start)})`
                : ''}.
            </span>
          ) : computed.weeklyShortfall > 0 ? (
            <span>Starting balances cover the gap for this period.</span>
          ) : null}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-msg">Reset all settings to defaults?</div>
            <div className="modal-btns">
              <button className="modal-btn cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="modal-btn confirm" onClick={doReset}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <div className="layout">
        {/* ── Controls ── */}
        <div className="controls">
          {/* Work Period */}
          <div className="card">
            <h2>Work Period</h2>
            <div className="week-select">
              <WeekPicker label="Start" value={state.startWeek}
                rangeStart={state.startWeek} rangeEnd={state.endWeek}
                onChange={i => upd({ startWeek: i })} />
              <WeekPicker label="End" value={state.endWeek}
                rangeStart={state.startWeek} rangeEnd={state.endWeek}
                onChange={i => upd({ endWeek: i })} />
            </div>
            <BreakGrid
              startIdx={state.startWeek} endIdx={state.endWeek}
              breakWeeks={state.breakWeeks} fullTimeWeeks={state.fullTimeWeeks}
              onChange={(bw, fw) => upd({ breakWeeks: bw, fullTimeWeeks: fw })}
            />
          </div>

          {/* Work Details */}
          <div className="card">
            <h2>Work Details</h2>
            <SliderField label="Hourly Rate" id="rate" value={state.rate} min={10} max={80} step={0.01}
              display={`$${state.rate.toFixed(2)}`}
              onSlider={v => upd({ rate: v })} onDirectInput={v => upd({ rate: v })}
              tip="Your before-tax pay rate. Include any casual loading if applicable." />
            <SliderField label="Full-Time Days" id="ftDays" value={state.ftDays} min={3} max={7} step={1}
              display={String(state.ftDays)}
              onSlider={v => { const d = Math.min(state.days, v); upd({ ftDays: v, days: d }); }}
              onDirectInput={v => { const d = Math.min(state.days, v); upd({ ftDays: v, days: d }); }}
              tip="How many days count as a full-time week. Your working days slider is capped to this." />
            <SliderField label="Days / Week" id="days" value={state.days} min={1} max={state.ftDays} step={0.5}
              display={String(state.days)}
              onSlider={v => upd({ days: v })} onDirectInput={v => upd({ days: Math.min(v, state.ftDays) })}
              tip="How many days you typically work each week." />
            <SliderField label="Hours / Day" id="hours" value={state.hours} min={1} max={16} step={0.25}
              display={String(state.hours)}
              onSlider={v => upd({ hours: v })} onDirectInput={v => upd({ hours: v })}
              tip="Average shift length." />
          </div>

          {/* Tax */}
          <div className="card">
            <h2>Tax</h2>
            <SliderField label="Withholding" id="tax" value={state.tax} min={0} max={50} step={0.5}
              display={`${Math.round(state.tax)}%`}
              onSlider={v => upd({ tax: v })} onDirectInput={v => upd({ tax: v })}
              tip="Percentage withheld from each pay. AU casual workers with the tax-free threshold typically see 15-19%." />
          </div>

          {/* Spending & Savings */}
          <div className="card">
            <h2>Spending &amp; Savings</h2>
            <SliderField label="Spend / Week" id="spend" value={state.spend} min={0} max={1500} step={5}
              display={`$${state.spend}`}
              onSlider={v => upd({ spend: v })} onDirectInput={v => upd({ spend: v })}
              tip="Your weekly spending budget. Everything left over from net pay is saved automatically." />
            <SliderField label="Invest %" id="invest" value={state.invest} min={0} max={100} step={1}
              display={`${Math.round(state.invest)}%`}
              onSlider={v => upd({ invest: v })} onDirectInput={v => upd({ invest: v })}
              tip="Fraction of savings put into investments (ETFs, stocks, etc). The rest stays as accessible cash." />
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <SliderField label="FY25-26 Return" id="taxreturn" value={state.taxreturn} min={0} max={5000} step={10}
                display={`$${state.taxreturn}`}
                onSlider={v => upd({ taxreturn: v })} onDirectInput={v => upd({ taxreturn: v })}
                tip="Expected tax refund from last financial year, landing in your account this July." />
            </div>
          </div>

          {/* Bills */}
          <div className="card">
            <h2>Monthly Bills</h2>
            <SliderField label="Fixed Expenses" id="bills" value={state.bills} min={0} max={1500} step={5}
              display={`$${state.bills}`}
              onSlider={v => upd({ bills: v })} onDirectInput={v => upd({ bills: v })}
              tip="Recurring monthly costs: subscriptions, phone, insurance, gym, etc." />
          </div>

          {/* Starting Balances */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, border: 'none', padding: 0 }}>Starting Balances</h2>
              <div className="invest-toggle"
                title="Week 1: balances are there from the start. Spread: contributed evenly across the period.">
                <button className={state.startMode === 'upfront' ? 'active' : ''}
                  onClick={() => upd({ startMode: 'upfront' })}>Week 1</button>
                <button className={state.startMode === 'spread' ? 'active' : ''}
                  onClick={() => upd({ startMode: 'spread' })}>Spread</button>
              </div>
            </div>
            <SliderField label="Cash" id="startCash" value={state.startCash} min={0} max={20000} step={10}
              display={`$${Math.round(state.startCash).toLocaleString()}`}
              onSlider={v => upd({ startCash: v })} onDirectInput={v => upd({ startCash: v })}
              tip="Spending money in your transaction account." />
            <SliderField label="Savings" id="startSave" value={state.startSave} min={0} max={20000} step={10}
              display={`$${Math.round(state.startSave).toLocaleString()}`}
              onSlider={v => upd({ startSave: v })} onDirectInput={v => upd({ startSave: v })}
              tip="Money in your savings account." />
            <SliderField label="Investments" id="startInvest" value={state.startInvest} min={0} max={50000} step={10}
              display={`$${Math.round(state.startInvest).toLocaleString()}`}
              onSlider={v => upd({ startInvest: v })} onDirectInput={v => upd({ startInvest: v })}
              tip="Current portfolio value (stocks, ETFs, etc)." />
          </div>
        </div>

        {/* ── Charts ── */}
        <div className="charts" ref={chartsRef} onMouseDown={onCardMouseDown}>
          {allCards.map(id => {
            const half = HALF_CARDS.has(id) ? { 'data-size': 'half' } : {};
            switch (id) {
              case 'wk-summary':
                return (
                  <div key={id} className="card" data-card="wk-summary">
                    <h2>Weekly</h2>
                    <div className="summary-grid">
                      <div className="stat"><div className="label">Gross</div><div className="value accent">{fmt(computed.weekly.gross)}</div></div>
                      <div className="stat"><div className="label">Tax</div><div className="value red">{fmt(computed.weekly.tax)}</div></div>
                      <div className="stat"><div className="label">Net</div><div className="value green">{fmt(computed.weekly.net)}</div></div>
                      <div className="stat"><div className="label">Spending</div><div className="value">{fmt(computed.weekly.spend)}</div></div>
                      <div className="stat"><div className="label">Available</div><div className="value accent2">{fmt(computed.weekly.cash)}</div></div>
                      <div className="stat"><div className="label">Invested</div><div className="value yellow">{fmt(computed.weekly.invested)}</div></div>
                    </div>
                  </div>
                );
              case 'totals':
                return (
                  <div key={id} className="card" data-card="totals">
                    <h2>Totals</h2>
                    <div className="summary-grid">
                      <div className="stat"><div className="label">Gross</div><div className="value accent">{fmt(computed.totalGross)}</div></div>
                      <div className="stat"><div className="label">Tax</div><div className="value red">{fmt(computed.totalTax)}</div></div>
                      <div className="stat"><div className="label">Net</div><div className="value green">{fmt(computed.totalNet)}</div></div>
                      <div className="stat"><div className="label">Spent</div><div className="value">{fmt(computed.totalSpent)}</div></div>
                      <div className="stat"><div className="label">Bills</div><div className="value" style={{ color: '#e17055' }}>{fmt(computed.totalBills)}</div></div>
                      <div className="stat"><div className="label">Cash Savings</div><div className="value accent2">{fmt(computed.totalCashSavings)}</div></div>
                      <div className="stat"><div className="label">Invested</div><div className="value yellow">{fmt(computed.totalInvested)}</div></div>
                      <div className="stat"><div className="label">FY27 Refund</div><div className="value green">{(computed.taxRefund >= 0 ? '+' : '-') + fmt(computed.taxRefund)}</div></div>
                      <div className="stat"><div className="label">Spending Power</div><div className="value green">{fmt(computed.cashBalance)}</div></div>
                      <div className="stat"><div className="label">Net Worth</div><div className="value accent">{fmt(computed.cashBalance + computed.totalInvestments)}</div></div>
                      <div className="stat"><div className="label">Weeks</div><div className="value">{computed.numWeeks}</div></div>
                      <div className="stat"><div className="label">Hours</div><div className="value">{computed.totalHours.toLocaleString()}</div></div>
                    </div>
                  </div>
                );
              case 'paycheck':
                return <PaycheckCard key={id} r={computed} daysPerWeek={state.days} />;
              case 'gross':
                return (
                  <div key={id} className="card" data-card="gross" {...half}>
                    <h2>Gross Breakdown</h2>
                    <div className="chart-container">
                      <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: COLORS.tick, font: { size: 10 }, boxWidth: 10, padding: 14 } } } }} />
                    </div>
                  </div>
                );
              case 'net':
                return <BillCoverageCard key={id} r={computed} />;
              case 'weekly-bar':
                return (
                  <div key={id} className="card" data-card="weekly-bar" {...half}>
                    <h2>One Week Breakdown</h2>
                    <div className="chart-container" style={{ height: 200 }}>
                      <Bar data={weeklyBarData} options={{ ...chartBaseOpts, indexAxis: 'y' as const, scales: { x: { ...chartBaseOpts.scales.y, stacked: true }, y: { display: false, stacked: true } } }} />
                    </div>
                  </div>
                );
              case 'buckets':
                return (
                  <BucketsCard key={id}
                    cashBalance={computed.cashBalance}
                    buckets={state.buckets}
                    fillMode={state.fillMode}
                    onBuckets={b => upd({ buckets: b })}
                    onFillMode={m => upd({ fillMode: m })}
                  />
                );
              case 'taxreturn':
                return <TaxReturnCard key={id} r={computed} />;
              case 'invest-growth':
                return <InvestGrowthCard key={id} r={computed} state={state} />;
              case 'simulator':
                return <SimulatorPreviewCard key={id} r={computed} state={state} />;
              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
}
