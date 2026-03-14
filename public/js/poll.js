// Polling manager — periodic state fetch with version diffing

import { apiFetch } from './api.js';

export class Poller {
  constructor(intervalMs, onUpdate) {
    this.intervalMs = intervalMs;
    this.onUpdate = onUpdate;
    this.lastVersion = 0;
    this.timer = null;
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.poll(); // immediate first poll
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll() {
    if (!this.active) return;
    try {
      const data = await apiFetch(`/poll?version=${this.lastVersion}`);
      if (data === null) return; // 304, no changes
      this.lastVersion = data.room?.version || this.lastVersion;
      this.onUpdate(data);
    } catch (err) {
      console.error('Poll error:', err);
    }
  }

  // Force an immediate poll (e.g. after placing a bet)
  async forcePoll() {
    this.lastVersion = 0; // reset to force full fetch
    await this.poll();
  }
}
