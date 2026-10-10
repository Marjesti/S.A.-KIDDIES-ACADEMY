let currentSchoolId = null;

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

async function loadActivityLogPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'activity-log', profile });
  currentSchoolId = profile.school_id;

  const { data: entries, error } = await supabaseClient
    .from('activity_log').select('actor_name, action, details, created_at')
    .eq('school_id', currentSchoolId)
    .order('created_at', { ascending: false })
    .limit(100);

  renderActivityLogBody(entries || [], error);
}

function renderActivityLogBody(entries, error) {
  const rowsHtml = entries.length ? entries.map((e) => `
    <tr>
      <td>${e.actor_name}</td>
      <td>${e.action}</td>
      <td class="text-muted">${e.details || ''}</td>
      <td class="text-muted">${timeAgo(e.created_at)}</td>
    </tr>
  `).join('') : `<tr><td colspan="4"><div class="empty-state">No activity recorded yet. Approving or publishing a result will show up here.</div></td></tr>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Audit trail</p>
    <h1 class="page-title">Activity log</h1>
    <p class="page-subtitle">A record of who approved or published results, and when. Most recent first.</p>

    ${error ? `<div class="panel"><div class="error-banner visible">${error.message}</div></div>` : `
    <div class="panel">
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Who</th><th>Action</th><th>Details</th><th>When</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
    </div>
    `}
  `;
}

loadActivityLogPage();
