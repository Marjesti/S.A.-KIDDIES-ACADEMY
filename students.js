let currentSchoolId = null;
let currentClasses = [];
let currentStudents = [];
let editingStudentId = null;
let currentProfile = null;
let isAdmin = false;
let isFormMaster = false;
let formMasterClassId = null;
let formMasterClassName = '';
let formMasterStudentEditEnabled = false;

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function canManageStudents() {
  return isAdmin || (isFormMaster && formMasterStudentEditEnabled);
}

// Resizes to a max dimension and re-encodes as JPEG client-side, so we
// never upload an oversized original -- keeps Supabase free-tier storage use low.
function compressImageFile(file, maxDimension = 480, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDimension) {
        height = Math.round(height * (maxDimension / width));
        width = maxDimension;
      } else if (height > maxDimension) {
        width = Math.round(width * (maxDimension / height));
        height = maxDimension;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process the image.')); return; }
        resolve(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    reader.readAsDataURL(file);
  });
}

async function loadStudentsPage() {
  const { profile } = await requireSession();
  currentProfile = profile;
  currentSchoolId = profile.school_id;
  isAdmin = profile.role === 'admin';

  // Form Masters are allowed into the Students page, but their scope and
  // editing permission are controlled by the admin switch on the school.
  if (!isAdmin) {
    const [{ data: teacher }, { data: school }] = await Promise.all([
      supabaseClient
        .from('teachers')
        .select('id, form_master_class_id, classes!teachers_form_master_class_id_fkey ( id, name )')
        .eq('profile_id', profile.id)
        .maybeSingle(),
      supabaseClient
        .from('schools')
        .select('form_master_student_edit_enabled')
        .eq('id', currentSchoolId)
        .single(),
    ]);

    isFormMaster = !!teacher?.form_master_class_id;
    formMasterClassId = teacher?.form_master_class_id || null;
    formMasterClassName = teacher?.classes?.name || '';
    formMasterStudentEditEnabled = !!school?.form_master_student_edit_enabled;

    if (!isFormMaster) {
      renderShell({ active: 'students', profile });
      document.getElementById('page-body').innerHTML = `
        <div class="panel">
          <p class="eyebrow">Student records</p>
          <h1 class="page-title">Students</h1>
          <div class="empty-state">Only Form Masters can access their class student records here.</div>
        </div>`;
      return;
    }
  }

  renderShell({ active: 'students', profile });
  await refreshStudentsView();
}

async function refreshStudentsView() {
  let classesQuery = supabaseClient
    .from('classes')
    .select('id, name')
    .eq('school_id', currentSchoolId)
    .order('name');

  if (isFormMaster && !isAdmin) {
    classesQuery = classesQuery.eq('id', formMasterClassId);
  }

  const [{ data: classes }, { data: students }, { data: teacherLinks }] = await Promise.all([
    classesQuery,
    (() => {
      let q = supabaseClient.from('students')
        .select('id, name, admission_no, guardian_email, guardian_phone, photo_url, photo_path, classes ( id, name )')
        .eq('school_id', currentSchoolId)
        .order('name');
      if (isFormMaster && !isAdmin) q = q.eq('class_id', formMasterClassId);
      return q;
    })(),
    isAdmin
      ? supabaseClient.from('teachers').select('name, form_master_class_id').not('form_master_class_id', 'is', null)
      : Promise.resolve({ data: formMasterClassId ? [{ name: currentProfile.name, form_master_class_id: formMasterClassId }] : [] }),
  ]);

  currentClasses = classes || [];
  currentStudents = students || [];

  const formMasterByClass = {};
  (teacherLinks || []).forEach((t) => {
    if (t.form_master_class_id) formMasterByClass[t.form_master_class_id] = t.name;
  });

  renderStudentsBody(currentClasses, currentStudents, formMasterByClass);
}

function studentRowHtml(s) {
  const canEdit = canManageStudents();
  const editButton = canEdit
    ? `<button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="startEditStudent(${s.id})">Edit</button>`
    : '';
  const removeButton = isAdmin
    ? `<button class="icon-btn" onclick="deleteStudent(${s.id})">Remove</button>`
    : '';

  return `
    <tr>
      <td>
        <span class="row-name">
          <span class="student-avatar">${studentPhotoDisplayUrl(s) ? `<img src="${studentPhotoDisplayUrl(s)}" alt="${s.name}">` : initials(s.name)}</span>
          ${s.name}
        </span>
      </td>
      <td class="text-muted">${s.admission_no || '&mdash;'}</td>
      <td class="text-muted">${s.guardian_email || '&mdash;'}</td>
      <td class="text-muted">${s.guardian_phone || '&mdash;'}</td>
      <td>${editButton}${removeButton || '<span class="text-muted">&mdash;</span>'}</td>
    </tr>`;
}

function classGroupHtml(className, formMasterName, students) {
  const teacherLine = formMasterName
    ? formMasterName
    : '<span class="text-muted">No form master assigned</span>';

  const rows = students.length
    ? students.map(studentRowHtml).join('')
    : `<tr><td colspan="5"><div class="empty-state">No students in this class yet.</div></td></tr>`;

  return `
    <div class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${students.length} student${students.length === 1 ? '' : 's'}</p>
          <h3 class="panel-title">${className}</h3>
        </div>
        <span class="text-muted" style="font-size:13.5px;">Form master: ${teacherLine}</span>
      </div>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Student</th><th>Admission no.</th><th>Guardian email</th><th>Guardian phone</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

function renderStudentsBody(classes, students, formMasterByClass) {
  const classOptions = classes.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const editingEnabled = canManageStudents();

  const groupsHtml = classes.map((c) => {
    const studentsInClass = students.filter((s) => s.classes?.id === c.id);
    const formMasterName = formMasterByClass[c.id] || null;
    return classGroupHtml(c.name, formMasterName, studentsInClass);
  }).join('');

  const unassigned = students.filter((s) => !s.classes?.id);
  const unassignedHtml = isAdmin && unassigned.length ? classGroupHtml('Unassigned', null, unassigned) : '';

  const noDataHtml = (!classes.length && !unassigned.length)
    ? `<div class="panel"><div class="empty-state">No students yet.</div></div>` : '';

  const adminControls = isAdmin ? `
    <button class="btn-gold" onclick="toggleForm('add-class-form')">+ Add class</button>
    <button class="btn-outline" onclick="toggleForm('import-csv-form')">Import from CSV</button>` : '';

  const addStudentButton = editingEnabled
    ? `<button class="btn-gold" onclick="toggleForm('add-student-form')">+ Add student</button>` : '';

  const formMasterNotice = isFormMaster && !isAdmin ? `
    <div style="margin-top:12px; padding:12px 14px; border-radius:10px; background:var(--gold-soft); color:var(--navy); font-size:13.5px;">
      <strong>Form Master:</strong> ${formMasterClassName || 'Your class'}.
      ${formMasterStudentEditEnabled
        ? 'Student adding and editing is currently enabled by the administrator. Student removal is not permitted.'
        : 'Student adding and editing is currently disabled by the administrator.'}
    </div>` : '';

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Class list &amp; roster</p>
    <h1 class="page-title">Students</h1>
    <p class="page-subtitle">${isFormMaster && !isAdmin ? `Your Form Master class: ${formMasterClassName || 'assigned class'}.` : 'Students are grouped by class, with the assigned teacher shown for each.'}</p>

    <div class="panel">
      <div class="panel-toolbar">
        ${adminControls}
        ${addStudentButton}
      </div>
      ${formMasterNotice}

      ${isAdmin ? `
      <div id="import-csv-form" class="form-panel">
        <p style="font-size:13.5px; margin-bottom:10px;">
          CSV with a header row: <code>name,admission_no,guardian_email,guardian_phone,class_name</code>.
          <code>class_name</code> must match an existing class name exactly (case-insensitive) or the student is added unassigned.
        </p>
        <input type="file" id="csv-file-input" accept=".csv">
        <button class="btn-gold" style="margin-top:10px;" onclick="handleCsvImport()">Import</button>
        <div id="csv-import-status" style="margin-top:10px; font-size:13.5px;"></div>
      </div>

      <div id="add-class-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="new-class-name">Class name</label>
            <input type="text" id="new-class-name" placeholder="e.g. JSS 1A">
          </div>
        </div>
        <button class="btn-gold" onclick="submitNewClass()">Save class</button>
      </div>` : ''}

      ${editingEnabled ? `
      <div id="add-student-form" class="form-panel">
        <div class="form-grid">
          <div class="field">
            <label for="new-student-name">Full name</label>
            <input type="text" id="new-student-name" placeholder="e.g. Amara Okafor">
          </div>
          <div class="field">
            <label for="new-student-admission-no">Admission no. (optional)</label>
            <input type="text" id="new-student-admission-no" placeholder="Leave blank to auto-assign, or enter manually" autocomplete="off">
            <small class="text-muted">A number you enter manually will be kept. Existing students' admission numbers are never changed by profile updates.</small>
          </div>
          <div class="field">
            <label for="new-student-class">Class</label>
            <select id="new-student-class" ${isFormMaster && !isAdmin ? 'disabled' : ''}>
              ${isFormMaster && !isAdmin
                ? `<option value="${formMasterClassId}">${formMasterClassName}</option>`
                : `<option value="">Unassigned</option>${classOptions}`}
            </select>
          </div>
          <div class="field">
            <label for="new-student-guardian">Guardian email</label>
            <input type="email" id="new-student-guardian" placeholder="Optional">
          </div>
          <div class="field">
            <label for="new-student-guardian-phone">Guardian WhatsApp number</label>
            <input type="text" id="new-student-guardian-phone" placeholder="e.g. 2348012345678">
          </div>
          <div class="field">
            <label for="new-student-photo">Photo (for ID card)</label>
            <input type="file" id="new-student-photo" accept="image/jpeg,image/png,image/webp">
            <p class="text-muted" style="font-size:12px; margin:4px 0 0;">To replace an existing photo, just choose a new file above.</p>
            <div id="new-student-photo-preview" style="margin-top:6px;"></div>
          </div>
        </div>
        <div id="student-photo-upload-status" style="font-size:13px; color: var(--text-muted); margin-bottom:8px;"></div>
        <button class="btn-gold" id="student-form-submit-btn" onclick="submitNewStudent()">Save student</button>
        <button class="btn-outline" onclick="closeStudentForm()">Cancel</button>
      </div>` : ''}

      <div id="form-error" class="error-banner"></div>
    </div>

    ${noDataHtml}
    ${groupsHtml}
    ${unassignedHtml}
  `;
}

function renderStudentPhotoPreview(student) {
  const url = student ? studentPhotoDisplayUrl(student) : null;
  const previewEl = document.getElementById('new-student-photo-preview');
  if (!previewEl) return;
  if (!url) { previewEl.innerHTML = ''; return; }
  previewEl.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <img src="${url}" alt="Current photo" style="width:48px; height:48px; object-fit:cover; border-radius:8px;">
      <button type="button" class="icon-btn" onclick="removeStudentPhoto(${student.id})">Remove photo</button>
    </div>
  `;
}

async function removeStudentPhoto(studentId) {
  if (!canManageStudents()) { showFormError('Student editing is currently disabled by the administrator.'); return; }
  if (!confirm('Remove this student\'s photo?')) return;
  const student = currentStudents.find((s) => s.id === studentId);
  if (!student) return;

  if (student.photo_path) {
    await supabaseClient.storage.from('student-photos').remove([student.photo_path]);
  }

  let query = supabaseClient.from('students')
    .update({ photo_path: null, photo_url: null })
    .eq('id', studentId);
  if (isFormMaster && !isAdmin) query = query.eq('class_id', formMasterClassId);

  const { error } = await query;
  if (error) { showFormError(error.message); return; }

  await refreshStudentsView();
  showSuccessToast('Photo removed');

  if (editingStudentId === studentId) {
    const preview = document.getElementById('new-student-photo-preview');
    if (preview) preview.innerHTML = '';
  }
}

function toggleForm(id) {
  if (id === 'add-student-form') {
    if (!canManageStudents()) return;
    editingStudentId = null;
    document.getElementById('new-student-name').value = '';
    document.getElementById('new-student-admission-no').value = '';
    document.getElementById('new-student-admission-no').readOnly = false;
    document.getElementById('new-student-class').value = isFormMaster && !isAdmin ? formMasterClassId : '';
    document.getElementById('new-student-guardian').value = '';
    document.getElementById('new-student-guardian-phone').value = '';
    document.getElementById('new-student-photo').value = '';
    document.getElementById('new-student-photo-preview').innerHTML = '';
    document.getElementById('student-form-submit-btn').textContent = 'Save student';
  }
  document.getElementById(id).classList.toggle('open');
}

function closeStudentForm() {
  editingStudentId = null;
  const form = document.getElementById('add-student-form');
  if (form) form.classList.remove('open');
}

function startEditStudent(id) {
  if (!canManageStudents()) {
    showFormError('Student editing is currently disabled by the administrator.');
    return;
  }

  const student = currentStudents.find((s) => s.id === id);
  if (!student) return;

  if (isFormMaster && !isAdmin && String(student.classes?.id) !== String(formMasterClassId)) {
    showFormError('You can only edit students in your Form Master class.');
    return;
  }

  editingStudentId = id;
  document.getElementById('new-student-name').value = student.name || '';
  document.getElementById('new-student-admission-no').value = student.admission_no || '';
  document.getElementById('new-student-admission-no').readOnly = true;
  document.getElementById('new-student-class').value = isFormMaster && !isAdmin ? formMasterClassId : (student.classes?.id || '');
  document.getElementById('new-student-guardian').value = student.guardian_email || '';
  document.getElementById('new-student-guardian-phone').value = student.guardian_phone || '';
  document.getElementById('new-student-photo').value = '';
  renderStudentPhotoPreview(student);
  document.getElementById('student-form-submit-btn').textContent = 'Update student';
  document.getElementById('add-student-form').classList.add('open');
  document.getElementById('add-student-form').scrollIntoView({ behavior: 'smooth' });
}

function showFormError(message) {
  const el = document.getElementById('form-error');
  if (!el) { alert(message); return; }
  el.textContent = message;
  el.classList.add('visible');
}

async function submitNewClass() {
  if (!isAdmin) { showFormError('Only an administrator can add classes.'); return; }
  const nameInput = document.getElementById('new-class-name');
  const name = nameInput.value.trim();
  if (!name) return;

  const { error } = await supabaseClient.from('classes').insert({ school_id: currentSchoolId, name });
  if (error) { showFormError(error.message); return; }

  nameInput.value = '';
  await refreshStudentsView();
  showSuccessToast('Class added');
}

async function submitNewStudent() {
  if (!canManageStudents()) {
    showFormError('Student adding/editing is currently disabled by the administrator.');
    return;
  }

  const name = document.getElementById('new-student-name').value.trim();
  const manualAdmissionNo = document.getElementById('new-student-admission-no').value.trim();
  const selectedClassId = document.getElementById('new-student-class').value || null;
  const classId = isFormMaster && !isAdmin ? formMasterClassId : selectedClassId;
  const guardianEmail = document.getElementById('new-student-guardian').value.trim();
  const guardianPhone = document.getElementById('new-student-guardian-phone').value.trim();
  const photoFile = document.getElementById('new-student-photo').files[0] || null;

  if (!name) { showFormError('Student name is required.'); return; }
  if (isFormMaster && !isAdmin && !classId) { showFormError('Your Form Master class could not be identified. Ask the administrator to check your assignment.'); return; }

  const payload = {
    name,
    class_id: classId,
    guardian_email: guardianEmail || null,
    guardian_phone: guardianPhone || null,
  };

  if (photoFile) {
    if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
      showFormError('Photo must be a JPEG, PNG, or WEBP image.');
      return;
    }

    const statusEl = document.getElementById('student-photo-upload-status');
    statusEl.textContent = 'Processing photo...';

    let compressedBlob;
    try {
      compressedBlob = await compressImageFile(photoFile);
    } catch (e) {
      statusEl.textContent = '';
      showFormError(e.message || 'Could not process that photo.');
      return;
    }

    const pathStem = (`student-${editingStudentId || Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const yearFolder = new Date().getFullYear();
    const newPath = `${currentSchoolId}/${yearFolder}/${pathStem}.jpg`;

    statusEl.textContent = 'Uploading photo...';
    const { error: uploadError } = await supabaseClient.storage
      .from('student-photos')
      .upload(newPath, compressedBlob, { upsert: true, contentType: 'image/jpeg' });

    if (uploadError) {
      statusEl.textContent = '';
      showFormError('Photo upload failed: ' + uploadError.message);
      return;
    }

    if (editingStudentId) {
      const existing = currentStudents.find((s) => s.id === editingStudentId);
      if (existing?.photo_path && existing.photo_path !== newPath) {
        await supabaseClient.storage.from('student-photos').remove([existing.photo_path]);
      }
    }

    payload.photo_path = newPath;
    statusEl.textContent = '';
  }

  let query;
  if (editingStudentId) {
    query = supabaseClient.from('students').update(payload).eq('id', editingStudentId);
    if (isFormMaster && !isAdmin) query = query.eq('class_id', formMasterClassId);
  } else {
    if (manualAdmissionNo) payload.admission_no = manualAdmissionNo;
    query = supabaseClient.from('students').insert({ school_id: currentSchoolId, ...payload });
  }

  const { error } = await query;
  if (error) { showFormError(error.message); return; }

  const wasEditing = !!editingStudentId;
  closeStudentForm();
  await refreshStudentsView();
  showSuccessToast(wasEditing ? 'Student updated' : 'Student saved');
}

async function deleteStudent(id) {
  if (!isAdmin) {
    showFormError('Form Masters cannot remove students.');
    return;
  }
  if (!confirm('Are you sure you want to remove this student? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('students').delete().eq('id', id);
  if (error) { showFormError(error.message); return; }
  await refreshStudentsView();
  showSuccessToast('Student removed');
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ''; });
    return row;
  });
}

async function handleCsvImport() {
  if (!isAdmin) { showFormError('Only an administrator can import students.'); return; }
  const statusEl = document.getElementById('csv-import-status');
  const fileInput = document.getElementById('csv-file-input');
  const file = fileInput.files[0];
  if (!file) { statusEl.textContent = 'Choose a CSV file first.'; return; }

  statusEl.textContent = 'Reading file...';
  const text = await file.text();
  const rows = parseCsv(text);

  if (!rows.length) { statusEl.textContent = 'No rows found in that file.'; return; }

  const classByName = {};
  currentClasses.forEach((c) => { classByName[c.name.toLowerCase()] = c.id; });

  const toInsert = [];
  let skipped = 0;
  let unmatchedClasses = new Set();

  rows.forEach((row) => {
    const name = row.name;
    if (!name) { skipped++; return; }
    const classId = row.class_name ? classByName[row.class_name.toLowerCase()] || null : null;
    if (row.class_name && !classId) unmatchedClasses.add(row.class_name);

    toInsert.push({
      school_id: currentSchoolId,
      name,
      admission_no: row.admission_no || null,
      guardian_email: row.guardian_email || null,
      guardian_phone: row.guardian_phone || null,
      class_id: classId,
    });
  });

  if (!toInsert.length) { statusEl.textContent = 'No valid rows to import (each row needs at least a name).'; return; }

  statusEl.textContent = `Importing ${toInsert.length} student(s)...`;
  const { error } = await supabaseClient.from('students').insert(toInsert);

  if (error) { statusEl.textContent = 'Import failed: ' + error.message; return; }

  let summary = `Imported ${toInsert.length} student(s).`;
  if (skipped) summary += ` Skipped ${skipped} row(s) with no name.`;
  if (unmatchedClasses.size) summary += ` Class name(s) not found (left unassigned): ${[...unmatchedClasses].join(', ')}.`;
  statusEl.textContent = summary;

  fileInput.value = '';
  await refreshStudentsView();
  showSuccessToast(summary);
}

loadStudentsPage();
