'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { BuckitState, SimDataPoint } from '@/types';
import { buildSimData, fmtDate } from '@/lib/simCalc';
import { useBuckitStore, hydrateStore, pickState, normalizeState } from '@/lib/store';

// ─── Tween utility ────────────────────────────────────────────────────────────

function makeTweener() {
  const active = new Map<HTMLElement, number>();
  return function tween(el: HTMLElement | null, from: number, to: number, prefix = '$', dur = 250) {
    if (!el) return;
    const node = el;
    const existing = active.get(node);
    if (existing) cancelAnimationFrame(existing);
    if (from === to) { node.textContent = prefix + Math.round(to).toLocaleString(); return; }
    const start = performance.now();
    function tick() {
      const t = Math.min(1, (performance.now() - start) / dur);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      node.textContent = prefix + Math.round(from + (to - from) * ease).toLocaleString();
      if (t < 1) { active.set(node, requestAnimationFrame(tick)); }
      else { active.delete(node); }
    }
    active.set(node, requestAnimationFrame(tick));
  };
}

function tweenPct(el: HTMLElement | null, from: number, to: number) {
  if (!el) return;
  el.textContent = to + '%';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SimulatorPage() {
  const [simData, setSimData] = useState<SimDataPoint[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const [waveformBars, setWaveformBars] = useState<{ h: number; cls: string; refund: boolean; tip: string }[]>([]);
  const [events, setEvents] = useState<{ text: string; cls: string }[]>([]);
  const [buckets, setBuckets] = useState<{ name: string; target: number; funded: number; pct: number }[]>([]);
  const [rawState, setRawState] = useState<BuckitState | null>(null);

  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simPushTsRef = useRef(0);
  const tween = useRef(makeTweener()).current;

  // Element refs for animation
  const heroLiquidRef = useRef<HTMLDivElement>(null);
  const heroNetWorthRef = useRef<HTMLDivElement>(null);
  const heroDeltaRef = useRef<HTMLDivElement>(null);
  const rbNetRef = useRef<HTMLSpanElement>(null);
  const rbTaxRef = useRef<HTMLSpanElement>(null);
  const rbSpendRef = useRef<HTMLSpanElement>(null);
  const rbCashRef = useRef<HTMLSpanElement>(null);
  const rbInvRef = useRef<HTMLSpanElement>(null);
  const rbHrsRef = useRef<HTMLSpanElement>(null);
  const spGrossRef = useRef<HTMLSpanElement>(null);
  const spTaxRef = useRef<HTMLSpanElement>(null);
  const spNetRef = useRef<HTMLSpanElement>(null);
  const spSpendRef = useRef<HTMLSpanElement>(null);
  const spBillsRef = useRef<HTMLSpanElement>(null);
  const spCashRef = useRef<HTMLSpanElement>(null);
  const spInvestRef = useRef<HTMLSpanElement>(null);
  const spDripSaveRef = useRef<HTMLSpanElement>(null);
  const spDripInvRef = useRef<HTMLSpanElement>(null);
  const spDirSpendRef = useRef<HTMLSpanElement>(null);
  const spTotSaveRef = useRef<HTMLSpanElement>(null);
  const spTotInvRef = useRef<HTMLSpanElement>(null);
  const spProgressRef = useRef<HTMLSpanElement>(null);
  const spWorkweeksRef = useRef<HTMLSpanElement>(null);
  const spBreakweeksRef = useRef<HTMLSpanElement>(null);
  const spFtweeksRef = useRef<HTMLSpanElement>(null);
  const spWeeктypeRef = useRef<HTMLDivElement>(null);
  const weekNumRef = useRef<HTMLElement>(null);
  const totalWeeksRef = useRef<HTMLSpanElement>(null);
  const weekDatesRef = useRef<HTMLSpanElement>(null);
  const tdWeekRef = useRef<HTMLElement>(null);
  const tdEarnedRef = useRef<HTMLSpanElement>(null);
  const dateStartRef = useRef<HTMLSpanElement>(null);
  const dateEndRef = useRef<HTMLSpanElement>(null);

  // Prev values for tweening
  const prevRef = useRef({
    liq: 0, nw: 0,
    ribbon: { net: 0, tax: 0, spend: 0, cash: 0, inv: 0, hrs: 0, gross: 0 },
    left: { gross: 0, tax: 0, net: 0, spend: 0, bills: 0, cash: 0, invest: 0 },
    bucketPcts: [] as number[],
  });

  function buildWaveform(data: SimDataPoint[]) {
    const maxNet = Math.max(...data.map(d => d.weeklyNet), 1);
    return data.map((d, i) => {
      const h = d.isBreak ? 8 : Math.max(4, (d.weeklyNet / maxNet) * 100);
      const tag = d.isBreak ? '' : d.isFT ? ' (full-time)' : '';
      let cls = d.isBreak
        ? 'wv-bar break-bar'
        : d.isFT
        ? 'wv-bar ft-bar'
        : 'wv-bar';
      // state appended later based on currentIdx
      void i;
      return { h, cls, refund: d.refundThisWeek, tip: `W${d.weekNum}${tag}${d.refundThisWeek ? ' (refund)' : ''}` };
    });
  }

  function renderFrame(idx: number, data: SimDataPoint[]) {
    const d = data[idx];
    if (!d) return;
    const prev = prevRef.current;

    // Week header
    if (weekNumRef.current) weekNumRef.current.textContent = String(d.weekNum);
    if (totalWeeksRef.current) totalWeeksRef.current.textContent = String(data.length);
    if (d.wk && weekDatesRef.current) {
      weekDatesRef.current.textContent = `${fmtDate(d.wk.start)} - ${fmtDate(d.wk.end)}`;
    }

    // Hero
    tween(heroLiquidRef.current, prev.liq, d.liq, '$', 280);
    tween(heroNetWorthRef.current, prev.nw, d.nw, '$', 280);
    if (heroLiquidRef.current) {
      heroLiquidRef.current.style.color = d.isBreak ? 'var(--accent3)' : d.isFT ? '#4caf50' : 'var(--green)';
    }

    const wkIn = Math.round(d.weeklyNet + (d.refundThisWeek && rawState ? rawState.taxreturn : 0));
    const wkOut = Math.round(d.weeklySpend + d.weeklyBills);
    const wkDelta = wkIn - wkOut;
    if (heroDeltaRef.current) {
      heroDeltaRef.current.innerHTML = `<span style="color:var(--green)">+$${wkIn.toLocaleString()} in</span> <span style="color:var(--red)">-$${wkOut.toLocaleString()} out</span> <span style="color:${wkDelta >= 0 ? 'var(--green)' : 'var(--red)'}">(${wkDelta >= 0 ? '+' : '-'}$${Math.abs(wkDelta).toLocaleString()})</span>`;
    }

    // Ribbon
    tween(rbNetRef.current, prev.ribbon.net, d.cNet);
    tween(rbTaxRef.current, prev.ribbon.tax, d.cTax);
    tween(rbSpendRef.current, prev.ribbon.spend, d.cSpend + d.cBills);
    tween(rbCashRef.current, prev.ribbon.cash, d.cCash);
    tween(rbInvRef.current, prev.ribbon.inv, d.inv);
    tween(rbHrsRef.current, prev.ribbon.hrs, d.hours, '');

    // Left panel
    tween(spGrossRef.current, prev.left.gross, Math.round(d.weeklyGross));
    tween(spTaxRef.current, prev.left.tax, Math.round(d.weeklyTax));
    tween(spNetRef.current, prev.left.net, Math.round(d.weeklyNet));
    tween(spSpendRef.current, prev.left.spend, Math.round(d.weeklySpend));
    tween(spBillsRef.current, prev.left.bills, Math.round(d.weeklyBills));
    tween(spCashRef.current, prev.left.cash, Math.round(d.weeklyCash));
    tween(spInvestRef.current, prev.left.invest, Math.round(d.weeklyInvest));
    const $ = (v: number) => '$' + Math.round(v).toLocaleString();
    if (spDripSaveRef.current) spDripSaveRef.current.textContent = $(d.dripSaveWk);
    if (spDripInvRef.current) spDripInvRef.current.textContent = $(d.dripInvWk);
    if (spDirSpendRef.current) spDirSpendRef.current.textContent = $(d.weeklySpend + d.weeklyBills);
    if (spTotSaveRef.current) spTotSaveRef.current.textContent = $(d.weeklyCash + d.dripSaveWk);
    if (spTotInvRef.current) spTotInvRef.current.textContent = $(d.weeklyInvest + d.dripInvWk);

    // Right panel
    if (spProgressRef.current) spProgressRef.current.textContent = Math.round((d.weekNum / data.length) * 100) + '%';
    if (spWorkweeksRef.current) spWorkweeksRef.current.textContent = String(d.workWeeks);
    if (spBreakweeksRef.current) spBreakweeksRef.current.textContent = String(d.breakWeeks);
    if (spFtweeksRef.current) spFtweeksRef.current.textContent = String(d.ftWeeks);
    if (spWeeктypeRef.current) {
      spWeeктypeRef.current.textContent = d.isBreak ? 'This Week (Break)' : d.isFT ? 'This Week (Full-Time)' : 'This Week (Part-Time)';
      spWeeктypeRef.current.style.color = d.isBreak ? 'var(--accent3)' : d.isFT ? '#4caf50' : '';
    }

    // Transport
    if (tdWeekRef.current) tdWeekRef.current.textContent = `W${d.weekNum}${d.isBreak ? ' (break)' : d.isFT ? ' (FT)' : ''}`;
    tween(tdEarnedRef.current, prev.ribbon.gross || 0, d.cGross);

    // Update prev
    prev.liq = d.liq; prev.nw = d.nw;
    prev.ribbon = { net: d.cNet, tax: d.cTax, spend: d.cSpend, cash: d.cCash, inv: d.inv, hrs: d.hours, gross: d.cGross };
    prev.left = { gross: Math.round(d.weeklyGross), tax: Math.round(d.weeklyTax), net: Math.round(d.weeklyNet), spend: Math.round(d.weeklySpend), bills: Math.round(d.weeklyBills), cash: Math.round(d.weeklyCash), invest: Math.round(d.weeklyInvest) };

    // Events
    setEvents(d.events.length > 0 ? d.events : [{ text: 'Nothing notable', cls: '' }]);

    // Buckets arcs
    setBuckets(d.buckets);

    // Waveform
    setWaveformBars(prev2 => prev2.map((bar, i) => ({
      ...bar,
      cls: bar.cls.replace(/ (past|current|future)$/, '') + (i < idx ? ' past' : i === idx ? ' current' : ' future'),
    })));
  }

  function resetPrev() {
    const p = prevRef.current;
    p.liq = 0; p.nw = 0;
    p.ribbon = { net: 0, tax: 0, spend: 0, cash: 0, inv: 0, hrs: 0, gross: 0 };
    p.left = { gross: 0, tax: 0, net: 0, spend: 0, bills: 0, cash: 0, invest: 0 };
    p.bucketPcts = p.bucketPcts.map(() => 0);
  }

  function stopPlay() {
    if (playTimerRef.current) { clearInterval(playTimerRef.current); playTimerRef.current = null; }
    setIsPlaying(false);
  }

  function startPlay(data: SimDataPoint[], startIdx: number) {
    let idx = startIdx;
    if (idx >= data.length - 1) { idx = -1; resetPrev(); }
    setIsPlaying(true);
    const spd = 1300 - speed;
    playTimerRef.current = setInterval(() => {
      const next = idx + 1;
      if (next >= data.length) { stopPlay(); return; }
      idx = next;
      setCurrentIdx(next);
      renderFrame(next, data);
    }, spd);
  }

  const init = useCallback((s: BuckitState) => {
    setRawState(s);
    const data = buildSimData(s);
    if (!data.length) return;
    setSimData(data);
    resetPrev();
    prevRef.current.bucketPcts = data[0]?.buckets?.map(() => 0) ?? [];

    const bars = buildWaveform(data);
    setWaveformBars(bars.map((b, i) => ({
      ...b,
      cls: b.cls + (i < data.length - 1 ? ' past' : ' current'),
    })));

    const lastIdx = data.length - 1;
    setCurrentIdx(lastIdx);

    if (data[0]?.wk && dateStartRef.current) dateStartRef.current.textContent = fmtDate(data[0].wk.start);
    if (data[lastIdx]?.wk && dateEndRef.current) dateEndRef.current.textContent = fmtDate(data[lastIdx].wk.end);

    // Prev values for smooth first render
    if (lastIdx > 0) {
      prevRef.current.liq = data[lastIdx - 1]?.liq ?? 0;
      prevRef.current.nw = data[lastIdx - 1]?.nw ?? 0;
    }

    setTimeout(() => {
      renderFrame(lastIdx, data);
      pushSimComputed(s, data);
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushSimComputed(s: BuckitState, data: SimDataPoint[]) {
    if (!data.length) return;
    simPushTsRef.current = Date.now();
    const final = data[data.length - 1];
    const payload = {
      ...s,
      _simComputed: {
        totalWeeks: data.length,
        workWeeks: final.workWeeks,
        breakWeeks: final.breakWeeks,
        ftWeeks: final.ftWeeks,
        totalHours: final.hours,
        cGross: final.cGross,
        cTax: final.cTax,
        cNet: final.cNet,
        cSpend: final.cSpend,
        cBills: final.cBills,
        cCash: final.cCash,
        cInvest: final.cInvest,
        spendingPower: final.liq,
        investments: final.inv,
        netWorth: final.nw,
        buckets: final.buckets,
        weeks: data.map(d => ({
          week: d.weekNum,
          label: d.wk ? fmtDate(d.wk.start) : '',
          isBreak: d.isBreak,
          isFT: d.isFT,
          net: Math.round(d.weeklyNet),
          spend: Math.round(d.weeklySpend),
          bills: Math.round(d.weeklyBills),
          cash: Math.round(d.weeklyCash),
          invest: Math.round(d.weeklyInvest),
          liq: d.liq,
          nw: d.nw,
        })),
      },
    };

    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  useEffect(() => {
    // Hydrate the persisted store, then prefer the server's copy if present.
    // SSE only connects when the API exists (it doesn't on static hosting).
    let es: EventSource | null = null;
    hydrateStore().then(() => {
      const stored = pickState(useBuckitStore.getState());
      init(stored);

      return fetch('/api/state').then(r => {
        if (!r.ok) return;
        return r.json().then((s: Record<string, unknown>) => {
          if (Object.keys(s).length > 0) init(normalizeState(s, stored));
          es = new EventSource('/api/events');
          es.onmessage = (e) => {
            if (Date.now() - simPushTsRef.current < 500) return;
            try {
              const data = JSON.parse(e.data) as Record<string, unknown>;
              if (Object.keys(data).length === 0) return;
              stopPlay();
              init(normalizeState(data, pickState(useBuckitStore.getState())));
            } catch {}
          };
        });
      });
    }).catch(() => {});

    return () => { es?.close(); stopPlay(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Waveform scrub
  const waveformRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  function idxFromEvent(e: MouseEvent | React.MouseEvent) {
    const el = waveformRef.current;
    if (!el || simData.length === 0) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round((x / rect.width) * (simData.length - 1));
  }

  function scrubTo(idx: number) {
    idx = Math.max(0, Math.min(idx, simData.length - 1));
    if (idx === currentIdx) return;
    setCurrentIdx(idx);
    renderFrame(idx, simData);
  }

  useEffect(() => {
    function onMove(e: MouseEvent) { if (scrubbing.current) scrubTo(idxFromEvent(e)); }
    function onUp() { scrubbing.current = false; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simData, currentIdx]);

  function handleWaveMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    stopPlay();
    scrubbing.current = true;
    scrubTo(idxFromEvent(e));
  }

  function handlePlay() {
    if (isPlaying) { stopPlay(); return; }
    startPlay(simData, currentIdx);
  }

  function handleReset() {
    stopPlay();
    resetPrev();
    setCurrentIdx(0);
    renderFrame(0, simData);
  }

  // Arc ring helper
  const R = 25;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="sim-page">
      <div className="top-bar">
        <Link href="/">Back</Link>
        <div className="week-badge">
          Week <strong ref={weekNumRef as React.RefObject<HTMLElement>}>1</strong> of{' '}
          <span ref={totalWeeksRef}>1</span> &middot; <span ref={weekDatesRef}></span>
        </div>
        <div />
      </div>

      <div className="sim-main">
        {/* Left panel */}
        <div className="side-panel">
          <div className="sp-title" ref={spWeeктypeRef}>This Week</div>
          <div className="sp-row"><span className="sp-label">Gross</span><span className="sp-val" ref={spGrossRef} style={{ color: 'var(--accent)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">Tax</span><span className="sp-val" ref={spTaxRef} style={{ color: 'var(--red)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">Net Pay</span><span className="sp-val" ref={spNetRef} style={{ color: 'var(--green)' }}>$0</span></div>
          <hr className="sp-divider" />
          <div className="sp-row"><span className="sp-label">Spending</span><span className="sp-val" ref={spSpendRef} style={{ color: 'var(--text)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">Bills</span><span className="sp-val" ref={spBillsRef} style={{ color: 'var(--red)' }}>$0</span></div>
          <hr className="sp-divider" />
          <div className="sp-row"><span className="sp-label">Cash</span><span className="sp-val" ref={spCashRef} style={{ color: 'var(--accent2)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">Invested</span><span className="sp-val" ref={spInvestRef} style={{ color: 'var(--accent3)' }}>$0</span></div>
          {rawState?.startMode === 'spread' && (<>
            <div className="sp-row"><span className="sp-label">Drip (Savings)</span><span className="sp-val" ref={spDripSaveRef} style={{ color: 'var(--accent)' }}>$0</span></div>
            <div className="sp-row"><span className="sp-label">Drip (Invest)</span><span className="sp-val" ref={spDripInvRef} style={{ color: 'var(--accent)' }}>$0</span></div>
          </>)}
          <hr className="sp-divider" />
          <div className="sp-title" style={{ marginTop: 4 }}>Direct This Week</div>
          <div className="sp-row"><span className="sp-label">Keep: Spending</span><span className="sp-val" ref={spDirSpendRef} style={{ color: 'var(--text)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">To Savings</span><span className="sp-val" ref={spTotSaveRef} style={{ color: 'var(--accent2)' }}>$0</span></div>
          <div className="sp-row"><span className="sp-label">To Investments</span><span className="sp-val" ref={spTotInvRef} style={{ color: 'var(--accent3)' }}>$0</span></div>
        </div>

        {/* Center stage */}
        <div className="stage">
          <div className="hero">
            <span className="hero-label">Spending Power</span>
            <div className="hero-value" ref={heroLiquidRef} style={{ color: 'var(--green)' }}>$0</div>
            <div className="hero-delta" ref={heroDeltaRef}></div>
            <div className="hero-sub" ref={heroNetWorthRef}>$0</div>
            <span className="hero-sub-label">Net Worth</span>
          </div>
          <div className="ribbon">
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbNetRef} style={{ color: 'var(--green)' }}>$0</span><span className="ribbon-lbl">Net Pay</span></div>
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbTaxRef} style={{ color: 'var(--red)' }}>$0</span><span className="ribbon-lbl">Tax</span></div>
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbSpendRef} style={{ color: 'var(--text)' }}>$0</span><span className="ribbon-lbl">Spent</span></div>
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbCashRef} style={{ color: 'var(--accent2)' }}>$0</span><span className="ribbon-lbl">Net Earned</span></div>
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbInvRef} style={{ color: 'var(--accent3)' }}>$0</span><span className="ribbon-lbl">Invested</span></div>
            <div className="ribbon-stat"><span className="ribbon-val" ref={rbHrsRef} style={{ color: 'var(--text)' }}>0</span><span className="ribbon-lbl">Hours</span></div>
          </div>
          <div className="arcs">
            {buckets.map((b, i) => {
              const offset = CIRC - (CIRC * Math.min(100, b.pct) / 100);
              const full = b.pct >= 100;
              const color = full ? 'var(--green)' : b.pct > 50 ? 'var(--accent2)' : 'var(--accent)';
              return (
                <div key={i} className="arc-item">
                  <div className="arc-ring">
                    <svg viewBox="0 0 60 60" width="60" height="60">
                      <circle cx="30" cy="30" r={R} fill="none" stroke="var(--border)" strokeWidth="3" />
                      <circle cx="30" cy="30" r={R} fill="none" stroke={color} strokeWidth="3"
                        strokeDasharray={CIRC} strokeDashoffset={offset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.3s' }} />
                    </svg>
                    <div className="arc-pct" style={{ color: full ? 'var(--green)' : 'var(--text)' }}>{b.pct}%</div>
                  </div>
                  <div className="arc-name">{b.name}</div>
                  <div className="arc-funded">${b.funded.toLocaleString()} / ${b.target.toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="side-panel">
          <div className="sp-title">Progress</div>
          <div className="sp-row"><span className="sp-label">Progress</span><span className="sp-val" ref={spProgressRef} style={{ color: 'var(--accent)' }}>0%</span></div>
          <div className="sp-row"><span className="sp-label">Work Weeks</span><span className="sp-val" ref={spWorkweeksRef} style={{ color: 'var(--text)' }}>0</span></div>
          <div className="sp-row"><span className="sp-label">Break Weeks</span><span className="sp-val" ref={spBreakweeksRef} style={{ color: 'var(--accent3)' }}>0</span></div>
          <div className="sp-row"><span className="sp-label">FT Weeks</span><span className="sp-val" ref={spFtweeksRef} style={{ color: '#4caf50' }}>0</span></div>
          <div style={{ marginTop: 8 }}>
            <div className="sp-title">Events</div>
            <div className="event-log">
              {events.map((ev, i) => (
                <div key={i} className={`evt show${ev.cls ? ' ' + ev.cls : ''}`}>{ev.text}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Transport */}
      <div className="transport">
        <div
          className="waveform"
          ref={waveformRef}
          onMouseDown={handleWaveMouseDown}
        >
          {waveformBars.map((bar, i) => {
            const isC = i === currentIdx;
            const isPast = i < currentIdx;
            const isFut = i > currentIdx;
            const base = bar.cls.split(' ').find(c => c === 'wv-bar') ? bar.cls.split(' ').filter(c => !['past','current','future'].includes(c)).join(' ') : bar.cls;
            const stateClass = isC ? 'current' : isPast ? 'past' : 'future';
            void isFut;
            return (
              <div
                key={i}
                className={`${base} ${stateClass}${bar.refund ? ' refund-bar' : ''}`}
                style={{ height: `${bar.h}%` }}
                title={bar.tip}
              />
            );
          })}
        </div>
        <div className="dates-row">
          <span ref={dateStartRef}></span>
          <span ref={dateEndRef}></span>
        </div>
        <div className="controls-row">
          <button className="ctrl-btn" onClick={handleReset} title="Reset">↩</button>
          <button className={`ctrl-btn${isPlaying ? ' playing' : ''}`} onClick={handlePlay} title="Play">
            {isPlaying ? '⏸' : '▶'}
          </button>
          <div className="time-display">
            <strong ref={tdWeekRef}>W1</strong> &middot; <span ref={tdEarnedRef}>$0</span> earned
          </div>
          <div className="speed-ctrl">
            <label>Speed</label>
            <input
              type="range" min={50} max={1200} step={50} value={speed}
              onChange={e => {
                const s = Number(e.target.value);
                setSpeed(s);
                if (isPlaying) { stopPlay(); startPlay(simData, currentIdx); }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
