'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  aggregateCandles,
  analyze,
  evaluatePriceActionStrategy,
  upsertLiveMinute,
  type Analysis,
  type Candle,
  type PriceActionStrategy,
} from '../lib/smc';
import {
  closeDemoPosition,
  createDemoAccount,
  demoAccountEquity,
  demoBotGate,
  CHALLENGE_LEVELS,
  processDemoBot,
  restoreDemoAccount,
  type DemoAccount,
} from '../lib/demo-bot';

const TIMEFRAMES = {
  '1m': { label: '2M', interval: 60_000, bars: 72 },
  '5m': { label: '5M', interval: 5 * 60_000, bars: 64 },
  '1h': { label: '1H', interval: 60 * 60_000, bars: 48 },
} as const;

const MARKETS = {
  xau: {
    pairLabel: 'XAU / USD',
    chartLabel: 'XAU/USD',
    unit: 'XAU',
    storageKey: 'tjl1-challenge-bot-xau-v2',
  },
  btc: {
    pairLabel: 'BTC / USD',
    chartLabel: 'BTC/USD',
    unit: 'BTC',
    storageKey: 'tjl1-challenge-bot-btc-v2',
  },
} as const;

type Timeframe = keyof typeof TIMEFRAMES;
type MarketId = keyof typeof MARKETS;
type Layer = 'structure' | 'liquidity' | 'delivery' | 'tjl1';
type FocusMode = 'clean' | 'structure' | 'liquidity' | 'entry';
type ConceptKey = keyof typeof GLOSSARY;

const GLOSSARY = {
  bullish: {
    group: 'Structure', term: 'Bullish structure', short: 'HH + HL',
    definition: 'Meaningful swing highs and swing lows are advancing: higher highs and higher lows.',
    confirmation: 'Use completed swing points, not every candle. Structure describes the current path; it never guarantees the next leg.',
    mistake: 'Calling the market bullish because of one green candle or one minor high break.',
  },
  bearish: {
    group: 'Structure', term: 'Bearish structure', short: 'LL + LH',
    definition: 'Meaningful swing highs and swing lows are declining: lower lows and lower highs.',
    confirmation: 'Look for repeated structural progression. A rally can be only a retracement inside bearish structure.',
    mistake: 'Treating every bullish retracement as a complete trend reversal.',
  },
  swing: {
    group: 'Structure', term: 'Swing high / swing low', short: 'Swing',
    definition: 'A visible turning point surrounded by lower highs or higher lows. It becomes a structural reference.',
    confirmation: 'The chart waits for candles on the right side of the turning point, so a swing is confirmed with delay.',
    mistake: 'Using an unconfirmed current candle as a permanent swing.',
  },
  bos: {
    group: 'Structure', term: 'Break of Structure', short: 'BOS',
    definition: 'A decisive break in the direction of the prevailing market structure, usually supporting continuation.',
    confirmation: 'This terminal requires a close through a prior swing plus displacement near the break.',
    mistake: 'Labeling a wick through a level as a confirmed BOS.',
  },
  mss: {
    group: 'Structure', term: 'Market Structure Shift', short: 'MSS',
    definition: 'A displacement break against the prior short-term structure, often after liquidity has been taken.',
    confirmation: 'A meaningful structural point must break with a close and force—not merely an engulf of one small candle.',
    mistake: 'Calling an engulfing candle an MSS when it breaks no meaningful swing.',
  },
  bsl: {
    group: 'Liquidity', term: 'Buy-side liquidity', short: 'BSL',
    definition: 'Orders expected above visible highs, including short stops and breakout-buy orders.',
    confirmation: 'Swing highs, equal highs, previous highs and session highs are common reference points.',
    mistake: 'Assuming price must reverse after reaching buy-side liquidity; it may run through it.',
  },
  ssl: {
    group: 'Liquidity', term: 'Sell-side liquidity', short: 'SSL',
    definition: 'Orders expected below visible lows, including long stops and breakout-sell orders.',
    confirmation: 'Swing lows, equal lows, previous lows and session lows are common reference points.',
    mistake: 'Assuming a low is safe support simply because liquidity rests beneath it.',
  },
  equal: {
    group: 'Liquidity', term: 'Equal highs / equal lows', short: 'EQH / EQL',
    definition: 'Two or more visible highs or lows formed at similar prices, making the orders beyond them an obvious objective.',
    confirmation: 'The terminal uses an ATR-based tolerance so “equal” means similar, not mathematically identical.',
    mistake: 'Forcing equality between levels that are far apart relative to current volatility.',
  },
  sweep: {
    group: 'Liquidity', term: 'Liquidity sweep / raid', short: 'Sweep',
    definition: 'Price trades beyond a liquidity level and then closes back through it, showing rejection.',
    confirmation: 'A sweep provides context. Look for displacement and an MSS before calling a reversal confirmed.',
    mistake: 'Entering solely because a wick crossed a prior high or low.',
  },
  run: {
    group: 'Liquidity', term: 'Liquidity run', short: 'Run',
    definition: 'Price trades through a liquidity level and closes beyond it, continuing toward another objective.',
    confirmation: 'Acceptance and continued delivery beyond the level distinguish a run from a rejection.',
    mistake: 'Automatically fading every liquidity level instead of allowing continuation.',
  },
  dol: {
    group: 'Liquidity', term: 'Draw on liquidity', short: 'DOL',
    definition: 'The liquidity pool your narrative identifies as the more likely price objective.',
    confirmation: 'It should agree with higher-timeframe structure, location, time and current delivery.',
    mistake: 'Treating the draw as a guaranteed destination rather than a testable hypothesis.',
  },
  displacement: {
    group: 'Delivery', term: 'Displacement', short: 'Displacement',
    definition: 'A forceful directional move with relatively large candle bodies and limited overlap.',
    confirmation: 'The terminal compares body size with the previous ten candles and requires a directional body over 62% of range.',
    mistake: 'Calling any large wick displacement when the candle body shows no directional acceptance.',
  },
  fvg: {
    group: 'Delivery', term: 'Fair value gap', short: 'FVG',
    definition: 'A three-candle imbalance where part of candle two’s move is not overlapped by candle one and candle three.',
    confirmation: 'Bullish: candle three low is above candle one high. Bearish: candle three high is below candle one low.',
    mistake: 'Treating every FVG as an automatic entry or assuming every gap must fill.',
  },
  orderblock: {
    group: 'Delivery', term: 'Order block', short: 'OB',
    definition: 'In ICT terminology, the final opposing candle before displacement that produces a meaningful structural result.',
    confirmation: 'The terminal only marks an opposing candle connected to a displacement-confirmed BOS or MSS.',
    mistake: 'Labeling every last red or green candle as an institutional order block.',
  },
  dealing: {
    group: 'Location', term: 'Dealing range', short: 'Range',
    definition: 'A meaningful low-to-high or high-to-low leg used to frame location and likely objectives.',
    confirmation: 'The current approximation uses the most recent 120 bars; discretionary analysis may select a larger external range.',
    mistake: 'Changing the range merely to make an entry appear to be in premium or discount.',
  },
  premium: {
    group: 'Location', term: 'Premium / discount', short: 'P / D',
    definition: 'Above the dealing-range midpoint is premium; below it is discount. The midpoint is equilibrium.',
    confirmation: 'Location filters a narrative: shorts are generally more attractive in premium and longs in discount.',
    mistake: 'Selling premium or buying discount without liquidity and delivery confirmation.',
  },
  sessions: {
    group: 'Timing', term: 'Sessions / kill zones', short: 'Sessions',
    definition: 'Time windows where liquidity and volatility often concentrate, including London and New York AM.',
    confirmation: 'This terminal shades 03:00–06:00 and 08:30–11:00 New York time.',
    mistake: 'Assuming the clock alone creates a valid setup.',
  },
  dxy: {
    group: 'Context', term: 'DXY context', short: 'DXY',
    definition: 'The US Dollar Index tracks the dollar against a basket of major currencies. Gold and Bitcoin can move inversely to it, but both relationships vary and can diverge.',
    confirmation: 'Use DXY only to describe the surrounding market: rising, falling, inverse alignment or divergence. Every setup must still confirm itself on its own chart.',
    mistake: 'Treating a DXY move as an entry signal or allowing it to override the selected market’s liquidity, structure and confirmation.',
  },
  tjl1: {
    group: 'Execution', term: 'TJL1 working rule', short: 'TJL1',
    definition: 'Current draft: a confirmed swing creates a level, followed by sweep, retracement and engulfing-trigger stages.',
    confirmation: 'This preserves the mechanical rule from the original code while we refine your exact personal TJL1 definition.',
    mistake: 'Confusing this draft detector with a universally standardized ICT model.',
  },
  aplus: {
    group: 'Execution', term: 'A+ alignment', short: 'A+',
    definition: 'A fully triggered execution sequence whose direction agrees with the latest higher-timeframe bias.',
    confirmation: 'The terminal requires every strategy stage in order and compares the 5-minute trigger with its 1-hour structural bias.',
    mistake: 'Using the A+ badge as certainty or ignoring invalidation and risk.',
  },
  smr: {
    group: 'Execution', term: 'Sweep → MSS → Retest model', short: 'SMR',
    definition: 'The terminal’s price-action strategy: 1-hour bias, 5-minute location, opposing liquidity sweep, displacement MSS, POI retest and engulfing confirmation.',
    confirmation: 'Every stage must complete in order. A sweep without an MSS is context; a retest without an engulfing close is only an armed idea.',
    mistake: 'Skipping a missing condition because the move looks likely or entering after price has already left the POI.',
  },
} as const;

type ChartLayers = Record<Layer, boolean>;
type HitBox = { x: number; y: number; w: number; h: number; concept: ConceptKey };

const FOCUS_PRESETS: Record<FocusMode, ChartLayers> = {
  clean: { structure: false, liquidity: false, delivery: false, tjl1: false },
  structure: { structure: true, liquidity: false, delivery: false, tjl1: false },
  liquidity: { structure: false, liquidity: true, delivery: false, tjl1: false },
  entry: { structure: true, liquidity: true, delivery: true, tjl1: true },
};

function estParts(time: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(time));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
  const minuteValue = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return { hour, minute: minuteValue, decimal: hour + minuteValue / 60 };
}

function formatPrice(price: number | null | undefined) {
  return Number.isFinite(price) ? Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function formatMoney(value: number) {
  const amount = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}$${amount}`;
}

function formatTime(time: number, withDate = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(time));
}

function MarketChart({
  candles,
  analysis,
  strategy,
  layers,
  timeframe,
  marketLabel,
  onSelect,
}: {
  candles: Candle[];
  analysis: Analysis;
  strategy?: PriceActionStrategy;
  layers: ChartLayers;
  timeframe: Timeframe;
  marketLabel: string;
  onSelect: (concept: ConceptKey) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitBoxes = useRef<HitBox[]>([]);
  const [size, setSize] = useState({ width: 900, height: 540 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry.contentRect.width));
      const height = Math.max(360, Math.round(entry.contentRect.height));
      setSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    hitBoxes.current = [];

    const colors = {
      grid: '#202a23', muted: '#6f7c73', ink: '#dce5dc', green: '#62d394', red: '#f06b5c',
      amber: '#d3a646', blue: '#61a9d8', purple: '#a58bd4', background: '#0a0f0c',
    };
    const visibleCount = TIMEFRAMES[timeframe].bars;
    const startIndex = Math.max(0, candles.length - visibleCount);
    const visible = candles.slice(startIndex);
    const rawHigh = Math.max(...visible.map((candle) => candle.high));
    const rawLow = Math.min(...visible.map((candle) => candle.low));
    const pricePadding = Math.max((rawHigh - rawLow) * 0.08, analysis.atr * 0.6);
    const highest = rawHigh + pricePadding;
    const lowest = rawLow - pricePadding;
    const left = 12;
    const right = size.width - 76;
    const top = 16;
    const bottom = size.height - 38;
    const xStep = (right - left) / Math.max(visible.length, 1);
    const x = (globalIndex: number) => left + (globalIndex - startIndex + 0.5) * xStep;
    const y = (price: number) => top + ((highest - price) / Math.max(highest - lowest, 1e-9)) * (bottom - top);
    const inView = (index: number) => index >= startIndex && index < candles.length;
    const priceInView = (price: number) => price >= lowest && price <= highest;

    context.fillStyle = colors.background;
    context.fillRect(0, 0, size.width, size.height);

    visible.forEach((candle, localIndex) => {
      const session = estParts(candle.time).decimal;
      if ((session >= 3 && session < 6) || (session >= 8.5 && session < 11)) {
        context.fillStyle = session < 6 ? 'rgba(97,169,216,0.035)' : 'rgba(211,166,70,0.04)';
        context.fillRect(left + localIndex * xStep, top, xStep + 1, bottom - top);
      }
    });

    if (layers.structure) {
      const rangeTop = y(analysis.range.high);
      const rangeMiddle = y(analysis.range.equilibrium);
      const rangeBottom = y(analysis.range.low);
      context.fillStyle = 'rgba(240,107,92,0.025)';
      context.fillRect(left, rangeTop, right - left, Math.max(0, rangeMiddle - rangeTop));
      context.fillStyle = 'rgba(98,211,148,0.025)';
      context.fillRect(left, rangeMiddle, right - left, Math.max(0, rangeBottom - rangeMiddle));
      context.setLineDash([4, 5]); context.strokeStyle = 'rgba(211,166,70,.35)';
      context.beginPath(); context.moveTo(left, rangeMiddle); context.lineTo(right, rangeMiddle); context.stroke(); context.setLineDash([]);
    }

    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'middle';
    for (let line = 0; line <= 5; line += 1) {
      const py = top + line * ((bottom - top) / 5);
      const price = highest - line * ((highest - lowest) / 5);
      context.strokeStyle = colors.grid; context.lineWidth = 1;
      context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke();
      context.fillStyle = colors.muted; context.fillText(formatPrice(price), right + 8, py);
    }

    const occupied: HitBox[] = [];
    const addLabel = (text: string, px: number, py: number, color: string, concept: ConceptKey, align: CanvasTextAlign = 'left') => {
      context.font = '10px ui-monospace, monospace';
      const width = context.measureText(text).width + 8;
      const drawX = align === 'right' ? px - width : align === 'center' ? px - width / 2 : px;
      const offsets = [0, -18, 18, -36, 36];
      const candidate = offsets
        .map((offset) => ({ x: Math.max(left, Math.min(drawX, right - width)), y: Math.max(top + 9, Math.min(py + offset, bottom - 9)), w: width, h: 18, concept }))
        .find((box) => !occupied.some((used) => box.x < used.x + used.w + 4 && box.x + box.w + 4 > used.x && box.y - 9 < used.y + used.h && box.y + 9 > used.y));
      if (!candidate) return;
      occupied.push(candidate);
      const textX = align === 'right' ? candidate.x + width - 4 : align === 'center' ? candidate.x + width / 2 : candidate.x + 4;
      context.fillStyle = 'rgba(8,11,9,.9)'; context.fillRect(candidate.x, candidate.y - 8, width, 16);
      context.fillStyle = color; context.textAlign = align; context.fillText(text, textX, candidate.y);
      context.textAlign = 'left';
      hitBoxes.current.push({ x: candidate.x, y: candidate.y - 10, w: width, h: 20, concept });
    };

    if (layers.delivery) {
      analysis.gaps.filter((gap) => gap.index >= startIndex - 2 && gap.bottom <= highest && gap.top >= lowest).slice(-3).forEach((gap) => {
        const px = Math.max(left, x(gap.index - 2));
        const color = gap.direction === 'bullish' ? colors.green : colors.red;
        context.fillStyle = gap.direction === 'bullish' ? 'rgba(98,211,148,.09)' : 'rgba(240,107,92,.09)';
        context.fillRect(px, y(gap.top), right - px, Math.max(2, y(gap.bottom) - y(gap.top)));
        context.strokeStyle = color; context.globalAlpha = 0.35; context.strokeRect(px, y(gap.top), right - px, Math.max(2, y(gap.bottom) - y(gap.top))); context.globalAlpha = 1;
        if (inView(gap.index)) addLabel('FVG', Math.min(right - 30, px + 4), y((gap.top + gap.bottom) / 2), color, 'fvg');
      });
      analysis.orderBlocks.filter((block) => block.originIndex >= startIndex - 3 && block.bottom <= highest && block.top >= lowest).slice(-2).forEach((block) => {
        const px = Math.max(left, x(block.originIndex) - xStep * 0.55);
        const color = block.direction === 'bullish' ? colors.green : colors.red;
        context.fillStyle = block.direction === 'bullish' ? 'rgba(98,211,148,.075)' : 'rgba(240,107,92,.075)';
        context.fillRect(px, y(block.top), right - px, Math.max(3, y(block.bottom) - y(block.top)));
        if (inView(block.originIndex)) addLabel(`${block.direction === 'bullish' ? 'BULL' : 'BEAR'} OB`, px + 3, y(block.top) - 9, color, 'orderblock');
      });
    }

    if (layers.liquidity) {
      const visiblePools = analysis.liquidity.filter((pool) => pool.index >= startIndex - 12 && priceInView(pool.price));
      const featuredPools = [
        ...visiblePools.filter((pool) => pool.equal).slice(-2),
        visiblePools.filter((pool) => pool.type === 'bsl').at(-1),
        visiblePools.filter((pool) => pool.type === 'ssl').at(-1),
      ].filter((pool, index, all) => pool && all.findIndex((item) => item?.index === pool.index && item?.type === pool.type) === index);
      featuredPools.forEach((pool) => {
        if (!pool) return;
        const color = pool.type === 'bsl' ? colors.amber : colors.blue;
        context.setLineDash(pool.equal ? [6, 4] : [3, 5]); context.strokeStyle = color; context.globalAlpha = pool.equal ? 0.68 : 0.36;
        context.beginPath(); context.moveTo(Math.max(left, x(pool.sourceIndex ?? pool.index)), y(pool.price)); context.lineTo(right, y(pool.price)); context.stroke();
        context.setLineDash([]); context.globalAlpha = 1;
        addLabel(pool.equal ? (pool.type === 'bsl' ? 'EQH · BSL' : 'EQL · SSL') : pool.type.toUpperCase(), right - 4, y(pool.price) - 10, color, pool.equal ? 'equal' : pool.type, 'right');
      });
    }

    if (layers.tjl1) {
      analysis.tjls.filter((tjl) => tjl.formedIndex >= startIndex - 12 && priceInView(tjl.level)).slice(-2).forEach((tjl) => {
        const color = tjl.direction === 'LONG' ? colors.green : colors.red;
        context.setLineDash([8, 5]); context.strokeStyle = color; context.globalAlpha = 0.5;
        context.beginPath(); context.moveTo(Math.max(left, x(tjl.formedIndex)), y(tjl.level)); context.lineTo(right, y(tjl.level)); context.stroke();
        context.setLineDash([]); context.globalAlpha = 1;
        addLabel(`TJL1 ${tjl.direction}`, right - 4, y(tjl.level) + 11, color, 'tjl1', 'right');
      });

      if (strategy?.poi && strategy.poi.bottom <= highest && strategy.poi.top >= lowest) {
        const px = strategy.mssIndex !== undefined && inView(strategy.mssIndex) ? x(strategy.mssIndex) : left;
        const color = strategy.direction === 'SHORT' ? colors.red : colors.green;
        context.fillStyle = strategy.direction === 'SHORT' ? 'rgba(240,107,92,.13)' : 'rgba(98,211,148,.13)';
        context.fillRect(Math.max(left, px), y(strategy.poi.top), right - Math.max(left, px), Math.max(3, y(strategy.poi.bottom) - y(strategy.poi.top)));
        addLabel(`SETUP ${strategy.poi.type}`, right - 4, y((strategy.poi.top + strategy.poi.bottom) / 2), color, strategy.poi.type === 'FVG' ? 'fvg' : 'orderblock', 'right');
      }

      const planLevels = [
        { label: 'ENTRY', price: strategy?.entry, color: colors.ink },
        { label: 'STOP', price: strategy?.stop, color: colors.red },
        { label: '5R', price: strategy?.target, color: colors.green },
      ];
      planLevels.forEach((level) => {
        if (level.price === undefined || !priceInView(level.price)) return;
        context.setLineDash([7, 5]); context.strokeStyle = level.color; context.globalAlpha = 0.7;
        context.beginPath(); context.moveTo(left, y(level.price)); context.lineTo(right, y(level.price)); context.stroke();
        context.setLineDash([]); context.globalAlpha = 1;
        addLabel(`${level.label} ${formatPrice(level.price)}`, right - 4, y(level.price), level.color, 'aplus', 'right');
      });
    }

    visible.forEach((candle, localIndex) => {
      const globalIndex = startIndex + localIndex;
      const px = x(globalIndex);
      const up = candle.close >= candle.open;
      const color = up ? colors.green : colors.red;
      context.strokeStyle = color; context.lineWidth = 1;
      context.beginPath(); context.moveTo(px, y(candle.high)); context.lineTo(px, y(candle.low)); context.stroke();
      context.fillStyle = color;
      const bodyTop = Math.min(y(candle.open), y(candle.close));
      context.fillRect(px - Math.max(1.5, xStep * 0.29), bodyTop, Math.max(3, xStep * 0.58), Math.max(1.5, Math.abs(y(candle.close) - y(candle.open))));
    });

    if (layers.structure) {
      analysis.pivots.filter((pivot) => inView(pivot.index)).slice(-10).forEach((pivot) => {
        const color = pivot.type === 'high' ? colors.red : colors.green;
        const py = y(pivot.price) + (pivot.type === 'high' ? -12 : 14);
        addLabel(pivot.label, x(pivot.index), py, color, pivot.label === 'HH' || pivot.label === 'HL' ? 'bullish' : pivot.label === 'LH' || pivot.label === 'LL' ? 'bearish' : 'swing', 'center');
      });
      analysis.breaks.filter((event) => inView(event.index)).slice(-3).forEach((event) => {
        const color = event.direction === 'bullish' ? colors.green : colors.red;
        context.strokeStyle = color; context.lineWidth = 2; context.setLineDash([5, 3]);
        context.beginPath(); context.moveTo(Math.max(left, x(event.index - 5)), y(event.level)); context.lineTo(x(event.index), y(event.level)); context.stroke(); context.setLineDash([]);
        addLabel(`${event.direction === 'bullish' ? 'BULL' : 'BEAR'} ${event.kind}`, x(event.index), y(event.level) + (event.direction === 'bullish' ? -15 : 15), color, event.kind === 'MSS' ? 'mss' : 'bos', 'center');
      });
    }

    if (layers.delivery) {
      analysis.displacement.filter((event) => inView(event.index)).slice(-8).forEach((event) => {
        const candle = candles[event.index];
        const color = event.direction === 'bullish' ? colors.green : colors.red;
        const py = event.direction === 'bullish' ? y(candle.low) + 10 : y(candle.high) - 10;
        context.fillStyle = color; context.beginPath();
        if (event.direction === 'bullish') { context.moveTo(x(event.index), py - 6); context.lineTo(x(event.index) - 4, py + 2); context.lineTo(x(event.index) + 4, py + 2); }
        else { context.moveTo(x(event.index), py + 6); context.lineTo(x(event.index) - 4, py - 2); context.lineTo(x(event.index) + 4, py - 2); }
        context.fill();
      });
    }

    if (layers.liquidity) {
      analysis.sweeps.filter((event) => inView(event.index)).slice(-3).forEach((event) => {
        const candle = candles[event.index];
        const isHigh = event.type === 'bsl';
        const color = event.result === 'sweep' ? colors.amber : colors.purple;
        const py = y(isHigh ? candle.high : candle.low);
        context.strokeStyle = color; context.lineWidth = 2; context.beginPath(); context.arc(x(event.index), py, 6, 0, Math.PI * 2); context.stroke();
        addLabel(event.result === 'sweep' ? 'SWEEP' : 'RUN', x(event.index), py + (isHigh ? -15 : 15), color, event.result, 'center');
      });
    }

    const last = visible.at(-1);
    if (last) {
      const py = y(last.close);
      context.strokeStyle = last.close >= last.open ? colors.green : colors.red; context.setLineDash([2, 3]);
      context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke(); context.setLineDash([]);
      context.fillStyle = last.close >= last.open ? colors.green : colors.red;
      context.fillRect(right + 3, py - 10, 70, 20);
      context.fillStyle = '#07100a'; context.font = '10px ui-monospace, monospace'; context.fillText(formatPrice(last.close), right + 8, py);
    }

    const tickEvery = Math.max(1, Math.floor(visible.length / 6));
    visible.forEach((candle, index) => {
      if (index % tickEvery !== 0 && index !== visible.length - 1) return;
      context.fillStyle = colors.muted; context.font = '9px ui-monospace, monospace';
      context.fillText(formatTime(candle.time, timeframe === '1h'), left + index * xStep, bottom + 20);
    });
  }, [analysis, candles, layers, size, strategy, timeframe]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const target = [...hitBoxes.current].reverse().find((box) => px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h);
    if (target) onSelect(target.concept);
  };

  return <canvas ref={canvasRef} className="market-chart" onClick={handleClick} aria-label={`Automatically annotated ${marketLabel} Smart Money Concepts chart`} />;
}

type DetectionEvent = { index: number; concept: ConceptKey; label: string; detail: string; time: number };

type XausDataState = {
  status?: 'fresh' | 'stale' | 'unavailable';
  as_of?: string;
  age_seconds?: number;
};

type XausSpotResponse = {
  xau?: { price?: number };
  data_state?: XausDataState;
  updated_at?: string;
};

type XausIntradayResponse = {
  points?: { t?: number; p?: number }[];
};

type GoldApiResponse = {
  price?: number;
  updatedAt?: string;
};

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];

type KrakenOhlcResponse = {
  error?: string[];
  result?: Record<string, KrakenOhlcRow[] | number>;
};

type KrakenTickerRow = { c?: string[] };

type KrakenTickerResponse = {
  error?: string[];
  result?: Record<string, KrakenTickerRow>;
};

type HistorySource = 'none' | 'xaus' | 'paxg-proxy' | 'kraken-btc';
type FeedStatus = 'connecting' | 'live' | 'backup' | 'stale' | 'offline';
type MarketFeed = {
  oneMinuteCandles: Candle[];
  status: FeedStatus;
  historySource: HistorySource;
  quote: number | null;
  previousQuote: number | null;
  sourceTime: number | null;
};

type FrankfurterHistoryResponse = {
  rates?: Record<string, Record<string, number>>;
};

type DxyPoint = { date: string; value: number };

function calculateDxy(rates: Record<string, number>) {
  const eurUsd = 1 / Number(rates.EUR);
  const usdJpy = Number(rates.JPY);
  const gbpUsd = 1 / Number(rates.GBP);
  const usdCad = Number(rates.CAD);
  const usdSek = Number(rates.SEK);
  const usdChf = Number(rates.CHF);
  const components = [eurUsd, usdJpy, gbpUsd, usdCad, usdSek, usdChf];
  if (components.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return 50.14348112
    * (eurUsd ** -0.576)
    * (usdJpy ** 0.136)
    * (gbpUsd ** -0.119)
    * (usdCad ** 0.091)
    * (usdSek ** 0.042)
    * (usdChf ** 0.036);
}

function dxyPointsFromRates(rates: Record<string, Record<string, number>>): DxyPoint[] {
  return Object.entries(rates).flatMap(([date, dailyRates]) => {
    const value = calculateDxy(dailyRates);
    return value === null ? [] : [{ date, value }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function percentChange(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

function dxyDirection(change: number) {
  if (change > 0.05) return 'RISING';
  if (change < -0.05) return 'FALLING';
  return 'FLAT';
}

function xausPointsToCandles(points: { t?: number; p?: number }[]): Candle[] {
  let previous: number | null = null;
  return points.flatMap((point) => {
    const close = Number(point.p);
    const seconds = Number(point.t);
    if (!Number.isFinite(close) || !Number.isFinite(seconds)) return [];
    const open = previous ?? close;
    previous = close;
    return [{
      time: Math.floor((seconds * 1_000) / 60_000) * 60_000,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    }];
  });
}

function krakenOhlcToCandles(payload: KrakenOhlcResponse): Candle[] {
  if (payload.error?.length || !payload.result) return [];
  const pair = Object.entries(payload.result).find(([key, value]) => key !== 'last' && Array.isArray(value));
  if (!pair || !Array.isArray(pair[1])) return [];
  return (pair[1] as KrakenOhlcRow[]).flatMap((row) => {
    const time = Number(row[0]) * 1_000;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    return [time, open, high, low, close].every(Number.isFinite)
      ? [{ time, open, high, low, close }]
      : [];
  });
}

function krakenTickerPrice(payload: KrakenTickerResponse) {
  if (payload.error?.length || !payload.result) return null;
  const ticker = Object.values(payload.result)[0];
  const price = Number(ticker?.c?.[0]);
  return Number.isFinite(price) ? price : null;
}

function createMarketFeed(): MarketFeed {
  return {
    oneMinuteCandles: [],
    status: 'connecting',
    historySource: 'none',
    quote: null,
    previousQuote: null,
    sourceTime: null,
  };
}

function buildEvents(candles: Candle[], analysis: Analysis): DetectionEvent[] {
  const events: DetectionEvent[] = [];
  analysis.sweeps.forEach((event) => events.push({
    index: event.index,
    concept: event.result,
    label: `${event.type.toUpperCase()} ${event.result === 'sweep' ? 'liquidity sweep' : 'liquidity run'}`,
    detail: formatPrice(event.level), time: candles[event.index]?.time ?? 0,
  }));
  analysis.breaks.forEach((event) => events.push({
    index: event.index, concept: event.kind === 'MSS' ? 'mss' : 'bos',
    label: `${event.direction === 'bullish' ? 'Bullish' : 'Bearish'} ${event.kind}`,
    detail: formatPrice(event.level), time: candles[event.index]?.time ?? 0,
  }));
  analysis.displacement.forEach((event) => events.push({
    index: event.index, concept: 'displacement', label: `${event.direction === 'bullish' ? 'Bullish' : 'Bearish'} displacement`,
    detail: 'force detected', time: candles[event.index]?.time ?? 0,
  }));
  analysis.gaps.forEach((event) => events.push({
    index: event.index, concept: 'fvg', label: `${event.direction === 'bullish' ? 'Bullish' : 'Bearish'} FVG`,
    detail: `${formatPrice(event.bottom)}–${formatPrice(event.top)}`, time: candles[event.index]?.time ?? 0,
  }));
  analysis.orderBlocks.forEach((event) => events.push({
    index: event.originIndex, concept: 'orderblock', label: `${event.direction === 'bullish' ? 'Bullish' : 'Bearish'} order block`,
    detail: `${formatPrice(event.bottom)}–${formatPrice(event.top)}`, time: candles[event.originIndex]?.time ?? 0,
  }));
  analysis.liquidity.filter((pool) => pool.equal).forEach((pool) => events.push({
    index: pool.index, concept: 'equal', label: pool.type === 'bsl' ? 'Equal highs · BSL' : 'Equal lows · SSL',
    detail: formatPrice(pool.price), time: candles[pool.index]?.time ?? 0,
  }));
  const unique = new Map<string, DetectionEvent>();
  events.forEach((event) => unique.set(`${event.index}-${event.concept}`, event));
  return [...unique.values()].sort((a, b) => b.index - a.index).slice(0, 20);
}

export default function Home() {
  const [marketId, setMarketId] = useState<MarketId>('xau');
  const [marketFeeds, setMarketFeeds] = useState<Record<MarketId, MarketFeed>>(() => ({
    xau: createMarketFeed(),
    btc: createMarketFeed(),
  }));
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [focusMode, setFocusMode] = useState<FocusMode | 'custom'>('clean');
  const [layers, setLayers] = useState<ChartLayers>(FOCUS_PRESETS.clean);
  const [panelOpen, setPanelOpen] = useState(true);
  const [dxySeries, setDxySeries] = useState<DxyPoint[]>([]);
  const [dxyStatus, setDxyStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [selectedConcept, setSelectedConcept] = useState<ConceptKey>('mss');
  const [panelTab, setPanelTab] = useState<'strategy' | 'bot' | 'live' | 'learn'>('strategy');
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<Record<MarketId, DemoAccount>>(() => ({
    xau: createDemoAccount(),
    btc: createDemoAccount(),
  }));
  const historyProvider = useRef<Record<MarketId, HistorySource>>({ xau: 'none', btc: 'none' });
  const primaryFailures = useRef(0);
  const primaryRetryAfter = useRef(0);
  const demoHydrated = useRef(false);
  const marketConfig = MARKETS[marketId];
  const activeFeed = marketFeeds[marketId];
  const { oneMinuteCandles, status, historySource, quote, previousQuote, sourceTime } = activeFeed;
  const demoAccount = demoAccounts[marketId];

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      setDemoAccounts({
        xau: restoreDemoAccount(window.localStorage.getItem(MARKETS.xau.storageKey)),
        btc: restoreDemoAccount(window.localStorage.getItem(MARKETS.btc.storageKey)),
      });
      demoHydrated.current = true;
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    if (!demoHydrated.current) return;
    window.localStorage.setItem(MARKETS.xau.storageKey, JSON.stringify(demoAccounts.xau));
    window.localStorage.setItem(MARKETS.btc.storageKey, JSON.stringify(demoAccounts.btc));
  }, [demoAccounts]);

  const updateFeed = useCallback((targetMarket: MarketId, update: (current: MarketFeed) => MarketFeed) => {
    setMarketFeeds((current) => ({ ...current, [targetMarket]: update(current[targetMarket]) }));
  }, []);

  const setFeedStatus = useCallback((targetMarket: MarketId, nextStatus: FeedStatus) => {
    updateFeed(targetMarket, (current) => ({ ...current, status: nextStatus }));
  }, [updateFeed]);

  const applyQuote = useCallback((targetMarket: MarketId, price: number, sourceTimestamp: number, historicalCandles?: Candle[], source?: HistorySource) => {
    updateFeed(targetMarket, (current) => ({
      ...current,
      previousQuote: current.quote ?? price,
      quote: price,
      sourceTime: sourceTimestamp,
      oneMinuteCandles: upsertLiveMinute(historicalCandles?.length ? historicalCandles : current.oneMinuteCandles, price, sourceTimestamp),
      historySource: source ?? current.historySource,
    }));
    if (source) {
      historyProvider.current[targetMarket] = source;
    }
  }, [updateFeed]);

  const fetchPrimaryFeed = useCallback(async () => {
    const needsXausHistory = historyProvider.current.xau !== 'xaus';
    const [spotResponse, historyResponse] = await Promise.all([
      fetch('https://xaus.com/api/v1/spot?compact=1', { cache: 'no-store' }),
      needsXausHistory
        ? fetch('https://xaus.com/api/v1/intraday?symbol=xau&hours=48', { cache: 'no-store' })
        : Promise.resolve(null),
    ]);
    if (!spotResponse.ok) throw new Error('primary quote unavailable');
    const spot = await spotResponse.json() as XausSpotResponse;
    const history = historyResponse?.ok
      ? await historyResponse.json() as XausIntradayResponse
      : null;
    const price = Number(spot.xau?.price);
    if (!Number.isFinite(price) || spot.data_state?.status === 'unavailable') throw new Error('invalid primary quote');
    const parsedSourceTime = Date.parse(spot.data_state?.as_of ?? spot.updated_at ?? '');
    const sourceTimestamp = Number.isFinite(parsedSourceTime) ? parsedSourceTime : Date.now();
    const historyCandles = history ? xausPointsToCandles(history.points ?? []) : undefined;
    applyQuote('xau', price, sourceTimestamp, historyCandles, historyCandles?.length ? 'xaus' : undefined);
    setFeedStatus('xau', spot.data_state?.status === 'fresh' ? 'live' : 'stale');
    primaryFailures.current = 0;
    primaryRetryAfter.current = 0;
  }, [applyQuote, setFeedStatus]);

  const fetchBackupFeed = useCallback(async () => {
    const needsProxyHistory = historyProvider.current.xau === 'none';
    const [spotResponse, proxyResponse] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' }),
      needsProxyHistory
        ? fetch('https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval=5', { cache: 'no-store' })
        : Promise.resolve(null),
    ]);
    if (!spotResponse.ok) throw new Error('backup quote unavailable');
    const spot = await spotResponse.json() as GoldApiResponse;
    const proxy = proxyResponse?.ok
      ? await proxyResponse.json() as KrakenOhlcResponse
      : null;
    const price = Number(spot.price);
    if (!Number.isFinite(price)) throw new Error('invalid backup quote');
    const parsedSourceTime = Date.parse(spot.updatedAt ?? '');
    const sourceTimestamp = Number.isFinite(parsedSourceTime) ? parsedSourceTime : Date.now();
    const proxyCandles = proxy ? krakenOhlcToCandles(proxy) : undefined;
    applyQuote('xau', price, sourceTimestamp, proxyCandles, proxyCandles?.length ? 'paxg-proxy' : undefined);
    setFeedStatus('xau', 'backup');
  }, [applyQuote, setFeedStatus]);

  const fetchXauQuote = useCallback(async () => {
    const now = Date.now();
    if (now >= primaryRetryAfter.current) {
      try {
        await fetchPrimaryFeed();
        return;
      } catch {
        primaryFailures.current += 1;
        const backoffMinutes = [5, 15, 30][Math.min(primaryFailures.current - 1, 2)];
        primaryRetryAfter.current = now + backoffMinutes * 60_000;
      }
    }
    try {
      await fetchBackupFeed();
    } catch {
      setFeedStatus('xau', 'offline');
    }
  }, [fetchBackupFeed, fetchPrimaryFeed, setFeedStatus]);

  const fetchBtcQuote = useCallback(async () => {
    try {
      const needsHistory = historyProvider.current.btc !== 'kraken-btc';
      const [tickerResponse, historyResponse] = await Promise.all([
        fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { cache: 'no-store' }),
        needsHistory
          ? fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5', { cache: 'no-store' })
          : Promise.resolve(null),
      ]);
      if (!tickerResponse.ok) throw new Error('BTC quote unavailable');
      const ticker = await tickerResponse.json() as KrakenTickerResponse;
      const history = historyResponse?.ok
        ? await historyResponse.json() as KrakenOhlcResponse
        : null;
      const price = krakenTickerPrice(ticker);
      if (price === null) throw new Error('invalid BTC quote');
      const historyCandles = history ? krakenOhlcToCandles(history) : undefined;
      applyQuote('btc', price, Date.now(), historyCandles, historyCandles?.length ? 'kraken-btc' : undefined);
      setFeedStatus('btc', 'live');
    } catch {
      setFeedStatus('btc', 'offline');
    }
  }, [applyQuote, setFeedStatus]);

  const fetchQuote = useCallback(async () => {
    if (marketId === 'btc') {
      await fetchBtcQuote();
      return;
    }
    await fetchXauQuote();
  }, [fetchBtcQuote, fetchXauQuote, marketId]);

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchQuote, 0);
    const timer = window.setInterval(fetchQuote, 30_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(timer);
    };
  }, [fetchQuote]);

  const fetchDxyContext = useCallback(async () => {
    try {
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 42);
      const startDate = start.toISOString().slice(0, 10);
      const response = await fetch(`https://api.frankfurter.dev/v1/${startDate}..?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF`, { cache: 'no-store' });
      if (!response.ok) throw new Error('DXY context unavailable');
      const payload = await response.json() as FrankfurterHistoryResponse;
      const points = dxyPointsFromRates(payload.rates ?? {});
      if (points.length < 2) throw new Error('insufficient DXY context');
      setDxySeries(points);
      setDxyStatus('ready');
    } catch {
      setDxyStatus('offline');
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(fetchDxyContext, 0);
    const refreshTimer = window.setInterval(fetchDxyContext, 6 * 60 * 60 * 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [fetchDxyContext]);

  const candlesByTimeframe = useMemo(() => ({
    '1m': oneMinuteCandles,
    '5m': aggregateCandles(oneMinuteCandles, TIMEFRAMES['5m'].interval),
    '1h': aggregateCandles(oneMinuteCandles, TIMEFRAMES['1h'].interval),
  }), [oneMinuteCandles]);
  const candles = candlesByTimeframe[timeframe];
  const analysis = useMemo(() => analyze(candles), [candles]);
  const fiveMinuteAnalysis = useMemo(() => analyze(candlesByTimeframe['5m']), [candlesByTimeframe]);
  const hourlyAnalysis = useMemo(() => analyze(candlesByTimeframe['1h']), [candlesByTimeframe]);
  const strategy = useMemo(
    () => evaluatePriceActionStrategy(candlesByTimeframe['5m'], fiveMinuteAnalysis, hourlyAnalysis.trend),
    [candlesByTimeframe, fiveMinuteAnalysis, hourlyAnalysis.trend],
  );
  const marketTimestamp = sourceTime ?? candlesByTimeframe['5m'].at(-1)?.time ?? 0;
  const completedFiveMinuteCandles = useMemo(
    () => candlesByTimeframe['5m'].filter((candle) => candle.time + TIMEFRAMES['5m'].interval <= marketTimestamp),
    [candlesByTimeframe, marketTimestamp],
  );
  const completedFiveMinuteAnalysis = useMemo(() => analyze(completedFiveMinuteCandles), [completedFiveMinuteCandles]);
  const demoStrategy = useMemo(
    () => evaluatePriceActionStrategy(completedFiveMinuteCandles, completedFiveMinuteAnalysis, hourlyAnalysis.trend),
    [completedFiveMinuteCandles, completedFiveMinuteAnalysis, hourlyAnalysis.trend],
  );
  const trustedHistorySource = marketId === 'xau' ? 'xaus' : 'kraken-btc';
  const trustedForDemoEntry = status === 'live' && historySource === trustedHistorySource;
  const demoMark = quote ?? candlesByTimeframe['5m'].at(-1)?.close ?? null;
  const demoEquity = demoAccountEquity(demoAccount, demoMark);
  const demoFloatingPnl = demoEquity - demoAccount.balance;
  const demoWinRate = demoAccount.trades.length
    ? (demoAccount.trades.filter((trade) => trade.pnl > 0).length / demoAccount.trades.length) * 100
    : 0;
  const challengeLevel = CHALLENGE_LEVELS[demoAccount.challengeLevel - 1] ?? CHALLENGE_LEVELS[0];
  const challengeFinishBalance = CHALLENGE_LEVELS.at(-1)!.startingBalance + CHALLENGE_LEVELS.at(-1)!.profitGoal;
  const demoGate = demoBotGate({
    account: demoAccount,
    strategy: demoStrategy,
    completedCandles: completedFiveMinuteCandles,
    quote: demoMark,
    trustedForEntry: trustedForDemoEntry,
    entryFeedLabel: marketId === 'xau' ? 'live XAUS' : 'live Kraken BTC/USD',
  });

  useEffect(() => {
    const processTimer = window.setTimeout(() => {
      setDemoAccounts((current) => ({
        ...current,
        [marketId]: processDemoBot({
          account: current[marketId],
          strategy: demoStrategy,
          completedCandles: completedFiveMinuteCandles,
          quote: demoMark,
          timestamp: marketTimestamp || Date.now(),
          trustedForEntry: trustedForDemoEntry,
          trustedHistory: historySource === trustedHistorySource,
        }),
      }));
    }, 0);
    return () => window.clearTimeout(processTimer);
  }, [completedFiveMinuteCandles, demoAccount.enabled, demoAccount.position?.id, demoMark, demoStrategy, historySource, marketId, marketTimestamp, trustedForDemoEntry, trustedHistorySource]);
  const dxyContext = useMemo(() => {
    const latest = dxySeries.at(-1);
    if (!latest) return null;
    const fiveSessionBase = dxySeries.at(-6) ?? dxySeries[0];
    const twentySessionBase = dxySeries.at(-21) ?? dxySeries[0];
    const fiveSessionChange = percentChange(latest.value, fiveSessionBase.value);
    const twentySessionChange = percentChange(latest.value, twentySessionBase.value);
    const direction = dxyDirection(fiveSessionChange);
    let relationship = `${marketConfig.unit} UNRESOLVED`;
    if (direction !== 'FLAT' && hourlyAnalysis.trend !== 'neutral') {
      const inverseAlignment = (direction === 'RISING' && hourlyAnalysis.trend === 'bearish')
        || (direction === 'FALLING' && hourlyAnalysis.trend === 'bullish');
      relationship = inverseAlignment ? 'INVERSE ALIGNMENT' : 'DIVERGENCE';
    } else if (direction === 'FLAT') {
      relationship = 'NO CLEAR DXY MOVE';
    }
    return { latest, fiveSessionChange, twentySessionChange, direction, relationship };
  }, [dxySeries, hourlyAnalysis.trend, marketConfig.unit]);
  const events = useMemo(() => buildEvents(candles, analysis), [candles, analysis]);
  const concept = GLOSSARY[selectedConcept];
  const latestSetup = analysis.setups.at(-1);
  const higherTimeframeBias = hourlyAnalysis.trend === 'neutral' ? null : hourlyAnalysis.trend === 'bullish' ? 'LONG' : 'SHORT';
  const isAPlus = strategy.aPlus;
  const latestBreak = analysis.breaks.at(-1);
  const latestSweep = analysis.sweeps.at(-1);
  const activeBias = latestBreak?.direction ?? analysis.trend;
  const change = quote && previousQuote ? ((quote - previousQuote) / previousQuote) * 100 : 0;
  const nowSession = estParts(sourceTime ?? oneMinuteCandles.at(-1)?.time ?? 0).decimal;
  const sessionName = nowSession >= 3 && nowSession < 6 ? 'LONDON WINDOW' : nowSession >= 8.5 && nowSession < 11 ? 'NEW YORK AM' : 'OFF-SESSION';
  const glossaryGroups = [...new Set(Object.values(GLOSSARY).map((item) => item.group))];
  const feedLabel = marketId === 'btc'
    ? status === 'live' ? 'LIVE BTC · KRAKEN' : status === 'offline' ? 'BTC FEED OFFLINE' : 'CONNECTING BTC FEED'
    : status === 'live'
      ? 'LIVE XAU · XAUS'
      : status === 'backup'
        ? 'BACKUP XAU · GOLD-API'
        : status === 'stale'
          ? 'STALE XAU · XAUS'
          : status === 'offline'
            ? 'ALL XAU FEEDS OFFLINE'
            : 'CONNECTING XAU FEEDS';
  const historyLabel = historySource === 'xaus'
    ? 'XAU/USD HISTORY · XAUS'
    : historySource === 'paxg-proxy'
      ? 'EMERGENCY HISTORY · PAXG/USD PROXY'
      : historySource === 'kraken-btc'
        ? 'BTC/USD HISTORY · KRAKEN'
        : 'HISTORY LOADING';

  const applyFocus = (mode: FocusMode) => {
    setFocusMode(mode);
    setLayers(FOCUS_PRESETS[mode]);
  };

  const selectMarket = (nextMarket: MarketId) => {
    if (nextMarket === marketId) return;
    if (demoAccount.position) {
      window.alert(`Close the open ${marketConfig.unit} demo position before switching markets.`);
      return;
    }
    setDemoAccounts((current) => ({
      ...current,
      [marketId]: {
        ...current[marketId],
        enabled: false,
        lastEvent: 'DEMO BOT DISARMED · MARKET CHANGED',
      },
    }));
    setMarketId(nextMarket);
  };

  const toggleDemoBot = () => {
    if (demoAccount.challengeState !== 'ACTIVE') return;
    setDemoAccounts((current) => ({
      ...current,
      [marketId]: {
        ...current[marketId],
        enabled: !current[marketId].enabled,
        lastEvent: current[marketId].enabled ? 'DEMO BOT DISARMED' : `DEMO BOT ARMED · ${marketConfig.unit}`,
      },
    }));
  };

  const manuallyCloseDemoPosition = () => {
    setDemoAccounts((current) => ({
      ...current,
      [marketId]: closeDemoPosition(current[marketId], demoMark, marketTimestamp || Date.now()),
    }));
  };

  const resetDemoAccount = () => {
    if (!window.confirm(`Reset the $20 ${marketConfig.unit} challenge and erase its local trade journal?`)) return;
    setDemoAccounts((current) => ({
      ...current,
      [marketId]: createDemoAccount(marketTimestamp || Date.now()),
    }));
  };

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">T1</span><span>TJL1 · SMC LAB</span></div>
        <div className="market">
          <div className="market-selector" role="group" aria-label="Select market">
            {(Object.keys(MARKETS) as MarketId[]).map((key) => (
              <button key={key} className={marketId === key ? 'active' : ''} aria-pressed={marketId === key} onClick={() => selectMarket(key)}>{MARKETS[key].pairLabel}</button>
            ))}
          </div>
          <strong>{formatPrice(quote ?? candles.at(-1)?.close)}</strong>
          <span className={change >= 0 ? 'market-up' : 'market-down'}>{change >= 0 ? '+' : ''}{change.toFixed(3)}%</span>
        </div>
        <div className="live"><i className={status} /> {feedLabel}{sourceTime ? ` · ${formatTime(sourceTime)}` : ''} · {sessionName}</div>
      </header>

      <section className={`workspace ${panelOpen ? '' : 'panel-closed'}`}>
        <div className="chart-column">
          <div className="toolbar">
            <div className="toolbar-left">
              <div className="timeframes" role="group" aria-label="Chart timeframe">
                {(Object.keys(TIMEFRAMES) as Timeframe[]).map((key) => (
                  <button key={key} className={timeframe === key ? 'active' : ''} onClick={() => setTimeframe(key)}>{TIMEFRAMES[key].label}<small>{candlesByTimeframe[key].length}</small></button>
                ))}
              </div>
              <div className="focus-modes" role="group" aria-label="Chart focus">
                {(Object.keys(FOCUS_PRESETS) as FocusMode[]).map((mode) => (
                  <button key={mode} className={focusMode === mode ? 'active' : ''} onClick={() => applyFocus(mode)}>{mode}</button>
                ))}
              </div>
            </div>
            <div className="chart-actions">
              <div className="layer-toggles" role="group" aria-label="Chart annotation layers">
                {(Object.keys(layers) as Layer[]).map((layer) => (
                  <button key={layer} className={layers[layer] ? 'on' : ''} aria-pressed={layers[layer]} onClick={() => { setFocusMode('custom'); setLayers((current) => ({ ...current, [layer]: !current[layer] })); }}>{layer === 'delivery' ? 'FVG / OB' : layer === 'tjl1' ? 'ENTRY / PLAN' : layer}</button>
                ))}
              </div>
              <button className="panel-toggle" onClick={() => setPanelOpen((open) => !open)}>{panelOpen ? 'Focus chart' : 'Show panel'}</button>
            </div>
          </div>

          <div className="chart-panel">
            <div className="panel-label"><span>PRICE DELIVERY · {TIMEFRAMES[timeframe].label}</span><span>{historyLabel}</span></div>
            <MarketChart candles={candles} analysis={analysis} strategy={timeframe === '5m' ? strategy : undefined} layers={layers} timeframe={timeframe} marketLabel={marketConfig.chartLabel} onSelect={(key) => { setSelectedConcept(key); setPanelTab('learn'); }} />
            {!candles.length && <div className="chart-empty"><span>{status === 'offline' ? `${marketConfig.chartLabel} FEED UNAVAILABLE` : `LOADING OBSERVED ${marketConfig.chartLabel} DATA`}</span><small>No simulated candles will be shown.</small></div>}
          </div>

          <div className="lower-strip">
            <button onClick={() => setPanelTab('strategy')}>
              <span>STRATEGY STATE</span><strong>{strategy.status} · {strategy.headline}</strong>
            </button>
            <button onClick={() => { setSelectedConcept('dol'); setPanelTab('learn'); }}>
              <span>DRAW ON LIQUIDITY</span><strong>{candles.length ? `${analysis.draw.type.toUpperCase()} · ${formatPrice(analysis.draw.price)}` : 'WAITING FOR MARKET DATA'}</strong>
            </button>
            <button onClick={() => { setSelectedConcept('premium'); setPanelTab('learn'); }}>
              <span>DEALING-RANGE LOCATION</span><strong>{candles.length ? `${analysis.range.location.toUpperCase()} · ${analysis.range.percent.toFixed(0)}%` : 'NOT CALCULATED'}</strong>
            </button>
            <button onClick={() => { setSelectedConcept('sessions'); setPanelTab('learn'); }}>
              <span>TIME CONTEXT</span><strong>{sessionName}</strong>
            </button>
          </div>

          <button className="dxy-context" onClick={() => { setSelectedConcept('dxy'); setPanelTab('learn'); }}>
            <span className="dxy-title">DXY DAILY CONTEXT<small>OBSERVATION ONLY · EXCLUDED FROM STRATEGY LOGIC</small></span>
            <span><small>REFERENCE</small><strong>{dxyContext ? dxyContext.latest.value.toFixed(2) : dxyStatus === 'offline' ? 'UNAVAILABLE' : 'LOADING'}</strong></span>
            <span><small>5-SESSION MOVE</small><strong className={dxyContext?.fiveSessionChange && dxyContext.fiveSessionChange < 0 ? 'market-down' : 'market-up'}>{dxyContext ? `${dxyContext.fiveSessionChange >= 0 ? '+' : ''}${dxyContext.fiveSessionChange.toFixed(2)}% · ${dxyContext.direction}` : '—'}</strong></span>
            <span><small>20-SESSION MOVE</small><strong>{dxyContext ? `${dxyContext.twentySessionChange >= 0 ? '+' : ''}${dxyContext.twentySessionChange.toFixed(2)}%` : '—'}</strong></span>
            <span><small>WITH {marketConfig.unit} 1H</small><strong>{dxyContext?.relationship ?? 'WAITING FOR DATA'}</strong></span>
            <span className="dxy-date">{dxyContext ? `FX-BASKET PROXY · ${dxyContext.latest.date}` : 'DAILY REFERENCE FEED'}</span>
          </button>

          <footer className="chart-note">
            <span>DATA NOTE</span>
            {marketId === 'xau' ? (
              <> Primary XAU/USD data comes from <a href="https://xaus.com/api/" target="_blank" rel="noreferrer">XAUS</a>. During a primary outage, spot automatically switches to <a href="https://gold-api.com/docs" target="_blank" rel="noreferrer">Gold API</a>; if no XAU history is available, the chart temporarily uses Kraken PAXG/USD candles as a clearly labeled emergency proxy. Primary retries back off from 5 to 15 to 30 minutes.</>
            ) : (
              <> BTC/USD spot and 5-minute history come from the public <a href="https://docs.kraken.com/api-reference/market-data/get-ohlc-data" target="_blank" rel="noreferrer">Kraken market-data API</a>. Bitcoin history is direct BTC/USD data, not a proxy.</>
            )}
            {' '}The separate DXY daily reference comes from <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a>. All prices are indicative, not broker-executable quotes or trade instructions.
          </footer>
        </div>

        <aside className="intel-panel">
          <div className="panel-tabs" role="tablist" aria-label="Analysis panel">
            <button role="tab" aria-selected={panelTab === 'strategy'} className={panelTab === 'strategy' ? 'active' : ''} onClick={() => setPanelTab('strategy')}>STRATEGY</button>
            <button role="tab" aria-selected={panelTab === 'bot'} className={panelTab === 'bot' ? 'active' : ''} onClick={() => setPanelTab('bot')}>DEMO BOT</button>
            <button role="tab" aria-selected={panelTab === 'live'} className={panelTab === 'live' ? 'active' : ''} onClick={() => setPanelTab('live')}>EVENTS</button>
            <button role="tab" aria-selected={panelTab === 'learn'} className={panelTab === 'learn' ? 'active' : ''} onClick={() => setPanelTab('learn')}>LEARN</button>
          </div>

          {panelTab === 'strategy' ? (
            <>
              <div className="panel-heading"><span>{marketConfig.unit} PRICE ACTION · 1H → 5M</span><b className={isAPlus ? 'aplus' : strategy.status === 'INVALIDATED' ? 'invalid' : ''}>{isAPlus ? 'A+' : strategy.status === 'WAIT' ? 'NO TRADE' : strategy.status}</b></div>
              {historySource === 'paxg-proxy' && (
                <p className="proxy-warning"><b>EMERGENCY PROXY MODE</b> Structure is calculated from Kraken PAXG/USD candles. Treat every setup state as context until XAUS history returns.</p>
              )}
              <div className="signal-card strategy-card">
                <div className="signal-title"><span>{strategy.name}</span><strong>{strategy.headline}</strong></div>
                <div className="bias-row"><span>DIRECTION</span><em>{strategy.direction ?? 'UNRESOLVED'}</em></div>
                <ol>
                  {strategy.steps.map((step) => (
                    <li key={step.key} className={step.status}>
                      <strong>{step.label}</strong><small>{step.detail}</small>
                    </li>
                  ))}
                </ol>
                <p className={`next-action ${strategy.status === 'INVALIDATED' ? 'invalid' : ''}`}>{strategy.nextAction}</p>
                {strategy.status === 'TRIGGERED' && (
                  <div className="trade-plan strategy-plan">
                    <span><small>ENTRY</small>{formatPrice(strategy.entry)}</span>
                    <span><small>STOP</small>{formatPrice(strategy.stop)}</span>
                    <span><small>DOL</small>{formatPrice(strategy.drawTarget)}</span>
                    <span><small>5R</small>{formatPrice(strategy.target)}</span>
                  </div>
                )}
                <button className="show-strategy" onClick={() => { setTimeframe('5m'); applyFocus('entry'); }}>SHOW SETUP ON 5M</button>
              </div>

              <div className="panel-heading"><span>FIXED PLAYBOOK</span><small>One setup only</small></div>
              <div className="playbook">
                <section><b>01 · Context</b><p>Trade only with clear 1H structure. Seek longs from 5M discount and shorts from 5M premium.</p></section>
                <section><b>02 · Event</b><p>Wait for opposing liquidity to be swept and rejected. The sweep is never the entry.</p></section>
                <section><b>03 · Confirmation</b><p>Require displacement to close through a meaningful swing, producing an MSS and fresh FVG or order block.</p></section>
                <section><b>04 · Entry math</b><p>Enter only after the POI retest and engulfing close. Stop beyond the sweep extreme. The terminal calculates 5R and the nearest opposing liquidity.</p></section>
                <section><b>05 · Reset</b><p>If price violates the sweep extreme before confirmation, the sequence is invalid. Start again—never force the old idea.</p></section>
              </div>
              <p className="risk-note">Educational model only. Session timing improves context but does not create a trade. Backtest it before risking capital.</p>
            </>
          ) : panelTab === 'bot' ? (
            <>
              <div className="panel-heading"><span>{marketConfig.unit} $20 CHALLENGE</span><b className={demoAccount.enabled ? 'bot-armed' : ''}>{demoAccount.challengeState === 'ACTIVE' ? demoAccount.enabled ? 'ARMED' : 'OFF' : demoAccount.challengeState}</b></div>
              <div className="challenge-warning"><b>HIGH-RISK EXPERIMENT · 30% GROWTH TARGET</b><span>This progression can lose the full $20 challenge balance very quickly. Simulation only—never broker execution.</span></div>
              <div className="demo-lock"><b>SMC ENTRY FILTER · {marketConfig.chartLabel}</b><span>Only a fresh completed Sweep → MSS → Retest → Engulfing sequence can create a virtual position.</span></div>

              <div className="demo-metrics">
                <span><small>BALANCE</small><strong>{formatMoney(demoAccount.balance)}</strong></span>
                <span><small>EQUITY</small><strong>{formatMoney(demoEquity)}</strong></span>
                <span><small>LEVEL</small><strong>{demoAccount.challengeLevel} / {CHALLENGE_LEVELS.length}</strong></span>
                <span><small>CHALLENGE FINISH</small><strong>{formatMoney(challengeFinishBalance)}</strong></span>
              </div>

              <div className="demo-controls">
                <button disabled={demoAccount.challengeState !== 'ACTIVE'} className={demoAccount.enabled ? 'disarm' : 'arm'} onClick={toggleDemoBot}>{demoAccount.challengeState === 'ACTIVE' ? demoAccount.enabled ? 'DISARM DEMO BOT' : 'ARM DEMO BOT' : 'RESET CHALLENGE TO CONTINUE'}</button>
                {demoAccount.position && <button className="close-demo" onClick={manuallyCloseDemoPosition}>CLOSE DEMO POSITION</button>}
              </div>

              <div className={`bot-gate ${demoGate.tone}`}>
                <span>{demoGate.label}</span>
                <p>{demoGate.detail}</p>
                <small>LAST EVENT · {demoAccount.lastEvent}</small>
              </div>

              <div className="panel-heading"><span>OPEN DEMO POSITION</span><small>{demoAccount.position ? '1 / 1' : 'NONE'}</small></div>
              {demoAccount.position ? (
                <div className="demo-position">
                  <div><span>LEVEL {demoAccount.position.challengeLevel} · {demoAccount.position.direction}</span><strong>{demoAccount.position.referenceLot.toFixed(2)} reference lot</strong></div>
                  <div className="position-levels">
                    <span><small>ENTRY</small>{formatPrice(demoAccount.position.entry)}</span>
                    <span><small>STOP</small>{formatPrice(demoAccount.position.stop)}</span>
                    <span><small>LEVEL TARGET</small>{formatPrice(demoAccount.position.target)}</span>
                    <span><small>FLOATING</small><b className={demoFloatingPnl >= 0 ? 'market-up' : 'market-down'}>{formatMoney(demoFloatingPnl)}</b></span>
                  </div>
                </div>
              ) : <p className="demo-empty">No simulated position is open.</p>}

              <div className="panel-heading"><span>CURRENT LEVEL PLAN</span><small>From your 30-level table</small></div>
              <div className="demo-rules">
                <span><small>STARTING BALANCE</small><strong>{formatMoney(challengeLevel.startingBalance)}</strong></span>
                <span><small>PLANNED MAX LOSS</small><strong>{formatMoney(challengeLevel.risk)}</strong></span>
                <span><small>PROFIT GOAL</small><strong>{formatMoney(challengeLevel.profitGoal)}</strong></span>
                <span><small>REFERENCE</small><strong>{challengeLevel.pips} pips · {challengeLevel.referenceLot.toFixed(2)} lot</strong></span>
                <span><small>TRADES TODAY</small><strong>{demoAccount.tradesToday} / UNLIMITED</strong></span>
                <span><small>WIN RATE</small><strong>{demoAccount.trades.length ? `${demoWinRate.toFixed(0)}%` : '—'}</strong></span>
              </div>

              <div className="panel-heading"><span>30-LEVEL LADDER</span><small>Current row highlighted</small></div>
              <div className="challenge-ladder" role="region" aria-label="Thirty-level challenge plan" tabIndex={0}>
                <div className="challenge-row challenge-head"><span>LVL</span><span>START</span><span>RISK</span><span>GOAL</span><span>REF LOT</span></div>
                {CHALLENGE_LEVELS.map((level) => (
                  <div key={level.level} className={`challenge-row ${level.level === demoAccount.challengeLevel ? 'current' : ''}`}>
                    <span>{level.level}</span><span>{formatMoney(level.startingBalance)}</span><span>{formatMoney(level.risk)}</span><span>{formatMoney(level.profitGoal)}</span><span>{level.referenceLot.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="challenge-note">The simulator uses the table’s exact dollar risk and dollar profit goal while keeping the SMC structural stop. The 20-pip and lot-size figures are displayed as plan references because pip and contract values differ between XAU/USD, BTC/USD and brokers.</p>

              <div className="panel-heading"><span>DEMO TRADE JOURNAL</span><small>{demoAccount.trades.length} closed</small></div>
              <div className="demo-journal">
                {[...demoAccount.trades].reverse().slice(0, 6).map((trade) => (
                  <div key={`${trade.id}-${trade.closedAt}`}>
                    <span><b>{trade.direction}</b><small>{formatTime(trade.closedAt)} · {trade.outcome}</small></span>
                    <strong className={trade.pnl >= 0 ? 'market-up' : 'market-down'}>{formatMoney(trade.pnl)}<small>{trade.rMultiple.toFixed(2)}R</small></strong>
                  </div>
                ))}
                {!demoAccount.trades.length && <p>No closed demo trades yet.</p>}
              </div>

              <button className="reset-demo" onClick={resetDemoAccount}>RESET $20 {marketConfig.unit} CHALLENGE</button>
              <p className="risk-note">Unlimited means unlimited fresh qualifying setups; the bot still blocks duplicate signals and allows only one position at a time. Each market has a separate device-local challenge. It runs only while this page is open and never connects to MT5.</p>
            </>
          ) : panelTab === 'live' ? (
            <>
              <div className="panel-heading"><span>TJL1 DRAFT TRACKER</span><b>{latestSetup?.state === 'triggered' ? 'TRIGGERED' : 'WATCH'}</b></div>
              <div className="signal-card">
                <div className="signal-title"><span>{activeBias === 'neutral' ? 'NEUTRAL' : `${activeBias.toUpperCase()} NARRATIVE`}</span><strong>{latestSetup ? `TJL1 ${latestSetup.direction}` : 'Structure tracking'}</strong></div>
                <div className="bias-row"><span>1H BIAS</span><em>{higherTimeframeBias ?? 'UNRESOLVED'}</em></div>
                <ol>
                  <li className={analysis.liquidity.length ? 'done' : ''}>Liquidity mapped</li>
                  <li className={latestSweep?.result === 'sweep' ? 'done' : latestSweep ? 'current' : ''}>Liquidity sweep</li>
                  <li className={latestBreak?.kind === 'MSS' ? 'done' : latestBreak ? 'current' : ''}>Displacement + MSS</li>
                  <li className={latestSetup?.state === 'retrace' || latestSetup?.state === 'triggered' ? 'done' : latestSetup?.state === 'sweep' ? 'current' : ''}>TJL1 retracement</li>
                  <li className={latestSetup?.state === 'triggered' ? 'done' : latestSetup?.state === 'retrace' ? 'current' : ''}>Engulfing trigger</li>
                </ol>
                {latestSetup?.state === 'triggered' && (
                  <div className="trade-plan"><span><small>ENTRY</small>{formatPrice(latestSetup.entry)}</span><span><small>STOP</small>{formatPrice(latestSetup.stop)}</span><span><small>5R</small>{formatPrice(latestSetup.target)}</span></div>
                )}
              </div>

              <div className="panel-heading"><span>AUTO-DETECTED</span><small>{events.length} recent</small></div>
              <div className="event-feed">
                {events.map((event, index) => (
                  <button className="concept-row" key={`${event.index}-${event.concept}`} onClick={() => { setSelectedConcept(event.concept); setPanelTab('learn'); }}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <span className="event-copy"><strong>{event.label}</strong><small>{formatTime(event.time)} · {event.detail}</small></span>
                    <em>LEARN</em>
                  </button>
                ))}
                {!events.length && <p className="empty-feed">Collecting enough candles to classify structure and liquidity.</p>}
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading"><span>SMC TERMINOLOGY</span><small>{Object.keys(GLOSSARY).length} concepts</small></div>
              <div className="glossary-index">
                {glossaryGroups.map((group) => (
                  <section key={group}>
                    <h2>{group}</h2>
                    <div>{(Object.entries(GLOSSARY) as [ConceptKey, typeof GLOSSARY[ConceptKey]][]).filter(([, item]) => item.group === group).map(([key, item]) => (
                      <button key={key} className={selectedConcept === key ? 'active' : ''} onClick={() => setSelectedConcept(key)}>{item.short}</button>
                    ))}</div>
                  </section>
                ))}
              </div>

              <article className="lesson-card">
                <div className="lesson-kicker">{concept.group} · SELECTED CONCEPT</div>
                <h1>{concept.term}</h1>
                <p>{concept.definition}</p>
                <dl><div><dt>What confirms it</dt><dd>{concept.confirmation}</dd></div><div><dt>Common mistake</dt><dd>{concept.mistake}</dd></div></dl>
              </article>

              <div className="knowledge-check">
                <span>KNOWLEDGE CHECK</span>
                <p>Price wicks above equal highs and closes back below, but no meaningful low breaks. What is confirmed?</p>
                {['Sweep only', 'Bearish MSS', 'Bearish BOS'].map((answer) => (
                  <button key={answer} className={quizAnswer === answer ? (answer === 'Sweep only' ? 'correct' : 'incorrect') : ''} onClick={() => setQuizAnswer(answer)}>{answer}</button>
                ))}
                {quizAnswer && <small role="status">{quizAnswer === 'Sweep only' ? 'Correct. The sweep is confirmed; an MSS still needs a meaningful structural break with displacement.' : 'Not yet. A wick and rejection identify a sweep, but structure has not shifted.'}</small>}
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
