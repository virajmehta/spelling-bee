import { requireAuth, clearAuth } from '/js/auth.js';
import { apiPost, apiPatch, apiGet, apiDelete } from '/js/api.js';
import { Poller } from '/js/poll.js';
import { showToast, renderStatusBar, renderOddsTable } from '/js/components.js';
import { formatChips } from '/js/format.js';

const auth = requireAuth('admin');
if (!auth) throw new Error('Not authorized');

let state = null;
let currentRoundId = null;

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

// --- Bee Actions (delegated) ---
document.getElementById('bee-actions').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;

  try {
    if (action === 'call') {
      // Auto-create turn with next speller + next word
      const nextSpellerId = btn.dataset.spellerId;
      if (!nextSpellerId || !currentRoundId) return;
      // Fetch next word server-side
      const wordData = await apiGet('/bee/words/next');
      const word = wordData.word?.word || null;
      await apiPost('/bee/turns', { roundId: currentRoundId, spellerId: nextSpellerId, word });
      showToast('Speller called');
      poller.forcePoll();
    } else if (action === 'skip-word') {
      await apiPost('/bee/words/skip', {});
      showToast('Word skipped');
    } else if (action === 'skip-speller') {
      const spellerId = btn.dataset.spellerId;
      if (!spellerId || !currentRoundId) return;
      const res = await apiPost('/bee/turns', { roundId: currentRoundId, spellerId });
      await apiPatch(`/bee/turns/${res.id}`, { result: 'correct' });
      showToast('Speller skipped');
      poller.forcePoll();
    } else if (action === 'correct') {
      await apiPatch(`/bee/turns/${btn.dataset.turnId}`, { result: 'correct' });
      showToast('Correct!');
      poller.forcePoll();
    } else if (action === 'incorrect') {
      await apiPatch(`/bee/turns/${btn.dataset.turnId}`, { result: 'incorrect' });
      // Auto-eliminate on incorrect
      await apiPost(`/bee/spellers/${btn.dataset.spellerId}/eliminate`, {});
      showToast('Incorrect — eliminated');
      poller.forcePoll();
    } else if (action === 'undo') {
      await apiPatch(`/bee/turns/${btn.dataset.turnId}`, { result: null });
      // If speller was eliminated, reinstate them
      if (btn.dataset.spellerId) {
        await apiPost(`/bee/spellers/${btn.dataset.spellerId}/reinstate`, {});
      }
      showToast('Undone');
      poller.forcePoll();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Turn History Undo (delegated) ---
document.getElementById('current-turns').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="undo"]');
  if (!btn) return;
  try {
    await apiPatch(`/bee/turns/${btn.dataset.turnId}`, { result: null });
    if (btn.dataset.spellerId) {
      await apiPost(`/bee/spellers/${btn.dataset.spellerId}/reinstate`, {});
    }
    showToast('Undone');
    poller.forcePoll();
  } catch (err) {
    showToast(err.message, 'error');
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

// --- Word Upload ---
document.getElementById('upload-words-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('word-file-input');
  const file = fileInput.files?.[0];
  if (!file) return showToast('Select a .json file first', 'error');

  try {
    const text = await file.text();
    const words = JSON.parse(text);
    if (!Array.isArray(words)) throw new Error('File must contain a JSON array');
    for (const w of words) {
      if (!w.word || !w.definition) throw new Error('Each entry needs "word" and "definition"');
    }
    const res = await apiPost('/admin/words/upload', words);
    document.getElementById('import-status').textContent = `Uploaded ${res.imported} words (replaced ${res.replaced} unused)`;
    showToast(`Uploaded ${res.imported} words`);
    fileInput.value = '';
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

  const sortedSpellers = [...spellers].sort((a, b) => {
    const order = { active: 0, winner: 1, eliminated: 2 };
    return (order[a.status] || 0) - (order[b.status] || 0);
  });

  document.getElementById('speller-list').innerHTML = sortedSpellers.map(s => {
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

  // --- Active round: pronouncer card + action buttons ---
  const turns = data.currentTurns || [];
  const activeTurn = turns.find(t => !t.result);

  // Pronouncer card — only when there's an active turn with a word
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

  // Compute upcoming spellers from room-level order, filtered to active + not yet gone this round
  let upcoming = [];
  if (activeRound && data.room.spellerOrder?.length) {
    const completedSpellerIds = new Set(turns.map(t => t.speller_id));
    // If there's an active turn, that speller is "current", not upcoming
    if (activeTurn) completedSpellerIds.delete(activeTurn.speller_id);
    upcoming = data.room.spellerOrder
      .filter(id => !completedSpellerIds.has(id))
      .map(id => spellers.find(s => s.id === id))
      .filter(s => s && s.status === 'active');
  }

  // Action buttons
  const actionsEl = document.getElementById('bee-actions');
  if (activeRound) {
    if (activeTurn) {
      // Active turn awaiting result — show Correct / Incorrect / Eliminate
      actionsEl.innerHTML = `
        <div class="bee-action-bar">
          <button class="btn btn--green btn--lg" data-action="correct" data-turn-id="${activeTurn.id}">Correct</button>
          <button class="btn btn--red btn--lg" data-action="incorrect" data-turn-id="${activeTurn.id}" data-speller-id="${activeTurn.speller_id}" data-speller-name="${esc(activeTurn.speller_name)}">Incorrect</button>
        </div>
        <div class="bee-action-bar mt-8">
          <button class="btn btn--outline btn--sm" data-action="skip-word">Skip Word</button>
        </div>
      `;
    } else {
      // No active turn — show Call Next Speller / Skip buttons
      const nextSpeller = upcoming[0];
      if (nextSpeller) {
        actionsEl.innerHTML = `
          <div class="next-up-label">Next up: <strong>${esc(nextSpeller.name)}</strong></div>
          <div class="bee-action-bar">
            <button class="btn btn--gold btn--lg" data-action="call" data-speller-id="${nextSpeller.id}">Call Speller</button>
          </div>
          <div class="bee-action-bar mt-8">
            <button class="btn btn--outline btn--sm" data-action="skip-word">Skip Word</button>
            <button class="btn btn--outline btn--sm" data-action="skip-speller" data-speller-id="${nextSpeller.id}" data-speller-name="${esc(nextSpeller.name)}">Skip Speller</button>
          </div>
        `;
      } else {
        actionsEl.innerHTML = '<div class="empty-state">All spellers have gone this round</div>';
      }
    }
  } else {
    actionsEl.innerHTML = '';
  }

  // Upcoming spellers list (excluding the current/next one who's shown in actions)
  const upcomingEl = document.getElementById('upcoming-spellers');
  const displayUpcoming = activeTurn ? upcoming.filter(s => s.id !== activeTurn.speller_id) : upcoming.slice(1);
  if (displayUpcoming.length > 0) {
    upcomingEl.innerHTML = `
      <div class="upcoming-lineup">
        <div class="upcoming-label">On Deck</div>
        <div class="upcoming-list">
          ${displayUpcoming.map((s, i) => `
            <div class="upcoming-item">
              <span class="upcoming-order">${i + 1}</span>
              <span class="upcoming-name">${esc(s.name)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    upcomingEl.innerHTML = '';
  }

  // Turn history — most recent completed turn gets an undo button
  const completedTurns = turns.filter(t => t.result);
  const mostRecentTurnId = completedTurns.length > 0 ? completedTurns[0].id : null;

  document.getElementById('current-turns').innerHTML = turns.length ? turns.map(t => {
    const canUndo = t.id === mostRecentTurnId;
    const undoBtn = canUndo
      ? ` <button class="btn btn--outline btn--sm" data-action="undo" data-turn-id="${t.id}" data-speller-id="${t.speller_id}" style="font-size:0.65rem;padding:3px 8px">Undo</button>`
      : '';

    const resultBadge = t.result === 'correct'
      ? `<span class="badge badge--correct">Correct</span>${undoBtn}`
      : t.result === 'incorrect'
        ? `<span class="badge badge--incorrect">Incorrect</span>${undoBtn}`
        : '<span class="text-sm text-gray">Pending...</span>';

    return `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid rgba(75,85,99,0.3)">
      <div>
        <strong>${esc(t.speller_name)}</strong>
        ${t.word ? `<span class="text-sm text-gray"> — "${esc(t.word)}"</span>` : ''}
      </div>
      <div class="flex gap-8">${resultBadge}</div>
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
