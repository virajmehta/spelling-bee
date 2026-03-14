// Shared render functions — leaderboard, speller list, odds table

import { formatChips, formatOdds, formatPayout, formatPercent } from './format.js';

export function showToast(message, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast toast--visible toast--${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

export function renderStatusBar(room) {
  let statusText, dotClass;
  if (room.status === 'finished') {
    statusText = 'Bee Finished';
    dotClass = 'status-dot--finished';
  } else if (room.bettingOpen) {
    statusText = 'Bets Open';
    dotClass = 'status-dot--open';
  } else {
    statusText = 'Bets Locked';
    dotClass = 'status-dot--locked';
  }

  return `
    <div class="status-bar">
      <div>
        <span class="status-dot ${dotClass}"></span>
        <strong>${statusText}</strong>
      </div>
      <div class="text-sm text-gray">${room.name} — ${room.code}</div>
    </div>
  `;
}

export function renderOddsTable(odds, totalPool) {
  if (!odds?.length) return '<div class="empty-state">No spellers yet</div>';

  const rows = odds.map(o => `
    <tr>
      <td class="speller-name">${esc(o.spellerName)}</td>
      <td class="mono text-gold">${formatOdds(o.impliedOdds)}</td>
      <td class="mono">${formatPayout(o.payoutPerChip)}</td>
      <td class="mono">${formatChips(o.poolOnSpeller)}</td>
      <td>
        <div class="odds-bar-bg"><div class="odds-bar-fill" style="width:${o.percentage}%"></div></div>
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Speller</th><th>Odds</th><th>Payout</th><th>Pool</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="text-sm text-gray mt-8">Total Pool: <span class="mono text-gold">${formatChips(totalPool)}</span> chips</div>
  `;
}

export function renderLeaderboard(leaderboard) {
  if (!leaderboard?.length) return '<div class="empty-state">No gamblers yet</div>';

  return leaderboard.map((entry, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `lb-rank--${rank}` : '';
    const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
    return `
      <div class="lb-row">
        <div class="lb-rank ${rankClass}">${medal}</div>
        <div class="lb-name">${esc(entry.displayName)}</div>
        <div class="lb-value">${formatChips(entry.portfolioValue)}</div>
      </div>
    `;
  }).join('');
}

export function renderSpellerList(spellers) {
  if (!spellers?.length) return '<div class="empty-state">No spellers added</div>';

  return spellers.map(s => {
    const statusBadge = s.status === 'active'
      ? '<span class="badge badge--active">Active</span>'
      : s.status === 'eliminated'
        ? '<span class="badge badge--eliminated">Out R' + (s.eliminated_in_round || '?') + '</span>'
        : '<span class="badge badge--winner">Winner</span>';

    return `
      <div class="speller-row ${s.status === 'eliminated' ? 'text-gray' : ''}">
        <span class="speller-name">${esc(s.name)}</span>
        ${statusBadge}
      </div>
    `;
  }).join('');
}

export function renderCurrentTurns(turns) {
  if (!turns?.length) return '';

  return turns.map(t => {
    const resultBadge = t.result === 'correct'
      ? '<span class="badge badge--correct">Correct</span>'
      : t.result === 'incorrect'
        ? '<span class="badge badge--incorrect">Incorrect</span>'
        : '<span class="badge" style="background:var(--gray-dark);color:var(--white)">Pending</span>';

    return `
      <div class="flex-between" style="padding:6px 0;border-bottom:1px solid rgba(75,85,99,0.3)">
        <div>
          <strong>${esc(t.speller_name)}</strong>
          ${t.word ? `<span class="text-sm text-gray"> — "${esc(t.word)}"</span>` : ''}
        </div>
        ${resultBadge}
      </div>
    `;
  }).join('');
}

export function renderMyBets(bets) {
  if (!bets?.length) return '<div class="empty-state">No bets placed yet</div>';

  return bets.map(b => {
    const statusClass = b.status === 'active' ? 'bet-card--active'
      : b.status === 'lost' ? 'bet-card--lost'
        : b.status === 'won' || b.status === 'paid' ? 'bet-card--won' : '';

    return `
      <div class="bet-card ${statusClass}">
        <div>
          <div class="speller-name">${esc(b.speller_name)}</div>
          <div class="text-sm text-gray">${b.status.toUpperCase()}</div>
        </div>
        <div class="mono text-gold">${formatChips(b.amount)}</div>
      </div>
    `;
  }).join('');
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
