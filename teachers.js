let currentSchoolId = null;
let currentSubjectsList = [];
let currentClassesList = [];
let editingTeacherId = null;

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Volunteer'];
const SECTIONS = ['Playgroup/Pre-Nursery', 'Nursery', 'Primary', 'Junior Secondary', 'Senior Secondary'];

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

async function loadTeachersPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'teachers', profile });
  currentSchoolId = profile.school_id;

  const [{ data: subjects }, { data: classes }] = await Promise.all([
    supabaseClient.from('subjects').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('classes').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
  ]);
  currentSubjectsList = subjects || [];
  currentClassesList = classes || [];

  await refreshTeachersView();
}

async function refreshTeachersView() {
  const { data: teachers } = await supabaseClient
    .from('teachers')
    .select('id, name, email, phone, sex, employment_type, form_master_class_id, classes!teachers_form_master_class_id_fkey ( name ), teacher_subjects ( subject_id ), teacher_classes ( class_id )')
    .eq('school_id', currentSchoolId)
    .order('name');

  renderTeachersBody(teachers || []);
}

function teacherRowHtml(t, sectionName, classSectionById, subjectSectionById) {
  let subjectCount, classCount;
  if (sectionName === null) {
    subjectCount = t.teacher_subjects?.length || 0;
    classCount = t.teacher_classes?.length || 0;
  } else {
    classCount = (t.teacher_classes || []).filter((link) => classSectionById[link.class_id] === sectionName).length;
    subjectCount = (t.teacher_subjects || []).filter((link) => {
      const sec = subjectSectionById[link.subject_id];
      return !sec || sec === sectionName;
    }).length;
  }

  return `
    <tr>
      <td>
        <span class="row-name">
          <span class="student-avatar">${initials(t.name)}</span>
          ${t.name}
          ${t.form_master_class_id ? `<span style="margin-left:8px; font-size:11px; background:var(--gold-soft); color:var(--navy); padding:2px 8px; border-radius:999px; font-weight:700;">Form master &middot; ${t.classes?.name || ''}</span>` : ''}
        </span>
      </td>
      <td class="text-muted">${t.email || '&mdash;'}</td>
      <td class="text-muted">${t.employment_type || '&mdash;'}</td>
      <td class="text-muted">${subjectCount}</td>
      <td class="text-muted">${classCount}</td>
      <td>
        <button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="startEditTeacher(${t.id})">Edit</button>
        <button class="icon-btn" onclick="deleteTeacher(${t.id})">Remove</button>
      </td>
    </tr>`;
}

function sectionGroupHtml(sectionName, teachersInSection, classSectionById, subjectSectionById) {
  if (!teachersInSection.length) return '';
  const rows = teachersInSection.map((t) => teacherRowHtml(t, sectionName, classSectionById, subjectSectionById)).join('');
  return `
    <div class="panel">
      <p class="eyebrow">${teachersInSection.length} teacher${teachersInSection.length === 1 ? '' : 's'}</p>
      <h3 class="panel-title">${sectionName === null ? 'Not yet assigned to a class' : sectionName}</h3>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Teacher</th><th>Email</th><th>Employment</th><th>Subjects</th><th>Classes</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

function renderTeachersBody(teachers) {
  window.__teachersCache = teachers;

  const subjectSectionGroups = [...SECTIONS, 'Unassigned section'].map((sectionName) => {
    const subjectsHere = currentSubjectsList
      .filter((s) => (s.section || 'Unassigned section') === sectionName)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!subjectsHere.length) return '';
    return `
      <div class="teacher-subject-section" data-section="${sectionName}" style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--navy); margin-bottom:6px;">${sectionName}</div>
        ${subjectsHere.map((s) => `
          <label style="display:block; font-size:14px; margin-bottom:6px;">
            <input type="checkbox" class="teacher-subject-check" value="${s.id}" data-section="${s.section || 'Unassigned section'}"> ${s.name}
          </label>`).join('')}
      </div>`;
  }).join('') || '<p class="text-muted" style="font-size:13.5px;">No subjects yet — add some on the Academics page.</p>';

  const classChecks = currentClassesList.map((c) => `
    <label style="display:block; font-size:14px; margin-bottom:6px;">
      <input type="checkbox" class="teacher-class-check" value="${c.id}" data-section="${c.section || 'Unassigned section'}" onchange="filterTeacherSubjectsByClasses()"> ${c.name}${c.section ? ' (' + c.section + ')' : ''}
    </label>`).join('') || '<p class="text-muted" style="font-size:13.5px;">No classes yet — add some on the Classes page.</p>';

  const employmentOptions = EMPLOYMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');

  // Map each class id -> its section, so we can figure out which section(s) a teacher belongs to
  const classSectionById = {};
  currentClassesList.forEach((c) => { classSectionById[c.id] = c.section || 'Unassigned section'; });

  // Map each subject id -> its section (used to scope the Subjects count to the section being shown)
  const subjectSectionById = {};
  currentSubjectsList.forEach((s) => { subjectSectionById[s.id] = s.section || null; });

  // A teacher can appear under more than one section if they teach across sections
  const sectionsUsed = [...SECTIONS, 'Unassigned section'];
  const groupsHtml = sectionsUsed.map((sectionName) => {
    const teachersHere = teachers.filter((t) =>
      (t.teacher_classes || []).some((link) => classSectionById[link.class_id] === sectionName)
    );
    return sectionGroupHtml(sectionName, teachersHere, classSectionById, subjectSectionById);
  }).join('');

  const noSectionTeachers = teachers.filter((t) => !(t.teacher_classes || []).length);
  const noSectionHtml = sectionGroupHtml(null, noSectionTeachers, classSectionById, subjectSectionById);

  const noDataHtml = !teachers.length
    ? `<div class="panel"><div class="empty-state">No teachers yet. Add your first one below.</div></div>` : '';

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Faculty directory</p>
    <h1 class="page-title">Teachers</h1>
    <p class="page-subtitle">Grouped by section, based on the classes each teacher handles.</p>

    <div class="panel">
      <div class="panel-toolbar">
        <button class="btn-gold" onclick="openAddTeacherForm()">+ Add teacher</button>
      </div>

      <div id="teacher-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="teacher-name">Full name</label>
            <input type="text" id="teacher-name" placeholder="e.g. Mr. Chinedu Okoro">
          </div>
          <div class="field">
            <label for="teacher-email">Email</label>
            <input type="email" id="teacher-email" placeholder="Optional">
          </div>
          <div class="field">
            <label for="teacher-employment">Employment type</label>
            <select id="teacher-employment">
              <option value="">Not set</option>
              ${employmentOptions}
            </select>
          </div>
          <div class="field">
            <label for="teacher-sex">Sex</label>
            <select id="teacher-sex">
              <option value="">Not set</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div class="field">
            <label for="teacher-phone">Phone number</label>
            <input type="text" id="teacher-phone" placeholder="e.g. 08012345678">
          </div>
          <div class="field">
            <label for="teacher-form-master">Form master of</label>
            <select id="teacher-form-master">
              <option value="">Not a form master</option>
              ${currentClassesList.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Subjects taught</label>
            <p class="text-muted" style="font-size:12.5px; margin:0 0 7px;">Select classes first. Subjects are grouped by section and only subjects from the selected class section(s) are available.</p>
            <div id="teacher-subject-list" style="max-height:180px; overflow-y:auto; border:1px solid var(--border-soft); border-radius:var(--radius-sm); padding:10px; background:#fff;">
              ${subjectSectionGroups}
            </div>
          </div>
          <div class="field">
            <label>Classes handled</label>
            <div style="max-height:150px; overflow-y:auto; border:1px solid var(--border-soft); border-radius:var(--radius-sm); padding:10px; background:#fff;">
              ${classChecks}
            </div>
          </div>
        </div>
        <button class="btn-gold" id="teacher-form-submit-btn" onclick="submitTeacherForm()">Save teacher</button>
        <button class="btn-outline" onclick="closeTeacherForm()">Cancel</button>
      </div>

      <div id="form-error" class="error-banner"></div>
    </div>

    ${noDataHtml}
    ${groupsHtml}
    ${noSectionHtml}
  `;
}

function showFormError(message) {
  const el = document.getElementById('form-error');
  el.textContent = message;
  el.classList.add('visible');
}

function filterTeacherSubjectsByClasses() {
  const selectedSections = new Set(
    [...document.querySelectorAll('.teacher-class-check:checked')].map((el) => el.dataset.section)
  );

  document.querySelectorAll('.teacher-subject-section').forEach((group) => {
    const visible = selectedSections.size === 0 || selectedSections.has(group.dataset.section);
    group.style.display = visible ? '' : 'none';
    group.querySelectorAll('.teacher-subject-check').forEach((check) => {
      check.disabled = !visible;
    });
  });
}

function openAddTeacherForm() {
  editingTeacherId = null;
  document.getElementById('teacher-name').value = '';
  document.getElementById('teacher-email').value = '';
  document.getElementById('teacher-employment').value = '';
  document.getElementById('teacher-sex').value = '';
  document.getElementById('teacher-phone').value = '';
  document.getElementById('teacher-form-master').value = '';
  document.querySelectorAll('.teacher-subject-check, .teacher-class-check').forEach((el) => el.checked = false);
  filterTeacherSubjectsByClasses();
  document.getElementById('teacher-form-submit-btn').textContent = 'Save teacher';
  document.getElementById('teacher-form').classList.add('open');
}

function startEditTeacher(id) {
  const teacher = (window.__teachersCache || []).find((t) => t.id === id);
  if (!teacher) return;

  editingTeacherId = id;
  document.getElementById('teacher-name').value = teacher.name || '';
  document.getElementById('teacher-email').value = teacher.email || '';
  document.getElementById('teacher-employment').value = teacher.employment_type || '';
  document.getElementById('teacher-sex').value = teacher.sex || '';
  document.getElementById('teacher-phone').value = teacher.phone || '';
  document.getElementById('teacher-form-master').value = teacher.form_master_class_id || '';

  const subjectIds = new Set((teacher.teacher_subjects || []).map((r) => r.subject_id));
  const classIds = new Set((teacher.teacher_classes || []).map((r) => r.class_id));
  document.querySelectorAll('.teacher-subject-check').forEach((el) => el.checked = subjectIds.has(Number(el.value)));
  document.querySelectorAll('.teacher-class-check').forEach((el) => el.checked = classIds.has(Number(el.value)));
  filterTeacherSubjectsByClasses();

  document.getElementById('teacher-form-submit-btn').textContent = 'Update teacher';
  document.getElementById('teacher-form').classList.add('open');
  document.getElementById('teacher-form').scrollIntoView({ behavior: 'smooth' });
}

function closeTeacherForm() {
  editingTeacherId = null;
  document.getElementById('teacher-form').classList.remove('open');
}

async function submitTeacherForm() {
  const name = document.getElementById('teacher-name').value.trim();
  const email = document.getElementById('teacher-email').value.trim();
  const employmentType = document.getElementById('teacher-employment').value || null;
  const sex = document.getElementById('teacher-sex').value || null;
  const phone = document.getElementById('teacher-phone').value.trim();
  const formMasterClassId = document.getElementById('teacher-form-master').value || null;
  if (!name) { showFormError('Teacher name is required.'); return; }

  const selectedSubjects = [...document.querySelectorAll('.teacher-subject-check:checked')].map((el) => Number(el.value));
  const selectedClasses = [...document.querySelectorAll('.teacher-class-check:checked')].map((el) => Number(el.value));

  let teacherId = editingTeacherId;
  const wasEditing = !!teacherId;

  if (teacherId) {
    const { error } = await supabaseClient.from('teachers').update({
      name, email: email || null, phone: phone || null, sex, employment_type: employmentType, form_master_class_id: formMasterClassId,
    }).eq('id', teacherId);
    if (error) { showFormError(error.message); return; }
    // Clear old links, then re-insert the current selection
    await supabaseClient.from('teacher_subjects').delete().eq('teacher_id', teacherId);
    await supabaseClient.from('teacher_classes').delete().eq('teacher_id', teacherId);
  } else {
    const { data: newTeacher, error } = await supabaseClient
      .from('teachers').insert({
        school_id: currentSchoolId, name, email: email || null, phone: phone || null, sex, employment_type: employmentType, form_master_class_id: formMasterClassId,
      }).select().single();
    if (error) { showFormError(error.message); return; }
    teacherId = newTeacher.id;
  }

  if (selectedSubjects.length) {
    await supabaseClient.from('teacher_subjects').insert(selectedSubjects.map((subject_id) => ({ teacher_id: teacherId, subject_id })));
  }
  if (selectedClasses.length) {
    await supabaseClient.from('teacher_classes').insert(selectedClasses.map((class_id) => ({ teacher_id: teacherId, class_id })));
  }

  closeTeacherForm();
  await refreshTeachersView();
  showSuccessToast(wasEditing ? 'Teacher updated' : 'Teacher saved');
}

async function deleteTeacher(id) {
  if (!confirm('Are you sure you want to remove this teacher? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('teachers').delete().eq('id', id);
  if (error) { showFormError(error.message); return; }
  await refreshTeachersView();
  showSuccessToast('Teacher removed');
}

loadTeachersPage();
