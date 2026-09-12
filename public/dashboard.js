if (!localStorage.getItem('ns_refresh_token')) window.location.href = 'index.html';

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('refreshBtn').addEventListener('click', () => { loadOrders(); loadStats(); });
document.getElementById('statusFilter').addEventListener('change', loadOrders);
document.getElementById('search').addEventListener('input', renderFiltered);

let allOrders = [];
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

async function loadOrders() {
  const status = document.getElementById('statusFilter').value;
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/orders${qs}`);
  if (!res.ok) return;
  const data = await res.json();
  allOrders = data.orders || [];
  renderFiltered();
}

function renderFiltered() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const filtered = !term
    ? allOrders
    : allOrders.filter(o =>
        (o.student_name || '').toLowerCase().includes(term) ||
        (o.nextopper_order_id || '').toLowerCase().includes(term));
  renderOrders(filtered);
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

async function retryOrder(id) {
  const res = await apiFetch(`/api/orders/${id}/retry`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Retry failed'); return; }
  expandedId = null;
  loadOrders();
  loadStats();
}

async function markDelivered(id) {
  const res = await apiFetch(`/api/orders/${id}/mark-delivered`, { method: 'POST' });
  if (!res.ok) { alert('Could not update status'); return; }
  expandedId = null;
  loadOrders();
  loadStats();
}

loadOrders();
loadStats();
