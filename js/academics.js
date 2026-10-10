let currentSchoolId = null;
let activeSessionId = null;
let allStudents = [];
let allClasses = [];

async function loadAcademicsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'academics', profile });
  currentSchoolId = profile.school_id;
  await refreshAcademicsView();
}

async function refreshAcademicsView() {
  const [{ data: sessions }, { data: students }, { data: classes }] = await Promise.all([
    supabaseClient.from('academic_sessions').select('id, year_label, term, is_active, start_date, end_date')
      .eq('school_id', currentSchoolId).order('created_at', { ascending: false }),
    supabaseClient.from('students').select('id, name, classes ( name )').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('classes').select('id, name').eq('school_id', currentSchoolId).order('name'),
  ]);

  allStudents = students || [];
  allClasses = classes || [];
  const active = (sessions || []).find((s) => s.is_active);
  activeSessionId = active ? active.id : null;

  renderAcademicsBody(sessions || []);
}

function renderAcademicsBody(sessions) {
  const sessionRows = sessions.length ? sessions.map((s) => `
    <tr>
      <td>${s.year_label}</td>
      <td>${s.term}</td>
      <td class="text-muted">${s.start_date || '&mdash;'} &rarr; ${s.end_date || '&mdash;'}</td>
      <td>${s.is_active
        ? '<span style="color:#3A7D44; font-weight:600;">Active</span>'
        : '<span class="text-muted">Inactive</span>'}</td>
      <td>
        ${s.is_active
          ? ''
          : `<button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="setActiveSession(${s.id})">Set active</button>`}
        <button class="icon-btn" onclick="deleteSession(${s.id})">Remove</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="5"><div class="empty-state">No academic sessions yet. Add one below.</div></td></tr>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Terms</p>
    <h1 class="page-title">Academics</h1>
    <p class="page-subtitle">Manage your school's academic sessions and terms. Subjects have their own page now.</p>

    <div class="panel">
      <div class="panel-toolbar">
        <button class="btn-gold" onclick="toggleForm('session-form')">+ Add session</button>
      </div>
      <div id="session-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="session-year">Year (e.g. 2025/2026)</label>
            <input type="text" id="session-year" placeholder="2025/2026">
          </div>
          <div class="field">
            <label for="session-term">Term</label>
            <select id="session-term">
              <option>First Term</option>
              <option>Second Term</option>
              <option>Third Term</option>
            </select>
          </div>
          <div class="field">
            <label for="session-start">Start date</label>
            <input type="date" id="session-start">
          </div>
          <div class="field">
            <label for="session-end">End date</label>
            <input type="date" id="session-end">
          </div>
        </div>
        <button class="btn-gold" onclick="submitNewSession()">Save session</button>
      </div>
      <div id="session-form-error" class="error-banner"></div>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Year</th><th>Term</th><th>Dates</th><th>Status</th><th></th></tr></thead>
        <tbody>${sessionRows}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <p class="eyebrow">Report cards</p>
      <h3 class="panel-title">Attendance, behaviour &amp; remarks</h3>
      ${activeSessionId ? `
        <div class="field">
          <label for="notes-student-search">Search student</label>
          <input type="text" id="notes-student-search" placeholder="Type a name..." oninput="filterNotesStudentSearch()">
        </div>
        <div id="notes-student-results" style="max-height:200px; overflow-y:auto; margin-top:8px;"></div>
        <div id="notes-form-container"></div>
      ` : `<p class="text-muted" style="font-size:14px;">Set an active session above first.</p>`}
    </div>

    <div class="panel">
      <p class="eyebrow">Report cards</p>
      <h3 class="panel-title">Headteacher's Remarks</h3>
      ${activeSessionId ? `
        <p class="text-muted" style="font-size:13.5px; margin-bottom:12px;">Pick a class to see every student who still needs a remark, with their average and position for context.</p>
        <div class="field">
          <label for="ht-class-select">Class</label>
          <select id="ht-class-select" onchange="loadHeadteacherRemarksForClass()">
            <option value="">Select a class</option>
            ${allClasses.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div id="ht-remarks-container" style="margin-top:14px;"></div>
      ` : `<p class="text-muted" style="font-size:14px;">Set an active session above first.</p>`}
    </div>
  `;
}

function filterNotesStudentSearch() {
  const term = document.getElementById('notes-student-search').value.trim().toLowerCase();
  const resultsEl = document.getElementById('notes-student-results');
  if (!term) { resultsEl.innerHTML = ''; return; }

  const matches = allStudents.filter((s) => s.name.toLowerCase().includes(term)).slice(0, 8);
  resultsEl.innerHTML = matches.length ? matches.map((s) => `
    <div class="queue-row" style="cursor:pointer;" onclick="loadStudentNotesForm(${s.id}, '${s.name.replace(/'/g, "\\'")}')">
      <span>${s.name}</span>
      <span class="text-muted">${s.classes?.name || 'Unassigned'}</span>
    </div>
  `).join('') : `<p class="text-muted" style="font-size:13.5px; padding:8px 0;">No matches.</p>`;
}

async function loadStudentNotesForm(studentId, studentName) {
  document.getElementById('notes-student-results').innerHTML = '';
  document.getElementById('notes-student-search').value = '';

  const { data: notes } = await supabaseClient
    .from('student_term_notes').select('*')
    .eq('student_id', studentId).eq('session_id', activeSessionId).maybeSingle();

  const n = notes || {};
  const ratingOptions = (current) => [1, 2, 3, 4, 5].map((v) =>
    `<option value="${v}" ${current === v ? 'selected' : ''}>${v}</option>`).join('');

  document.getElementById('notes-form-container').innerHTML = `
    <div class="form-panel open" style="margin-top:14px;">
      <p style="font-weight:600; margin-bottom:10px;">${studentName}</p>
      <div class="form-grid">
        <div class="field"><label>Days school opened</label><input type="number" id="notes-days-opened" value="${n.days_opened ?? ''}"></div>
        <div class="field"><label>Days present</label><input type="number" id="notes-days-present" value="${n.days_present ?? ''}"></div>
        <div class="field"><label>Days absent</label><input type="number" id="notes-days-absent" value="${n.days_absent ?? ''}"></div>
        <div class="field"><label>Next term begins</label><input type="date" id="notes-next-term" value="${n.next_term_date || ''}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Punctuality</label><select id="notes-punctuality"><option value="">--</option>${ratingOptions(n.punctuality)}</select></div>
        <div class="field"><label>Attendance</label><select id="notes-attendance"><option value="">--</option>${ratingOptions(n.attendance_rating)}</select></div>
        <div class="field"><label>Neatness</label><select id="notes-neatness"><option value="">--</option>${ratingOptions(n.neatness)}</select></div>
        <div class="field"><label>Handwriting</label><select id="notes-handwriting"><option value="">--</option>${ratingOptions(n.handwriting)}</select></div>
        <div class="field"><label>Politeness</label><select id="notes-politeness"><option value="">--</option>${ratingOptions(n.politeness)}</select></div>
        <div class="field"><label>Initiative</label><select id="notes-initiative"><option value="">--</option>${ratingOptions(n.initiative)}</select></div>
        <div class="field"><label>Attitude to school</label><select id="notes-attitude"><option value="">--</option>${ratingOptions(n.attitude_to_school)}</select></div>
      </div>
      <div class="field"><label>Headteacher/Principal's remarks</label><input type="text" id="notes-headteacher-remark" value="${n.headteacher_remark || ''}"></div>
      <div class="field"><label>Teacher's remark</label><input type="text" id="notes-teacher-remark" value="${n.teacher_remark || ''}"></div>
      <button class="btn-gold" onclick="saveStudentNotes(${studentId})">Save</button>
      <div id="notes-error" class="error-banner"></div>
      <div id="notes-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>
  `;
}

async function saveStudentNotes(studentId) {
  const val = (id) => document.getElementById(id).value;
  const numOrNull = (v) => v === '' ? null : Number(v);

  const payload = {
    school_id: currentSchoolId,
    student_id: studentId,
    session_id: activeSessionId,
    days_opened: numOrNull(val('notes-days-opened')),
    days_present: numOrNull(val('notes-days-present')),
    days_absent: numOrNull(val('notes-days-absent')),
    next_term_date: val('notes-next-term') || null,
    punctuality: numOrNull(val('notes-punctuality')),
    attendance_rating: numOrNull(val('notes-attendance')),
    neatness: numOrNull(val('notes-neatness')),
    handwriting: numOrNull(val('notes-handwriting')),
    politeness: numOrNull(val('notes-politeness')),
    initiative: numOrNull(val('notes-initiative')),
    attitude_to_school: numOrNull(val('notes-attitude')),
    headteacher_remark: val('notes-headteacher-remark').trim() || null,
    teacher_remark: val('notes-teacher-remark').trim() || null,
  };

  const { error } = await supabaseClient
    .from('student_term_notes')
    .upsert(payload, { onConflict: 'student_id,session_id' });

  const errEl = document.getElementById('notes-error');
  const okEl = document.getElementById('notes-success');
  errEl.classList.remove('visible'); okEl.classList.remove('visible');

  if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }
  okEl.textContent = 'Saved.'; okEl.classList.add('visible');
  showSuccessToast('Notes saved');
}

function toggleForm(id) {
  document.getElementById(id).classList.toggle('open');
}

function showSessionError(message) {
  const el = document.getElementById('session-form-error');
  el.textContent = message;
  el.classList.add('visible');
}

async function submitNewSession() {
  const yearLabel = document.getElementById('session-year').value.trim();
  const term = document.getElementById('session-term').value;
  const startDate = document.getElementById('session-start').value || null;
  const endDate = document.getElementById('session-end').value || null;
  if (!yearLabel) { showSessionError('Year is required, e.g. 2025/2026.'); return; }

  const { error } = await supabaseClient.from('academic_sessions').insert({
    school_id: currentSchoolId, year_label: yearLabel, term, is_active: false,
    start_date: startDate, end_date: endDate,
  });
  if (error) { showSessionError(error.message); return; }

  document.getElementById('session-form').classList.remove('open');
  await refreshAcademicsView();
  showSuccessToast('Session added');
}

async function setActiveSession(id) {
  const { error: clearError } = await supabaseClient
    .from('academic_sessions').update({ is_active: false }).eq('school_id', currentSchoolId);
  if (clearError) { showSessionError(clearError.message); return; }

  const { error } = await supabaseClient.from('academic_sessions').update({ is_active: true }).eq('id', id);
  if (error) { showSessionError(error.message); return; }

  await refreshAcademicsView();
  showSuccessToast('Active session updated');
}

async function deleteSession(id) {
  if (!confirm('Are you sure you want to remove this academic session? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('academic_sessions').delete().eq('id', id);
  if (error) { showSessionError(error.message); return; }
  await refreshAcademicsView();
  showSuccessToast('Session removed');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

let htRemarksData = { students: [], showCompleted: false };

async function loadHeadteacherRemarksForClass() {
  const classId = document.getElementById('ht-class-select').value;
  const container = document.getElementById('ht-remarks-container');
  if (!classId) { container.innerHTML = ''; return; }

  container.innerHTML = `<div class="empty-state">Loading class...</div>`;

  const [{ data: students }, { data: results }, { data: notes }] = await Promise.all([
    supabaseClient.from('students').select('id, name').eq('class_id', classId).order('name'),
    supabaseClient.from('results').select('student_id, total_score')
      .eq('school_id', currentSchoolId).eq('session_id', activeSessionId),
    supabaseClient.from('student_term_notes').select('student_id, headteacher_remark')
      .eq('school_id', currentSchoolId).eq('session_id', activeSessionId),
  ]);

  const classStudents = students || [];
  const studentIds = new Set(classStudents.map((s) => s.id));
  const classResults = (results || []).filter((r) => studentIds.has(r.student_id));

  // Average per student, using only results that belong to this class
  const byStudent = {};
  classResults.forEach((r) => {
    if (r.total_score === null || r.total_score === undefined) return;
    if (!byStudent[r.student_id]) byStudent[r.student_id] = [];
    byStudent[r.student_id].push(Number(r.total_score));
  });
  const totals = Object.entries(byStudent).map(([id, scores]) => ({
    id: Number(id),
    average: scores.reduce((a, b) => a + b, 0) / scores.length,
  })).sort((a, b) => b.average - a.average);

  const ranks = {};
  let rank = 0, prevAvg = null, seen = 0;
  totals.forEach((t) => {
    seen++;
    if (t.average !== prevAvg) { rank = seen; prevAvg = t.average; }
    ranks[t.id] = rank;
  });
  const averageById = {};
  totals.forEach((t) => { averageById[t.id] = t.average; });

  const remarkById = {};
  (notes || []).forEach((n) => { remarkById[n.student_id] = n.headteacher_remark; });

  htRemarksData = {
    classId,
    students: classStudents.map((s) => ({
      id: s.id,
      name: s.name,
      average: averageById[s.id] ?? null,
      position: ranks[s.id] ?? null,
      remark: remarkById[s.id] || null,
    })),
    showCompleted: false,
  };

  renderHeadteacherRemarksList();
}

function renderHeadteacherRemarksList() {
  const { students, showCompleted } = htRemarksData;
  const remaining = students.filter((s) => !s.remark);
  const completed = students.filter((s) => s.remark);

  const remainingRows = remaining.length ? remaining.map((s) => `
    <div class="panel" style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px 12px; margin-bottom:8px;">
        <strong>${s.name}</strong>
        <span class="text-muted" style="font-size:13px;">
          ${s.average !== null ? 'Average: ' + s.average.toFixed(1) + '%' : 'No scored results yet'}
          ${s.position !== null ? ' &middot; Position: ' + ordinal(s.position) : ''}
        </span>
      </div>
      <textarea id="ht-remark-${s.id}" rows="2" style="width:100%; padding:10px; border-radius:var(--radius-sm); border:1px solid var(--border-soft); font-family:inherit; font-size:14px;" placeholder="Write a remark for ${s.name}..."></textarea>
      <button class="btn-gold" style="margin-top:8px;" onclick="saveHeadteacherRemark(${s.id})">Save comment</button>
    </div>
  `).join('') : `<div class="empty-state">Every student in this class has a remark. Nice work.</div>`;

  const completedRows = completed.map((s) => `
    <div class="queue-row">
      <span>${s.name}</span>
      <span class="text-muted" style="max-width:60%; text-align:right;">${s.remark}</span>
    </div>
  `).join('');

  document.getElementById('ht-remarks-container').innerHTML = `
    <p style="font-weight:600; font-size:14px; margin-bottom:10px;">${remaining.length} of ${students.length} remaining</p>
    ${remainingRows}
    ${completed.length ? `
      <div class="panel" style="margin-top:14px;">
        <a href="#" style="font-size:13.5px; font-weight:600; color:var(--navy);" onclick="event.preventDefault(); htRemarksData.showCompleted = !htRemarksData.showCompleted; renderHeadteacherRemarksList();">
          ${showCompleted ? 'Hide' : 'Show'} ${completed.length} already commented on
        </a>
        ${showCompleted ? `<div style="margin-top:10px;">${completedRows}</div>` : ''}
      </div>
    ` : ''}
  `;
}

async function saveHeadteacherRemark(studentId) {
  const remark = document.getElementById(`ht-remark-${studentId}`).value.trim();
  if (!remark) return;

  const { data: existing } = await supabaseClient
    .from('student_term_notes').select('id')
    .eq('student_id', studentId).eq('session_id', activeSessionId).maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabaseClient.from('student_term_notes').update({ headteacher_remark: remark }).eq('id', existing.id));
  } else {
    ({ error } = await supabaseClient.from('student_term_notes').insert({
      school_id: currentSchoolId, student_id: studentId, session_id: activeSessionId, headteacher_remark: remark,
    }));
  }

  if (error) { alert('Could not save: ' + error.message); return; }

  const s = htRemarksData.students.find((x) => x.id === studentId);
  if (s) s.remark = remark;
  renderHeadteacherRemarksList();
  showSuccessToast('Remark saved');
}

loadAcademicsPage();
