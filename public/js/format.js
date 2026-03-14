// Number/odds formatting utilities

export function formatChips(amount) {
  if (amount == null) return '0';
  return amount.toLocaleString();
}

export function formatOdds(oddsStr) {
  return oddsStr || 'N/A';
}

export function formatPayout(payoutPerChip) {
  if (!payoutPerChip || payoutPerChip === 0) return '--';
  return payoutPerChip.toFixed(1) + 'x';
}

export function formatPercent(pct) {
  if (!pct) return '0%';
  return pct.toFixed(1) + '%';
}
