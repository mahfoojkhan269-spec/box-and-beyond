if (!localStorage.getItem('ns_refresh_token')) window.location.href = 'index.html';

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('refreshBtn').addEventListener('click', () => { loadOrders(1); loadStats(); });
document.getElementById('statusFilter').addEventListener('change', () => loadOrders(1));
document.getElementById('prevPageBtn').addEventListener('click', () => loadOrders(currentPage - 1));
document.getElementById('nextPageBtn').addEventListener('click', () => loadOrders(currentPage + 1));

// Debounced: search runs as a real SQL query server-side (see GET /api/orders),
// so it shouldn't fire on every keystroke once order volume is large.
let searchDebounce;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadOrders(1), 300);
});
const userEmail = localStorage.getItem('ns_user_email') || '';
document.getElementById('accountEmail').textContent = userEmail;
document.getElementById('accountAvatar').textContent = userEmail.slice(0, 2).toUpperCase() || '??';

const VIEW_TITLES = { orders: 'Orders', 'needs-review': 'Needs review', logs: 'Webhook logs' };

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view] || 'Orders';

  const isOrdersLike = view === 'orders' || view === 'needs-review';
  document.getElementById('view-orders').classList.toggle('hide', !isOrdersLike);
  document.getElementById('view-logs').classList.toggle('hide', view !== 'logs');

  if (view === 'needs-review') {
    document.getElementById('statusFilter').value = 'needs_review';
    loadOrders(1);
  } else if (view === 'orders') {
    document.getElementById('statusFilter').value = '';
    loadOrders(1);
  } else if (view === 'logs') {
    loadLogs();
  }
}

const PAGE_SIZE = 25;
let currentPage = 1;
let totalOrders = 0;
let expandedId = null;

const STAT_CARDS = [
  { key: 'total', label: 'Total orders', className: 'stat-total' },
  { key: 'received', label: 'Received', className: '' },
  { key: 'shipment_created', label: 'Shipment created', className: '' },
  { key: 'dispatched', label: 'Dispatched', className: 'stat-dispatched' },
  { key: 'delivered', label: 'Delivered', className: 'stat-delivered' },
  { key: 'needs_review', label: 'Needs review', className: 'stat-review' },
];

function statusLabel(status) {
  return (status || '').replace(/_/g, ' ');
}

function latestShipment(order) {
  const shipments = order.shipments || [];
  return shipments[shipments.length - 1] || null;
}

async function loadStats() {
  const res = await apiFetch('/api/orders/stats');
  if (!res.ok) return;
  const data = await res.json();
  const counts = { total: data.total, ...data.byStatus };

  const row = document.getElementById('statsRow');
  row.innerHTML = STAT_CARDS.map(card => `
    <div class="stat-card ${card.className}">
      <div class="stat-value">${counts[card.key] ?? 0}</div>
      <div class="stat-label">${card.label}</div>
    </div>
  `).join('');
}

async function loadOrders(page) {
  currentPage = Math.max(1, page || 1);
  const status = document.getElementById('statusFilter').value;
  const search = document.getElementById('search').value.trim();

  const params = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const res = await apiFetch(`/api/orders?${params}`);
  if (!res.ok) return;
  const data = await res.json();
  totalOrders = data.total || 0;
  renderOrders(data.orders || []);
  renderPagination();
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages} · ${totalOrders} order(s)`;
  document.getElementById('prevPageBtn').disabled = currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function renderOrders(orders) {
  const body = document.getElementById('ordersBody');
  body.innerHTML = '';

  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No orders match.</td></tr>';
    return;
  }

  orders.forEach(order => {
    const shipment = latestShipment(order);
    const row = document.createElement('tr');
    row.className = 'row-clickable';
    row.innerHTML = `
      <td>${order.nextopper_order_id}</td>
      <td>${order.student_name || '—'}</td>
      <td>${order.course_name || '—'}</td>
      <td><span class="badge badge-${order.status}">${statusLabel(order.status)}</span></td>
      <td>${shipment?.dtdc_awb_number || '—'}</td>
      <td>${order.received_at ? new Date(order.received_at).toLocaleString() : '—'}</td>
    `;
    row.addEventListener('click', () => toggleDetail(order, row));
    body.appendChild(row);
  });
}

async function toggleDetail(order, row) {
  const next = row.nextElementSibling;
  const alreadyOpen = next && next.classList.contains('detail-row');
  document.querySelectorAll('.detail-row').forEach(el => el.remove());

  if (alreadyOpen) { expandedId = null; return; }
  expandedId = order.id;

  const placeholder = document.createElement('tr');
  placeholder.className = 'detail-row';
  placeholder.innerHTML = `<td colspan="6" class="empty">Loading...</td>`;
  row.after(placeholder);

  const res = await apiFetch(`/api/orders/${order.id}`);
  if (!res.ok || expandedId !== order.id) return;
  const { order: full } = await res.json();
  if (document.body.contains(placeholder)) placeholder.replaceWith(buildDetailRow(full));
}

function buildDetailRow(order) {
  const shipment = latestShipment(order);
  const tr = document.createElement('tr');
  tr.className = 'detail-row';
  const needsAction = order.status === 'failed' || order.status === 'needs_review';

  const events = [...(order.order_events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const attempts = [...(order.delivery_attempts || [])].sort((a, b) => new Date(a.attempted_at) - new Date(b.attempted_at));

  const timelineHtml = events.length
    ? `<ul class="timeline">${events.map(e => `
        <li>
          <span class="tl-time">${new Date(e.created_at).toLocaleString()}</span>
          <span class="tl-status">${statusLabel(e.status)}</span>
          <span class="tl-note">${e.note || ''}</span>
        </li>`).join('')}</ul>`
    : '<div class="empty">No status history yet.</div>';

  const ndrHtml = attempts.length
    ? `<div class="section-title">Delivery attempts (NDR)</div><ul class="timeline">${attempts.map(a => `
        <li>
          <span class="tl-time">${new Date(a.attempted_at).toLocaleString()}</span>
          <span class="tl-note">${a.ndr_reason || 'No reason given by DTDC'}</span>
        </li>`).join('')}</ul>`
    : '';

  tr.innerHTML = `
    <td colspan="6">
      <div class="detail-grid">
        <div><span>Phone</span>${order.phone || '—'}</div>
        <div><span>Email</span>${order.email || '—'}</div>
        <div><span>Address</span>${[order.address_line1, order.address_line2, order.city, order.state, order.pincode].filter(Boolean).join(', ') || '—'}</div>
        <div><span>Reference</span>${shipment?.dtdc_reference || '—'}</div>
        <div><span>Courier status</span>${shipment?.courier_status || '—'}</div>
        <div><span>Last error</span>${shipment?.error_message || '—'}</div>
      </div>
      <div class="actions">
        ${needsAction ? `<button class="btn btn-primary btn-sm" data-action="retry" data-id="${order.id}">Retry shipment</button>` : ''}
        ${shipment?.label_url ? `<a class="btn btn-outline btn-sm" href="${shipment.label_url}" target="_blank" rel="noopener">View label</a>` : ''}
        ${order.status !== 'delivered' ? `<button class="btn btn-outline btn-sm" data-action="deliver" data-id="${order.id}">Mark delivered</button>` : ''}
      </div>
      <div class="section-title">Status history</div>
      ${timelineHtml}
      ${ndrHtml}
    </td>
  `;
  tr.querySelector('[data-action="retry"]')?.addEventListener('click', () => retryOrder(order.id));
  tr.querySelector('[data-action="deliver"]')?.addEventListener('click', () => markDelivered(order.id));
  return tr;
}

async function loadLogs() {
  const res = await apiFetch('/api/webhook-logs');
  if (!res.ok) return;
  const data = await res.json();
  const body = document.getElementById('logsBody');
  const logs = data.logs || [];

  if (!logs.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No webhook calls received yet.</td></tr>';
    return;
  }

  body.innerHTML = logs.map(log => `
    <tr>
      <td>${new Date(log.received_at).toLocaleString()}</td>
      <td><span class="badge ${log.signature_valid ? 'badge-delivered' : 'badge-needs_review'}">${log.signature_valid ? 'valid' : 'invalid'}</span></td>
      <td>${log.body?.order_id ?? log.body?.id ?? '—'}</td>
      <td>${log.error || '—'}</td>
    </tr>
  `).join('');
}

async function retryOrder(id) {
  const res = await apiFetch(`/api/orders/${id}/retry`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Retry failed'); return; }
  expandedId = null;
  loadOrders(currentPage);
  loadStats();
}

async function markDelivered(id) {
  const res = await apiFetch(`/api/orders/${id}/mark-delivered`, { method: 'POST' });
  if (!res.ok) { alert('Could not update status'); return; }
  expandedId = null;
  loadOrders(currentPage);
  loadStats();
}

loadOrders(1);
loadStats();
