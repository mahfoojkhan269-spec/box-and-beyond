// Thin fetch wrapper: attaches the access token, and on a 401 tries exactly
// once to refresh the session before giving up and sending the user back to login.
async function apiFetch(path, options = {}) {
  const doFetch = (token) => fetch(`${window.API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  let token = localStorage.getItem('ns_access_token');
  let res = await doFetch(token);

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) { logout(); return res; }
    res = await doFetch(localStorage.getItem('ns_access_token'));
  }

  return res;
}

async function refreshSession() {
  const refresh_token = localStorage.getItem('ns_refresh_token');
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${window.API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem('ns_access_token', data.access_token);
    localStorage.setItem('ns_refresh_token', data.refresh_token);
    if (data.user?.email) localStorage.setItem('ns_user_email', data.user.email);
    return true;
  } catch {
    return false;
  }
}

function logout() {
  localStorage.removeItem('ns_access_token');
  localStorage.removeItem('ns_refresh_token');
  localStorage.removeItem('ns_user_email');
  window.location.href = 'index.html';
}
