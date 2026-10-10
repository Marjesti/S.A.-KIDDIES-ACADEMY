function formatDate(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

async function loadOverview() {
  const { profile } = await requireSession();
  renderShell({ active: 'overview', profile });

  if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
    renderOverviewBody({
      adminFirstName: 'Amina',
      schoolName: profile.schools?.name || 'your school',
      activeSession: { year_label: '2025/2026', term: 'First Term' },
      studentCount: 6,
      teacherCount: 3,
      averageScore: 81.8,
      pendingCount: 2,
      groupEntries: [['SS 2 Gold', 36], ['JSS 3 Silver', 28], ['Primary 5 Gold', 22]],
    });
    return;
  }

  const schoolId = profile.school_id;

  // Active academic session (for the progress banner)
  const { data: activeSession } = await supabaseClient
    .from('academic_sessions')
    .select('id, year_label, term, start_date, end_date')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .maybeSingle();

  // Counts
  const [{ count: studentCount }, { count: teacherCount }] = await Promise.all([
    supabaseClient.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabaseClient.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
  ]);

  // Results for average score + pending count (scoped to active session if there is one)
  let resultsQuery = supabaseClient.from('results').select('status, total_score').eq('school_id', schoolId);
  if (activeSession) resultsQuery = resultsQuery.eq('session_id', activeSession.id);
  const { data: results } = await resultsQuery;

  const pendingCount = (results || []).filter((r) => r.status === 'pending').length;
  const scored = (results || []).filter((r) => r.total_score !== null && r.total_score !== undefined);
  const averageScore = scored.length
    ? (scored.reduce((sum, r) => sum + Number(r.total_score), 0) / scored.length)
    : null;

  // Approval queue: group pending results by class, via students -> classes
  const { data: pendingRows } = await supabaseClient
    .from('results')
    .select('id, students ( name, classes ( name ) )')
    .eq('school_id', schoolId)
    .eq('status', 'pending');

  const groupCounts = {};
  (pendingRows || []).forEach((row) => {
    const className = row.students?.classes?.name || 'Unassigned class';
    groupCounts[className] = (groupCounts[className] || 0) + 1;
  });
  const groupEntries = Object.entries(groupCounts);

  renderOverviewBody({
    adminFirstName: firstName(profile.name),
    schoolName: profile.schools?.name || 'your school',
    activeSession,
    studentCount: studentCount || 0,
    teacherCount: teacherCount || 0,
    averageScore,
    pendingCount,
    groupEntries,
  });
}

function renderOverviewBody(data) {
  const {
    adminFirstName, schoolName, activeSession,
    studentCount, teacherCount, averageScore, pendingCount, groupEntries,
  } = data;

  function termProgressHtml() {
    if (!activeSession.start_date || !activeSession.end_date) {
      return `<p class="text-muted" style="font-size:13px; margin:0;">Add start/end dates on the Academics page to track progress.</p>`;
    }
    const start = new Date(activeSession.start_date).getTime();
    const end = new Date(activeSession.end_date).getTime();
    const now = Date.now();
    let pct = Math.round(((now - start) / (end - start)) * 100);
    pct = Math.max(0, Math.min(100, pct));
    const label = now < start ? 'Not started yet' : now > end ? 'Term complete' : `${pct}%`;
    return `
      <div class="progress-row"><span>Term progress</span><span>${label}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width: ${pct}%"></div></div>`;
  }

  const sessionHtml = activeSession ? `
    <div class="session-banner">
      <p class="eyebrow">Active academic session</p>
      <div class="session-title">${activeSession.year_label} &middot; ${activeSession.term}</div>
      ${termProgressHtml()}
    </div>
  ` : `
    <div class="session-banner">
      <p class="eyebrow">No active academic session</p>
      <div class="session-title">Set one up to see term progress here</div>
    </div>
  `;

  const queueHtml = groupEntries.length ? groupEntries.map(([className, count]) => `
    <div class="queue-row">
      <span><span class="queue-dot" style="background: var(--gold)"></span>${className}</span>
      <span>${count} record${count === 1 ? '' : 's'}</span>
    </div>
  `).join('') : `<div class="empty-state">No results are waiting for review right now.</div>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${formatDate(new Date())}</p>
    <h1 class="page-title">Good day, ${adminFirstName}.</h1>
    <p class="page-subtitle">Here is the pulse of ${schoolName}.</p>

    ${sessionHtml}

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">&#128101;</div>
        <div class="stat-label">Students</div>
        <div class="stat-value">${studentCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#127891;</div>
        <div class="stat-label">Teachers</div>
        <div class="stat-value">${teacherCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#128200;</div>
        <div class="stat-label">Average score</div>
        <div class="stat-value">${averageScore !== null ? averageScore.toFixed(1) + '%' : '&mdash;'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">&#9745;</div>
        <div class="stat-label">Pending results</div>
        <div class="stat-value">${pendingCount}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Needs your attention</p>
          <h3 class="panel-title">Approval queue</h3>
        </div>
        <a href="results-queue.html" class="panel-link">View all &rsaquo;</a>
      </div>
      ${queueHtml}
    </div>
  `;
}

loadOverview();
