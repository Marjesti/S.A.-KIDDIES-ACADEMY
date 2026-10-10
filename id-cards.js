let currentSchoolId = null;
let schoolInfo = { name: '', address: '', phone: '', logo_url: null };
let activeSession = null;
let allStudents = [];
let allTeachers = [];
let allClasses = [];
let teacherClassesById = {};
let teacherSubjectsById = {};

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function idCardVerifyUrl(token) {
  return `${window.location.origin}${window.location.pathname.replace('id-cards.html', '')}id-verify.html?token=${encodeURIComponent(token)}`;
}

async function getIdCardToken(entityType, entityId) {
  const { data, error } = await supabaseClient.rpc('get_or_create_id_card_token', {
    p_entity_type: entityType,
    p_entity_id: entityId
  });
  if (error) throw error;
  return data;
}

async function loadIdCardsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'id-cards', profile });
  currentSchoolId = profile.school_id;

  const [{ data: school }, { data: session }, { data: classes }, { data: students }, { data: teachers }, { data: teacherClasses }, { data: teacherSubjects }] = await Promise.all([
    supabaseClient.from('schools').select('name, address, phone, logo_url').eq('id', currentSchoolId).single(),
    supabaseClient.from('academic_sessions').select('year_label, term').eq('school_id', currentSchoolId).eq('is_active', true).maybeSingle(),
    supabaseClient.from('classes').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('students').select('id, name, admission_no, photo_url, photo_path, class_id, classes ( name )').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('teachers').select('id, name, email, phone, sex, employment_type, form_master_class_id, classes!teachers_form_master_class_id_fkey ( id, name )').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('teacher_classes').select('teacher_id, class_id, classes ( id, name, section )'),
    supabaseClient.from('teacher_subjects').select('teacher_id, subject_id, subjects ( id, name, section )'),
  ]);

  schoolInfo = school || schoolInfo;
  activeSession = session || null;
  allClasses = classes || [];
  allStudents = students || [];
  allTeachers = teachers || [];

  teacherClassesById = {};
  (teacherClasses || []).forEach((row) => {
    if (!teacherClassesById[row.teacher_id]) teacherClassesById[row.teacher_id] = [];
    if (row.classes) teacherClassesById[row.teacher_id].push(row.classes);
  });
  teacherSubjectsById = {};
  (teacherSubjects || []).forEach((row) => {
    if (!teacherSubjectsById[row.teacher_id]) teacherSubjectsById[row.teacher_id] = [];
    if (row.subjects) teacherSubjectsById[row.teacher_id].push(row.subjects);
  });

  renderIdCardsBody();
}

function renderIdCardsBody() {
  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Print &amp; verify</p>
    <h1 class="page-title">ID Cards</h1>
    <p class="page-subtitle">Generate verified identity cards for students and teachers. Every QR code opens the school's dedicated ID Card Verification dashboard.</p>

    <div class="panel">
      <div class="field">
        <label for="id-card-person-type">Generate for</label>
        <select id="id-card-person-type" onchange="onIdCardPersonTypeChange()">
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
        </select>
      </div>

      <div id="id-card-student-controls">
        <div class="field">
          <label for="id-card-mode">Student selection</label>
          <select id="id-card-mode" onchange="onIdCardModeChange()">
            <option value="individual">One student</option>
            <option value="class">A whole class</option>
          </select>
        </div>
        <div id="id-card-individual-picker" class="field">
          <label for="id-card-student-search">Search student</label>
          <input type="text" id="id-card-student-search" placeholder="Type a name..." oninput="renderStudentPickerResults()">
          <div id="id-card-student-results" style="max-height:200px; overflow-y:auto; margin-top:8px;"></div>
        </div>
        <div id="id-card-class-picker" class="field" style="display:none;">
          <label for="id-card-class-select">Class</label>
          <select id="id-card-class-select" onchange="renderSelectedStudentIdCards()">
            <option value="">Select a class</option>
            ${allClasses.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="id-card-teacher-controls" style="display:none;">
        <div class="field">
          <label for="id-card-teacher-search">Search teacher</label>
          <input type="text" id="id-card-teacher-search" placeholder="Type a teacher's name..." oninput="renderTeacherPickerResults()">
          <div id="id-card-teacher-results" style="max-height:200px; overflow-y:auto; margin-top:8px;"></div>
        </div>
        <div class="field">
          <label for="id-card-teacher-section">Teacher section</label>
          <select id="id-card-teacher-section" onchange="renderTeacherSectionCards()">
            <option value="">All teachers</option>
            ${[...new Set(allTeachers.flatMap(t => (teacherClassesById[t.id] || []).map(c => c.section).filter(Boolean)))].sort().map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>

      <button class="btn-gold" onclick="window.print()">Print</button>
      <div id="id-card-generation-error" class="error-banner"></div>
    </div>

    <div id="id-card-output"></div>
  `;
}

function onIdCardPersonTypeChange() {
  const type = document.getElementById('id-card-person-type').value;
  document.getElementById('id-card-student-controls').style.display = type === 'student' ? '' : 'none';
  document.getElementById('id-card-teacher-controls').style.display = type === 'teacher' ? '' : 'none';
  document.getElementById('id-card-output').innerHTML = '';
}

function onIdCardModeChange() {
  const mode = document.getElementById('id-card-mode').value;
  document.getElementById('id-card-individual-picker').style.display = mode === 'individual' ? '' : 'none';
  document.getElementById('id-card-class-picker').style.display = mode === 'class' ? '' : 'none';
  document.getElementById('id-card-output').innerHTML = '';
}

function renderStudentPickerResults() {
  const query = document.getElementById('id-card-student-search').value.trim().toLowerCase();
  const resultsEl = document.getElementById('id-card-student-results');
  if (!query) { resultsEl.innerHTML = ''; return; }

  const matches = allStudents.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 15);
  resultsEl.innerHTML = matches.length ? matches.map((s) => `
    <div class="queue-row" style="cursor:pointer;" onclick="selectStudentForIdCard(${s.id})">
      <span>${s.name}</span>
      <span class="text-muted">${s.classes?.name || 'Unassigned'}</span>
    </div>
  `).join('') : `<div class="empty-state">No matching students.</div>`;
}

function renderTeacherPickerResults() {
  const query = document.getElementById('id-card-teacher-search').value.trim().toLowerCase();
  const section = document.getElementById('id-card-teacher-section').value;
  const resultsEl = document.getElementById('id-card-teacher-results');
  if (!query) { resultsEl.innerHTML = ''; return; }

  const matches = allTeachers.filter((t) => {
    const sectionMatch = !section || (teacherClassesById[t.id] || []).some(c => c.section === section);
    return sectionMatch && t.name.toLowerCase().includes(query);
  }).slice(0, 15);

  resultsEl.innerHTML = matches.length ? matches.map((t) => `
    <div class="queue-row" style="cursor:pointer;" onclick="selectTeacherForIdCard(${t.id})">
      <span>${t.name}</span>
      <span class="text-muted">${(teacherClassesById[t.id] || []).map(c => c.name).join(', ') || 'No class assigned'}</span>
    </div>
  `).join('') : `<div class="empty-state">No matching teachers.</div>`;
}

async function selectStudentForIdCard(studentId) {
  const student = allStudents.find((s) => s.id === studentId);
  document.getElementById('id-card-student-search').value = student ? student.name : '';
  document.getElementById('id-card-student-results').innerHTML = '';
  document.getElementById('id-card-output').innerHTML = student ? `<div class="id-card-grid">${cardPairHtml(student)}</div>` : '';
  if (student) await renderStudentIdCardQRCodes([student]);
}

function renderSelectedStudentIdCards() {
  const classId = document.getElementById('id-card-class-select').value;
  const outputEl = document.getElementById('id-card-output');
  if (!classId) { outputEl.innerHTML = ''; return; }

  const classStudents = allStudents.filter((s) => String(s.class_id) === String(classId));
  outputEl.innerHTML = classStudents.length
    ? `<div class="id-card-grid">${classStudents.map(cardPairHtml).join('')}</div>`
    : `<div class="panel"><div class="empty-state">No students in this class yet.</div></div>`;
  if (classStudents.length) renderStudentIdCardQRCodes(classStudents);
}

function renderTeacherSectionCards() {
  const section = document.getElementById('id-card-teacher-section').value;
  const teachers = allTeachers.filter(t => !section || (teacherClassesById[t.id] || []).some(c => c.section === section));
  const outputEl = document.getElementById('id-card-output');
  outputEl.innerHTML = teachers.length
    ? `<div class="id-card-grid">${teachers.map(teacherCardPairHtml).join('')}</div>`
    : `<div class="panel"><div class="empty-state">No teachers in this section.</div></div>`;
  if (teachers.length) renderTeacherIdCardQRCodes(teachers);
}

async function selectTeacherForIdCard(teacherId) {
  const teacher = allTeachers.find((t) => t.id === teacherId);
  document.getElementById('id-card-teacher-search').value = teacher ? teacher.name : '';
  document.getElementById('id-card-teacher-results').innerHTML = '';
  document.getElementById('id-card-output').innerHTML = teacher ? `<div class="id-card-grid">${teacherCardPairHtml(teacher)}</div>` : '';
  if (teacher) await renderTeacherIdCardQRCodes([teacher]);
}

function showIdCardError(message) {
  const el = document.getElementById('id-card-generation-error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

async function renderStudentIdCardQRCodes(students) {
  try {
    for (const student of students) {
      const holder = document.getElementById(`id-card-qr-student-${student.id}`);
      if (!holder) continue;
      const token = await getIdCardToken('student', student.id);
      holder.innerHTML = '';
      new QRCode(holder, { text: idCardVerifyUrl(token), width: 200, height: 200, colorDark: '#1B2942', colorLight: '#ffffff' });
    }
  } catch (error) {
    console.error(error);
    showIdCardError('ID card QR verification is not set up yet. Run db/schema_id_card_verification.sql in Supabase, then try again.');
  }
}

async function renderTeacherIdCardQRCodes(teachers) {
  try {
    for (const teacher of teachers) {
      const holder = document.getElementById(`id-card-qr-teacher-${teacher.id}`);
      if (!holder) continue;
      const token = await getIdCardToken('teacher', teacher.id);
      holder.innerHTML = '';
      new QRCode(holder, { text: idCardVerifyUrl(token), width: 200, height: 200, colorDark: '#1B2942', colorLight: '#ffffff' });
    }
  } catch (error) {
    console.error(error);
    showIdCardError('ID card QR verification is not set up yet. Run db/schema_id_card_verification.sql in Supabase, then try again.');
  }
}

function schoolLogoHtml(small = false) {
  return schoolInfo.logo_url
    ? `<img src="${schoolInfo.logo_url}" alt="logo" class="id-card-logo-img">`
    : `<div class="id-card-logo-fallback">${initials(schoolInfo.name || 'S')}</div>`;
}

// The watermark always uses the current School Setup logo URL.
// Because the logo is read from the schools table each time this page loads,
// changing the school logo automatically changes the printed ID-card watermark.
function schoolLogoWatermarkHtml() {
  return schoolInfo.logo_url
    ? `<div class="id-card-watermark" aria-hidden="true"><img src="${schoolInfo.logo_url}" alt=""></div>`
    : '';
}

function cardPairHtml(student) {
  const className = student.classes?.name || 'Unassigned';
  const photoUrl = studentPhotoDisplayUrl(student);
  const photoHtml = photoUrl
    ? `<img src="${photoUrl}" alt="${student.name}" class="id-card-photo">`
    : `<div class="id-card-photo-placeholder">${initials(student.name)}</div>`;
  const logoHtml = schoolLogoHtml();

  return `
    <div class="id-card-pair">
      <div class="id-card id-card-front id-card-classic-front">
        ${schoolLogoWatermarkHtml()}
        <div class="id-card-topbar">
          <div class="id-card-header-inner">
            <div class="id-card-logo-badge">${logoHtml}</div>
            <div class="id-card-heading">
              <div class="id-card-school-name">${schoolInfo.name || 'School name'}</div>
              <div class="id-card-tagline">STUDENT IDENTITY CARD</div>
            </div>
          </div>
        </div>
        <div class="id-card-front-content">
          <div class="id-card-photo-ring-wrap">${photoHtml}</div>
          <div class="id-card-person-info">
            <div class="id-card-name">${student.name}</div>
            <div class="id-card-role">Student</div>
            <div class="id-card-info-line"><span>Admission No.</span><strong>${student.admission_no || '&mdash;'}</strong></div>
            <div class="id-card-info-line"><span>Class</span><strong>${className}</strong></div>
          </div>
        </div>
        <div class="id-card-front-footer">
          <span>PROPERTY OF ${schoolInfo.name || 'THE SCHOOL'}</span>
          <span>PLEASE CARRY THIS CARD</span>
        </div>
      </div>

      <div class="id-card id-card-back id-card-classic-back">
        ${schoolLogoWatermarkHtml()}
        <div class="id-card-back-heading">
          <div class="id-card-logo-badge small">${logoHtml}</div>
          <div>
            <div class="id-card-school-name small">${schoolInfo.name || 'School name'}</div>
            <div class="id-card-back-label">STUDENT ID CARD</div>
          </div>
        </div>
        <div class="id-card-back-body">
          <div class="id-card-terms">
            <p class="id-card-terms-title">TERMS &amp; CONDITIONS</p>
            <div class="id-card-term-item"><span class="dot"></span>This card remains the property of the school and must be surrendered on request.</div>
            <div class="id-card-term-item"><span class="dot"></span>If found, please return it to the school office.</div>
            <div class="id-card-term-item"><span class="dot"></span>Report a lost card to the school immediately.</div>
          </div>
          <div class="id-card-qr-block">
            <div id="id-card-qr-student-${student.id}" class="id-card-qr"></div>
            <div class="id-card-scan-text">SCAN TO VERIFY</div>
          </div>
        </div>
        <div class="id-card-sig">Authorised School Signature</div>
      </div>
    </div>`;
}

function teacherCardPairHtml(teacher) {
  const formMaster = teacher.classes?.name || 'Not assigned';
  const logoHtml = schoolLogoHtml();

  return `
    <div class="id-card-pair">
      <div class="id-card id-card-front id-card-classic-front teacher-id-card-front">
        ${schoolLogoWatermarkHtml()}
        <div class="id-card-topbar">
          <div class="id-card-header-inner">
            <div class="id-card-logo-badge">${logoHtml}</div>
            <div class="id-card-heading">
              <div class="id-card-school-name">${schoolInfo.name || 'School name'}</div>
              <div class="id-card-tagline">STAFF IDENTITY CARD</div>
            </div>
          </div>
        </div>
        <div class="id-card-front-content teacher-front-content">
          <div class="id-card-photo-ring-wrap">
            <div class="id-card-photo-placeholder teacher-photo-placeholder">${initials(teacher.name)}</div>
          </div>
          <div class="id-card-person-info teacher-person-info">
            <div class="id-card-name">${teacher.name}</div>
            <div class="id-card-role">${teacher.employment_type || 'Staff'}</div>
            <div class="id-card-info-line"><span>Form Master</span><strong>${formMaster}</strong></div>
            <div class="id-card-info-line"><span>Sex</span><strong>${teacher.sex || '&mdash;'}</strong></div>
            <div class="id-card-info-line"><span>Phone</span><strong>${teacher.phone || '&mdash;'}</strong></div>
            ${teacher.email ? `<div class="id-card-info-line"><span>Email</span><strong>${teacher.email}</strong></div>` : ''}
          </div>
        </div>
        <div class="id-card-front-footer">
          <span>PROPERTY OF ${schoolInfo.name || 'THE SCHOOL'}</span>
          <span>STAFF</span>
        </div>
      </div>

      <div class="id-card id-card-back id-card-classic-back">
        ${schoolLogoWatermarkHtml()}
        <div class="id-card-back-heading">
          <div class="id-card-logo-badge small">${logoHtml}</div>
          <div>
            <div class="id-card-school-name small">${schoolInfo.name || 'School name'}</div>
            <div class="id-card-back-label">STAFF ID CARD</div>
          </div>
        </div>
        <div class="id-card-back-body teacher-back-body">
          <div class="id-card-terms">
            <p class="id-card-terms-title">TERMS &amp; CONDITIONS</p>
            <div class="id-card-term-item"><span class="dot"></span>This card is the property of the school and must be surrendered on request or at the end of service.</div>
            <div class="id-card-term-item"><span class="dot"></span>If found, please return it to the school office.</div>
            <div class="id-card-term-item"><span class="dot"></span>Report a lost card to the school immediately.</div>
            <div class="id-card-term-item"><span class="dot"></span>This card is for official school identification only.</div>
          </div>
          <div class="id-card-qr-block">
            <div id="id-card-qr-teacher-${teacher.id}" class="id-card-qr"></div>
            <div class="id-card-scan-text">SCAN TO VERIFY</div>
          </div>
        </div>
        <div class="id-card-sig">Principal / Headteacher Signature</div>
      </div>
    </div>`;
}

loadIdCardsPage();
