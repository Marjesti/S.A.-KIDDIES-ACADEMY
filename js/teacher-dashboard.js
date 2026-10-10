let teacherRecord = null;
let mySubjects = [];
let myClasses = [];
let activeSession = null;
let myStudents = [];
let myOwnResults = [];
let formMasterPendingResults = [];
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

function assessmentConfigForSection(section) {
  return isPrimarySection(section)
    ? { ca1: primaryCa1Max, ca2: primaryCa2Max, exam: primaryExamMax }
    : { ca1: ca1Max, ca2: ca2Max, exam: 70 };
}
let currentUserId = null;
let currentSchoolId = null;
let formMasterStudentEditEnabled = false;
let teacherTimetableEntries = [];
let teacherTimetablePeriods = [];

const SECTIONS = ['Playgroup/Pre-Nursery', 'Nursery', 'Primary', 'Junior Secondary', 'Senior Secondary'];

// Local HTML escaping for the teacher dashboard. Do not depend on
// timetable.js because the teacher dashboard does not load that file.
function teacherEsc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
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

function teacherMenuItem(key, label, icon, target, href = null) {
  return href
    ? `<li><a href="${href}" data-menu-key="${key}"><span class="teacher-nav-icon">${icon}</span><span>${label}</span></a></li>`
    : `<li><a href="#${target}" data-menu-key="${key}" data-scroll-target="${target}"><span class="teacher-nav-icon">${icon}</span><span>${label}</span></a></li>`;
}

function setupTeacherMenu() {
  const nav = document.getElementById('teacher-nav');
  if (!nav) return;

  const items = [
    teacherMenuItem('dashboard', 'Dashboard', '⌂', 'teacher-assignments'),
    teacherMenuItem('timetable', 'My Timetable', '▦', 'teacher-timetable'),
    teacherMenuItem('results', 'Submit Results', '✎', 'teacher-submit-results'),
    teacherMenuItem('submissions', 'My Submissions', '✓', 'teacher-my-submissions'),
  ];

  if (teacherRecord?.form_master_class_id) {
    items.push(teacherMenuItem('mark-book', 'Class Mark Book', '▤', null, 'mark-book.html'));
    items.push(teacherMenuItem('approval', 'Approve Results', '✓', 'teacher-approval'));
    items.push(teacherMenuItem('notes', 'Report Card Notes', '▧', 'teacher-notes'));
    if (formMasterStudentEditEnabled) {
      items.push(teacherMenuItem('students', 'Manage Students', '♙', 'teacher-students'));
    }
  }

  nav.innerHTML = items.join('');

  const shell = document.getElementById('teacher-app-shell');
  const overlay = document.getElementById('teacher-sidebar-overlay');
  const toggle = document.getElementById('teacher-menu-toggle');
  const closeMenu = () => {
    shell?.classList.remove('menu-open');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  toggle?.addEventListener('click', () => {
    const open = shell?.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  overlay?.addEventListener('click', closeMenu);

  nav.querySelectorAll('a[data-scroll-target]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.dataset.scrollTarget;
      event.preventDefault();

      // The hamburger is the sole navigation. Show ONLY the selected workspace.
      document.querySelectorAll('.teacher-dashboard-section, #student-management-panel').forEach(section => {
        section.style.display = 'none';
      });

      if (link.dataset.menuKey === 'students') {
        renderTeacherStudentManager();
        const manager = document.getElementById('student-management-panel');
        if (manager) manager.style.display = '';
      } else {
        const target = document.getElementById(targetId);
        if (!target) return;
        target.style.display = '';
      }

      nav.querySelectorAll('a').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
      closeMenu();
    });
  });

  nav.querySelectorAll('a[href="mark-book.html"]').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  nav.querySelector('a[data-menu-key="dashboard"]')?.classList.add('active');

  document.getElementById('teacher-signout-btn')?.addEventListener('click', signOutTeacher);
}

async function loadTeacherDashboard() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  currentUserId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles').select('name, role, school_id, schools ( name, logo_url, ca1_max, ca2_max, primary_ca1_max, primary_ca2_max, primary_exam_max, form_master_student_edit_enabled )').eq('id', session.user.id).single();

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
  examMax = 70;
  formMasterStudentEditEnabled = !!profile.schools?.form_master_student_edit_enabled;

  document.getElementById('teacher-name').textContent = profile.name;
  document.getElementById('school-name').textContent = profile.schools?.name || '';
  document.getElementById('teacher-sidebar-school').textContent = profile.schools?.name || 'S.A. Kiddies Academy';
  const logo = profile.schools?.logo_url;
  if (logo) document.getElementById('teacher-sidebar-logo').innerHTML = `<img src="${teacherEsc(logo)}" alt="School logo">`;

  const { data: teacher } = await supabaseClient
    .from('teachers')
    .select('id, name, form_master_class_id, classes!teachers_form_master_class_id_fkey ( id, name, section ), teacher_subjects ( subjects ( id, name, section ) ), teacher_classes ( classes ( id, name, section ) )')
    .eq('profile_id', session.user.id)
    .maybeSingle();

  if (!teacher) {
    document.getElementById('page-body').innerHTML = `
      <div class="panel"><div class="empty-state">Your login isn't linked to a teacher record yet. Ask your admin to check the Teachers page.</div></div>
    `;
    return;
  }

  teacherRecord = teacher;
  setupTeacherMenu();
  // "Handled" classes -- used ONLY for subject-teaching + the result-submission filter.
  mySubjects = (teacher.teacher_subjects || []).map((r) => r.subjects).filter(Boolean);
  myClasses = (teacher.teacher_classes || []).map((r) => r.classes).filter(Boolean);

  const { data: session_ } = await supabaseClient
    .from('academic_sessions').select('id, year_label, term')
    .eq('school_id', profile.school_id).eq('is_active', true).maybeSingle();
  activeSession = session_;
  await loadTeacherTimetable(activeSession?.id || null);

  const { data: students } = await supabaseClient
    .from('students').select('id, name, admission_no, guardian_email, guardian_phone, photo_url, photo_path, classes ( id, name, section )')
    .eq('school_id', profile.school_id).order('name');
  myStudents = students || [];

  await refreshMyResults();
}

async function loadTeacherTimetable(sessionId) {
  teacherTimetableEntries = [];
  teacherTimetablePeriods = [];
  if (!sessionId || !teacherRecord?.id) return;

  const [entriesResult, periodsResult] = await Promise.all([
    supabaseClient
      .from('timetable_entries')
      .select('id, day_of_week, period_no, room, notes, classes(name), subjects(name)')
      .eq('school_id', currentSchoolId)
      .eq('session_id', sessionId)
      .eq('teacher_id', teacherRecord.id),
    supabaseClient
      .from('timetable_periods')
      .select('day_of_week, period_no, label, start_time, end_time, is_break')
      .eq('school_id', currentSchoolId)
      .order('day_of_week')
      .order('period_no')
  ]);

  teacherTimetableEntries = entriesResult.data || [];
  teacherTimetablePeriods = periodsResult.data || [];
}

function renderTeacherTimetable() {
  if (!activeSession) {
    return `<div class="panel" style="border-left:4px solid var(--gold);">
      <p class="eyebrow">My timetable</p>
      <h3 class="panel-title">No active academic session</h3>
      <p class="text-muted" style="font-size:13.5px;">Your timetable will appear here when an academic session is active.</p>
    </div>`;
  }

  const bySlot = new Map(teacherTimetableEntries.map(e => [`${e.day_of_week}|${e.period_no}`, e]));
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const f = value => String(value || '').slice(0,5);

  const dayBlocks = days.map(day => {
    const periods = teacherTimetablePeriods.filter(p => p.day_of_week === day && !p.is_break).sort((a,b) => a.period_no - b.period_no);
    if (!periods.length) return '';

    const rows = periods.map(period => {
      const entry = bySlot.get(`${day}|${period.period_no}`);
      return `<div class="my-tt-row">
        <div class="my-tt-time"><strong>${teacherEsc(period.label || `P${period.period_no}`)}</strong><span>${f(period.start_time)}–${f(period.end_time)}</span></div>
        <div class="my-tt-lesson">${entry
          ? `<strong>${teacherEsc(entry.subjects?.name || 'Subject')}</strong><span>${teacherEsc(entry.classes?.name || 'Class')}${entry.room ? ` · Room ${teacherEsc(entry.room)}` : ''}</span>`
          : `<span class="my-tt-free">Free period</span>`}</div>
      </div>`;
    }).join('');

    return `<div class="my-tt-day"><div class="my-tt-day-title">${day}</div>${rows}</div>`;
  }).join('');

  return `<div class="panel my-timetable-panel teacher-dashboard-section" id="teacher-timetable">
    <div class="panel-header">
      <div>
        <p class="eyebrow">My timetable · read-only</p>
        <h3 class="panel-title">${teacherEsc(activeSession.year_label)} · ${teacherEsc(activeSession.term)}</h3>
      </div>
      <span class="my-tt-badge">${teacherTimetableEntries.length} lesson${teacherTimetableEntries.length === 1 ? '' : 's'}</span>
    </div>
    <p class="text-muted" style="font-size:13.5px; margin-bottom:14px;">This timetable is linked to your teacher account. You can view it, but you cannot edit timetable entries.</p>
    ${teacherTimetableEntries.length ? `<div class="my-tt-grid">${dayBlocks}</div>` : `<div class="empty-state">No timetable entries have been scheduled for you for this session yet.</div>`}
  </div>`;
}

async function refreshMyResults() {
  if (!activeSession) { renderDashboard(); return; }

  const { data: mine } = await supabaseClient
    .from('results')
    .select('id, student_id, subject_id, ca1_score, ca2_score, ca_score, exam_score, total_score, grade, status, students ( name, classes ( id, name, section ) ), subjects ( name )')
    .eq('session_id', activeSession.id)
    .eq('submitted_by', currentUserId)
    .order('id', { ascending: false });
  myOwnResults = mine || [];

  // Only relevant if this teacher is a form master: pending results across
  // the WHOLE class, for them to approve before admin publishes.
  formMasterPendingResults = [];
  if (teacherRecord.form_master_class_id) {
    const { data: pending } = await supabaseClient
      .from('results')
      .select('id, ca1_score, ca2_score, ca_score, exam_score, total_score, grade, status, students ( name ), subjects ( name )')
      .eq('session_id', activeSession.id)
      .eq('status', 'pending');
    // RLS already scopes this to the form master's class for us.
    formMasterPendingResults = pending || [];
  }

  renderDashboard();
}

function renderSubjectOptionsForSection(section) {
  const matching = section
    ? mySubjects.filter((s) => (s.section || 'Unassigned section') === section)
    : mySubjects;

  if (!matching.length) return '<option value="">No subjects assigned for this section</option>';

  return [...SECTIONS, 'Unassigned section'].map((sectionName) => {
    const subjectsHere = matching
      .filter((s) => (s.section || 'Unassigned section') === sectionName)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!subjectsHere.length) return '';
    return `<optgroup label="${sectionName}">${subjectsHere.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</optgroup>`;
  }).join('');
}

function renderTeacherStudentManager() {
  if (!teacherRecord?.form_master_class_id || !formMasterStudentEditEnabled) return;

  const className = teacherRecord.classes?.name || 'Your Form Master class';
  const rows = myStudents
    .filter((s) => String(s.classes?.id) === String(teacherRecord.form_master_class_id))
    .map((s) => `
      <tr>
        <td>
          <span class="row-name">
            <span class="student-avatar">${studentPhotoDisplayUrl(s) ? `<img src="${studentPhotoDisplayUrl(s)}" alt="${s.name}">` : initials(s.name)}</span>
            ${s.name}
          </span>
        </td>
        <td class="text-muted">${s.admission_no || '&mdash;'}</td>
        <td class="text-muted">${s.guardian_phone || '&mdash;'}</td>
        <td><button class="icon-btn" style="color:var(--navy);" onclick="openTeacherStudentForm(${s.id})">Edit</button></td>
      </tr>`).join('');

  document.getElementById('student-management-panel')?.remove();
  document.getElementById('teacher-student-form-panel')?.remove();

  const html = `
    <div class="panel" id="student-management-panel" style="border-left:4px solid var(--gold);">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Student records</p>
          <h3 class="panel-title">Manage Students — ${className}</h3>
        </div>
        <button class="btn-outline" onclick="closeTeacherStudentManager()">Close</button>
      </div>
      <p class="text-muted" style="font-size:13.5px;">You can add new students and edit existing students in this Form Master class. Student removal is not permitted.</p>
      <button class="btn-gold" onclick="openTeacherStudentForm()">+ Add student</button>
      <div id="teacher-student-form-panel" class="form-panel" style="margin-top:14px;">
        <div class="form-grid">
          <div class="field">
            <label for="tm-student-name">Full name</label>
            <input id="tm-student-name" type="text" placeholder="Student full name">
          </div>
          <div class="field">
            <label>Admission no.</label>
            <div class="text-muted" style="padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-soft);">Automatically generated for this class.</div>
          </div>
          <div class="field">
            <label>Class</label>
            <input type="text" value="${className}" disabled>
          </div>
          <div class="field">
            <label for="tm-student-email">Guardian email</label>
            <input id="tm-student-email" type="email" placeholder="Optional">
          </div>
          <div class="field">
            <label for="tm-student-phone">Guardian phone</label>
            <input id="tm-student-phone" type="text" placeholder="Optional">
          </div>
          <div class="field">
            <label for="tm-student-photo">Photo</label>
            <input id="tm-student-photo" type="file" accept="image/jpeg,image/png,image/webp">
            <div id="tm-student-photo-preview" style="margin-top:6px;"></div>
          </div>
        </div>
        <div id="tm-student-error" class="error-banner"></div>
        <div id="tm-student-status" style="font-size:13px; margin-bottom:8px;"></div>
        <button id="tm-student-save" class="btn-gold" onclick="saveTeacherStudent()">Save student</button>
        <button class="btn-outline" onclick="closeTeacherStudentForm()">Cancel</button>
      </div>
      <div class="data-table-wrap" style="margin-top:16px;">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Admission no.</th><th>Guardian phone</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4"><div class="empty-state">No students in this class yet.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  const host = document.getElementById('page-body');
  host.insertAdjacentHTML('afterbegin', html);
  document.getElementById('teacher-student-form-panel').classList.remove('open');
  document.getElementById('student-management-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let editingTeacherStudentId = null;

function closeTeacherStudentManager() {
  document.getElementById('student-management-panel')?.remove();
  document.getElementById('teacher-student-form-panel')?.remove();
}

function closeTeacherStudentForm() {
  const panel = document.getElementById('teacher-student-form-panel');
  if (panel) panel.classList.remove('open');
  editingTeacherStudentId = null;
}

function openTeacherStudentForm(studentId = null) {
  if (!formMasterStudentEditEnabled || !teacherRecord?.form_master_class_id) return;
  editingTeacherStudentId = studentId;
  const panel = document.getElementById('teacher-student-form-panel');
  if (!panel) return;
  const student = studentId ? myStudents.find((s) => s.id === studentId) : null;
  if (student && String(student.classes?.id) !== String(teacherRecord.form_master_class_id)) return;

  document.getElementById('tm-student-name').value = student?.name || '';
  document.getElementById('tm-student-email').value = student?.guardian_email || '';
  document.getElementById('tm-student-phone').value = student?.guardian_phone || '';
  document.getElementById('tm-student-photo').value = '';
  document.getElementById('tm-student-error').textContent = '';
  document.getElementById('tm-student-error').classList.remove('visible');
  document.getElementById('tm-student-status').textContent = '';
  document.getElementById('tm-student-save').textContent = student ? 'Update student' : 'Save student';

  const preview = document.getElementById('tm-student-photo-preview');
  const photoUrl = student ? studentPhotoDisplayUrl(student) : null;
  preview.innerHTML = photoUrl ? `<img src="${photoUrl}" alt="${student.name}" style="width:64px;height:64px;border-radius:10px;object-fit:cover;">` : '';
  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showTeacherStudentError(message) {
  const el = document.getElementById('tm-student-error');
  if (!el) { alert(message); return; }
  el.textContent = message;
  el.classList.add('visible');
}

async function saveTeacherStudent() {
  if (!formMasterStudentEditEnabled || !teacherRecord?.form_master_class_id) {
    showTeacherStudentError('Student adding and editing is currently disabled by the administrator.');
    return;
  }

  const name = document.getElementById('tm-student-name').value.trim();
  const guardianEmail = document.getElementById('tm-student-email').value.trim();
  const guardianPhone = document.getElementById('tm-student-phone').value.trim();
  const photoFile = document.getElementById('tm-student-photo').files[0] || null;
  const student = editingTeacherStudentId ? myStudents.find((s) => s.id === editingTeacherStudentId) : null;

  if (!name) { showTeacherStudentError('Student name is required.'); return; }
  if (student && String(student.classes?.id) !== String(teacherRecord.form_master_class_id)) {
    showTeacherStudentError('You can only edit students in your Form Master class.'); return;
  }

  const payload = {
    name,
    guardian_email: guardianEmail || null,
    guardian_phone: guardianPhone || null,
  };

  const status = document.getElementById('tm-student-status');

  if (photoFile) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type)) {
      showTeacherStudentError('Photo must be a JPEG, PNG, or WEBP image.'); return;
    }
    status.textContent = 'Processing photo...';
    let blob;
    try { blob = await compressImageFile(photoFile); }
    catch (e) { showTeacherStudentError(e.message || 'Could not process that photo.'); status.textContent = ''; return; }

    const pathStem = (`student-${editingTeacherStudentId || Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const newPath = `${currentSchoolId}/${new Date().getFullYear()}/${pathStem}.jpg`;
    status.textContent = 'Uploading photo...';
    const { error: uploadError } = await supabaseClient.storage.from('student-photos').upload(newPath, blob, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) { status.textContent = ''; showTeacherStudentError('Photo upload failed: ' + uploadError.message); return; }
    if (student?.photo_path && student.photo_path !== newPath) await supabaseClient.storage.from('student-photos').remove([student.photo_path]);
    payload.photo_path = newPath;
    status.textContent = '';
  }

  // Form Master student writes go through protected RPC functions.
  // This avoids depending on the school's existing students INSERT/UPDATE
  // RLS policies while the database function still enforces the same
  // admin-controlled permission and Form Master class restriction.
  let result;
  if (editingTeacherStudentId) {
    result = await supabaseClient.rpc('form_master_update_student', {
      p_student_id: editingTeacherStudentId,
      p_name: payload.name,
      p_admission_no: null,
      p_guardian_email: payload.guardian_email,
      p_guardian_phone: payload.guardian_phone,
      p_photo_path: payload.photo_path ?? null,
    });
  } else {
    result = await supabaseClient.rpc('form_master_add_student', {
      p_name: payload.name,
      p_admission_no: null,
      p_guardian_email: payload.guardian_email,
      p_guardian_phone: payload.guardian_phone,
      p_photo_path: payload.photo_path ?? null,
    });
  }

  if (result.error) { showTeacherStudentError(result.error.message); return; }

  showSuccessToast(editingTeacherStudentId ? 'Student updated' : 'Student added');
  closeTeacherStudentForm();
  await reloadTeacherStudents();
  renderTeacherStudentManager();
}

async function reloadTeacherStudents() {
  const { data } = await supabaseClient
    .from('students')
    .select('id, name, admission_no, guardian_email, guardian_phone, photo_url, photo_path, classes ( id, name, section )')
    .eq('school_id', currentSchoolId)
    .eq('class_id', teacherRecord.form_master_class_id)
    .order('name');
  myStudents = data || [];
}

function renderDashboard() {
  const subjectTags = mySubjects.length
    ? [...SECTIONS, 'Unassigned section'].map((section) => {
        const subjectsHere = mySubjects.filter((s) => (s.section || 'Unassigned section') === section);
        if (!subjectsHere.length) return '';
        return `<div style="margin:5px 0 8px;"><div style="font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--navy);">${section}</div>${subjectsHere.map((s) => `<span style="display:inline-block; background:var(--gold-soft); color:var(--navy); padding:4px 10px; border-radius:999px; font-size:12.5px; margin:2px;">${s.name}</span>`).join('')}</div>`;
      }).join('')
    : '<span class="text-muted">None assigned yet</span>';

  const classTags = myClasses.length
    ? myClasses.map((c) => `<span style="display:inline-block; background:var(--gold-soft); color:var(--navy); padding:4px 10px; border-radius:999px; font-size:12.5px; margin:2px;">${c.name}</span>`).join('')
    : '<span class="text-muted">None assigned yet</span>';

  const formMasterLine = teacherRecord.form_master_class_id
    ? `<div class="panel teacher-dashboard-section" id="teacher-form-master" style="border-left:4px solid var(--gold);">
        <p class="eyebrow">Form master</p>
        <h3 class="panel-title">${teacherRecord.classes?.name || 'Your class'}</h3>
        <p class="text-muted" style="font-size:13.5px;">You have full access to every student and subject in this class, and can approve their pending results before the admin publishes them.</p>
      </div>`
    : '';

  const classFilterOptions = myClasses.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const subjectOptions = renderSubjectOptionsForSection('');

  document.getElementById('page-body').innerHTML = `
    <div class="panel teacher-dashboard-section" id="teacher-assignments">
      <p class="eyebrow">Your assignments</p>
      <h3 class="panel-title">Subjects &amp; classes</h3>
      <p><strong>Subjects:</strong> ${subjectTags}</p>
      <p style="margin-top:10px;"><strong>Classes handled:</strong> ${classTags}</p>
    </div>

    ${renderTeacherTimetable()}

    ${formMasterLine}
    ${teacherRecord.form_master_class_id ? `
      <div class="panel teacher-dashboard-section" id="teacher-mark-book">
        <p class="eyebrow">Class record</p>
        <h3 class="panel-title">Class Mark Book</h3>
        <p class="text-muted" style="font-size:13.5px;">Browse your whole class's scores, subject by subject.</p>
        <a href="mark-book.html" class="btn-gold" style="display:inline-block; text-decoration:none;">Open Mark Book</a>
      </div>
    ` : ''}
    ${teacherRecord.form_master_class_id && formMasterStudentEditEnabled ? `
      <div class="panel teacher-dashboard-section" id="teacher-students">
        <p class="eyebrow">Student records</p>
        <h3 class="panel-title">Manage students</h3>
        <p class="text-muted" style="font-size:13.5px;">Add or edit students in your Form Master class. Student removal is not permitted.</p>
        <button class="btn-gold" onclick="renderTeacherStudentManager()">Manage Students</button>
      </div>
    ` : ''}
    ${teacherRecord.form_master_class_id ? renderFormMasterApprovalPanel() : ''}
    ${teacherRecord.form_master_class_id ? renderFormMasterNotesPanel() : ''}

    ${activeSession ? `
    <div class="panel teacher-dashboard-section" id="teacher-submit-results">
      <p class="eyebrow">${activeSession.year_label} &middot; ${activeSession.term}</p>
      <h3 class="panel-title">${editingResultId ? 'Update result' : 'Submit a result'}</h3>
      ${mySubjects.length && myClasses.length ? `
        <div class="form-grid">
          <div class="field">
            <label for="result-class">Class</label>
            <select id="result-class" onchange="onResultClassChange()">
              <option value="">Select a class first</option>
              ${classFilterOptions}
            </select>
          </div>
          <div class="field">
            <label for="result-student">Student</label>
            <select id="result-student"><option value="">Select a class first</option></select>
          </div>
          <div class="field">
            <label for="result-subject">Subject</label>
            <select id="result-subject">${subjectOptions}</select>
          </div>
          <div class="field">
            <label for="result-ca1">CA1 score</label>
            <input type="number" id="result-ca1" min="0">
          </div>
          <div class="field">
            <label for="result-ca2">CA2 score</label>
            <input type="number" id="result-ca2" min="0">
          </div>
          <div class="field">
            <label for="result-exam">Exam score</label>
            <input type="number" id="result-exam" min="0">
          </div>
        </div>
        <button class="btn-gold" onclick="submitResult()">${editingResultId ? 'Save changes' : 'Submit for approval'}</button>
        ${editingResultId ? `<button class="btn-outline" onclick="cancelEditResult()">Cancel</button>` : ''}
        <div id="form-error" class="error-banner"></div>
        <div id="form-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
      ` : `<p class="text-muted" style="font-size:14px;">You need at least one subject and one class assigned before you can submit results.</p>`}
    </div>

    <div class="panel teacher-dashboard-section" id="teacher-my-submissions">
      <p class="eyebrow">Your submissions</p>
      <h3 class="panel-title">Results you've entered</h3>
      ${renderMyResultsTable()}
    </div>
    ` : `<div class="panel"><div class="empty-state">No active academic session right now.</div></div>`}
  `;

  // Open the result-entry workspace when editing, rather than hiding the form
  // behind the dashboard's single-workspace navigation.
  const workspaceToShow = editingResultId ? 'teacher-submit-results' : 'teacher-assignments';
  document.querySelectorAll('.teacher-dashboard-section').forEach(section => {
    section.style.display = section.id === workspaceToShow ? '' : 'none';
  });
  document.getElementById('student-management-panel')?.remove();
}

function renderMyResultsTable() {
  if (!myOwnResults.length) return `<div class="empty-state">You haven't submitted any results yet.</div>`;

  const rows = myOwnResults.map((r) => {
    const isOwnFormMasterClass = teacherRecord.form_master_class_id
      && r.students?.classes?.id === teacherRecord.form_master_class_id;

    const actions = (r.status === 'pending' || r.status === 'approved')
      ? `<button class="icon-btn" style="color: var(--navy); margin-right:10px;" onclick="startEditResult(${r.id})">Edit</button>${
          (r.status === 'pending' && isOwnFormMasterClass) ? `<button class="icon-btn" style="color: var(--navy);" onclick="approveAsFormMaster(${r.id})">Approve</button>` : ''
        }`
      : '';

    return `
    <tr>
      <td>${r.students?.name || ''}</td>
      <td class="text-muted">${r.students?.classes?.name || ''}</td>
      <td>${r.subjects?.name || ''}</td>
      <td class="text-muted">CA1: ${r.ca1_score ?? '--'} &middot; CA2: ${r.ca2_score ?? '--'} &middot; Exam: ${r.exam_score ?? '--'}</td>
      <td>${r.total_score ?? '--'} (${r.grade || '--'})</td>
      <td>${r.status === 'pending' ? '<span class="text-muted">Pending</span>' : r.status === 'approved' ? '<span style="color:#8A6D1D; font-weight:600;">Approved</span>' : '<span style="color:#3A7D44; font-weight:600;">Published</span>'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  return `
    <div class="data-table-wrap"><table class="data-table">
      <thead><tr><th>Student</th><th>Class</th><th>Subject</th><th>CA/Exam</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderFormMasterApprovalPanel() {
  if (!formMasterPendingResults.length) {
    return `<div class="panel teacher-dashboard-section" id="teacher-approval"><p class="eyebrow">Awaiting your approval</p><h3 class="panel-title">Pending results in your class</h3><div class="empty-state">Nothing pending right now.</div></div>`;
  }
  const rows = formMasterPendingResults.map((r) => `
    <tr>
      <td>${r.students?.name || ''}</td>
      <td>${r.subjects?.name || ''}</td>
      <td class="text-muted">CA1: ${r.ca1_score ?? '--'} &middot; CA2: ${r.ca2_score ?? '--'} &middot; Exam: ${r.exam_score ?? '--'}</td>
      <td>${r.total_score ?? '--'} (${r.grade || '--'})</td>
      <td><button class="icon-btn" style="color: var(--navy);" onclick="approveAsFormMaster(${r.id})">Approve</button></td>
    </tr>
  `).join('');
  return `
    <div class="panel teacher-dashboard-section" id="teacher-approval">
      <p class="eyebrow">Awaiting your approval</p>
      <h3 class="panel-title">Pending results in your class</h3>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Student</th><th>Subject</th><th>CA/Exam</th><th>Total</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

function onResultClassChange() {
  const classId = document.getElementById('result-class').value;
  const studentSelect = document.getElementById('result-student');
  const subjectSelect = document.getElementById('result-subject');
  if (!classId) {
    studentSelect.innerHTML = '<option value="">Select a class first</option>';
    subjectSelect.innerHTML = renderSubjectOptionsForSection('');
    return;
  }

  const selectedClass = myClasses.find((c) => String(c.id) === String(classId));
  const section = selectedClass?.section || '';
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
  subjectSelect.innerHTML = renderSubjectOptionsForSection(section);

  const inClass = myStudents.filter((s) => String(s.classes?.id) === String(classId));
  studentSelect.innerHTML = inClass.length
    ? inClass.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    : '<option value="">No students in this class</option>';
}

function startEditResult(id) {
  const r = myOwnResults.find((x) => x.id === id);
  if (!r) return;
  editingResultId = id;
  renderDashboard();

  // Pre-fill after the form renders
  setTimeout(() => {
    const classId = r.students?.classes?.id;
    if (classId) {
      const classSelect = document.getElementById('result-class');
      if (classSelect) classSelect.value = classId;
      onResultClassChange();
      const studentSelect = document.getElementById('result-student');
      if (studentSelect) studentSelect.value = r.student_id;
    }
    const subjectSelect = document.getElementById('result-subject');
    if (subjectSelect) subjectSelect.value = r.subject_id;
    const ca1Input = document.getElementById('result-ca1');
    const ca2Input = document.getElementById('result-ca2');
    const examInput = document.getElementById('result-exam');
    if (ca1Input) ca1Input.value = r.ca1_score ?? '';
    if (ca2Input) ca2Input.value = r.ca2_score ?? '';
    if (examInput) examInput.value = r.exam_score ?? '';
    document.getElementById('teacher-submit-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

function cancelEditResult() {
  editingResultId = null;
  renderDashboard();
}

async function submitResult() {
  const studentId = document.getElementById('result-student').value;
  const subjectId = document.getElementById('result-subject').value;
  const ca1 = document.getElementById('result-ca1').value;
  const ca2 = document.getElementById('result-ca2').value;
  const exam = document.getElementById('result-exam').value;

  const errEl = document.getElementById('form-error');
  const okEl = document.getElementById('form-success');
  errEl.classList.remove('visible'); okEl.classList.remove('visible');

  if (!studentId || !subjectId) { errEl.textContent = 'Choose a class, a student, and a subject.'; errEl.classList.add('visible'); return; }

  const ca1Score = ca1 === '' ? null : Number(ca1);
  const ca2Score = ca2 === '' ? null : Number(ca2);
  const examScore = exam === '' ? null : Number(exam);
  if (ca1Score !== null && (ca1Score < 0 || ca1Score > ca1Max)) { errEl.textContent = `CA1 score must be 0-${ca1Max}.`; errEl.classList.add('visible'); return; }
  if (ca2Score !== null && (ca2Score < 0 || ca2Score > ca2Max)) { errEl.textContent = `CA2 score must be 0-${ca2Max}.`; errEl.classList.add('visible'); return; }
  if (examScore !== null && (examScore < 0 || examScore > examMax)) { errEl.textContent = `Exam score must be 0-${examMax}.`; errEl.classList.add('visible'); return; }

  // ca_score and total_score are computed automatically by a database
  // trigger from ca1/ca2/exam -- this total is only for looking up the
  // matching grade to send along.
  const caTotal = (ca1Score !== null || ca2Score !== null) ? (ca1Score ?? 0) + (ca2Score ?? 0) : null;
  const total = (caTotal !== null && examScore !== null) ? caTotal + examScore : null;

  const payload = {
    ca1_score: ca1Score, ca2_score: ca2Score, exam_score: examScore, grade: gradeFor(total),
  };

  const query = editingResultId
    ? supabaseClient.from('results').update(payload).eq('id', editingResultId)
    : supabaseClient.from('results').insert({
        school_id: currentSchoolId, student_id: studentId, subject_id: subjectId,
        session_id: activeSession.id, status: 'pending', submitted_by: currentUserId, ...payload,
      });

  const { error } = await query;

  if (error) {
    errEl.textContent = error.code === '23505'
      ? 'This student already has a result for this subject in this term.'
      : error.message;
    errEl.classList.add('visible');
    return;
  }

  okEl.textContent = editingResultId ? 'Updated.' : 'Submitted for approval.';
  okEl.classList.add('visible');
  const wasEditing = !!editingResultId;
  editingResultId = null;
  await refreshMyResults();
  showSuccessToast(wasEditing ? 'Result updated' : 'Result submitted for approval');
}

async function approveAsFormMaster(id) {
  const { error } = await supabaseClient.from('results').update({ status: 'approved' }).eq('id', id);
  if (error) {
    alert('Could not approve: ' + error.message);
    return;
  }

  const { data: profile } = await supabaseClient.from('profiles').select('name').eq('id', currentUserId).single();
  await supabaseClient.from('activity_log').insert({
    school_id: currentSchoolId,
    actor_id: currentUserId,
    actor_name: profile?.name || 'Unknown',
    action: 'Approved a result (form master)',
    details: `Result #${id} marked as approved`,
  });

  await refreshMyResults();
  showSuccessToast('Result approved');
}

function renderFormMasterNotesPanel() {
  const classId = teacherRecord.form_master_class_id;
  const inClass = myStudents.filter((s) => s.classes?.id === classId);
  const options = inClass.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  return `
    <div class="panel teacher-dashboard-section" id="teacher-notes">
      <p class="eyebrow">Report cards</p>
      <h3 class="panel-title">Attendance, behaviour &amp; remarks</h3>
      <p class="text-muted" style="font-size:13.5px;">For students in ${teacherRecord.classes?.name || 'your class'}.</p>
      <div class="field">
        <label for="fm-notes-student">Student</label>
        <select id="fm-notes-student" onchange="loadFormMasterNotesForm()">
          <option value="">Select a student</option>
          ${options}
        </select>
      </div>
      <div id="fm-notes-form-container"></div>
    </div>`;
}

async function loadFormMasterNotesForm() {
  const studentId = document.getElementById('fm-notes-student').value;
  const container = document.getElementById('fm-notes-form-container');
  if (!studentId) { container.innerHTML = ''; return; }

  const { data: notes } = await supabaseClient
    .from('student_term_notes').select('*')
    .eq('student_id', studentId).eq('session_id', activeSession.id).maybeSingle();

  const n = notes || {};
  const ratingOptions = (current) => [1, 2, 3, 4, 5].map((v) =>
    `<option value="${v}" ${current === v ? 'selected' : ''}>${v}</option>`).join('');

  container.innerHTML = `
    <div class="form-panel open">
      <div class="form-grid">
        <div class="field"><label>Days school opened</label><input type="number" id="fm-days-opened" value="${n.days_opened ?? ''}"></div>
        <div class="field"><label>Days present</label><input type="number" id="fm-days-present" value="${n.days_present ?? ''}"></div>
        <div class="field"><label>Days absent</label><input type="number" id="fm-days-absent" value="${n.days_absent ?? ''}"></div>
        <div class="field"><label>Next term begins</label><input type="date" id="fm-next-term" value="${n.next_term_date || ''}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Punctuality</label><select id="fm-punctuality"><option value="">--</option>${ratingOptions(n.punctuality)}</select></div>
        <div class="field"><label>Attendance</label><select id="fm-attendance"><option value="">--</option>${ratingOptions(n.attendance_rating)}</select></div>
        <div class="field"><label>Neatness</label><select id="fm-neatness"><option value="">--</option>${ratingOptions(n.neatness)}</select></div>
        <div class="field"><label>Handwriting</label><select id="fm-handwriting"><option value="">--</option>${ratingOptions(n.handwriting)}</select></div>
        <div class="field"><label>Politeness</label><select id="fm-politeness"><option value="">--</option>${ratingOptions(n.politeness)}</select></div>
        <div class="field"><label>Initiative</label><select id="fm-initiative"><option value="">--</option>${ratingOptions(n.initiative)}</select></div>
        <div class="field"><label>Attitude to school</label><select id="fm-attitude"><option value="">--</option>${ratingOptions(n.attitude_to_school)}</select></div>
      </div>
      <div class="field"><label>Headteacher/Principal's remarks</label><input type="text" id="fm-headteacher-remark" value="${n.headteacher_remark || ''}"></div>
      <div class="field"><label>Teacher's remark</label><input type="text" id="fm-teacher-remark" value="${n.teacher_remark || ''}"></div>
      <button class="btn-gold" onclick="saveFormMasterNotes(${studentId})">Save</button>
      <div id="fm-notes-error" class="error-banner"></div>
      <div id="fm-notes-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>`;
}

async function saveFormMasterNotes(studentId) {
  const val = (id) => document.getElementById(id).value;
  const numOrNull = (v) => v === '' ? null : Number(v);

  const payload = {
    school_id: currentSchoolId,
    student_id: studentId,
    session_id: activeSession.id,
    days_opened: numOrNull(val('fm-days-opened')),
    days_present: numOrNull(val('fm-days-present')),
    days_absent: numOrNull(val('fm-days-absent')),
    next_term_date: val('fm-next-term') || null,
    punctuality: numOrNull(val('fm-punctuality')),
    attendance_rating: numOrNull(val('fm-attendance')),
    neatness: numOrNull(val('fm-neatness')),
    handwriting: numOrNull(val('fm-handwriting')),
    politeness: numOrNull(val('fm-politeness')),
    initiative: numOrNull(val('fm-initiative')),
    attitude_to_school: numOrNull(val('fm-attitude')),
    headteacher_remark: val('fm-headteacher-remark').trim() || null,
    teacher_remark: val('fm-teacher-remark').trim() || null,
  };

  const { error } = await supabaseClient
    .from('student_term_notes').upsert(payload, { onConflict: 'student_id,session_id' });

  const errEl = document.getElementById('fm-notes-error');
  const okEl = document.getElementById('fm-notes-success');
  errEl.classList.remove('visible'); okEl.classList.remove('visible');
  if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }
  okEl.textContent = 'Saved.'; okEl.classList.add('visible');
  showSuccessToast('Notes saved');
}

async function signOutTeacher() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

loadTeacherDashboard();
