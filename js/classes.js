let currentSchoolId = null;
let editingClassId = null;

const SECTIONS = ['Playgroup/Pre-Nursery', 'Nursery', 'Primary', 'Junior Secondary', 'Senior Secondary'];

async function loadClassesPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'classes', profile });
  currentSchoolId = profile.school_id;
  await refreshClassesView();
}

async function refreshClassesView() {
  const { data: classes } = await supabaseClient
    .from('classes')
    .select('id, name, section, students ( id )')
    .eq('school_id', currentSchoolId)
    .order('name');

  renderClassesBody(classes || []);
}

function renderClassesBody(classes) {
  const sectionOptions = SECTIONS.map((s) => `<option value="${s}">${s}</option>`).join('');

  const rowsHtml = classes.length ? classes.map((c) => `
    <tr>
      <td>${c.name}</td>
      <td class="text-muted">${c.section || '&mdash;'}</td>
      <td class="text-muted">${c.students?.length || 0} student${c.students?.length === 1 ? '' : 's'}</td>
      <td>
        <button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="startEditClass(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${c.section || ''}')">Edit</button>
        <button class="icon-btn" onclick="deleteClass(${c.id})">Remove</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="4"><div class="empty-state">No classes yet. Add your first one above.</div></td></tr>`;

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Class list</p>
    <h1 class="page-title">Classes</h1>
    <p class="page-subtitle">Set up the classes students get grouped into, like "JSS 1A" or "Primary 5 Gold".</p>

    <div class="panel">
      <div class="panel-toolbar">
        <button class="btn-gold" onclick="openAddClassForm()">+ Add class</button>
      </div>

      <div id="class-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="class-name-input">Class name</label>
            <input type="text" id="class-name-input" placeholder="e.g. JSS 1A">
          </div>
          <div class="field">
            <label for="class-section-input">Section</label>
            <select id="class-section-input">
              <option value="">Select a section</option>
              ${sectionOptions}
            </select>
          </div>
        </div>
        <button class="btn-gold" id="class-form-submit-btn" onclick="submitClassForm()">Save class</button>
        <button class="btn-outline" onclick="closeClassForm()">Cancel</button>
      </div>

      <div id="form-error" class="error-banner"></div>

      <div class="data-table-wrap"><table class="data-table">
        <thead>
          <tr><th>Class name</th><th>Section</th><th>Students</th><th></th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
    </div>
  `;
}

function showFormError(message) {
  const el = document.getElementById('form-error');
  el.textContent = message;
  el.classList.add('visible');
}

function openAddClassForm() {
  editingClassId = null;
  document.getElementById('class-name-input').value = '';
  document.getElementById('class-section-input').value = '';
  document.getElementById('class-form-submit-btn').textContent = 'Save class';
  document.getElementById('class-form').classList.add('open');
}

function startEditClass(id, name, section) {
  editingClassId = id;
  document.getElementById('class-name-input').value = name;
  document.getElementById('class-section-input').value = section || '';
  document.getElementById('class-form-submit-btn').textContent = 'Update class';
  document.getElementById('class-form').classList.add('open');
}

function closeClassForm() {
  editingClassId = null;
  document.getElementById('class-form').classList.remove('open');
}

async function submitClassForm() {
  const name = document.getElementById('class-name-input').value.trim();
  const section = document.getElementById('class-section-input').value || null;
  if (!name) { showFormError('Class name is required.'); return; }

  const wasEditing = !!editingClassId;
  const query = editingClassId
    ? supabaseClient.from('classes').update({ name, section }).eq('id', editingClassId)
    : supabaseClient.from('classes').insert({ school_id: currentSchoolId, name, section });

  const { error } = await query;
  if (error) { showFormError(error.message); return; }

  closeClassForm();
  await refreshClassesView();
  showSuccessToast(wasEditing ? 'Class updated' : 'Class saved');
}

async function deleteClass(id) {
  if (!confirm('Are you sure you want to remove this class? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('classes').delete().eq('id', id);
  if (error) { showFormError(error.message); return; }
  await refreshClassesView();
  showSuccessToast('Class removed');
}

loadClassesPage();
