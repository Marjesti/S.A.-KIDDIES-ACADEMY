let currentSchoolId = null;
let activeSession = null;
let currentStudents = [];
let currentSubjects = [];
let currentClasses = [];
let currentFilter = 'all';
let currentResults = [];
let editingResultId = null;
let ca1Max = 15;
let ca2Max = 15;
let examMax = 70;
let primaryCa1Max = 20;
let primaryCa2Max = 20;
let primaryExamMax = 60;

function isPrimarySection(section) {
  return String(section || '').trim().toLowerCase().includes('primary');
}

function isEarlyYearsSection(section) {
  const value = String(section || '').trim().toLowerCase();
  return value.includes('pre-nursery') || value.includes('prenursery') || value.includes('nursery') || value.includes('playgroup') || value === 'nur';
}

function assessmentConfigForSection(section) {
  if (isEarlyYearsSection(section)) return { ca1: 20, ca2: 20, exam: 60 };
  return isPrimarySection(section)
    ? { ca1: primaryCa1Max, ca2: primaryCa2Max, exam: primaryExamMax }
    : { ca1: ca1Max, ca2: ca2Max, exam: 70 };
}

function gradeFor(total) {
  if (total === null || total === undefined) return '';
  if (total >= 90) return 'A+';
  if (total >= 80) return 'A';
  if (total >= 75) return 'B2';
  if (total >= 70) return 'B3';
  if (total >= 65) return 'C4';
  if (total >= 60) return 'C5';
  if (total >= 50) return 'C6';
  if (total >= 40) return 'D7';
  if (total >= 30) return 'E8';
  return 'F9';
}

async function loadResultsQueuePage() {
  const { profile } = await requireSession();
  renderShell({ active: 'results-queue', profile });
  currentSchoolId = profile.school_id;

  const { data: session } = await supabaseClient
    .from('academic_sessions')
    .select('id, year_label, term')
    .eq('school_id', currentSchoolId)
    .eq('is_active', true)
    .maybeSingle();
  activeSession = session;

  if (!activeSession) {
    document.getElementById('page-body').innerHTML = `
      <p class="page-date">Results management</p>
      <h1 class="page-title">Results queue</h1>
      <div class="panel">
        <div class="empty-state">
          No active academic session is set. Go to <a href="academics.html">Academics</a>
          and mark a session as active before recording results.
        </div>
      </div>
    `;
    return;
  }

  const [{ data: students }, { data: subjects }, { data: classes }, { data: school }] = await Promise.all([
    supabaseClient.from('students').select('id, name, classes ( id, name, section )').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('subjects').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('classes').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('schools').select('ca1_max, ca2_max, primary_ca1_max, primary_ca2_max, primary_exam_max').eq('id', currentSchoolId).single(),
  ]);
  currentStudents = students || [];
  currentSubjects = subjects || [];
  currentClasses = classes || [];
  ca1Max = school?.ca1_max ?? 15;
  ca2Max = school?.ca2_max ?? 15;
  primaryCa1Max = school?.primary_ca1_max ?? 20;
  primaryCa2Max = school?.primary_ca2_max ?? 20;
  primaryExamMax = school?.primary_exam_max ?? 60;
  examMax = 70;

  await refreshResultsView();
}

async function refreshResultsView() {
  let query = supabaseClient
    .from('results')
    .select('id, ca1_score, ca2_score, ca_score, exam_score, total_score, grade, status, subject_id, students ( id, name, classes ( id, name ) ), subjects ( name )')
    .eq('school_id', currentSchoolId)
    .eq('session_id', activeSession.id)
    .order('id', { ascending: false });

  if (currentFilter !== 'all') query = query.eq('status', currentFilter);

  const { data: results } = await query;
  currentResults = results || [];
  renderResultsBody(currentResults);
}

function statusBadge(status) {
  if (status === 'published') return '<span style="color:#3A7D44; font-weight:600;">Published</span>';
  if (status === 'approved') return '<span style="color:#8A6D1D; font-weight:600;">Approved</span>';
  return '<span class="text-muted">Pending</span>';
}

function actionButtons(r) {
  const btns = [];
  if (r.status === 'pending' || r.status === 'approved') btns.push(`<button class="icon-btn" style="color: var(--navy);" onclick="startEditResult(${r.id})">Edit</button>`);
  if (r.status === 'pending') btns.push(`<button class="icon-btn" style="color: var(--navy);" onclick="setResultStatus(${r.id}, 'approved')">Approve</button>`);
  if (r.status === 'approved') btns.push(`<button class="icon-btn" style="color: var(--navy);" onclick="setResultStatus(${r.id}, 'published')">Publish</button>`);
  btns.push(`<button class="icon-btn" onclick="deleteResult(${r.id})">Remove</button>`);
  return btns.join(' &middot; ');
}

function queueEscapeHtml(value) { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch])); }

function classGroupHtml(className, resultsInClass, classKey = 'unassigned') {
  if (!resultsInClass.length) return '';
  const subjectMap = new Map();
  resultsInClass.forEach(r => {
    const subject = r.subjects?.name || 'Unassigned subject';
    if (!subjectMap.has(subject)) subjectMap.set(subject, []);
    subjectMap.get(subject).push(r);
  });
  const subjects = [...subjectMap.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  const navId = `queue-subject-${String(classKey).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const subjectHtml = subjects.map(([subject, records], index) => {
    const rows = records.sort((a,b) => (a.students?.name || '').localeCompare(b.students?.name || '')).map(r => `
      <tr><th scope="row" class="markbook-student">${queueEscapeHtml(r.students?.name || 'Unknown student')}</th>
      <td>${r.ca1_score ?? '—'}</td><td>${r.ca2_score ?? '—'}</td><td>${r.exam_score ?? '—'}</td>
      <td><span class="markbook-total">${r.total_score ?? '—'} (${queueEscapeHtml(r.grade || '—')})</span></td>
      <td><span class="markbook-status">${statusBadge(r.status)}</span></td>
      <td><div class="markbook-actions">${actionButtons(r)}</div></td></tr>`).join('');
    return `<section class="markbook-subject-panel" data-markbook-index="${index}" style="${index ? 'display:none;' : ''}"><h4 class="markbook-class-title">${queueEscapeHtml(subject)}</h4><div class="markbook-scroll" tabindex="0" aria-label="${queueEscapeHtml(className)} ${queueEscapeHtml(subject)} results"><table class="data-table markbook-table markbook-record-table"><thead><tr><th class="markbook-student markbook-head">Name</th><th>CA1</th><th>CA2</th><th>Exams</th><th>Total (Grade)</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join('');
  return `<div class="panel markbook-subject-stack" id="${navId}"><p class="eyebrow">${resultsInClass.length} result${resultsInClass.length === 1 ? '' : 's'}</p><div class="markbook-group-heading"><h3 class="panel-title">${queueEscapeHtml(className)}</h3><div class="markbook-subject-nav"><button class="btn-outline" onclick="moveQueueSubject('${navId}',-1)" aria-label="Previous subject">‹ Previous</button><span class="markbook-subject-count">1 / ${subjects.length}</span><button class="btn-outline" onclick="moveQueueSubject('${navId}',1)" aria-label="Next subject">Next ›</button></div></div><div class="markbook-subject-panels">${subjectHtml}</div></div>`;
}

function moveQueueSubject(groupId, direction) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const panels = [...group.querySelectorAll(':scope > .markbook-subject-panels > .markbook-subject-panel')];
  if (!panels.length) return;
  const current = Math.max(0, panels.findIndex(panel => panel.style.display !== 'none'));
  const next = (current + direction + panels.length) % panels.length;
  panels.forEach((panel, index) => { panel.style.display = index === next ? '' : 'none'; });
  const count = group.querySelector('.markbook-subject-count');
  if (count) count.textContent = `${next + 1} / ${panels.length}`;
}

function renderResultsBody(results) {
  const studentOptions = currentStudents.map((s) => `<option value="${s.id}">${s.name}${s.classes?.name ? ' (' + s.classes.name + ')' : ''}</option>`).join('');
  const subjectOptions = currentSubjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  // Group results by class, in class-name order; results with no class go in "Unassigned" at the end.
  const groupsHtml = currentClasses.map((c) => {
    const resultsInClass = results.filter((r) => r.students?.classes?.id === c.id);
    return classGroupHtml(c.name, resultsInClass, c.id);
  }).join('');

  const unassignedResults = results.filter((r) => !r.students?.classes?.id);
  const unassignedHtml = classGroupHtml('Unassigned', unassignedResults, 'unassigned');

  const noDataHtml = !results.length
    ? `<div class="panel"><div class="empty-state">No results here yet.</div></div>` : '';

  const filterTab = (key, label) => `
    <button class="btn-outline" style="${currentFilter === key ? 'background: var(--navy); color:#fff; border-color: var(--navy);' : ''}"
      onclick="setFilter('${key}')">${label}</button>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${activeSession.year_label} &middot; ${activeSession.term}</p>
    <h1 class="page-title">Results queue</h1>
    <p class="page-subtitle">Results are grouped by class, then by subject.</p>

    <div class="panel">
      <div class="panel-toolbar">
        <button class="btn-gold" onclick="openRecordResultForm()">+ Record result</button>
      </div>

      <div id="result-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="result-student">Student</label>
            <select id="result-student" onchange="filterSubjectsForStudent()">${studentOptions}</select>
          </div>
          <div class="field">
            <label for="result-subject">Subject</label>
            <select id="result-subject">${subjectOptions}</select>
          </div>
          <div class="field">
            <label for="result-ca1">CA1 score</label>
            <input type="number" id="result-ca1" min="0" placeholder="Enter score">
          </div>
          <div class="field">
            <label for="result-ca2">CA2 score</label>
            <input type="number" id="result-ca2" min="0" placeholder="Enter score">
          </div>
          <div class="field">
            <label for="result-exam">Exam score</label>
            <input type="number" id="result-exam" min="0" placeholder="Enter score">
          </div>
        </div>
        <button class="btn-gold" id="result-form-submit-btn" onclick="submitNewResult()">${editingResultId ? 'Save changes' : 'Save result'}</button>
        ${editingResultId ? `<button class="btn-outline" onclick="cancelEditResult()">Cancel</button>` : ''}
      </div>

      <div id="form-error" class="error-banner"></div>

      <div class="panel-toolbar">
        ${filterTab('all', 'All')}
        ${filterTab('pending', 'Pending')}
        ${filterTab('approved', 'Approved')}
        ${filterTab('published', 'Published')}
      </div>
    </div>

    ${noDataHtml}
    ${groupsHtml}
    ${unassignedHtml}
  `;
}

function filterSubjectsForStudent() {
  const studentId = document.getElementById('result-student').value;
  const subjectSelect = document.getElementById('result-subject');
  const previouslySelected = subjectSelect.value;

  const student = currentStudents.find((s) => String(s.id) === String(studentId));
  const section = student?.classes?.section || null;
  const config = assessmentConfigForSection(section);
  ca1Max = config.ca1; ca2Max = config.ca2; examMax = config.exam;
  const ca1Label = document.querySelector("label[for=\"result-ca1\"]");
  const ca2Label = document.querySelector("label[for=\"result-ca2\"]");
  const examLabel = document.querySelector("label[for=\"result-exam\"]");
  if (ca1Label) ca1Label.textContent = `CA1 score (out of ${ca1Max})`;
  if (ca2Label) ca2Label.textContent = `CA2 score (out of ${ca2Max})`;
  if (examLabel) examLabel.textContent = `Exam score (out of ${examMax})`;
  document.getElementById("result-ca1")?.setAttribute("max", ca1Max);
  document.getElementById("result-ca2")?.setAttribute("max", ca2Max);
  document.getElementById("result-exam")?.setAttribute("max", examMax);

  // Subjects with no section set are treated as applying to every section.
  const visibleSubjects = section
    ? currentSubjects.filter((s) => !s.section || s.section === section)
    : currentSubjects;

  subjectSelect.innerHTML = visibleSubjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  // Keep the previous selection if it's still valid for this student's section
  if (visibleSubjects.some((s) => String(s.id) === String(previouslySelected))) {
    subjectSelect.value = previouslySelected;
  }
}

function openRecordResultForm() {
  editingResultId = null;
  document.getElementById('result-student').value = '';
  document.getElementById('result-subject').value = '';
  document.getElementById('result-ca1').value = '';
  document.getElementById('result-ca2').value = '';
  document.getElementById('result-exam').value = '';
  filterSubjectsForStudent();
  document.getElementById('result-form').classList.add('open');
}

function startEditResult(id) {
  const r = currentResults.find((x) => x.id === id);
  if (!r) return;
  editingResultId = id;
  renderResultsBody(currentResults);

  setTimeout(() => {
    document.getElementById('result-student').value = r.students?.id ?? '';
    filterSubjectsForStudent();
    document.getElementById('result-subject').value = r.subject_id;
    document.getElementById('result-ca1').value = r.ca1_score ?? '';
    document.getElementById('result-ca2').value = r.ca2_score ?? '';
    document.getElementById('result-exam').value = r.exam_score ?? '';
    document.getElementById('result-form').classList.add('open');
    document.getElementById('result-form').scrollIntoView({ behavior: 'smooth' });
  }, 0);
}

function cancelEditResult() {
  editingResultId = null;
  renderResultsBody(currentResults);
}

function showFormError(message) {
  const el = document.getElementById('form-error');
  el.textContent = message;
  el.classList.add('visible');
}

function setFilter(key) {
  currentFilter = key;
  refreshResultsView();
}

async function submitNewResult() {
  const studentId = document.getElementById('result-student').value;
  const subjectId = document.getElementById('result-subject').value;
  const ca1 = document.getElementById('result-ca1').value;
  const ca2 = document.getElementById('result-ca2').value;
  const exam = document.getElementById('result-exam').value;

  if (!studentId || !subjectId) { showFormError('Please choose a student and a subject.'); return; }

  const ca1Score = ca1 === '' ? null : Number(ca1);
  const ca2Score = ca2 === '' ? null : Number(ca2);
  const examScore = exam === '' ? null : Number(exam);

  if (ca1Score !== null && (ca1Score < 0 || ca1Score > ca1Max)) { showFormError(`CA1 score must be between 0 and ${ca1Max}.`); return; }
  if (ca2Score !== null && (ca2Score < 0 || ca2Score > ca2Max)) { showFormError(`CA2 score must be between 0 and ${ca2Max}.`); return; }
  if (examScore !== null && (examScore < 0 || examScore > examMax)) { showFormError(`Exam score must be between 0 and ${examMax}.`); return; }

  // ca_score and total_score are computed automatically by a database
  // trigger from ca1/ca2/exam -- we only compute a total here to look up
  // the matching grade to send along, not to set the score columns.
  const caTotal = (ca1Score !== null || ca2Score !== null) ? (ca1Score ?? 0) + (ca2Score ?? 0) : null;
  const total = (caTotal !== null && examScore !== null) ? caTotal + examScore : null;
  const payload = { ca1_score: ca1Score, ca2_score: ca2Score, exam_score: examScore, grade: gradeFor(total) };

  let error;
  if (editingResultId) {
    ({ error } = await supabaseClient.from('results').update(payload).eq('id', editingResultId));
  } else {
    ({ error } = await supabaseClient.from('results').insert({
      school_id: currentSchoolId,
      student_id: studentId,
      subject_id: subjectId,
      session_id: activeSession.id,
      status: 'pending',
      submitted_by: (await supabaseClient.auth.getSession()).data.session?.user.id,
      ...payload,
    }));
  }

  if (error) {
    if (error.code === '23505') {
      showFormError('This student already has a result for this subject in this term. Edit the existing one instead of adding a new one.');
    } else {
      showFormError(error.message);
    }
    return;
  }

  if (!editingResultId) {
    const student = currentStudents.find((s) => String(s.id) === String(studentId));
    const subject = currentSubjects.find((s) => String(s.id) === String(subjectId));
    await supabaseClient.from('notifications').insert({
      school_id: currentSchoolId,
      title: 'Result submitted for review',
      body: `${subject?.name || 'A subject'} result for ${student?.name || 'a student'} is awaiting approval.`,
    });
  }

  const wasEditing = !!editingResultId;
  editingResultId = null;
  document.getElementById('result-form').classList.remove('open');
  await refreshResultsView();
  showSuccessToast(wasEditing ? 'Result updated' : 'Result submitted for approval');
}

async function setResultStatus(id, status) {
  const { error } = await supabaseClient.from('results').update({ status }).eq('id', id);
  if (error) { showFormError(error.message); return; }

  const { data: { session } } = await supabaseClient.auth.getSession();
  const { data: profile } = await supabaseClient.from('profiles').select('name').eq('id', session.user.id).single();
  await supabaseClient.from('activity_log').insert({
    school_id: currentSchoolId,
    actor_id: session.user.id,
    actor_name: profile?.name || 'Unknown',
    action: status === 'approved' ? 'Approved a result' : 'Published a result',
    details: `Result #${id} marked as ${status}`,
  });

  if (status === 'published') {
    await supabaseClient.from('notifications').insert({
      school_id: currentSchoolId,
      title: 'Result published',
      body: 'A result was published and is now visible to guardians.',
    });
  }

  await refreshResultsView();
  showSuccessToast(status === 'approved' ? 'Result approved' : 'Result published');
}

async function deleteResult(id) {
  if (!confirm('Are you sure you want to remove this result? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('results').delete().eq('id', id);
  if (error) { showFormError(error.message); return; }
  await refreshResultsView();
  showSuccessToast('Result removed');
}

loadResultsQueuePage();
