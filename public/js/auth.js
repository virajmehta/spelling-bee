// Auth: JWT storage, join flow, redirect by role

export function getAuth() {
  const token = localStorage.getItem('sb_token');
  const role = localStorage.getItem('sb_role');
  const roomId = localStorage.getItem('sb_room');
  const roomName = localStorage.getItem('sb_room_name');
  const displayName = localStorage.getItem('sb_name');
  if (!token || !role) return null;
  return { token, role, roomId, roomName, displayName };
}

export function setAuth(data) {
  localStorage.setItem('sb_token', data.token);
  localStorage.setItem('sb_role', data.role);
  localStorage.setItem('sb_room', data.roomId);
  localStorage.setItem('sb_room_name', data.roomName);
  localStorage.setItem('sb_name', data.displayName || '');
}

export function clearAuth() {
  localStorage.removeItem('sb_token');
  localStorage.removeItem('sb_role');
  localStorage.removeItem('sb_room');
  localStorage.removeItem('sb_room_name');
  localStorage.removeItem('sb_name');
}

export function redirectByRole(role) {
  const pages = { admin: '/admin', gambler: '/gambler' };
  window.location.href = pages[role] || '/';
}

export function requireAuth(requiredRole) {
  const auth = getAuth();
  if (!auth) {
    window.location.href = '/';
    return null;
  }
  if (requiredRole && auth.role !== requiredRole) {
    window.location.href = '/';
    return null;
  }
  return auth;
}
