// The Aica token radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet by what a token would be worth if the
// protocol's record stayed as it is. The value model is a comparables model, derived from the
// snapshot itself on every run — nothing about it is a list of names:
//
//   comps       every protocol in the snapshot whose token already trades with a recorded
//               market cap (CEX records set aside: an exchange's token against an exchange's
//               TVL is not a price for a protocol's token). Each comp gives a ratio,
//               mcap_usd / tvl_usd — what the market pays per dollar of TVL. A single token
//               can trade at a wild ratio (one live prediction market sits at 400x its TVL),
//               so every ratio is winsorised to [0.01, 5] before it prices anything: one
//               token's mania is not a category's price.
//   multiple    a protocol's category multiple is the median ratio of its category's comps,
//               shrunk toward the global median by the comp count:
//               (n x category median + SHRINKAGE x global median) / (n + SHRINKAGE),
//               then clamped to [0.02, 2]: only a tenth of live protocols trade richer than
//               2x TVL at all, and never as a whole category. A category with no comps
//               takes the global median.
//   growth      the week's TVL change, clamped to [-50, +100] per cent, moves the value by
//               1 + (growth / 100) x GROWTH_WEIGHT: a protocol shrinking fast is worth less
//               than its TVL, one compounding is worth more.
//   maturity    a protocol that has run longer with no token has more record to price:
//               MATURITY_FLOOR + MATURITY_RANGE x min(age_days, MATURITY_DAYS) / MATURITY_DAYS.
//               An unreported listing date is priced as UNKNOWN_AGE_DAYS old.
//   implied     max(1, round(tvl_usd x multiple x growth x maturity)), whole dollars.
//
// The board covers the snapshot's whole watchlist (the floor, never the ceiling) and every
// other pre-token protocol that is a candidate for a token of its own: not an exchange, not a
// versioned pool of another protocol, and not a wrapped, staked or bridged product — the same
// product line the house's watchlist rule draws, applied at every size, so the radar's early
// rows are protocols the floor's $50M line simply had not reached. Protocols whose token
// already trades are never ranked: the dashboard shows them apart, at the market's own value.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, carried into data.js so the page runs the same arithmetic. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrinkage: number;
  winsorize_lo: number;
  winsorize_hi: number;
  multiple_lo: number;
  multiple_hi: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.6,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  shrinkage: 6,
  winsorize_lo: 0.01,
  winsorize_hi: 5,
  multiple_lo: 0.02,
  multiple_hi: 2,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'aica-radar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's comparables: the shrunk multiple and how many live comps priced it. */
export interface CategoryMultiple {
  multiple: number;
  comps: number;
  median: number;
}

/** The comparables table the model derives from the snapshot's live-token protocols. */
export interface Comparables {
  global_median: number;
  comps: number;
  by_category: Record<string, CategoryMultiple>;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: { global_median: number; comps: number; by_category: Record<string, CategoryMultiple> };
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of another protocol, not a candidate for a token of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking in a name marks the same kind of product. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a pre-token protocol is a candidate for the board: an independent protocol that
 * could issue a token of its own — not an exchange record, not a versioned pool, and not a
 * wrapped, staked or bridged product of a protocol whose token already trades.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_NAME.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables table: what the market pays per dollar of TVL, from every protocol in the
 * snapshot whose token trades with a recorded market cap. CEX records are set aside. Each
 * category's multiple is its comps' median ratio, shrunk toward the global median by count.
 */
export function buildComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const clampRatio = (r: number): number => Math.min(model.winsorize_hi, Math.max(model.winsorize_lo, r));
  const clampMultiple = (m: number): number => Math.min(model.multiple_hi, Math.max(model.multiple_lo, m));
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = clampRatio(p.mcap_usd / p.tvl_usd);
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const byCategory: Record<string, CategoryMultiple> = {};
  for (const [category, ratios] of [...ratiosByCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const med = median(ratios);
    const shrunk = (ratios.length * med + model.shrinkage * globalMedian) / (ratios.length + model.shrinkage);
    byCategory[category] = { multiple: round4(clampMultiple(shrunk)), comps: ratios.length, median: round4(med) };
  }
  return { global_median: round4(clampMultiple(globalMedian)), comps: all.length, by_category: byCategory };
}

/** The multiple one protocol is priced at: its category's shrunk median, else the global median. */
export function multipleFor(p: SnapshotProtocol, comps: Comparables): { multiple: number; categoryComps: number } {
  if (p.category !== null) {
    const entry = comps.by_category[p.category];
    if (entry !== undefined) return { multiple: entry.multiple, categoryComps: entry.comps };
  }
  return { multiple: comps.global_median, categoryComps: 0 };
}

/** The growth and maturity factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = protocol.change_7d ?? 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range,
  );
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** A farm step before it is flattened: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A signed per-cent with one decimal, as the plan and the page both write it: +5.8%, -28.5%. */
export function pct(x: number): string {
  return `${x > 0 ? '+' : ''}${(Math.round(x * 10) / 10).toString()}%`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** What one transaction costs in gas on a chain, in the plan's words. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $15';
  if (chain === 'Bitcoin') return 'about $6';
  return 'about $2';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. Mirrored by dashboard/app.js. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain} through its own app, then borrow once against it, no more than 40% of what you supplied, so the wallet counts as both a supplier and a borrower.`;
  if (c.includes('cdp')) return `Open a vault on ${name} on ${chain}: deposit $${capital} of collateral and mint no more than a third of it as the protocol's stablecoin, keeping the vault well above its liquidation line.`;
  if (c.includes('dex')) return `Provide $${capital} of two-sided liquidity to ${name}'s largest pool on ${chain} — the stablecoin pair if it has one — and leave the LP position open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} — the largest vault it curates — and keep the vault shares in the same wallet.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the receipt shares; do not chase its highest-APY vault first.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the staking receipt in the same wallet.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged the other way, so the account trades without betting on direction.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain}, the position that holds its hedged trade, and keep the shares.`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${name}'s tokenised asset on ${chain} through its own app and hold the asset in the same wallet.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market, then let it settle rather than trading out early.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to its end date.`;
  if (c.includes('launchpad')) return `Register the wallet with ${name} and commit $${capital} to one launch it runs on ${chain}, following the allocation steps its own page sets out.`;
  if (c.includes('index')) return `Buy $${capital} of a ${name} index on ${chain} and hold the basket token rather than its parts.`;
  if (c.includes('stable') || c.includes('reserve currency')) return `Mint or deposit $${capital} of the stable asset ${name} issues, on ${chain}, and hold it in the wallet.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side so the trip is not a round trip.`;
  if (c.includes('chain')) return `Bridge $${capital} of funds onto ${name} and make real transactions there: one swap and one contract call a week in its own apps.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s pool on ${chain} and let the funds sit the pool's full waiting period before any withdrawal.`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} on ${name} and make one real payment or card purchase with it, so the account is a user and not a deposit.`;
  if (c.includes('ai')) return `Buy $${capital} of credits or compute on ${name} and run one real job with it, keeping the account active afterwards.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`;
}

/** The second surface: a second chain when the protocol runs on one, else a deeper position. */
function secondFor(p: SnapshotProtocol, capital: number, chain: string): FarmStep {
  const half = capital / 2;
  if (p.chains.length >= 2) {
    const other = p.chains[1]!;
    return {
      text: `${p.name} also runs on ${other}: repeat a smaller position there, bridging $${half} across with the bridge its own app names, so your activity is not all on one chain.`,
      cost: `$${half} of capital and ${gasFor(other)} of gas`,
      time: '25 minutes',
    };
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend')) {
    return {
      text: `After a week, add a second market on ${chain}: supply $${half} in the other large market ${p.name} runs, so the wallet shows depth in two markets, not a single touch.`,
      cost: `$${half} of capital and ${gasFor(chain)} of gas`,
      time: '15 minutes, a week after the first step',
    };
  }
  if (c.includes('dex')) {
    return {
      text: `After a week, add $${half} to a second pool on ${chain} — a different pair from the first — so the wallet provides liquidity in more than one market ${p.name} runs.`,
      cost: `$${half} of capital and ${gasFor(chain)} of gas`,
      time: '15 minutes, a week after the first step',
    };
  }
  return {
    text: `After a week, add $${half} to the same position on ${chain}: a second, separate deposit reads as a returning user, which most points programs count for more than one large deposit.`,
    cost: `$${half} of capital and ${gasFor(chain)} of gas`,
    time: '10 minutes, a week after the first step',
  };
}

/** The trend step: what the snapshot's own 7-day TVL change tells the farmer to do. */
function trendFor(p: SnapshotProtocol, chain: string): FarmStep {
  if (p.change_7d === null) {
    return {
      text: `The snapshot reports no 7-day TVL change for ${p.name}: before adding beyond the first position, check its TVL trend on DefiLlama and size as if the trend were unknown.`,
      cost: 'nothing to check',
      time: '5 minutes before you add',
    };
  }
  if (p.change_7d <= -10) {
    return {
      text: `${p.name}'s TVL fell ${pct(p.change_7d)} in the snapshot's 7 days: halve every amount in this plan until two weekly checks in a row show its TVL flat or rising again.`,
      cost: 'nothing to check; the smaller size is the saving',
      time: '5 minutes a week while it falls',
    };
  }
  if (p.change_7d >= 25) {
    return {
      text: `${p.name}'s TVL rose ${pct(p.change_7d)} in the snapshot's 7 days: do not chase the spike with more size — keep the planned capital and let the weekly cadence do the work.`,
      cost: 'nothing extra; the discipline is the saving',
      time: '5 minutes a week',
    };
  }
  return {
    text: `${p.name}'s TVL moved ${pct(p.change_7d)} in the snapshot's 7 days, inside the normal band: stay with the planned size and re-check the trend at each weekly visit.`,
    cost: 'nothing to check',
    time: '5 minutes a week',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record — its category, its chains, its TVL, its age and its 7-day trend.
 * Mirrored line for line by dashboard/app.js so the page shows the plan board.json carries.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  return [
    {
      text: `Start with a fresh wallet for ${p.name}: fund it only with what this plan uses, keep its seed phrase on paper offline, and never farm from the wallet that holds your main funds.`,
      cost: `one funding transfer, ${gasFor(chain)} of gas`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gasFor(chain)} of gas`,
      time: '20 minutes to set up',
    },
    secondFor(p, capital, chain),
    {
      text: `Come back once a week for ${weeks} weeks: one qualifying action a visit — a deposit, a swap, a vote or a claim — keeps the wallet in the active set most points programs count.`,
      cost: `${gasFor(chain)} of gas a week`,
      time: `10 minutes a week for ${weeks} weeks`,
    },
    trendFor(p, chain),
    {
      text: `Hold the position for at least ${hold} days, and once a month open ${p.name}'s own points or rewards page — only from the link inside its app — to confirm the wallet is being counted.`,
      cost: 'the capital stays in the position; never pay anyone to claim or to verify a wallet',
      time: `${hold} days in total`,
    },
    {
      text: `If ${p.name} issues a token, check any allocation only on the protocol's own page, claim inside its deadline if it sets one, and keep the farm log — wallet, dates, amounts, transaction hashes — either way.`,
      cost: `claim gas only, ${gasFor(chain)}`,
      time: '30 minutes when a claim opens',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComparables(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isCandidate(p));
  const scored = chosen.map((p) => {
    const { multiple, categoryComps } = multipleFor(p, comps);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, implied, growthPct, growthMult, maturityMult, age, multiple, categoryComps };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      category_comps: s.categoryComps,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = buildComparables(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples: { global_median: comps.global_median, comps: comps.comps, by_category: comps.by_category },
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (/\s/.test(r.slug) || r.slug.length < 1 || r.slug.length > 128) return `bad slug ${r.slug}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
