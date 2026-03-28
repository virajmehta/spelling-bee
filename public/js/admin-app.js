import { requireAuth, clearAuth } from '/js/auth.js';
import { apiPost, apiPatch, apiGet, apiDelete } from '/js/api.js';
import { Poller } from '/js/poll.js';
import { showToast, renderStatusBar, renderOddsTable, renderCurrentTurns } from '/js/components.js';
import { formatChips } from '/js/format.js';
import { showPayoutReveal } from '/js/animations.js';

const auth = requireAuth('admin');
if (!auth) throw new Error('Not authorized');

let state = null;
let currentRoundId = null;
let selectedWord = null;

document.getElementById('room-info').textContent = `${auth.roomName || 'Room'} — ${auth.displayName}`;

// --- Tab switching ---
document.getElementById('admin-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.admin-tab');
  if (!tab) return;
  const tabName = tab.dataset.tab;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabName}`));
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearAuth();
  window.location.href = '/';
});

// --- Speller Management ---
document.getElementById('add-spellers-btn').addEventListener('click', async () => {
  const text = document.getElementById('add-spellers-text').value.trim();
  if (!text) return;
  const names = text.split('\n').map(n => n.trim()).filter(Boolean);
  if (!names.length) return;

  try {
    await apiPost('/admin/spellers', { spellers: names });
    document.getElementById('add-spellers-text').value = '';
    showToast(`Added ${names.length} spellers`);
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Round Controls ---
document.getElementById('start-round-btn').addEventListener('click', async () => {
  try {
    const res = await apiPost('/bee/rounds', {});
    currentRoundId = res.id;
    showToast(`Round ${res.roundNumber} started — Bets Locked`);
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('complete-round-btn').addEventListener('click', async () => {
  if (!currentRoundId) return;
  try {
    await apiPost(`/bee/rounds/${currentRoundId}/complete`, {});
    showToast('Round completed — Bets Open');
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Turn Creation ---
document.getElementById('create-turn-btn').addEventListener('click', async () => {
  const spellerId = document.getElementById('turn-speller').value;
  const customWord = document.getElementById('custom-word').value.trim();
  const word = selectedWord || customWord || null;

  if (!spellerId) return showToast('Select a speller', 'error');
  if (!currentRoundId) return showToast('No active round', 'error');

  try {
    await apiPost('/bee/turns', { roundId: currentRoundId, spellerId, word });
    document.getElementById('custom-word').value = '';
    selectedWord = null;
    showToast('Turn created');
    loadNextWord();
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Turn Result (delegated click on result buttons) ---
document.getElementById('current-turns').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-turn-action]');
  if (!btn) return;

  const turnId = btn.dataset.turnId;
  const action = btn.dataset.turnAction;

  if (action === 'correct' || action === 'incorrect') {
    try {
      await apiPatch(`/bee/turns/${turnId}`, { result: action });
      showToast(`Marked ${action}`);
      poller.forcePoll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (action === 'eliminate') {
    const spellerId = btn.dataset.spellerId;
    try {
      await apiPost(`/bee/spellers/${spellerId}/eliminate`, {});
      showToast('Speller eliminated');
      poller.forcePoll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// --- Speller Actions (delegated) ---
document.getElementById('speller-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-speller-action]');
  if (!btn) return;
  const spellerId = btn.dataset.spellerId;
  const action = btn.dataset.spellerAction;

  try {
    if (action === 'eliminate') {
      await apiPost(`/bee/spellers/${spellerId}/eliminate`, {});
      showToast('Speller eliminated');
    } else if (action === 'reinstate') {
      await apiPost(`/bee/spellers/${spellerId}/reinstate`, {});
      showToast('Speller reinstated');
    } else if (action === 'delete') {
      await apiDelete(`/admin/spellers/${spellerId}`);
      showToast('Speller removed');
    }
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Chip Credits ---
document.getElementById('credit-all-btn').addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('credit-all-amount').value);
  if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

  try {
    const res = await apiPost('/admin/credits/all', { amount });
    showToast(`Credited ${formatChips(amount)} chips to ${res.credited} gamblers`);
    document.getElementById('credit-all-amount').value = '';
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('gambler-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-credit-user]');
  if (!btn) return;
  const userId = btn.dataset.creditUser;
  const amount = parseInt(prompt('Chip amount to credit:'));
  if (!amount || amount <= 0) return;

  try {
    await apiPost('/admin/credits', { userId, amount });
    showToast(`Credited ${formatChips(amount)} chips`);
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Word Import ---
document.getElementById('import-words-btn').addEventListener('click', async () => {
  try {
    const res = await apiPost('/admin/words/import', {});
    document.getElementById('import-status').textContent = `Imported ${res.imported} words`;
    showToast('Words imported');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Finish Bee ---
document.getElementById('finish-btn').addEventListener('click', async () => {
  const winnerId = document.getElementById('winner-select').value;
  if (!winnerId) return showToast('Select a winner', 'error');

  if (!confirm('Are you sure? This will end the bee and compute payouts.')) return;

  try {
    const payoutResult = await apiPost('/bee/finish', { winnerId });
    showPayoutReveal(payoutResult);
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Poll & Render ---
function render(data) {
  state = data;

  // Status bar + room code
  document.getElementById('status-bar').innerHTML = renderStatusBar(data.room);
  document.getElementById('room-info').textContent = `${data.room.name} — ${auth.displayName}`;
  document.getElementById('room-code-display').textContent = data.room.code;

  // Active round
  const activeRound = data.rounds?.find(r => r.status === 'active');
  currentRoundId = activeRound?.id || null;

  if (activeRound) {
    document.getElementById('no-round-msg').style.display = 'none';
    document.getElementById('round-controls').style.display = 'none';
    document.getElementById('active-round').style.display = '';
    document.getElementById('round-label').textContent = `Round ${activeRound.round_number}`;
    document.getElementById('round-status').textContent = 'ACTIVE';
    document.getElementById('round-status').style.background = 'var(--green)';
    document.getElementById('round-status').style.color = '#000';
  } else {
    document.getElementById('no-round-msg').style.display = data.room.status === 'finished' ? 'none' : '';
    document.getElementById('round-controls').style.display = data.room.status === 'finished' ? 'none' : '';
    document.getElementById('active-round').style.display = 'none';
    document.getElementById('round-status').textContent = data.room.status === 'finished' ? 'FINISHED' : 'IDLE';
    document.getElementById('round-status').style.background = 'var(--gray-dark)';
    document.getElementById('round-status').style.color = 'var(--white)';
  }

  // Spellers
  const spellers = data.spellers || [];
  const activeSpellers = spellers.filter(s => s.status === 'active');
  document.getElementById('active-speller-count').textContent = `${activeSpellers.length}/${spellers.length} active`;

  document.getElementById('speller-list').innerHTML = spellers.map(s => {
    const badge = s.status === 'active' ? '<span class="badge badge--active">Active</span>'
      : s.status === 'eliminated' ? `<span class="badge badge--eliminated">Out R${s.eliminated_in_round || '?'}</span>`
        : '<span class="badge badge--winner">Winner</span>';

    const actions = s.status === 'active'
      ? `<button class="btn btn--red btn--sm" data-speller-action="eliminate" data-speller-id="${s.id}">Eliminate</button>`
      : s.status === 'eliminated'
        ? `<button class="btn btn--outline btn--sm" data-speller-action="reinstate" data-speller-id="${s.id}">Reinstate</button>`
        : '';

    const deleteBtn = data.room.status === 'setup'
      ? `<button class="btn btn--outline btn--sm" data-speller-action="delete" data-speller-id="${s.id}" style="font-size:0.7rem">✕</button>` : '';

    return `<div class="speller-admin-row">
      <div><span class="speller-name">${esc(s.name)}</span> ${badge}</div>
      <div class="speller-admin-actions">${actions} ${deleteBtn}</div>
    </div>`;
  }).join('') || '<div class="empty-state">No spellers added</div>';

  // Turn speller dropdown
  const turnSpellerSelect = document.getElementById('turn-speller');
  const currentVal = turnSpellerSelect.value;
  turnSpellerSelect.innerHTML = '<option value="">Select speller...</option>' +
    activeSpellers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (currentVal) turnSpellerSelect.value = currentVal;

  // Winner dropdown
  const winnerSelect = document.getElementById('winner-select');
  const currentWinner = winnerSelect.value;
  winnerSelect.innerHTML = '<option value="">Select winner...</option>' +
    activeSpellers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (currentWinner) winnerSelect.value = currentWinner;

  // Current word card (for pronouncer — shows the active turn's word details)
  const turns = data.currentTurns || [];
  const activeTurn = turns.find(t => !t.result);
  const wordCardEl = document.getElementById('current-word-card');
  if (activeTurn && activeTurn.word) {
    wordCardEl.style.display = '';
    wordCardEl.innerHTML = `
      <div class="pronouncer-card">
        <div class="pronouncer-label">Now Spelling</div>
        <div class="pronouncer-speller">${esc(activeTurn.speller_name)}</div>
        <div class="pronouncer-word">${esc(activeTurn.word)}</div>
        ${activeTurn.word_pronunciation ? `<div class="pronouncer-pronunciation">${esc(activeTurn.word_pronunciation)}</div>` : ''}
        ${activeTurn.word_definition ? `<div class="pronouncer-detail"><span class="pronouncer-detail-label">Definition:</span> ${esc(activeTurn.word_definition)}</div>` : ''}
        ${activeTurn.word_sentence ? `<div class="pronouncer-detail"><span class="pronouncer-detail-label">Sentence:</span> ${esc(activeTurn.word_sentence)}</div>` : ''}
        ${activeTurn.word_origin ? `<div class="pronouncer-detail"><span class="pronouncer-detail-label">Origin:</span> ${esc(activeTurn.word_origin)}</div>` : ''}
      </div>
    `;
  } else {
    wordCardEl.style.display = 'none';
  }

  // Upcoming spellers from round order
  const upcomingEl = document.getElementById('upcoming-spellers');
  if (activeRound && activeRound.speller_order) {
    const spellerOrder = typeof activeRound.speller_order === 'string'
      ? JSON.parse(activeRound.speller_order) : activeRound.speller_order;
    const completedSpellerIds = new Set(turns.map(t => t.speller_id));
    const upcoming = spellerOrder
      .filter(id => !completedSpellerIds.has(id))
      .map(id => spellers.find(s => s.id === id))
      .filter(Boolean);

    if (upcoming.length > 0) {
      upcomingEl.innerHTML = `
        <div class="upcoming-lineup">
          <div class="upcoming-label">Upcoming Spellers</div>
          <div class="upcoming-list">
            ${upcoming.map((s, i) => `
              <div class="upcoming-item ${i === 0 ? 'upcoming-item--next' : ''}">
                <span class="upcoming-order">${i + 1}</span>
                <span class="upcoming-name">${esc(s.name)}</span>
                ${i === 0 ? '<span class="badge badge--active" style="font-size:0.6rem">Next</span>' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
      // Auto-select next speller in dropdown
      if (upcoming.length > 0 && !document.getElementById('turn-speller').value) {
        document.getElementById('turn-speller').value = upcoming[0].id;
      }
    } else {
      upcomingEl.innerHTML = '';
    }
  } else {
    upcomingEl.innerHTML = '';
  }

  // Current turns with action buttons
  document.getElementById('current-turns').innerHTML = turns.length ? turns.map(t => {
    const resultBtns = t.result ? (
      t.result === 'correct'
        ? '<span class="badge badge--correct">Correct</span>'
        : `<span class="badge badge--incorrect">Incorrect</span>
           <button class="btn btn--red btn--sm" data-turn-action="eliminate" data-speller-id="${t.speller_id}">Eliminate</button>`
    ) : `
      <button class="btn btn--green btn--sm" data-turn-action="correct" data-turn-id="${t.id}">✓</button>
      <button class="btn btn--red btn--sm" data-turn-action="incorrect" data-turn-id="${t.id}">✗</button>
    `;

    return `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid rgba(75,85,99,0.3)">
      <div>
        <strong>${esc(t.speller_name)}</strong>
        ${t.word ? `<span class="text-sm text-gray"> — "${esc(t.word)}"</span>` : ''}
      </div>
      <div class="flex gap-8">${resultBtns}</div>
    </div>`;
  }).join('') : '<div class="empty-state text-sm">No turns yet</div>';

  // Odds
  document.getElementById('admin-odds').innerHTML = renderOddsTable(data.odds, data.totalPool);

  // Gambler list
  const gamblers = data.gamblers || [];
  document.getElementById('gambler-list').innerHTML = gamblers.length ? gamblers.map(g => `
    <div class="gambler-chip-row">
      <span class="name">${esc(g.displayName)}</span>
      <div class="flex gap-8" style="align-items:center">
        <span class="balance">${formatChips(g.chipBalance)}</span>
        <button class="btn btn--outline btn--sm" data-credit-user="${g.userId}">+</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">No gamblers yet</div>';

  // Load next word if round is active
  if (activeRound) {
    loadNextWord();
  }
}

async function loadNextWord() {
  try {
    const data = await apiGet('/bee/words/next');
    const container = document.getElementById('next-word');
    if (data.word) {
      const w = data.word;
      selectedWord = w.word;
      container.innerHTML = `
        <div class="word-card selected" data-word="${esc(w.word)}">
          <div class="word-text">${esc(w.word)}${w.pronunciation ? ` <span class="text-sm text-gray" style="font-style:italic;font-weight:400">${esc(w.pronunciation)}</span>` : ''}</div>
          <div class="word-def">${esc(w.definition)}</div>
          ${w.sentence ? `<div class="word-def" style="margin-top:2px;font-style:italic">"${esc(w.sentence)}"</div>` : ''}
          <div class="word-def" style="margin-top:2px">Origin: ${esc(w.origin)}</div>
          <div class="flex-between mt-8">
            <span class="text-sm text-gray">${data.remaining} words remaining</span>
            <button class="btn btn--outline btn--sm" id="skip-word-btn">Skip</button>
          </div>
        </div>
      `;
      document.getElementById('skip-word-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiPost('/bee/words/skip', {});
          selectedWord = null;
          loadNextWord();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    } else {
      selectedWord = null;
      container.innerHTML = '<div class="text-sm text-gray">No words remaining</div>';
    }
  } catch (e) { /* best effort */ }
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// Start polling
const poller = new Poller(5000, render);
poller.start();
