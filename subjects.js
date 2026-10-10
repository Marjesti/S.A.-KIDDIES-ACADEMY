let currentSchoolId = null;
let editingSubjectId = null;

const SECTIONS = ['Playgroup/Pre-Nursery', 'Nursery', 'Primary', 'Junior Secondary', 'Senior Secondary'];

async function loadSubjectsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'subjects', profile });
  currentSchoolId = profile.school_id;
  await refreshSubjectsView();
}

async function refreshSubjectsView() {
  const { data: subjects } = await supabaseClient
    .from('subjects').select('id, name, section').eq('school_id', currentSchoolId).order('name');
  renderSubjectsBody(subjects || []);
}

function subjectRowHtml(s) {
  return `
    <tr>
      <td>${s.name}</td>
      <td>
        <button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="startEditSubject(${s.id}, '${s.name.replace(/'/g, "\\'")}', '${s.section || ''}')">Edit</button>
        <button class="icon-btn" onclick="deleteSubject(${s.id})">Remove</button>
      </td>
    </tr>`;
}

function sectionGroupHtml(sectionName, subjectsHere) {
  if (!subjectsHere.length) return '';
  return `
    <div class="panel">
      <p class="eyebrow">${subjectsHere.length} subject${subjectsHere.length === 1 ? '' : 's'}</p>
      <h3 class="panel-title">${sectionName}</h3>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Subject</th><th></th></tr></thead>
        <tbody>${subjectsHere.map(subjectRowHtml).join('')}</tbody>
      </table></div>
    </div>`;
}

function renderSubjectsBody(subjects) {
  const sectionOptions = SECTIONS.map((s) => `<option value="${s}">${s}</option>`).join('');

  const groupsHtml = SECTIONS.map((sectionName) => {
    const subjectsHere = subjects.filter((s) => s.section === sectionName);
    return sectionGroupHtml(sectionName, subjectsHere);
  }).join('');

  const unassigned = subjects.filter((s) => !s.section);
  const unassignedHtml = sectionGroupHtml('No section set', unassigned);

  const noDataHtml = !subjects.length
    ? `<div class="panel"><div class="empty-state">No subjects yet. Add your first one below.</div></div>` : '';

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Curriculum</p>
    <h1 class="page-title">Subjects</h1>
    <p class="page-subtitle">Grouped by section, so results and teacher assignments stay organized.</p>

    <div class="panel">
      <div class="panel-toolbar">
        <button class="btn-gold" onclick="openAddSubjectForm()">+ Add subject</button>
      </div>
      <div id="subject-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="subject-name">Subject name</label>
            <input type="text" id="subject-name" placeholder="e.g. Mathematics">
          </div>
          <div class="field">
            <label for="subject-section">Section</label>
            <select id="subject-section">
              <option value="">Select a section</option>
              ${sectionOptions}
            </select>
          </div>
        </div>
        <button class="btn-gold" id="subject-form-submit-btn" onclick="submitSubjectForm()">Save subject</button>
        <button class="btn-outline" onclick="closeSubjectForm()">Cancel</button>
      </div>
      <div id="form-error" class="error-banner"></div>
    </div>

    ${noDataHtml}
    ${groupsHtml}
    ${unassignedHtml}
  `;
}

function showFormError(message) {
  const el = document.getElementById('form-error');
  el.textContent = message;
  el.classList.add('visible');
}

function openAddSubjectForm() {
  editingSubjectId = null;
  document.getElementById('subject-name').value = '';
  document.getElementById('subject-section').value = '';
  document.getElementById('subject-form-submit-btn').textContent = 'Save subject';
  document.getElementById('subject-form').classList.add('open');
}

function startEditSubject(id, name, section) {
  editingSubjectId = id;
  document.getElementById('subject-name').value = name;
  document.getElementById('subject-section').value = section || '';
  document.getElementById('subject-form-submit-btn').textContent = 'Update subject';
  document.getElementById('subject-form').classList.add('open');
}

function closeSubjectForm() {
  editingSubjectId = null;
  document.getElementById('subject-form').classList.remove('open');
}

async function submitSubjectForm() {
  const name = document.getElementById('subject-name').value.trim();
  const section = document.getElementById('subject-section').value || null;
  if (!name) { showFormError('Subject name is required.'); return; }

  const wasEditing = !!editingSubjectId;
  const query = editingSubjectId
    ? supabaseClient.from('subjects').update({ name, section }).eq('id', editingSubjectId)
    : supabaseClient.from('subjects').insert({ school_id: currentSchoolId, name, section });

  const { error } = await query;
  if (error) { showFormError(error.message); return; }

  closeSubjectForm();
  await refreshSubjectsView();
  showSuccessToast(wasEditing ? 'Subject updated' : 'Subject saved');
}

async function deleteSubject(id) {
  if (!confirm('Are you sure you want to remove this subject? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('subjects').delete().eq('id', id);
  if (error) { showFormError(error.message); return; }
  await refreshSubjectsView();
  showSuccessToast('Subject removed');
}

loadSubjectsPage();
