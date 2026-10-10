let currentSchoolId = null;
let currentUserId = null;
let ca1Max = 15;
let ca2Max = 15;
let examMax = 70;
let primaryCa1Max = 20;
let primaryCa2Max = 20;
let primaryExamMax = 60;
let formMasterClassId = null;
let formMasterClassName = '';
let activeSession = null;
let markBookStudents = [];
let markBookSubjects = [];
let resultsByStudentSubject = {}; // `${studentId}-${subjectId}` -> result row
let currentPageIndex = 0;

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

async function loadMarkBook() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  currentUserId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles').select('name, role, school_id, schools ( name, ca1_max, ca2_max, primary_ca1_max, primary_ca2_max, primary_exam_max )').eq('id', session.user.id).single();

  if (!profile || profile.role !== 'teacher') {
    window.location.href = profile?.role === 'admin' ? 'overview.html' : 'login.html';
    return;
  }
  currentSchoolId = profile.school_id;
  ca1Max = profile.schools?.ca1_max ?? 15;
  ca2Max = profile.schools?.ca2_max ?? 15;
  primaryCa1Max = profile.schools?.primary_ca1_max ?? 20;
  primaryCa2Max = profile.schools?.primary_ca2_max ?? 20;
  primaryExamMax = profile.schools?.primary_exam_max ?? 60;
  document.getElementById('teacher-name').textContent = profile.name;
  document.getElementById('school-name').textContent = profile.schools?.name || '';

  const { data: teacher } = await supabaseClient
    .from('teachers')
    .select('form_master_class_id, classes!teachers_form_master_class_id_fkey ( id, name, section )')
    .eq('profile_id', session.user.id)
    .single();

  if (!teacher || !teacher.form_master_class_id) {
    document.getElementById('page-body').innerHTML = `
      <div class="panel"><div class="empty-state">The Class Mark Book is only available to Form Masters. You are not currently set as a Form Master for any class.</div></div>
    `;
    return;
  }
  formMasterClassId = teacher.form_master_class_id;
  formMasterClassName = teacher.classes?.name || 'Your class';
  const section = teacher.classes?.section || null;
  if (String(section || '').trim().toLowerCase().includes('primary')) {
    ca1Max = primaryCa1Max;
    ca2Max = primaryCa2Max;
    examMax = primaryExamMax;
  } else {
    examMax = 70;
  }

  const { data: sessionsData } = await supabaseClient
    .from('academic_sessions').select('id, year_label, term').eq('school_id', currentSchoolId).eq('is_active', true).maybeSingle();
  activeSession = sessionsData || null;

  if (!activeSession) {
    document.getElementById('page-body').innerHTML = `<div class="panel"><div class="empty-state">No active academic session is set.</div></div>`;
    return;
  }

  const [{ data: students }, { data: subjects }] = await Promise.all([
    supabaseClient.from('students').select('id, name').eq('class_id', formMasterClassId).order('name'),
    supabaseClient.from('subjects').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
  ]);

  markBookStudents = students || [];
  // Subjects with no section set apply to every section, same convention used elsewhere in the app
  markBookSubjects = (subjects || []).filter((s) => !s.section || s.section === section);

  if (markBookStudents.length && markBookSubjects.length) {
    const { data: results } = await supabaseClient
      .from('results')
      .select('student_id, subject_id, ca1_score, ca2_score, ca_score, exam_score, total_score, grade, status')
      .eq('session_id', activeSession.id)
      .in('student_id', markBookStudents.map((s) => s.id));

    resultsByStudentSubject = {};
    (results || []).forEach((r) => { resultsByStudentSubject[`${r.student_id}-${r.subject_id}`] = r; });
  }

  currentPageIndex = 0;
  renderMarkBookShell();
}

function renderMarkBookShell() {
  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${activeSession.year_label} &middot; ${activeSession.term}</p>
    <h1 class="page-title">Class Mark Book &mdash; ${formMasterClassName}</h1>

    ${markBookSubjects.length ? `
      <div class="markbook-nav">
        <button class="markbook-nav-btn" id="markbook-prev" onclick="goToMarkBookPage(currentPageIndex - 1, 'right')">&larr; Previous</button>
        <div class="markbook-title">
          <p class="eyebrow">Subject ${currentPageIndex + 1} of ${markBookSubjects.length}</p>
          <h2 id="markbook-subject-name"></h2>
        </div>
        <button class="markbook-nav-btn" id="markbook-next" onclick="goToMarkBookPage(currentPageIndex + 1, 'left')">Next &rarr;</button>
      </div>

      <div class="markbook-viewport">
        <div class="markbook-page" id="markbook-page"></div>
      </div>
    ` : `<div class="panel"><div class="empty-state">No subjects are set up for this class's section yet.</div></div>`}
  `;

  if (markBookSubjects.length) {
    renderMarkBookPage();
    attachSwipeHandlers();
  }
}

function renderMarkBookPage() {
  const subject = markBookSubjects[currentPageIndex];
  document.getElementById('markbook-subject-name').textContent = subject.name;
  document.getElementById('markbook-prev').disabled = currentPageIndex === 0;
  document.getElementById('markbook-next').disabled = currentPageIndex === markBookSubjects.length - 1;
  document.querySelector('.markbook-title .eyebrow').textContent = `Subject ${currentPageIndex + 1} of ${markBookSubjects.length}`;

  const rows = markBookStudents.map((s) => {
    const r = resultsByStudentSubject[`${s.id}-${subject.id}`];
    const cell = (val) => val === null || val === undefined
      ? '<span class="markbook-missing">&mdash;</span>'
      : val;
    const statusLabel = r
      ? (r.status === 'published' ? '<span class="markbook-complete">Published</span>'
         : r.status === 'approved' ? 'Approved'
         : 'Pending')
      : '<span class="markbook-missing">Not started</span>';

    return `
      <tr>
        <td>${s.name}</td>
        <td>${cell(r?.ca1_score)}</td>
        <td>${cell(r?.ca2_score)}</td>
        <td>${cell(r?.ca_score)}</td>
        <td>${cell(r?.exam_score)}</td>
        <td>${cell(r?.total_score)}</td>
        <td>${r?.grade || '<span class="markbook-missing">&mdash;</span>'}</td>
        <td style="font-size:12px;">${statusLabel}</td>
      </tr>
    `;
  }).join('');

  document.getElementById('markbook-page').innerHTML = `
    <div class="markbook-table-wrap">
      <table class="markbook-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>CA1<br><span style="font-weight:400; opacity:0.8;">/${ca1Max}</span></th>
            <th>CA2<br><span style="font-weight:400; opacity:0.8;">/${ca2Max}</span></th>
            <th>CA Total<br><span style="font-weight:400; opacity:0.8;">/${ca1Max + ca2Max}</span></th>
            <th>Exam<br><span style="font-weight:400; opacity:0.8;">/${examMax}</span></th>
            <th>Final</th>
            <th>Grade</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="8"><div class="empty-state">No students in this class yet.</div></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function goToMarkBookPage(newIndex, direction) {
  if (newIndex < 0 || newIndex >= markBookSubjects.length) return;
  const pageEl = document.getElementById('markbook-page');
  pageEl.classList.add(direction === 'left' ? 'sliding-out-left' : 'sliding-out-right');
  setTimeout(() => {
    currentPageIndex = newIndex;
    renderMarkBookPage();
    pageEl.classList.remove('sliding-out-left', 'sliding-out-right');
  }, 180);
}

function attachSwipeHandlers() {
  const viewport = document.querySelector('.markbook-viewport');
  if (!viewport) return;
  let startX = null;

  viewport.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const deltaX = e.changedTouches[0].clientX - startX;
    if (Math.abs(deltaX) > 50) {
      if (deltaX < 0) goToMarkBookPage(currentPageIndex + 1, 'left');
      else goToMarkBookPage(currentPageIndex - 1, 'right');
    }
    startX = null;
  }, { passive: true });
}

loadMarkBook();
