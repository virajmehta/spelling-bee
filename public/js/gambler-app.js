import { requireAuth, clearAuth } from '/js/auth.js';
import { apiPost } from '/js/api.js';
import { Poller } from '/js/poll.js';
import {
  showToast, renderStatusBar, renderOddsTable,
  renderSpellerList, renderMyBets
} from '/js/components.js';
import { formatChips } from '/js/format.js';
import { showPayoutReveal } from '/js/animations.js';

const auth = requireAuth('gambler');
if (!auth) throw new Error('Not authorized');

let state = null;
let payoutShown = false;

document.getElementById('room-info').textContent = `${auth.roomName || 'Room'} — ${auth.displayName}`;

document.getElementById('logout-btn').addEventListener('click', () => {
  clearAuth();
  window.location.href = '/';
});

// --- Place Bet ---
document.getElementById('place-bet-btn').addEventListener('click', async () => {
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

  // Balance
  document.getElementById('balance').textContent = formatChips(data.chipBalance || 0);

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

  // Bet section visibility
  const betSection = document.getElementById('bet-section');
  betSection.style.display = data.room.bettingOpen && data.room.status !== 'finished' ? '' : 'none';

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
        ${latest.word ? `<div class="word">"${esc(latest.word)}"</div>` : ''}
        ${latest.result ? `<span class="badge badge--${latest.result}">${latest.result}</span>` : '<span class="text-sm text-gray">Awaiting result...</span>'}
      </div>
    `;
  } else {
    liveTurnEl.style.display = 'none';
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

  // Odds
  document.getElementById('odds-board').innerHTML = renderOddsTable(data.odds, data.totalPool);

  // My Bets
  const myBets = data.myBets || [];
  document.getElementById('bet-count').textContent = myBets.length ? `${myBets.length} bet${myBets.length > 1 ? 's' : ''}` : '';
  document.getElementById('my-bets').innerHTML = renderMyBets(myBets);

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
            ${a.word ? `<span class="text-sm text-gray"> — "${esc(a.word)}"</span>` : ''}
          </div>
          <div class="text-sm text-gray">R${a.round_number}</div>
        </div>`;
      }).join('')
    : '<div class="empty-state">No activity yet</div>';

  // Spellers
  document.getElementById('speller-list').innerHTML = renderSpellerList(data.spellers);

  // Payout reveal (once)
  if (data.room.status === 'finished' && data.payout && !payoutShown) {
    payoutShown = true;
    setTimeout(() => showPayoutReveal(data.payout), 500);
  }
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

const poller = new Poller(7000, render);
poller.start();
