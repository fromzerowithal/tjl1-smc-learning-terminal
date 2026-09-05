import type { Candle, PriceActionStrategy } from './smc';

export const DEMO_BOT_RULES = {
  startingBalance: 10_000,
  riskPercent: 0.25,
  dailyLossPercent: 1,
  maxTradesPerDay: 2,
  rewardRisk: 5,
  maxUnits: 100,
} as const;

export type DemoPosition = {
  id: string;
  signalKey: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  openedCandleTime: number;
  entry: number;
  stop: number;
  target: number;
  units: number;
  riskAmount: number;
};

export type DemoTrade = DemoPosition & {
  closedAt: number;
  exit: number;
  outcome: 'TARGET' | 'STOP' | 'MANUAL';
  pnl: number;
  rMultiple: number;
};

export type DemoAccount = {
  enabled: boolean;
  balance: number;
  dayKey: string;
  dayStartBalance: number;
  dailyPnl: number;
  tradesToday: number;
  lastSignalKey: string | null;
  lastEvent: string;
  position: DemoPosition | null;
  trades: DemoTrade[];
};

type ProcessDemoBotInput = {
  account: DemoAccount;
  strategy: PriceActionStrategy;
  completedCandles: Candle[];
  quote: number | null;
  timestamp: number;
  trustedForEntry: boolean;
  trustedHistory: boolean;
  maxUnits?: number;
};

type DemoBotGateInput = Pick<ProcessDemoBotInput, 'account' | 'strategy' | 'completedCandles' | 'quote' | 'trustedForEntry'> & {
  entryFeedLabel?: string;
};

const fiveMinutes = 5 * 60_000;

export function newYorkDayKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function createDemoAccount(timestamp = Date.now()): DemoAccount {
  return {
    enabled: false,
    balance: DEMO_BOT_RULES.startingBalance,
    dayKey: newYorkDayKey(timestamp),
    dayStartBalance: DEMO_BOT_RULES.startingBalance,
    dailyPnl: 0,
    tradesToday: 0,
    lastSignalKey: null,
    lastEvent: 'DEMO ACCOUNT READY · BOT OFF',
    position: null,
    trades: [],
  };
}

export function restoreDemoAccount(raw: string | null, timestamp = Date.now()): DemoAccount {
  const fallback = createDemoAccount(timestamp);
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<DemoAccount>;
    if (!Number.isFinite(saved.balance) || !Array.isArray(saved.trades)) return fallback;
    return {
      ...fallback,
      ...saved,
      enabled: false,
      balance: Number(saved.balance),
      dayStartBalance: Number.isFinite(saved.dayStartBalance) ? Number(saved.dayStartBalance) : Number(saved.balance),
      dailyPnl: Number.isFinite(saved.dailyPnl) ? Number(saved.dailyPnl) : 0,
      tradesToday: Number.isFinite(saved.tradesToday) ? Math.max(0, Math.floor(Number(saved.tradesToday))) : 0,
      position: saved.position ?? null,
      trades: saved.trades.slice(-50),
      lastEvent: saved.position ? 'POSITION RESTORED · BOT RE-ARM REQUIRED' : 'SESSION RESTORED · BOT RE-ARM REQUIRED',
    };
  } catch {
    return fallback;
  }
}

function rollTradingDay(account: DemoAccount, timestamp: number) {
  const dayKey = newYorkDayKey(timestamp);
  if (account.dayKey === dayKey) return account;
  return {
    ...account,
    dayKey,
    dayStartBalance: account.balance,
    dailyPnl: 0,
    tradesToday: 0,
    lastEvent: 'NEW YORK TRADING DAY RESET',
  };
}

function closePosition(account: DemoAccount, exit: number, timestamp: number, outcome: DemoTrade['outcome']) {
  const position = account.position;
  if (!position || !Number.isFinite(exit)) return account;
  const priceMove = position.direction === 'LONG' ? exit - position.entry : position.entry - exit;
  const pnl = priceMove * position.units;
  const rMultiple = position.riskAmount > 0 ? pnl / position.riskAmount : 0;
  const trade: DemoTrade = { ...position, closedAt: timestamp, exit, outcome, pnl, rMultiple };
  return {
    ...account,
    balance: Math.max(0, account.balance + pnl),
    dailyPnl: account.dailyPnl + pnl,
    position: null,
    trades: [...account.trades, trade].slice(-50),
    lastEvent: `${outcome} · ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} · ${rMultiple.toFixed(2)}R`,
  };
}

function signalKey(strategy: PriceActionStrategy, completedCandles: Candle[]) {
  if (strategy.triggerIndex === undefined || !strategy.direction) return null;
  const candle = completedCandles[strategy.triggerIndex];
  return candle ? `${strategy.direction}-${candle.time}` : null;
}

function currentSignalIsFresh(strategy: PriceActionStrategy, completedCandles: Candle[]) {
  return strategy.triggerIndex !== undefined && strategy.triggerIndex === completedCandles.length - 1;
}

export function demoAccountEquity(account: DemoAccount, quote: number | null) {
  if (!account.position || quote === null || !Number.isFinite(quote)) return account.balance;
  const move = account.position.direction === 'LONG' ? quote - account.position.entry : account.position.entry - quote;
  return Math.max(0, account.balance + move * account.position.units);
}

export function closeDemoPosition(account: DemoAccount, quote: number | null, timestamp: number) {
  if (quote === null || !Number.isFinite(quote)) return account;
  return closePosition(account, quote, timestamp, 'MANUAL');
}

export function processDemoBot(input: ProcessDemoBotInput): DemoAccount {
  const { strategy, completedCandles, quote, timestamp, trustedForEntry, trustedHistory } = input;
  const account = rollTradingDay(input.account, timestamp);

  if (account.position) {
    const position = account.position;
    if (trustedHistory) {
      const laterCandles = completedCandles.filter((candle) => candle.time > position.openedCandleTime);
      for (const candle of laterCandles) {
        const stopHit = position.direction === 'LONG' ? candle.low <= position.stop : candle.high >= position.stop;
        const targetHit = position.direction === 'LONG' ? candle.high >= position.target : candle.low <= position.target;
        if (stopHit) return closePosition(account, position.stop, candle.time + fiveMinutes, 'STOP');
        if (targetHit) return closePosition(account, position.target, candle.time + fiveMinutes, 'TARGET');
      }
    }
    if (quote !== null && Number.isFinite(quote)) {
      const stopHit = position.direction === 'LONG' ? quote <= position.stop : quote >= position.stop;
      const targetHit = position.direction === 'LONG' ? quote >= position.target : quote <= position.target;
      if (stopHit) return closePosition(account, position.stop, timestamp, 'STOP');
      if (targetHit) return closePosition(account, position.target, timestamp, 'TARGET');
    }
  }

  if (!account.enabled || account.position || !trustedForEntry || quote === null || !Number.isFinite(quote)) return account;
  if (account.tradesToday >= DEMO_BOT_RULES.maxTradesPerDay) return account;
  const dailyLossLimit = account.dayStartBalance * (DEMO_BOT_RULES.dailyLossPercent / 100);
  if (account.dailyPnl <= -dailyLossLimit) return account;
  if (strategy.status !== 'TRIGGERED' || !strategy.direction || strategy.entry === undefined || strategy.stop === undefined) return account;
  if (!currentSignalIsFresh(strategy, completedCandles)) return account;

  const key = signalKey(strategy, completedCandles);
  if (!key || account.lastSignalKey === key) return account;
  const originalRisk = Math.abs(strategy.entry - strategy.stop);
  const stopIsValid = strategy.direction === 'LONG' ? quote > strategy.stop : quote < strategy.stop;
  if (!stopIsValid || originalRisk <= 0 || !Number.isFinite(originalRisk)) {
    return { ...account, lastSignalKey: key, lastEvent: 'SIGNAL SKIPPED · INVALID STOP' };
  }
  if (Math.abs(quote - strategy.entry) > originalRisk * 0.25) {
    return { ...account, lastSignalKey: key, lastEvent: 'SIGNAL SKIPPED · ENTRY MOVED TOO FAR' };
  }

  const riskAmount = account.balance * (DEMO_BOT_RULES.riskPercent / 100);
  const riskDistance = Math.abs(quote - strategy.stop);
  const units = Math.min(riskAmount / riskDistance, input.maxUnits ?? DEMO_BOT_RULES.maxUnits);
  if (!Number.isFinite(units) || units <= 0) return account;
  const target = strategy.direction === 'LONG'
    ? quote + riskDistance * DEMO_BOT_RULES.rewardRisk
    : quote - riskDistance * DEMO_BOT_RULES.rewardRisk;
  const position: DemoPosition = {
    id: `demo-${key}`,
    signalKey: key,
    direction: strategy.direction,
    openedAt: timestamp,
    openedCandleTime: Math.floor(timestamp / fiveMinutes) * fiveMinutes,
    entry: quote,
    stop: strategy.stop,
    target,
    units,
    riskAmount: units * riskDistance,
  };
  return {
    ...account,
    position,
    tradesToday: account.tradesToday + 1,
    lastSignalKey: key,
    lastEvent: `${position.direction} DEMO POSITION OPENED`,
  };
}

export function demoBotGate(input: DemoBotGateInput) {
  const { account, strategy, completedCandles, quote, trustedForEntry } = input;
  if (!account.enabled) return { tone: 'off' as const, label: 'BOT OFF', detail: 'Arm the demo bot when you are ready to simulate.' };
  if (account.position) return { tone: 'active' as const, label: 'MANAGING POSITION', detail: 'No second position can open until this one closes.' };
  if (!trustedForEntry) return { tone: 'hold' as const, label: 'SAFETY HOLD', detail: `New entries require ${input.entryFeedLabel ?? 'trusted live market'} data. Backup, stale and proxy feeds remain observation-only.` };
  if (account.tradesToday >= DEMO_BOT_RULES.maxTradesPerDay) return { tone: 'hold' as const, label: 'DAILY TRADE LIMIT', detail: 'The bot has used both permitted demo trades for this New York day.' };
  if (account.dailyPnl <= -(account.dayStartBalance * DEMO_BOT_RULES.dailyLossPercent / 100)) return { tone: 'hold' as const, label: 'DAILY LOSS LOCK', detail: 'The 1% daily loss limit is active. New entries are blocked.' };
  if (quote === null || !Number.isFinite(quote)) return { tone: 'hold' as const, label: 'WAITING FOR QUOTE', detail: 'No executable demo price is available.' };
  if (strategy.status !== 'TRIGGERED' || !currentSignalIsFresh(strategy, completedCandles)) {
    return { tone: 'waiting' as const, label: 'SCANNING', detail: 'Waiting for a fresh completed Sweep → MSS → Retest → Engulfing sequence.' };
  }
  const key = signalKey(strategy, completedCandles);
  if (key && account.lastSignalKey === key) return { tone: 'waiting' as const, label: 'SIGNAL USED', detail: 'This confirmation has already been processed. Waiting for a new setup.' };
  return { tone: 'ready' as const, label: 'ENTRY READY', detail: 'A fresh completed A+ sequence is available for demo execution.' };
}
