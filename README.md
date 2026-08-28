# TJL1 SMC Learning Terminal

An interactive XAU/USD Smart Money Concepts learning and analysis terminal. It maps structure, liquidity, sweeps, displacement, fair value gaps, order blocks, and a rule-based Sweep → MSS → Retest setup.

## Live data

The chart requests observed XAU/USD prices from the public [XAUS API](https://xaus.com/api/): up to 48 hours of intraday observations plus refreshed spot prices. The feed is indicative and is not a broker-executable quote.

## Run locally

```bash
corepack enable
pnpm install
pnpm dev
```

## Publish

The included GitHub Pages workflow builds and publishes the site automatically after a push to `main`.

## Important

This is an educational analysis tool, not financial advice or a promise of profit. It does not connect to a brokerage account or place trades.
