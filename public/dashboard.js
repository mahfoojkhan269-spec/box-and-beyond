if (!localStorage.getItem('ns_refresh_token')) window.location.href = 'index.html';

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('refreshBtn').addEventListener('click', loadOrders);
document.getElementById('statusFilter').addEventListener('change', loadOrders);
document.getElementById('search').addEventListener('input', renderFiltered);

let allOrders = [];
let expandedId = null;

function statusLabel(status) {
  return (status || '').replace(/_/g, ' ');
}

function latestShipment(order) {
  const shipments = order.shipments || [];
  return shipments[shipments.length - 1] || null;
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

    if (expandedId === order.id) body.appendChild(buildDetailRow(order));
  });
}

function toggleDetail(order, row) {
  const next = row.nextElementSibling;
  const alreadyOpen = next && next.classList.contains('detail-row');
  document.querySelectorAll('.detail-row').forEach(el => el.remove());
  expandedId = alreadyOpen ? null : order.id;
  if (!alreadyOpen) row.after(buildDetailRow(order));
}

function buildDetailRow(order) {
  const shipment = latestShipment(order);
  const tr = document.createElement('tr');
  tr.className = 'detail-row';
  const needsAction = order.status === 'failed' || order.status === 'needs_review';
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
  loadOrders();
}

async function markDelivered(id) {
  const res = await apiFetch(`/api/orders/${id}/mark-delivered`, { method: 'POST' });
  if (!res.ok) { alert('Could not update status'); return; }
  loadOrders();
}

loadOrders();
