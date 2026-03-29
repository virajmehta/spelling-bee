// Fetch wrapper with auth headers and error handling

const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('sb_token');
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('sb_token');
    localStorage.removeItem('sb_role');
    localStorage.removeItem('sb_room');
    localStorage.removeItem('sb_room_name');
    window.location.href = '/?expired=1';
    throw new Error('Session expired');
  }

  if (res.status === 304) {
    return null; // No changes
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch(path, body) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

export function apiGet(path) {
  return apiFetch(path);
}
