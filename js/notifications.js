let currentSchoolId = null;

async function loadNotificationsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'notifications', profile });
  currentSchoolId = profile.school_id;
  await refreshNotificationsView();
}

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function refreshNotificationsView() {
  const { data: notifications } = await supabaseClient
    .from('notifications')
    .select('id, title, body, is_read, created_at')
    .eq('school_id', currentSchoolId)
    .order('created_at', { ascending: false })
    .limit(50);

  renderNotificationsBody(notifications || []);
}

function renderNotificationsBody(notifications) {
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const rowsHtml = notifications.length ? notifications.map((n) => `
    <div class="queue-row" style="align-items:flex-start; ${n.is_read ? '' : 'background:#FBF6E8;'} padding:14px 10px; border-radius: var(--radius-sm);">
      <div>
        <div style="font-weight:600; margin-bottom:2px;">
          ${n.title} ${!n.is_read ? '<span style="color:var(--gold); font-size:11px; font-weight:700;">&#9679; NEW</span>' : ''}
        </div>
        ${n.body ? `<div class="text-muted" style="font-size:13.5px; margin-bottom:4px;">${n.body}</div>` : ''}
        <div class="text-muted" style="font-size:12px;">${timeAgo(n.created_at)}</div>
      </div>
      ${!n.is_read ? `<button class="icon-btn" style="color: var(--navy);" onclick="markRead(${n.id})">Mark read</button>` : ''}
    </div>
  `).join('') : `<div class="empty-state">Nothing here yet — this fills up as results are submitted and published.</div>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Keep in step</p>
    <h1 class="page-title">Notifications</h1>
    <p class="page-subtitle">A quiet record of decisions, submissions, and important changes.</p>

    ${unreadCount > 0 ? `
      <div class="panel-toolbar">
        <button class="btn-outline" onclick="markAllRead()">Mark all read (${unreadCount})</button>
      </div>
    ` : ''}

    <div class="panel">
      ${rowsHtml}
    </div>
  `;
}

async function markRead(id) {
  await supabaseClient.from('notifications').update({ is_read: true }).eq('id', id);
  await refreshNotificationsView();
}

async function markAllRead() {
  await supabaseClient.from('notifications').update({ is_read: true }).eq('school_id', currentSchoolId).eq('is_read', false);
  await refreshNotificationsView();
}

loadNotificationsPage();
