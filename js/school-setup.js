let currentSchoolId = null;
let currentProfile = null;

async function loadSchoolSetupPage() {
  const { profile } = await requireSession();
  currentProfile = profile;
  renderShell({ active: 'school-setup', profile });
  currentSchoolId = profile.school_id;

  const { data: school } = await supabaseClient
    .from('schools')
    .select('name, address, phone, logo_url, principal_signature_url, headteacher_signature_url, form_master_student_edit_enabled')
    .eq('id', currentSchoolId)
    .single();

  renderSchoolSetupBody(school || {});
}

function renderSchoolSetupBody(school) {
  const isAdmin = currentProfile?.role === 'admin';

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">School profile</p>
    <h1 class="page-title">School setup</h1>
    <p class="page-subtitle">This information appears on printed report cards.</p>

    <div class="panel">
      <div class="form-grid">
        <div class="field">
          <label for="school-name">School name</label>
          <input type="text" id="school-name" value="${school.name || ''}" ${isAdmin ? '' : 'disabled'}>
        </div>
        <div class="field">
          <label for="school-phone">Phone</label>
          <input type="text" id="school-phone" value="${school.phone || ''}" placeholder="e.g. 0706 749 3313" ${isAdmin ? '' : 'disabled'}>
        </div>
      </div>
      <div class="field">
        <label for="school-address">Address</label>
        <input type="text" id="school-address" value="${school.address || ''}" placeholder="e.g. Darmanawa, Rayhaan Street, Behind AKTH, Kano State" ${isAdmin ? '' : 'disabled'}>
      </div>
      <div class="field">
        <label for="school-logo">Logo URL (optional)</label>
        <input type="text" id="school-logo" value="${school.logo_url || ''}" placeholder="https://..." ${isAdmin ? '' : 'disabled'}>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="principal-signature-url">Principal signature image URL (optional)</label>
          <input type="url" id="principal-signature-url" value="${school.principal_signature_url || ''}" placeholder="https://.../principal.png" ${isAdmin ? '' : 'disabled'}>
          <small class="text-muted">Paste a direct URL to your preferred transparent PNG. This is saved for future use; signatures are currently omitted from report cards.</small>
        </div>
        <div class="field">
          <label for="headteacher-signature-url">Headteacher signature image URL (optional)</label>
          <input type="url" id="headteacher-signature-url" value="${school.headteacher_signature_url || ''}" placeholder="https://.../headteacher.png" ${isAdmin ? '' : 'disabled'}>
          <small class="text-muted">Paste a direct URL to your preferred transparent PNG. This is saved for future use; signatures are currently omitted from report cards.</small>
        </div>
      </div>
      ${isAdmin ? `
        <button class="btn-gold" onclick="saveSchoolSetup()">Save school profile</button>
      ` : ''}
      <div id="form-error" class="error-banner"></div>
      <div id="form-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>

    ${isAdmin ? `
    <div class="panel" style="margin-top:16px;">
      <p class="eyebrow">Permissions</p>
      <h3 class="panel-title">Form Master student management</h3>
      <p class="text-muted" style="font-size:13.5px; line-height:1.6;">
        When enabled, Form Masters can add and edit students in their assigned Form Master class.
        They can never remove students. You can turn this permission off at any time.
      </p>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0;">
        <div>
          <strong id="fm-permission-status">${school.form_master_student_edit_enabled ? 'Enabled' : 'Disabled'}</strong>
          <div class="text-muted" style="font-size:12.5px; margin-top:3px;">Applies immediately to Form Master accounts.</div>
        </div>
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700;">
          <input type="checkbox" id="form-master-student-edit-toggle" ${school.form_master_student_edit_enabled ? 'checked' : ''} onchange="toggleFormMasterStudentEditing(this.checked)">
          Allow Form Masters to add/edit students
        </label>
      </div>

      <div id="fm-permission-error" class="error-banner"></div>
      <div id="fm-permission-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>
    ` : ''}
  `;
}

async function saveSchoolSetup() {
  if (currentProfile?.role !== 'admin') return;

  const name = document.getElementById('school-name').value.trim();
  const address = document.getElementById('school-address').value.trim();
  const phone = document.getElementById('school-phone').value.trim();
  const logoUrl = document.getElementById('school-logo').value.trim();
  const principalSignatureUrl = document.getElementById('principal-signature-url').value.trim();
  const headteacherSignatureUrl = document.getElementById('headteacher-signature-url').value.trim();

  const { error } = await supabaseClient.from('schools').update({
    name, address: address || null, phone: phone || null, logo_url: logoUrl || null,
    principal_signature_url: principalSignatureUrl || null,
    headteacher_signature_url: headteacherSignatureUrl || null,
  }).eq('id', currentSchoolId);

  const errEl = document.getElementById('form-error');
  const okEl = document.getElementById('form-success');
  errEl.classList.remove('visible'); okEl.classList.remove('visible');

  if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }
  okEl.textContent = 'School profile saved.'; okEl.classList.add('visible');
  showSuccessToast('School settings saved');
}

async function toggleFormMasterStudentEditing(enabled) {
  if (currentProfile?.role !== 'admin') return;

  const toggle = document.getElementById('form-master-student-edit-toggle');
  const statusEl = document.getElementById('fm-permission-status');
  const errEl = document.getElementById('fm-permission-error');
  const okEl = document.getElementById('fm-permission-success');
  errEl.classList.remove('visible'); okEl.classList.remove('visible');

  toggle.disabled = true;

  const { error } = await supabaseClient
    .from('schools')
    .update({ form_master_student_edit_enabled: !!enabled })
    .eq('id', currentSchoolId);

  toggle.disabled = false;

  if (error) {
    toggle.checked = !enabled;
    errEl.textContent = 'Could not change this permission: ' + error.message;
    errEl.classList.add('visible');
    return;
  }

  statusEl.textContent = enabled ? 'Enabled' : 'Disabled';
  okEl.textContent = enabled
    ? 'Form Masters can now add and edit students in their own class.'
    : 'Form Master student editing has been turned off.';
  okEl.classList.add('visible');
  showSuccessToast(enabled ? 'Form Master student editing enabled' : 'Form Master student editing disabled');
}

loadSchoolSetupPage();
