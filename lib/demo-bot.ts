import type { Candle, PriceActionStrategy } from './smc';

export const DEMO_BOT_RULES = {
  startingBalance: 20,
  growthTargetPercent: 30,
  planPips: 20,
} as const;

export const CHALLENGE_LEVELS = [
  { level: 1, startingBalance: 20, risk: 6, profitGoal: 6, pips: 20, referenceLot: 0.03 },
  { level: 2, startingBalance: 26, risk: 6, profitGoal: 8, pips: 20, referenceLot: 0.04 },
  { level: 3, startingBalance: 34, risk: 8, profitGoal: 10, pips: 20, referenceLot: 0.05 },
  { level: 4, startingBalance: 44, risk: 10, profitGoal: 14, pips: 20, referenceLot: 0.07 },
  { level: 5, startingBalance: 58, risk: 14, profitGoal: 18, pips: 20, referenceLot: 0.09 },
  { level: 6, startingBalance: 76, risk: 18, profitGoal: 22, pips: 20, referenceLot: 0.11 },
  { level: 7, startingBalance: 98, risk: 22, profitGoal: 28, pips: 20, referenceLot: 0.14 },
  { level: 8, startingBalance: 126, risk: 28, profitGoal: 38, pips: 20, referenceLot: 0.19 },
  { level: 9, startingBalance: 164, risk: 38, profitGoal: 48, pips: 20, referenceLot: 0.24 },
  { level: 10, startingBalance: 212, risk: 48, profitGoal: 64, pips: 20, referenceLot: 0.32 },
  { level: 11, startingBalance: 276, risk: 64, profitGoal: 82, pips: 20, referenceLot: 0.41 },
  { level: 12, startingBalance: 358, risk: 82, profitGoal: 108, pips: 20, referenceLot: 0.54 },
  { level: 13, startingBalance: 466, risk: 108, profitGoal: 140, pips: 20, referenceLot: 0.70 },
  { level: 14, startingBalance: 606, risk: 140, profitGoal: 182, pips: 20, referenceLot: 0.91 },
  { level: 15, startingBalance: 788, risk: 182, profitGoal: 236, pips: 20, referenceLot: 1.18 },
  { level: 16, startingBalance: 1_024, risk: 236, profitGoal: 308, pips: 20, referenceLot: 1.54 },
  { level: 17, startingBalance: 1_332, risk: 308, profitGoal: 400, pips: 20, referenceLot: 2.00 },
  { level: 18, startingBalance: 1_732, risk: 400, profitGoal: 520, pips: 20, referenceLot: 2.60 },
  { level: 19, startingBalance: 2_252, risk: 520, profitGoal: 674, pips: 20, referenceLot: 3.37 },
  { level: 20, startingBalance: 2_926, risk: 674, profitGoal: 878, pips: 20, referenceLot: 4.39 },
  { level: 21, startingBalance: 3_804, risk: 878, profitGoal: 1_140, pips: 20, referenceLot: 5.70 },
  { level: 22, startingBalance: 4_944, risk: 1_140, profitGoal: 1_482, pips: 20, referenceLot: 7.41 },
  { level: 23, startingBalance: 6_426, risk: 1_482, profitGoal: 1_928, pips: 20, referenceLot: 9.64 },
  { level: 24, startingBalance: 8_354, risk: 1_928, profitGoal: 2_506, pips: 20, referenceLot: 12.53 },
  { level: 25, startingBalance: 10_860, risk: 2_506, profitGoal: 3_256, pips: 20, referenceLot: 16.28 },
  { level: 26, startingBalance: 14_116, risk: 3_256, profitGoal: 4_234, pips: 20, referenceLot: 21.17 },
  { level: 27, startingBalance: 18_350, risk: 4_234, profitGoal: 5_504, pips: 20, referenceLot: 27.52 },
  { level: 28, startingBalance: 23_854, risk: 5_504, profitGoal: 7_156, pips: 20, referenceLot: 35.78 },
  { level: 29, startingBalance: 31_010, risk: 7_156, profitGoal: 9_302, pips: 20, referenceLot: 46.51 },
  { level: 30, startingBalance: 40_312, risk: 9_302, profitGoal: 12_092, pips: 20, referenceLot: 60.46 },
] as const;

export type ChallengeState = 'ACTIVE' | 'FAILED' | 'COMPLETE';

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
  challengeLevel: number;
  profitGoal: number;
  planPips: number;
  referenceLot: number;
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
  challengeLevel: number;
  challengeState: ChallengeState;
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
    challengeLevel: 1,
    challengeState: 'ACTIVE',
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
      challengeLevel: Number.isFinite(saved.challengeLevel)
        ? Math.min(CHALLENGE_LEVELS.length, Math.max(1, Math.floor(Number(saved.challengeLevel))))
        : 1,
      challengeState: saved.challengeState === 'FAILED' || saved.challengeState === 'COMPLETE' ? saved.challengeState : 'ACTIVE',
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
  const balance = Math.max(0, account.balance + pnl);
  let challengeLevel = account.challengeLevel;
  let challengeState = account.challengeState;
  if (outcome === 'TARGET') {
    if (position.challengeLevel >= CHALLENGE_LEVELS.length) {
      challengeState = 'COMPLETE';
    } else {
      challengeLevel = position.challengeLevel + 1;
    }
  } else if (outcome === 'STOP') {
    if (balance < DEMO_BOT_RULES.startingBalance || position.challengeLevel === 1) {
      challengeState = 'FAILED';
    } else {
      challengeLevel = Math.max(1, position.challengeLevel - 1);
    }
  }
  const levelEvent = challengeState === 'COMPLETE'
    ? 'CHALLENGE COMPLETE'
    : challengeState === 'FAILED'
      ? 'CHALLENGE FAILED · RESET REQUIRED'
      : `LEVEL ${challengeLevel} READY`;
  return {
    ...account,
    enabled: challengeState === 'ACTIVE' ? account.enabled : false,
    balance,
    dailyPnl: account.dailyPnl + pnl,
    challengeLevel,
    challengeState,
    position: null,
    trades: [...account.trades, trade].slice(-50),
    lastEvent: `${outcome} · ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} · ${levelEvent}`,
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
  if (account.challengeState !== 'ACTIVE') return account;
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

  const challenge = CHALLENGE_LEVELS[account.challengeLevel - 1] ?? CHALLENGE_LEVELS[0];
  const riskAmount = Math.min(challenge.risk, account.balance);
  const riskDistance = Math.abs(quote - strategy.stop);
  const units = riskAmount / riskDistance;
  if (!Number.isFinite(units) || units <= 0) return account;
  const target = strategy.direction === 'LONG'
    ? quote + challenge.profitGoal / units
    : quote - challenge.profitGoal / units;
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
    challengeLevel: challenge.level,
    profitGoal: challenge.profitGoal,
    planPips: challenge.pips,
    referenceLot: challenge.referenceLot,
  };
  return {
    ...account,
    position,
    tradesToday: account.tradesToday + 1,
    lastSignalKey: key,
    lastEvent: `LEVEL ${challenge.level} ${position.direction} DEMO POSITION OPENED`,
  };
}

export function demoBotGate(input: DemoBotGateInput) {
  const { account, strategy, completedCandles, quote, trustedForEntry } = input;
  if (!account.enabled) return { tone: 'off' as const, label: 'BOT OFF', detail: 'Arm the demo bot when you are ready to simulate.' };
  if (account.challengeState === 'FAILED') return { tone: 'hold' as const, label: 'CHALLENGE FAILED', detail: 'The balance fell below the Level 1 requirement. Reset the challenge to try again.' };
  if (account.challengeState === 'COMPLETE') return { tone: 'ready' as const, label: '30 LEVELS COMPLETE', detail: 'The final profit goal was reached. Reset only if you want to run another simulation.' };
  if (account.position) return { tone: 'active' as const, label: 'MANAGING POSITION', detail: 'No second position can open until this one closes.' };
  if (!trustedForEntry) return { tone: 'hold' as const, label: 'SAFETY HOLD', detail: `New entries require ${input.entryFeedLabel ?? 'trusted live market'} data. Backup, stale and proxy feeds remain observation-only.` };
  if (quote === null || !Number.isFinite(quote)) return { tone: 'hold' as const, label: 'WAITING FOR QUOTE', detail: 'No executable demo price is available.' };
  if (strategy.status !== 'TRIGGERED' || !currentSignalIsFresh(strategy, completedCandles)) {
    return { tone: 'waiting' as const, label: 'SCANNING', detail: 'Waiting for a fresh completed Sweep → MSS → Retest → Engulfing sequence.' };
  }
  const key = signalKey(strategy, completedCandles);
  if (key && account.lastSignalKey === key) return { tone: 'waiting' as const, label: 'SIGNAL USED', detail: 'This confirmation has already been processed. Waiting for a new setup.' };
  return { tone: 'ready' as const, label: 'ENTRY READY', detail: 'A fresh completed A+ sequence is available for demo execution.' };
}
