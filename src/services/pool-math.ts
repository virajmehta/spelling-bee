import { Bet } from '../types';

export interface OddsInfo {
  spellerId: string;
  spellerName: string;
  poolOnSpeller: number;
  totalPool: number;
  payoutPerChip: number;
  impliedOdds: string;
  percentage: number;
}

export interface PortfolioItem {
  spellerId: string;
  spellerName: string;
  spellerStatus: string;
  totalBet: number;
  potentialPayout: number;
}

export function calculateOdds(
  bets: { speller_id: string; speller_name: string; amount: number; status: string }[],
  activeSpellers: { id: string; name: string }[]
): { totalPool: number; odds: OddsInfo[] } {
  // Total pool includes ALL bets (even on eliminated spellers = dead money)
  const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);

  // Pool per active speller
  const poolBySpeller = new Map<string, { name: string; pool: number }>();
  for (const s of activeSpellers) {
    poolBySpeller.set(s.id, { name: s.name, pool: 0 });
  }

  for (const bet of bets) {
    if (bet.status !== 'active') continue;
    const entry = poolBySpeller.get(bet.speller_id);
    if (entry) {
      entry.pool += bet.amount;
    }
  }

  const odds: OddsInfo[] = [];
  for (const [spellerId, { name, pool }] of poolBySpeller) {
    const payoutPerChip = pool > 0 ? totalPool / pool : 0;
    const percentage = totalPool > 0 && pool > 0 ? (pool / totalPool) * 100 : 0;

    let impliedOdds = 'N/A';
    if (pool > 0) {
      const decimalOdds = totalPool / pool;
      if (decimalOdds >= 2) {
        impliedOdds = `+${Math.round((decimalOdds - 1) * 100)}`;
      } else {
        impliedOdds = `−${Math.round(100 / (decimalOdds - 1))}`;
      }
    }

    odds.push({
      spellerId,
      spellerName: name,
      poolOnSpeller: pool,
      totalPool,
      payoutPerChip,
      impliedOdds,
      percentage: Math.round(percentage * 10) / 10,
    });
  }

  // Sort by pool descending (favorites first)
  odds.sort((a, b) => b.poolOnSpeller - a.poolOnSpeller);
  return { totalPool, odds };
}

export function calculatePortfolio(
  userBets: { speller_id: string; speller_name: string; speller_status: string; amount: number; status: string }[],
  allBets: { speller_id: string; amount: number; status: string }[],
  chipBalance: number
): { items: PortfolioItem[]; totalValue: number } {
  const totalPool = allBets.reduce((sum, b) => sum + b.amount, 0);

  // Pool per speller (active bets only)
  const poolBySpeller = new Map<string, number>();
  for (const b of allBets) {
    if (b.status !== 'active') continue;
    poolBySpeller.set(b.speller_id, (poolBySpeller.get(b.speller_id) || 0) + b.amount);
  }

  // Group user bets by speller
  const bySpeller = new Map<string, { name: string; status: string; total: number }>();
  for (const b of userBets) {
    const existing = bySpeller.get(b.speller_id) || { name: b.speller_name, status: b.speller_status, total: 0 };
    existing.total += b.amount;
    bySpeller.set(b.speller_id, existing);
  }

  let portfolioValue = chipBalance;
  const items: PortfolioItem[] = [];

  for (const [spellerId, { name, status, total }] of bySpeller) {
    const spellerPool = poolBySpeller.get(spellerId) || 0;
    const potentialPayout = spellerPool > 0 && status === 'active'
      ? Math.floor((total / spellerPool) * totalPool)
      : 0;

    if (status === 'active') {
      portfolioValue += potentialPayout;
    }

    items.push({
      spellerId,
      spellerName: name,
      spellerStatus: status,
      totalBet: total,
      potentialPayout,
    });
  }

  return { items, totalValue: portfolioValue };
}
