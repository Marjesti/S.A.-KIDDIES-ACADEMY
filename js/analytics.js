let currentSchoolId = null;

async function loadAnalyticsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'analytics', profile });
  currentSchoolId = profile.school_id;

  const { data: activeSession } = await supabaseClient
    .from('academic_sessions')
    .select('id, year_label, term')
    .eq('school_id', currentSchoolId)
    .eq('is_active', true)
    .maybeSingle();

  if (!activeSession) {
    document.getElementById('page-body').innerHTML = `
      <p class="page-date">Academic health</p>
      <h1 class="page-title">Analytics</h1>
      <div class="panel">
        <div class="empty-state">
          No active academic session is set. Go to <a href="academics.html">Academics</a>
          and mark a session as active to see analytics here.
        </div>
      </div>
    `;
    return;
  }

  const [{ data: results }, { data: allSessions }, { data: currentNotes }] = await Promise.all([
    supabaseClient.from('results')
      .select('total_score, status, subjects ( name )')
      .eq('school_id', currentSchoolId)
      .eq('session_id', activeSession.id),
    supabaseClient.from('academic_sessions')
      .select('id, year_label, term')
      .eq('school_id', currentSchoolId)
      .order('created_at', { ascending: true }),
    supabaseClient.from('student_term_notes')
      .select('days_opened, days_present, students ( classes ( id, name ) )')
      .eq('school_id', currentSchoolId)
      .eq('session_id', activeSession.id),
  ]);

  // Attendance across ALL terms (for the trend), one query covering every session at once
  const { data: allNotes } = await supabaseClient
    .from('student_term_notes')
    .select('session_id, days_opened, days_present')
    .eq('school_id', currentSchoolId);

  renderAnalyticsBody(activeSession, results || [], allSessions || [], allNotes || [], currentNotes || []);
}

function renderAnalyticsBody(session, results, allSessions, allNotes, currentNotes) {
  const scored = results.filter((r) => r.total_score !== null && r.total_score !== undefined);
  const overallAverage = scored.length
    ? scored.reduce((sum, r) => sum + Number(r.total_score), 0) / scored.length
    : null;
  const passCount = scored.filter((r) => Number(r.total_score) >= 40).length;
  const passRate = scored.length ? Math.round((passCount / scored.length) * 100) : null;

  // Group by subject
  const bySubject = {};
  scored.forEach((r) => {
    const name = r.subjects?.name || 'Unassigned';
    if (!bySubject[name]) bySubject[name] = [];
    bySubject[name].push(Number(r.total_score));
  });
  const subjectAverages = Object.entries(bySubject).map(([name, scores]) => ({
    name,
    average: scores.reduce((a, b) => a + b, 0) / scores.length,
  })).sort((a, b) => b.average - a.average);

  const hasSubjectData = subjectAverages.length > 0;
  const subjectChartHtml = hasSubjectData
    ? `<div style="height: ${Math.max(160, subjectAverages.length * 34)}px;"><canvas id="subject-chart"></canvas></div>`
    : `<div class="empty-state">No scored results yet for this session.</div>`;

  let focusHtml = '<div class="empty-state">Add results to see insights here.</div>';
  if (subjectAverages.length && overallAverage !== null) {
    const strongest = subjectAverages[0];
    const belowAverage = subjectAverages.filter((s) => s.average < overallAverage - 5);
    const items = [];
    items.push(`
      <div class="queue-row">
        <span><span class="queue-dot" style="background:#3A7D44"></span>${strongest.name}</span>
        <span class="text-muted">Strongest subject &mdash; ${strongest.average.toFixed(1)}%</span>
      </div>`);
    belowAverage.forEach((s) => {
      items.push(`
        <div class="queue-row">
          <span><span class="queue-dot" style="background:#C97B3D"></span>${s.name}</span>
          <span class="text-muted">${(overallAverage - s.average).toFixed(1)} points below average</span>
        </div>`);
    });
    focusHtml = items.join('');
  }

  // ---- Attendance trend across terms ----
  const bySession = {};
  allNotes.forEach((n) => {
    if (n.days_opened === null || n.days_present === null) return;
    if (!bySession[n.session_id]) bySession[n.session_id] = { opened: 0, present: 0 };
    bySession[n.session_id].opened += n.days_opened;
    bySession[n.session_id].present += n.days_present;
  });

  const trendRows = allSessions.map((s) => {
    const agg = bySession[s.id];
    const rate = agg && agg.opened > 0 ? (agg.present / agg.opened) * 100 : null;
    return { label: `${s.year_label} \u00b7 ${s.term}`, rate, isCurrent: s.id === session.id };
  }).filter((r) => r.rate !== null);

  const trendChartHtml = trendRows.length
    ? `<div style="height: 220px;"><canvas id="attendance-trend-chart"></canvas></div>`
    : `<div class="empty-state">No attendance data recorded yet. Enter days opened/present on the Academics page.</div>`;

  // ---- Attendance by class, current term ----
  const byClass = {};
  currentNotes.forEach((n) => {
    if (n.days_opened === null || n.days_present === null) return;
    const className = n.students?.classes?.name || 'Unassigned';
    if (!byClass[className]) byClass[className] = { opened: 0, present: 0 };
    byClass[className].opened += n.days_opened;
    byClass[className].present += n.days_present;
  });
  const classRows = Object.entries(byClass).map(([name, agg]) => ({
    name, rate: agg.opened > 0 ? (agg.present / agg.opened) * 100 : 0,
  })).sort((a, b) => b.rate - a.rate);

  const classChartHtml = classRows.length
    ? `<div style="height: ${Math.max(160, classRows.length * 34)}px;"><canvas id="class-attendance-chart"></canvas></div>`
    : `<div class="empty-state">No attendance data recorded yet for this term.</div>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${session.year_label} &middot; ${session.term}</p>
    <h1 class="page-title">Analytics</h1>
    <p class="page-subtitle">Patterns worth noticing across the current academic session.</p>

    <div class="session-banner">
      <p class="eyebrow">Current session average</p>
      <div class="session-title">${overallAverage !== null ? overallAverage.toFixed(1) + '%' : '&mdash;'}</div>
      ${passRate !== null ? `<div class="progress-row"><span>Pass rate</span><span>${passRate}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${passRate}%"></div></div>` : ''}
    </div>

    <div class="panel">
      <p class="eyebrow">By subject</p>
      <h3 class="panel-title">Average score</h3>
      ${subjectChartHtml}
    </div>

    <div class="panel">
      <p class="eyebrow">A closer look</p>
      <h3 class="panel-title">Where to focus next</h3>
      ${focusHtml}
    </div>

    <div class="panel">
      <p class="eyebrow">Attendance</p>
      <h3 class="panel-title">Trend across terms</h3>
      ${trendChartHtml}
    </div>

    <div class="panel">
      <p class="eyebrow">Attendance</p>
      <h3 class="panel-title">By class this term</h3>
      ${classChartHtml}
    </div>
  `;

  renderAnalyticsCharts(subjectAverages, trendRows, classRows);
}

let subjectChartInstance = null;
let trendChartInstance = null;
let classChartInstance = null;

function renderAnalyticsCharts(subjectAverages, trendRows, classRows) {
  const navy = '#1B2942';
  const gold = '#E8A93E';
  const gridColor = 'rgba(0,0,0,0.06)';

  if (subjectChartInstance) { subjectChartInstance.destroy(); subjectChartInstance = null; }
  if (trendChartInstance) { trendChartInstance.destroy(); trendChartInstance = null; }
  if (classChartInstance) { classChartInstance.destroy(); classChartInstance = null; }

  const subjectCanvas = document.getElementById('subject-chart');
  if (subjectCanvas && subjectAverages.length) {
    subjectChartInstance = new Chart(subjectCanvas, {
      type: 'bar',
      data: {
        labels: subjectAverages.map((s) => s.name),
        datasets: [{ data: subjectAverages.map((s) => s.average), backgroundColor: navy, borderRadius: 6, maxBarThickness: 28 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.x.toFixed(1) + '%' } } },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { color: gridColor }, ticks: { callback: (v) => v + '%' } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  const trendCanvas = document.getElementById('attendance-trend-chart');
  if (trendCanvas && trendRows.length) {
    trendChartInstance = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: trendRows.map((r) => r.label),
        datasets: [{
          data: trendRows.map((r) => r.rate),
          borderColor: gold, backgroundColor: 'rgba(232,169,62,0.15)',
          fill: true, tension: 0.3, pointBackgroundColor: gold, pointRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.y.toFixed(1) + '%' } } },
        scales: {
          y: { beginAtZero: true, max: 100, grid: { color: gridColor }, ticks: { callback: (v) => v + '%' } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  const classCanvas = document.getElementById('class-attendance-chart');
  if (classCanvas && classRows.length) {
    classChartInstance = new Chart(classCanvas, {
      type: 'bar',
      data: {
        labels: classRows.map((r) => r.name),
        datasets: [{ data: classRows.map((r) => r.rate), backgroundColor: navy, borderRadius: 6, maxBarThickness: 28 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.x.toFixed(1) + '%' } } },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { color: gridColor }, ticks: { callback: (v) => v + '%' } },
          y: { grid: { display: false } },
        },
      },
    });
  }
}

loadAnalyticsPage();
