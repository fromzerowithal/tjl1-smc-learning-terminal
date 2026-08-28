export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type Direction = 'bullish' | 'bearish';
export type Trend = Direction | 'neutral';

export type Pivot = {
  index: number;
  type: 'high' | 'low';
  price: number;
  label: 'HH' | 'LH' | 'HL' | 'LL' | 'H' | 'L';
};

export type LiquidityPool = {
  index: number;
  type: 'bsl' | 'ssl';
  price: number;
  equal: boolean;
  sourceIndex?: number;
};

export type Sweep = {
  index: number;
  type: 'bsl' | 'ssl';
  level: number;
  result: 'sweep' | 'run';
};

export type StructureBreak = {
  index: number;
  direction: Direction;
  kind: 'BOS' | 'MSS';
  level: number;
};

export type Gap = {
  index: number;
  direction: Direction;
  top: number;
  bottom: number;
};

export type OrderBlock = {
  index: number;
  direction: Direction;
  top: number;
  bottom: number;
  originIndex: number;
};

export type TjlLevel = {
  formedIndex: number;
  level: number;
  direction: 'LONG' | 'SHORT';
  type: 'high' | 'low';
};

export type TjlSetup = {
  state: 'sweep' | 'retrace' | 'triggered';
  direction: 'LONG' | 'SHORT';
  tjl: TjlLevel;
  sweepIndex: number;
  triggerIndex?: number;
  entry?: number;
  stop?: number;
  target?: number;
};

export type Analysis = {
  atr: number;
  pivots: Pivot[];
  liquidity: LiquidityPool[];
  sweeps: Sweep[];
  breaks: StructureBreak[];
  displacement: { index: number; direction: Direction }[];
  gaps: Gap[];
  orderBlocks: OrderBlock[];
  trend: Trend;
  range: { high: number; low: number; equilibrium: number; location: 'premium' | 'discount' | 'equilibrium'; percent: number };
  draw: { type: 'bsl' | 'ssl'; price: number };
  tjls: TjlLevel[];
  setups: TjlSetup[];
};

export type StrategyStep = {
  key: 'bias' | 'location' | 'sweep' | 'mss' | 'poi' | 'retest' | 'trigger';
  label: string;
  detail: string;
  status: 'done' | 'current' | 'pending';
};

export type PriceActionStrategy = {
  name: 'Sweep → MSS → Retest';
  direction: 'LONG' | 'SHORT' | null;
  status: 'WAIT' | 'ARMED' | 'TRIGGERED' | 'INVALIDATED';
  state: 'bias' | 'location' | 'sweep' | 'mss' | 'poi' | 'retest' | 'trigger' | 'active' | 'invalidated';
  headline: string;
  nextAction: string;
  steps: StrategyStep[];
  sweepIndex?: number;
  mssIndex?: number;
  poi?: { type: 'FVG' | 'OB'; index: number; top: number; bottom: number };
  retestIndex?: number;
  triggerIndex?: number;
  entry?: number;
  stop?: number;
  target?: number;
  drawTarget?: number;
  rewardToDraw?: number;
  aPlus: boolean;
};

const minute = 60_000;

export function generateSeed(base: number, count = 720, now = Date.now()): Candle[] {
  let state = 0x6d2b79f5;
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  const stepSize = Math.max(base * 0.00012, 0.35);
  const start = Math.floor(now / minute) * minute - (count - 1) * minute;
  const candles: Candle[] = [];
  let value = base - stepSize * 5;

  for (let i = 0; i < count; i += 1) {
    const open = value;
    const drift = Math.sin(i / 23) * stepSize * 0.4 + Math.sin(i / 8) * stepSize * 0.25;
    const close = open + drift + (random() - 0.5) * stepSize * 1.6;
    const wick = stepSize * (0.35 + random() * 0.8);
    candles.push({
      time: start + i * minute,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick * (0.8 + random() * 0.4),
      close,
    });
    value = close;
  }

  const unit = Math.max(base * 0.00018, 0.55);
  const pattern = [
    [-4, 0, -6, -1], [-1, 4, -3, 3], [3, 7, 0, 5], [5, 9, 2, 7],
    [7, 10, 4, 6], [6, 12, 5, 10], [10, 14, 7, 12], [12, 14.05, 8, 10],
    [10, 14.08, 7, 12], [12, 13, 8, 10], [10, 19, 9, 9.5], [9.5, 10, 3, 4],
    [4, 5, -3, -1], [-1, 3, -4, 2], [2, 3, -2, -1], [-1, 1, -4, 0],
  ];
  pattern.forEach((bar, offset) => {
    const index = count - pattern.length + offset;
    candles[index] = {
      time: start + index * minute,
      open: base + bar[0] * unit,
      high: base + bar[1] * unit,
      low: base + bar[2] * unit,
      close: base + bar[3] * unit,
    };
  });

  return candles;
}

export function upsertLiveMinute(candles: Candle[], price: number, time = Date.now()): Candle[] {
  const bucket = Math.floor(time / minute) * minute;
  const next = candles.slice();
  const last = next[next.length - 1];
  if (!last || last.time < bucket) {
    const open = last?.close ?? price;
    next.push({ time: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price });
  } else {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    };
  }
  return next.slice(-6_000);
}

export function aggregateCandles(candles: Candle[], interval: number): Candle[] {
  const map = new Map<number, Candle>();
  candles.forEach((candle) => {
    const time = Math.floor(candle.time / interval) * interval;
    const current = map.get(time);
    if (!current) {
      map.set(time, { ...candle, time });
      return;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
  });
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function averageTrueRange(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 1;
  const values: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    values.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  const sample = values.slice(-period);
  return sample.reduce((sum, value) => sum + value, 0) / Math.max(sample.length, 1);
}

export function findPivots(candles: Candle[], left = 2, right = 2): Pivot[] {
  const raw: Omit<Pivot, 'label'>[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const candle = candles[i];
    const before = candles.slice(i - left, i);
    const after = candles.slice(i + 1, i + right + 1);
    const isHigh = before.every((item) => candle.high > item.high) && after.every((item) => candle.high >= item.high);
    const isLow = before.every((item) => candle.low < item.low) && after.every((item) => candle.low <= item.low);
    if (isHigh) raw.push({ index: i, type: 'high', price: candle.high });
    if (isLow) raw.push({ index: i, type: 'low', price: candle.low });
  }
  raw.sort((a, b) => a.index - b.index || (a.type === 'high' ? -1 : 1));
  let previousHigh: number | null = null;
  let previousLow: number | null = null;
  return raw.map((pivot) => {
    let label: Pivot['label'];
    if (pivot.type === 'high') {
      label = previousHigh === null ? 'H' : pivot.price > previousHigh ? 'HH' : 'LH';
      previousHigh = pivot.price;
    } else {
      label = previousLow === null ? 'L' : pivot.price > previousLow ? 'HL' : 'LL';
      previousLow = pivot.price;
    }
    return { ...pivot, label };
  });
}

function trendAt(pivots: Pivot[], index = Infinity): Trend {
  const prior = pivots.filter((pivot) => pivot.index < index);
  const high = prior.filter((pivot) => pivot.type === 'high').at(-1);
  const low = prior.filter((pivot) => pivot.type === 'low').at(-1);
  if (high?.label === 'HH' && low?.label === 'HL') return 'bullish';
  if (high?.label === 'LH' && low?.label === 'LL') return 'bearish';
  return 'neutral';
}

function buildLiquidity(pivots: Pivot[], atr: number): LiquidityPool[] {
  const pools: LiquidityPool[] = pivots.slice(-28).map((pivot) => ({
    index: pivot.index,
    type: pivot.type === 'high' ? 'bsl' : 'ssl',
    price: pivot.price,
    equal: false,
  }));
  (['high', 'low'] as const).forEach((type) => {
    const same = pivots.filter((pivot) => pivot.type === type);
    for (let i = 1; i < same.length; i += 1) {
      if (Math.abs(same[i].price - same[i - 1].price) <= atr * 0.22) {
        pools.push({
          index: same[i].index,
          sourceIndex: same[i - 1].index,
          type: type === 'high' ? 'bsl' : 'ssl',
          price: (same[i].price + same[i - 1].price) / 2,
          equal: true,
        });
      }
    }
  });
  return pools.sort((a, b) => a.index - b.index).slice(-20);
}

function detectSweeps(candles: Candle[], pools: LiquidityPool[]): Sweep[] {
  const events: Sweep[] = [];
  pools.forEach((pool) => {
    const end = Math.min(candles.length, pool.index + 70);
    for (let index = pool.index + 1; index < end; index += 1) {
      const candle = candles[index];
      if (pool.type === 'bsl' && candle.high > pool.price) {
        events.push({ index, type: pool.type, level: pool.price, result: candle.close < pool.price ? 'sweep' : 'run' });
        break;
      }
      if (pool.type === 'ssl' && candle.low < pool.price) {
        events.push({ index, type: pool.type, level: pool.price, result: candle.close > pool.price ? 'sweep' : 'run' });
        break;
      }
    }
  });
  const unique = new Map<string, Sweep>();
  events.forEach((event) => unique.set(`${event.index}-${event.type}-${event.result}`, event));
  return [...unique.values()].sort((a, b) => a.index - b.index).slice(-12);
}

function detectDisplacement(candles: Candle[]): { index: number; direction: Direction }[] {
  const results: { index: number; direction: Direction }[] = [];
  for (let i = 10; i < candles.length; i += 1) {
    const current = candles[i];
    const averageBody = candles.slice(i - 10, i).reduce((sum, candle) => sum + Math.abs(candle.close - candle.open), 0) / 10;
    const body = Math.abs(current.close - current.open);
    const range = Math.max(current.high - current.low, 1e-9);
    if (body > averageBody * 1.65 && body / range >= 0.62) {
      results.push({ index: i, direction: current.close > current.open ? 'bullish' : 'bearish' });
    }
  }
  return results.slice(-16);
}

function detectBreaks(candles: Candle[], pivots: Pivot[], displacement: { index: number; direction: Direction }[]): StructureBreak[] {
  const events: StructureBreak[] = [];
  pivots.forEach((pivot) => {
    for (let index = pivot.index + 1; index < Math.min(candles.length, pivot.index + 80); index += 1) {
      const direction: Direction = pivot.type === 'high' ? 'bullish' : 'bearish';
      const broke = pivot.type === 'high' ? candles[index].close > pivot.price : candles[index].close < pivot.price;
      if (!broke) continue;
      const hasDisplacement = displacement.some((item) => item.direction === direction && Math.abs(item.index - index) <= 1);
      if (!hasDisplacement) break;
      const priorTrend = trendAt(pivots, index);
      const kind = priorTrend === direction ? 'BOS' : 'MSS';
      events.push({ index, direction, kind, level: pivot.price });
      break;
    }
  });
  const unique = new Map<string, StructureBreak>();
  events.forEach((event) => unique.set(`${event.index}-${event.direction}-${event.kind}`, event));
  return [...unique.values()].sort((a, b) => a.index - b.index).slice(-12);
}

function detectGaps(candles: Candle[], atr: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 2; i < candles.length; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    if (third.low > first.high && third.low - first.high > atr * 0.04) {
      gaps.push({ index: i, direction: 'bullish', top: third.low, bottom: first.high });
    }
    if (third.high < first.low && first.low - third.high > atr * 0.04) {
      gaps.push({ index: i, direction: 'bearish', top: first.low, bottom: third.high });
    }
  }
  return gaps.slice(-12);
}

function detectOrderBlocks(candles: Candle[], breaks: StructureBreak[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  breaks.forEach((event) => {
    for (let index = event.index - 1; index >= Math.max(0, event.index - 5); index -= 1) {
      const candle = candles[index];
      const opposing = event.direction === 'bullish' ? candle.close < candle.open : candle.close > candle.open;
      if (!opposing) continue;
      blocks.push({
        index: event.index,
        direction: event.direction,
        top: candle.high,
        bottom: candle.low,
        originIndex: index,
      });
      break;
    }
  });
  return blocks.slice(-8);
}

function buildTJLs(candles: Candle[]): TjlLevel[] {
  const pivots = findPivots(candles, 1, 1);
  return pivots.flatMap((pivot) => {
    const confirmation = candles[pivot.index + 1];
    const source = candles[pivot.index];
    if (!confirmation || !source) return [];
    const valid = pivot.type === 'high' ? confirmation.close < source.close : confirmation.close > source.close;
    if (!valid) return [];
    return [{
      formedIndex: pivot.index,
      level: pivot.price,
      direction: pivot.type === 'high' ? 'SHORT' as const : 'LONG' as const,
      type: pivot.type,
    }];
  }).slice(-12);
}

function scanTjlSetup(candles: Candle[], tjl: TjlLevel): TjlSetup | null {
  const end = Math.min(candles.length, tjl.formedIndex + 62);
  for (let index = tjl.formedIndex + 2; index < end; index += 1) {
    const sweep = candles[index];
    const body = Math.abs(sweep.close - sweep.open);
    const range = Math.max(sweep.high - sweep.low, 1e-9);
    const sweepOkay = tjl.direction === 'LONG'
      ? sweep.low < tjl.level && sweep.close > tjl.level && sweep.close > sweep.open && body / range > 0.6
      : sweep.high > tjl.level && sweep.close < tjl.level && sweep.close < sweep.open && body / range > 0.6;
    if (!sweepOkay) continue;
    const retrace = candles[index + 1];
    if (!retrace) return { state: 'sweep', direction: tjl.direction, tjl, sweepIndex: index };
    const retraceOkay = tjl.direction === 'LONG'
      ? retrace.close < sweep.close && retrace.low > sweep.low
      : retrace.close > sweep.close && retrace.high < sweep.high;
    if (!retraceOkay) continue;
    const trigger = candles[index + 2];
    if (!trigger) return { state: 'retrace', direction: tjl.direction, tjl, sweepIndex: index };
    const triggerOkay = tjl.direction === 'LONG'
      ? trigger.close > retrace.high && trigger.open < retrace.close
      : trigger.close < retrace.low && trigger.open > retrace.close;
    if (!triggerOkay) continue;
    const entry = trigger.close;
    const stop = tjl.direction === 'LONG' ? Math.min(sweep.low, retrace.low) : Math.max(sweep.high, retrace.high);
    const risk = Math.abs(entry - stop);
    return {
      state: 'triggered', direction: tjl.direction, tjl, sweepIndex: index, triggerIndex: index + 2,
      entry, stop, target: tjl.direction === 'LONG' ? entry + risk * 5 : entry - risk * 5,
    };
  }
  return null;
}

export function analyze(candles: Candle[]): Analysis {
  if (!candles.length) {
    return {
      atr: 1,
      pivots: [],
      liquidity: [],
      sweeps: [],
      breaks: [],
      displacement: [],
      gaps: [],
      orderBlocks: [],
      trend: 'neutral',
      range: { high: 0, low: 0, equilibrium: 0, location: 'equilibrium', percent: 50 },
      draw: { type: 'bsl', price: 0 },
      tjls: [],
      setups: [],
    };
  }
  const atr = averageTrueRange(candles);
  const pivots = findPivots(candles);
  const liquidity = buildLiquidity(pivots, atr);
  const sweeps = detectSweeps(candles, liquidity);
  const displacement = detectDisplacement(candles);
  const breaks = detectBreaks(candles, pivots, displacement);
  const gaps = detectGaps(candles, atr);
  const orderBlocks = detectOrderBlocks(candles, breaks);
  const trend = trendAt(pivots);
  const recent = candles.slice(-120);
  const high = Math.max(...recent.map((candle) => candle.high));
  const low = Math.min(...recent.map((candle) => candle.low));
  const equilibrium = (high + low) / 2;
  const close = candles.at(-1)?.close ?? equilibrium;
  const percent = ((close - low) / Math.max(high - low, 1e-9)) * 100;
  const location = Math.abs(percent - 50) < 4 ? 'equilibrium' : percent > 50 ? 'premium' : 'discount';
  const desiredType = trend === 'bearish' ? 'ssl' : 'bsl';
  const candidates = liquidity
    .filter((pool) => pool.type === desiredType && (desiredType === 'bsl' ? pool.price > close : pool.price < close))
    .sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close));
  const draw = candidates[0] ?? { type: desiredType, price: desiredType === 'bsl' ? high : low, index: candles.length - 1, equal: false };
  const tjls = buildTJLs(candles);
  const setups = tjls.map((tjl) => scanTjlSetup(candles, tjl)).filter((setup): setup is TjlSetup => Boolean(setup));

  return {
    atr, pivots, liquidity, sweeps, breaks, displacement, gaps, orderBlocks, trend,
    range: { high, low, equilibrium, location, percent },
    draw: { type: draw.type, price: draw.price },
    tjls,
    setups,
  };
}

function dealingLocationAt(candles: Candle[], index: number, direction: Direction) {
  const sample = candles.slice(Math.max(0, index - 119), index + 1);
  const high = Math.max(...sample.map((candle) => candle.high));
  const low = Math.min(...sample.map((candle) => candle.low));
  const equilibrium = (high + low) / 2;
  const reference = direction === 'bullish' ? candles[index].low : candles[index].high;
  return direction === 'bullish' ? reference <= equilibrium : reference >= equilibrium;
}

function overlaps(candle: Candle, top: number, bottom: number) {
  return candle.low <= top && candle.high >= bottom;
}

/**
 * A transparent, educational 1H-to-5M price-action model.
 * It will not produce an entry until every condition has completed in order:
 * bias → location → sweep → displacement MSS → POI → retest → engulfing close.
 */
export function evaluatePriceActionStrategy(
  candles: Candle[],
  analysis: Analysis,
  higherTimeframeBias: Trend,
): PriceActionStrategy {
  const direction: Direction | null = higherTimeframeBias === 'neutral' ? null : higherTimeframeBias;
  const tradeDirection = direction === 'bullish' ? 'LONG' : direction === 'bearish' ? 'SHORT' : null;
  const currentLocationOkay = direction === 'bullish'
    ? analysis.range.location === 'discount'
    : direction === 'bearish'
      ? analysis.range.location === 'premium'
      : false;
  const expectedSweep = direction === 'bullish' ? 'ssl' : 'bsl';
  const searchStart = Math.max(0, candles.length - 60);
  const alignedSweeps = direction
    ? analysis.sweeps.filter((event) => event.result === 'sweep' && event.type === expectedSweep && event.index >= searchStart)
    : [];
  const sweep = alignedSweeps.at(-1);
  const locationOkay = sweep && direction ? dealingLocationAt(candles, sweep.index, direction) : currentLocationOkay;
  const mss = sweep && direction
    ? analysis.breaks.find((event) => event.kind === 'MSS'
      && event.direction === direction
      && event.index > sweep.index
      && event.index <= sweep.index + 12)
    : undefined;

  const directionalGaps = mss && direction
    ? analysis.gaps.filter((gap) => gap.direction === direction && gap.index >= mss.index - 1 && gap.index <= mss.index + 3)
    : [];
  const directionalBlocks = mss && direction
    ? analysis.orderBlocks.filter((block) => block.direction === direction && block.index >= mss.index - 1 && block.index <= mss.index + 2)
    : [];
  const selectedGap = directionalGaps.at(-1);
  const selectedBlock = directionalBlocks.at(-1);
  const poi = selectedGap
    ? { type: 'FVG' as const, index: selectedGap.index, top: selectedGap.top, bottom: selectedGap.bottom }
    : selectedBlock
      ? { type: 'OB' as const, index: selectedBlock.originIndex, top: selectedBlock.top, bottom: selectedBlock.bottom }
      : undefined;

  const retestStart = Math.max((mss?.index ?? -1) + 1, (poi?.index ?? -1) + 1);
  let retestIndex: number | undefined;
  if (poi && mss) {
    for (let index = retestStart; index < Math.min(candles.length, mss.index + 21); index += 1) {
      if (overlaps(candles[index], poi.top, poi.bottom)) {
        retestIndex = index;
        break;
      }
    }
  }

  let triggerIndex: number | undefined;
  if (retestIndex !== undefined && direction) {
    for (let index = retestIndex + 1; index < Math.min(candles.length, retestIndex + 5); index += 1) {
      const trigger = candles[index];
      const rejection = candles[index - 1];
      const confirms = direction === 'bullish'
        ? trigger.close > rejection.high && trigger.close > trigger.open
        : trigger.close < rejection.low && trigger.close < trigger.open;
      if (confirms) {
        triggerIndex = index;
        break;
      }
    }
  }

  const sweepExtreme = sweep
    ? direction === 'bullish' ? candles[sweep.index].low : candles[sweep.index].high
    : undefined;
  const invalidated = sweep && direction && sweepExtreme !== undefined
    ? candles.slice(sweep.index + 1, triggerIndex ?? candles.length).some((candle) => (
      direction === 'bullish' ? candle.low < sweepExtreme : candle.high > sweepExtreme
    ))
    : false;

  const entry = triggerIndex !== undefined ? candles[triggerIndex].close : undefined;
  const retestCandle = retestIndex !== undefined ? candles[retestIndex] : undefined;
  const stop = entry !== undefined && sweepExtreme !== undefined && retestCandle && direction
    ? direction === 'bullish'
      ? Math.min(sweepExtreme, retestCandle.low)
      : Math.max(sweepExtreme, retestCandle.high)
    : undefined;
  const risk = entry !== undefined && stop !== undefined ? Math.abs(entry - stop) : undefined;
  const target = entry !== undefined && risk !== undefined && direction
    ? direction === 'bullish' ? entry + risk * 5 : entry - risk * 5
    : undefined;
  const drawTarget = entry !== undefined && direction
    ? analysis.liquidity
      .filter((pool) => direction === 'bullish' ? pool.type === 'bsl' && pool.price > entry : pool.type === 'ssl' && pool.price < entry)
      .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0]?.price
    : undefined;
  const rewardToDraw = drawTarget !== undefined && entry !== undefined && risk
    ? Math.abs(drawTarget - entry) / risk
    : undefined;

  const completed = {
    bias: Boolean(direction),
    location: Boolean(direction && locationOkay),
    sweep: Boolean(sweep && locationOkay),
    mss: Boolean(mss && locationOkay),
    poi: Boolean(poi && mss && locationOkay),
    retest: retestIndex !== undefined && Boolean(poi && locationOkay),
    trigger: triggerIndex !== undefined && !invalidated,
  };
  const orderedKeys: StrategyStep['key'][] = ['bias', 'location', 'sweep', 'mss', 'poi', 'retest', 'trigger'];
  const firstMissing = orderedKeys.find((key) => !completed[key]);
  const currentKey = invalidated ? undefined : firstMissing;
  const stepCopy: Record<StrategyStep['key'], { label: string; detail: string }> = {
    bias: { label: '1H directional bias', detail: direction ? `${tradeDirection} only` : 'Wait for clear 1H structure' },
    location: { label: '5M dealing-range location', detail: direction === 'bullish' ? 'Discount required' : direction === 'bearish' ? 'Premium required' : 'Direction decides location' },
    sweep: { label: 'Opposing liquidity sweep', detail: direction === 'bullish' ? 'Sell-side raid + close back above' : direction === 'bearish' ? 'Buy-side raid + close back below' : 'Wait for bias first' },
    mss: { label: 'Displacement + MSS', detail: direction ? `${direction === 'bullish' ? 'Bullish' : 'Bearish'} close through a meaningful swing` : 'Must follow the sweep' },
    poi: { label: 'Fresh FVG or order block', detail: poi ? `${poi.type} ${poi.bottom.toFixed(2)}–${poi.top.toFixed(2)}` : 'Created by the MSS leg' },
    retest: { label: 'Return to the POI', detail: 'No chasing; wait for price to retrace' },
    trigger: { label: 'Engulfing confirmation', detail: direction === 'bearish' ? 'Bearish close below rejection low' : 'Bullish close above rejection high' },
  };
  const steps = orderedKeys.map((key) => ({
    key,
    ...stepCopy[key],
    status: completed[key] ? 'done' as const : key === currentKey ? 'current' as const : 'pending' as const,
  }));

  if (invalidated) {
    return {
      name: 'Sweep → MSS → Retest', direction: tradeDirection, status: 'INVALIDATED', state: 'invalidated',
      headline: 'Setup invalidated', nextAction: 'The sweep extreme failed. Reset and wait for a completely new sequence.',
      steps, sweepIndex: sweep?.index, mssIndex: mss?.index, poi, retestIndex, aPlus: false,
    };
  }
  if (completed.trigger) {
    return {
      name: 'Sweep → MSS → Retest', direction: tradeDirection, status: 'TRIGGERED', state: 'active',
      headline: `${tradeDirection} model confirmed`, nextAction: 'The model is complete. Manage risk from the sweep extreme; never widen the stop.',
      steps, sweepIndex: sweep?.index, mssIndex: mss?.index, poi, retestIndex, triggerIndex,
      entry, stop, target, drawTarget, rewardToDraw, aPlus: true,
    };
  }

  const state = (firstMissing ?? 'trigger') as Exclude<PriceActionStrategy['state'], 'active' | 'invalidated'>;
  const armed = completed.mss;
  const nextCopy: Record<typeof state, string> = {
    bias: 'No trade. Wait for a clear 1H HH/HL or LL/LH structure.',
    location: `No trade. Wait for price to reach ${direction === 'bullish' ? '5M discount' : '5M premium'}.`,
    sweep: `No trade. Wait for a ${direction === 'bullish' ? 'sell-side' : 'buy-side'} liquidity sweep and rejection.`,
    mss: 'No trade. The sweep is context only; wait for displacement and an MSS.',
    poi: 'No trade. Wait for the MSS leg to leave a fresh FVG or order block.',
    retest: 'Armed, not entered. Wait for price to retrace into the marked POI.',
    trigger: 'Armed, not entered. Wait for the rejection candle to be engulfed.',
  };
  return {
    name: 'Sweep → MSS → Retest', direction: tradeDirection, status: armed ? 'ARMED' : 'WAIT', state,
    headline: direction ? `${tradeDirection} sequence · waiting for ${stepCopy[state].label.toLowerCase()}` : 'No directional bias',
    nextAction: nextCopy[state], steps, sweepIndex: sweep?.index, mssIndex: mss?.index, poi, retestIndex, aPlus: false,
  };
}
