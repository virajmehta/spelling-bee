// Payout reveal animation sequence

import { formatChips } from './format.js';

export function showPayoutReveal(payoutData) {
  const overlay = document.createElement('div');
  overlay.id = 'payout-overlay';
  overlay.innerHTML = `
    <style>
      #payout-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(7, 9, 15, 0.97);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 1s cubic-bezier(0.22, 1, 0.36, 1);
        overflow-y: auto; padding: 40px 20px;
      }
      #payout-overlay.visible { opacity: 1; }

      /* Animated background gradient */
      #payout-overlay::before {
        content: '';
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 50% 40% at 50% 30%, rgba(245,197,24,0.08) 0%, transparent 60%),
          radial-gradient(ellipse 40% 50% at 30% 70%, rgba(168,85,247,0.04) 0%, transparent 60%),
          radial-gradient(ellipse 40% 40% at 70% 60%, rgba(59,130,246,0.04) 0%, transparent 60%);
        animation: reveal-bg 4s ease-in-out infinite alternate;
        pointer-events: none;
      }
      @keyframes reveal-bg {
        0%   { transform: scale(1); }
        100% { transform: scale(1.15) translate(-2%, 3%); }
      }

      .reveal-crown {
        font-size: 4rem;
        opacity: 0;
        transform: scale(0) rotate(-20deg);
        transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
        filter: drop-shadow(0 0 30px rgba(245,197,24,0.5));
        margin-bottom: 10px;
        position: relative;
      }
      .reveal-crown.show {
        opacity: 1;
        transform: scale(1) rotate(0deg);
      }

      .reveal-winner {
        font-family: 'Syne', 'Oswald', sans-serif;
        font-size: 3.2rem;
        font-weight: 800;
        text-transform: uppercase;
        text-align: center;
        letter-spacing: 0.08em;
        background: linear-gradient(135deg, #f5c518 0%, #ffd740 40%, #f5c518 80%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: winner-shimmer 3s ease-in-out infinite;
        filter: drop-shadow(0 0 40px rgba(245,197,24,0.5));
        transform: scale(0);
        transition: transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
        margin-bottom: 20px;
        position: relative;
      }
      .reveal-winner.show { transform: scale(1); }

      @keyframes winner-shimmer {
        0%, 100% { background-position: 0% center; }
        50% { background-position: 200% center; }
      }

      .reveal-pool {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.2rem;
        color: #94a3b8;
        opacity: 0;
        transition: all 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        transform: translateY(10px);
        margin-bottom: 32px;
        text-align: center;
        position: relative;
      }
      .reveal-pool.show { opacity: 1; transform: translateY(0); }
      .reveal-pool .pool-amount {
        color: #f5c518;
        font-weight: 600;
        font-size: 1.4rem;
      }

      .reveal-payout {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        padding: 14px 22px;
        margin: 5px 0;
        width: 100%;
        max-width: 420px;
        transform: translateX(80px);
        opacity: 0;
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        position: relative;
      }
      .reveal-payout.show { transform: translateX(0); opacity: 1; }
      .reveal-payout:hover { border-color: rgba(245, 197, 24, 0.2); }
      .reveal-payout .name { font-weight: 600; font-size: 1rem; }
      .reveal-payout .amount {
        font-family: 'JetBrains Mono', monospace;
        color: #f5c518;
        font-weight: 600;
        font-size: 1.15rem;
        text-shadow: 0 0 12px rgba(245,197,24,0.3);
      }

      .reveal-confetti { position: fixed; inset: 0; pointer-events: none; z-index: 10000; }
      .confetti-piece {
        position: absolute;
        top: -10px;
        opacity: 0;
        animation: confetti-fall linear forwards;
      }
      @keyframes confetti-fall {
        0% { opacity: 1; transform: translateY(0) rotate(0deg) scale(1); }
        75% { opacity: 0.8; }
        100% { opacity: 0; transform: translateY(100vh) rotate(1080deg) scale(0.5); }
      }

      .reveal-close {
        margin-top: 36px;
        padding: 14px 36px;
        background: linear-gradient(135deg, #f5c518 0%, #ffd740 100%);
        color: #000;
        border: none;
        border-radius: 10px;
        font-family: 'Syne', 'Oswald', sans-serif;
        font-size: 0.9rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        cursor: pointer;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        box-shadow: 0 4px 20px rgba(245, 197, 24, 0.3);
        position: relative;
      }
      .reveal-close.show { opacity: 1; transform: translateY(0); }
      .reveal-close:hover {
        box-shadow: 0 6px 30px rgba(245, 197, 24, 0.45);
        transform: translateY(-2px);
      }

      .reveal-no-bets {
        font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
        font-size: 1rem;
        color: #94a3b8;
        opacity: 0;
        transition: all 0.5s;
        transform: translateY(10px);
        margin-bottom: 20px;
        text-align: center;
        position: relative;
      }
      .reveal-no-bets.show { opacity: 1; transform: translateY(0); }

      @media (max-width: 480px) {
        .reveal-winner { font-size: 2.2rem; }
        .reveal-crown { font-size: 3rem; }
        .reveal-payout { padding: 12px 16px; }
      }
    </style>
    <div class="reveal-crown" id="reveal-crown">👑</div>
    <div class="reveal-winner" id="reveal-winner"></div>
    <div class="reveal-pool" id="reveal-pool"></div>
    <div id="reveal-payouts"></div>
    <div class="reveal-no-bets" id="reveal-no-bets"></div>
    <button class="reveal-close" id="reveal-close">View Final Standings</button>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  const winner = payoutData.winner || payoutData;
  const winnerName = winner.winnerName || winner.name || 'Champion';
  const totalPool = payoutData.totalPool || 0;
  const payouts = payoutData.payouts || [];

  // Step 1: Crown emoji (0.3s delay)
  setTimeout(() => {
    document.getElementById('reveal-crown').classList.add('show');
  }, 300);

  // Step 2: Winner name (0.8s delay)
  setTimeout(() => {
    const el = document.getElementById('reveal-winner');
    el.textContent = winnerName;
    el.classList.add('show');
  }, 800);

  // Step 3: Total pool (1.8s)
  setTimeout(() => {
    const el = document.getElementById('reveal-pool');
    el.innerHTML = `Total Pool: <span class="pool-amount">${formatChips(totalPool)}</span> chips`;
    el.classList.add('show');
  }, 1800);

  // Step 4: Payouts cascade (2.8s+)
  if (payouts.length === 0) {
    setTimeout(() => {
      const el = document.getElementById('reveal-no-bets');
      el.textContent = 'No bets on winner — pool unclaimed!';
      el.classList.add('show');
    }, 2800);
  } else {
    const container = document.getElementById('reveal-payouts');
    payouts.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'reveal-payout';
      row.innerHTML = `
        <span class="name">${escHtml(p.display_name || p.displayName)}</span>
        <span class="amount">+${formatChips(p.payout_amount || p.payoutAmount)}</span>
      `;
      container.appendChild(row);
      setTimeout(() => row.classList.add('show'), 2800 + i * 250);
    });
  }

  // Step 5: Confetti (after payouts)
  const confettiDelay = 2800 + Math.max(payouts.length, 1) * 250 + 400;
  setTimeout(() => launchConfetti(), confettiDelay);

  // Step 6: Close button
  setTimeout(() => {
    document.getElementById('reveal-close').classList.add('show');
  }, confettiDelay + 600);

  document.getElementById('reveal-close').addEventListener('click', () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 1000);
  });
}

function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'reveal-confetti';
  document.body.appendChild(container);

  const colors = ['#f5c518', '#ffd740', '#f43f5e', '#10b981', '#3b82f6', '#a855f7', '#ff9100', '#e879f9'];
  const shapes = ['circle', 'square', 'diamond'];

  for (let i = 0; i < 100; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const size = 6 + Math.random() * 10;
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2.5 + Math.random() * 3) + 's';
    piece.style.animationDelay = Math.random() * 2.5 + 's';
    piece.style.width = size + 'px';
    piece.style.height = size + 'px';

    if (shape === 'circle') {
      piece.style.borderRadius = '50%';
    } else if (shape === 'diamond') {
      piece.style.borderRadius = '2px';
      piece.style.transform = 'rotate(45deg)';
    } else {
      piece.style.borderRadius = '2px';
    }

    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 7000);
}

function escHtml(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
