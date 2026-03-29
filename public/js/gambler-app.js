import { requireAuth, clearAuth } from '/js/auth.js';
import { apiPost } from '/js/api.js';
import { Poller } from '/js/poll.js';
import {
  showToast, renderStatusBar,
  renderSpellerList, renderMyBets
} from '/js/components.js';
import { formatChips, formatOdds, formatPayout } from '/js/format.js';
import { showPayoutReveal } from '/js/animations.js';

const auth = (() => {
  const a = requireAuth();
  if (!a || (a.role !== 'gambler' && a.role !== 'observer')) {
    window.location.href = '/';
    return null;
  }
  return a;
})();
if (!auth) throw new Error('Not authorized');
const isObserver = auth.role === 'observer';

let state = null;
let payoutShown = false;

document.getElementById('room-info').textContent = `${auth.roomName || 'Room'} — ${auth.displayName}`;

// Observer mode: hide betting UI, update header
if (isObserver) {
  document.querySelector('.balance-hero').style.display = 'none';
  document.getElementById('bet-section').style.display = 'none';
  document.querySelector('h1').textContent = 'Spectator View';
}

document.getElementById('logout-btn').addEventListener('click', () => {
  clearAuth();
  window.location.href = '/';
});

// --- Place Bet (gamblers only) ---
document.getElementById('place-bet-btn').addEventListener('click', async () => {
  if (isObserver) return;
  const spellerId = document.getElementById('bet-speller').value;
  const amount = parseInt(document.getElementById('bet-amount').value);

  if (!spellerId) return showToast('Select a speller', 'error');
  if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

  try {
    await apiPost('/bets', { spellerId, amount });
    document.getElementById('bet-amount').value = '';
    showToast(`Bet placed: ${formatChips(amount)} chips`);
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Quick amount buttons
document.getElementById('quick-amounts').addEventListener('click', (e) => {
  const btn = e.target.closest('.quick-amount');
  if (!btn) return;
  document.getElementById('bet-amount').value = btn.dataset.amount;
});

// --- Render ---
function render(data) {
  state = data;

  // Status bar
  document.getElementById('status-bar').innerHTML = renderStatusBar(data.room);
  document.getElementById('room-info').textContent = `${data.room.name} — ${auth.displayName}`;

  // Balance (hidden for observers)
  if (!isObserver) {
    document.getElementById('balance').textContent = formatChips(data.chipBalance || 0);
  }

  // Quick amounts based on balance
  const bal = data.chipBalance || 0;
  const quickAmounts = [
    Math.floor(bal * 0.1),
    Math.floor(bal * 0.25),
    Math.floor(bal * 0.5),
    bal,
  ].filter(a => a > 0);
  document.getElementById('quick-amounts').innerHTML = quickAmounts.map(a =>
    `<div class="quick-amount" data-amount="${a}">${formatChips(a)}</div>`
  ).join('');

  // Betting banner
  const bannerEl = document.getElementById('betting-banner');
  if (data.room.status === 'finished') {
    bannerEl.innerHTML = '<div class="locked-banner" style="border-color:var(--gold);color:var(--gold)">Bee Complete</div>';
  } else if (data.room.bettingOpen) {
    bannerEl.innerHTML = '<div class="open-banner">Bets Are Open — Place Your Wagers!</div>';
  } else {
    bannerEl.innerHTML = '<div class="locked-banner">Bets Locked — Round In Progress</div>';
  }

  // Bet section visibility (hidden for observers)
  const betSection = document.getElementById('bet-section');
  betSection.style.display = !isObserver && data.room.bettingOpen && data.room.status !== 'finished' ? '' : 'none';

  // Live turn
  const liveTurnEl = document.getElementById('live-turn');
  const turns = data.currentTurns || [];
  if (turns.length > 0 && !data.room.bettingOpen) {
    const latest = turns[0];
    liveTurnEl.style.display = '';
    liveTurnEl.innerHTML = `
      <div class="live-turn">
        <div class="text-sm text-gray">Now Spelling</div>
        <div class="speller">${esc(latest.speller_name)}</div>
        ${latest.result ? `<span class="badge badge--${latest.result}">${latest.result}</span>` : '<span class="text-sm text-gray">Awaiting result...</span>'}
      </div>
    `;
  } else {
    liveTurnEl.style.display = 'none';
  }

  // Upcoming spellers (during active round, using room-level order)
  const upcomingEl = document.getElementById('upcoming-spellers');
  const activeRound = data.rounds?.find(r => r.status === 'active');
  if (activeRound && data.room.spellerOrder?.length && !data.room.bettingOpen) {
    const completedSpellerIds = new Set(turns.map(t => t.speller_id));
    const allSpellers = data.spellers || [];
    const upcoming = data.room.spellerOrder
      .filter(id => !completedSpellerIds.has(id))
      .map(id => allSpellers.find(s => s.id === id))
      .filter(s => s && s.status === 'active');

    if (upcoming.length > 0) {
      upcomingEl.style.display = '';
      upcomingEl.innerHTML = `
        <div class="card" style="border-left:3px solid var(--blue)">
          <div class="card-header"><h2>Up Next</h2></div>
          ${upcoming.slice(0, 6).map((s, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i > 0 ? 'border-top:1px solid rgba(51,65,85,0.25);' : ''}">
              <span class="text-sm text-gray" style="font-family:var(--font-mono);width:22px;text-align:center">${i + 1}</span>
              <span style="font-weight:${i === 0 ? '700' : '500'};${i === 0 ? 'color:var(--gold)' : ''}">${esc(s.name)}</span>
              ${i === 0 ? '<span class="badge badge--active" style="font-size:0.6rem">Next</span>' : ''}
            </div>
          `).join('')}
          ${upcoming.length > 6 ? `<div class="text-sm text-gray mt-8">+${upcoming.length - 6} more</div>` : ''}
        </div>
      `;
    } else {
      upcomingEl.style.display = 'none';
    }
  } else {
    upcomingEl.style.display = 'none';
  }

  // Bet speller dropdown
  const activeSpellers = (data.spellers || []).filter(s => s.status === 'active');
  const betSelect = document.getElementById('bet-speller');
  const currentVal = betSelect.value;
  betSelect.innerHTML = '<option value="">Pick a speller...</option>' +
    activeSpellers.map(s => {
      const odds = data.odds?.find(o => o.spellerId === s.id);
      const oddsStr = odds?.impliedOdds || 'N/A';
      return `<option value="${s.id}">${esc(s.name)} (${oddsStr})</option>`;
    }).join('');
  if (currentVal) betSelect.value = currentVal;

  // Odds board — includes eliminated spellers grayed out with lost bets
  const allSpellers = data.spellers || [];
  const oddsMap = {};
  (data.odds || []).forEach(o => { oddsMap[o.spellerId] = o; });
  const myBetsBySpeller = {};
  (data.myBets || []).forEach(b => {
    if (!myBetsBySpeller[b.speller_id]) myBetsBySpeller[b.speller_id] = [];
    myBetsBySpeller[b.speller_id].push(b);
  });

  // Active spellers first (sorted by pool), then eliminated
  const activeOdds = (data.odds || []).map(o => {
    const s = allSpellers.find(sp => sp.id === o.spellerId);
    return { ...o, speller: s, eliminated: false };
  });
  const eliminatedSpellers = allSpellers
    .filter(s => s.status === 'eliminated')
    .map(s => ({ spellerId: s.id, spellerName: s.name, speller: s, eliminated: true }));

  const allRows = [...activeOdds, ...eliminatedSpellers];

  if (allRows.length === 0) {
    document.getElementById('odds-board').innerHTML = '<div class="empty-state">No spellers yet</div>';
  } else {
    const rows = allRows.map(o => {
      const bets = myBetsBySpeller[o.spellerId] || [];
      const myTotal = bets.reduce((sum, b) => sum + b.amount, 0);
      const lostBets = bets.filter(b => b.status === 'lost');
      const lostTotal = lostBets.reduce((sum, b) => sum + b.amount, 0);

      if (o.eliminated) {
        return `<tr class="eliminated">
          <td class="speller-name">${esc(o.spellerName)}</td>
          <td class="mono text-gray">—</td>
          <td class="mono text-gray">—</td>
          <td class="mono">${isObserver ? '—' : (myTotal > 0 ? `<span class="text-red">-${formatChips(lostTotal)}</span>` : '—')}</td>
        </tr>`;
      }

      const lastCol = isObserver
        ? (o.poolOnSpeller ? formatChips(o.poolOnSpeller) : '—')
        : (myTotal > 0 ? formatChips(myTotal) : '—');

      return `<tr>
        <td class="speller-name">${esc(o.spellerName)}</td>
        <td class="mono text-gold">${formatOdds(o.impliedOdds)}</td>
        <td class="mono">${formatPayout(o.payoutPerChip)}</td>
        <td class="mono">${lastCol}</td>
      </tr>`;
    }).join('');

    document.getElementById('odds-board').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Speller</th><th>Odds</th><th>Payout</th><th>${isObserver ? 'Pool' : 'My Bets'}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-sm text-gray mt-8">Total Pool: <span class="mono text-gold">${formatChips(data.totalPool)}</span> chips</div>
    `;
  }

  // My Bets (hidden for observers)
  const myBetsCard = document.getElementById('my-bets-card');
  if (isObserver) {
    myBetsCard.style.display = 'none';
  } else {
    const myBets = data.myBets || [];
    document.getElementById('bet-count').textContent = myBets.length ? `${myBets.length} bet${myBets.length > 1 ? 's' : ''}` : '';
    document.getElementById('my-bets').innerHTML = renderMyBets(myBets);
  }

  // Recent Activity
  const activity = data.recentActivity || [];
  document.getElementById('recent-activity').innerHTML = activity.length
    ? activity.map(a => {
        const icon = a.result === 'correct' ? '<span class="text-green">&#10003;</span>'
          : a.result === 'incorrect' ? '<span class="text-red">&#10007;</span>'
          : '<span class="text-gray">&#8226;</span>';
        const eliminated = a.speller_status === 'eliminated' && a.result === 'incorrect'
          ? ' <span class="badge badge--eliminated" style="font-size:0.6rem">Eliminated</span>' : '';
        return `<div style="padding:6px 0;border-bottom:1px solid rgba(75,85,99,0.3);display:flex;align-items:center;gap:8px">
          <div style="width:20px;text-align:center;font-size:1rem">${icon}</div>
          <div style="flex:1">
            <strong>${esc(a.speller_name)}</strong>${eliminated}
          </div>
          <div class="text-sm text-gray">R${a.round_number}</div>
        </div>`;
      }).join('')
    : '<div class="empty-state">No activity yet</div>';

  // Spellers
  document.getElementById('speller-list').innerHTML = renderSpellerList(data.spellers);

  // Payout reveal (once, animated)
  if (data.room.status === 'finished' && data.payout && !payoutShown) {
    payoutShown = true;
    setTimeout(() => showPayoutReveal(data.payout), 500);
  }

  // Persistent final results (always visible when finished)
  const finalResultsEl = document.getElementById('final-results');
  if (data.room.status === 'finished' && data.payout) {
    const winner = data.payout.winner;
    const payouts = data.payout.payouts || [];
    finalResultsEl.style.display = '';
    finalResultsEl.innerHTML = `
      <div class="card" style="border: 1px solid var(--gold); border-radius: var(--radius);">
        <div class="card-header"><h2>Final Results</h2></div>
        <div style="text-align:center;padding:12px 0">
          <div class="text-sm text-gray">Winner</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--gold)">${winner ? esc(winner.name) : 'N/A'}</div>
          <div class="text-sm text-gray mt-8">Total Pool: <span class="mono text-gold">${formatChips(data.totalPool)}</span></div>
        </div>
        ${payouts.length > 0 ? `
          <div style="border-top:1px solid rgba(75,85,99,0.3);padding-top:12px">
            <div class="text-sm text-gray" style="margin-bottom:8px">Payouts</div>
            ${payouts.map(p => `
              <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(75,85,99,0.2)">
                <span>${esc(p.display_name || p.displayName)}</span>
                <span class="mono text-gold">+${formatChips(p.payout_amount || p.payoutAmount)}</span>
              </div>
            `).join('')}
          </div>
        ` : '<div class="text-sm text-gray" style="text-align:center;padding:8px 0">No winning bets — pool unclaimed</div>'}
      </div>
    `;
  } else {
    finalResultsEl.style.display = 'none';
  }
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

const poller = new Poller(4000, render);
poller.start();
