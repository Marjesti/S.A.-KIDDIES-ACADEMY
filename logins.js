let currentSchoolId = null;
let currentTeachersList = [];
let currentStudentsList = [];
let currentParentLogins = [];
let selectedChildIds = [];
let editingParentLoginEmail = null;

// A separate, non-persisting Supabase client used ONLY to create new
// login accounts. Using signUp() on the normal supabaseClient would
// log the admin out and log in as the new account instead -- this
// temporary client keeps that from ever touching the admin's session.
const tempAuthClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'rms-temp-account-creation',
  },
});

async function loadLoginsPage() {
  const { profile } = await requireSession();
  renderShell({ active: 'logins', profile });
  currentSchoolId = profile.school_id;

  const [{ data: teachers }, { data: students }, { data: logins }, { data: links }] = await Promise.all([
    supabaseClient.from('teachers').select('id, name, profile_id').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('students').select('id, name, admission_no').eq('school_id', currentSchoolId).order('name'),
    supabaseClient.from('parent_logins').select('id, email').eq('school_id', currentSchoolId).order('email'),
    supabaseClient.from('parent_login_students').select('parent_login_id, student_id, students ( id, name )'),
  ]);

  currentTeachersList = teachers || [];
  currentStudentsList = students || [];

  const childrenByLogin = {};
  (links || []).forEach((l) => {
    if (!childrenByLogin[l.parent_login_id]) childrenByLogin[l.parent_login_id] = [];
    if (l.students) childrenByLogin[l.parent_login_id].push(l.students);
  });
  currentParentLogins = (logins || []).map((l) => ({ ...l, children: childrenByLogin[l.id] || [] }));

  renderLoginsBody();
}

function renderLoginsBody() {
  const unlinkedTeachers = currentTeachersList.filter((t) => !t.profile_id);
  const teacherOptions = unlinkedTeachers.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Access management</p>
    <h1 class="page-title">Logins</h1>
    <p class="page-subtitle">Give teachers, admins, and parents the access they need. Parents can also still verify a single result via QR code without any login.</p>

    <div class="panel">
      <p class="eyebrow">Staff</p>
      <h3 class="panel-title">Give a teacher login access</h3>
      <p class="text-muted" style="font-size:13.5px;">A teacher only sees the subjects and classes assigned to them on the Teachers page — set those up first if you haven't already.</p>
      ${unlinkedTeachers.length ? `
        <div class="form-grid">
          <div class="field">
            <label for="teacher-account-select">Teacher</label>
            <select id="teacher-account-select">${teacherOptions}</select>
          </div>
          <div class="field">
            <label for="teacher-account-email">Login email</label>
            <input type="email" id="teacher-account-email" placeholder="teacher@school.edu.ng">
          </div>
          <div class="field">
            <label for="teacher-account-password">Temporary password</label>
            <input type="text" id="teacher-account-password" placeholder="At least 8 characters">
          </div>
        </div>
        <button class="btn-gold" onclick="createTeacherAccount()">Create teacher login</button>
      ` : `<p class="text-muted" style="font-size:14px;">Every teacher already has a login, or none exist yet — add teachers on the Teachers page first.</p>`}
      <div id="teacher-account-error" class="error-banner"></div>
      <div id="teacher-account-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>

    <div class="panel">
      <p class="eyebrow">Parents</p>
      <h3 class="panel-title">${editingParentLoginEmail ? `Editing login: ${editingParentLoginEmail}` : 'Create a parent login'}</h3>
      <p class="text-muted" style="font-size:13.5px;">Link one or more children to a single login (useful for siblings), and set the parent's email and PIN yourself.</p>

      <div class="field">
        <label for="parent-child-search">Search a child by name</label>
        <input type="text" id="parent-child-search" placeholder="Type a name..." oninput="renderParentChildSearchResults()">
        <div id="parent-child-search-results" style="max-height:180px; overflow-y:auto; margin-top:8px;"></div>
      </div>

      <div id="parent-selected-children" style="display:flex; flex-wrap:wrap; gap:8px; margin:10px 0;">${selectedChildrenChipsHtml()}</div>

      <div class="form-grid">
        <div class="field">
          <label for="parent-account-email">Email address</label>
          <input type="email" id="parent-account-email" placeholder="e.g. parent@example.com">
        </div>
        <div class="field">
          <label for="parent-account-pin">6-digit PIN</label>
          <input type="text" id="parent-account-pin" inputmode="numeric" maxlength="6" placeholder="e.g. 482913">
        </div>
      </div>
      <button class="btn-gold" onclick="saveParentLogin()">${editingParentLoginEmail ? 'Save changes' : 'Create parent login'}</button>
      ${editingParentLoginEmail ? `<button class="btn-outline" onclick="cancelEditParentLogin()">Cancel</button>
      <p class="text-muted" style="font-size:12.5px; margin-top:6px;">PINs can't be retrieved once set, so saving changes to this login always sets a new PIN.</p>` : ''}
      <div id="parent-account-error" class="error-banner"></div>
      <div id="parent-account-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>

      ${currentParentLogins.length ? `
        <p class="eyebrow" style="margin-top:24px;">Existing parent logins</p>
        <div class="data-table-wrap"><table class="data-table">
          <thead><tr><th>Email</th><th>Children</th><th></th></tr></thead>
          <tbody>
            ${currentParentLogins.map((l) => `
              <tr>
                <td>${l.email}</td>
                <td class="text-muted">${l.children.map((c) => c.name).join(', ') || '&mdash;'}</td>
                <td>
                  <button class="icon-btn" style="color: var(--navy); margin-right:14px;" onclick="startEditParentLogin(${l.id})">Edit</button>
                  <button class="icon-btn" onclick="deleteParentLogin(${l.id})">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      ` : ''}
    </div>

    <div class="panel">
      <p class="eyebrow">Admins</p>
      <h3 class="panel-title">Give another admin login access</h3>
      <p class="text-muted" style="font-size:13.5px;">An admin has full access to everything — only add people you fully trust with the whole school's data.</p>
      <div class="form-grid">
        <div class="field">
          <label for="admin-account-name">Full name</label>
          <input type="text" id="admin-account-name" placeholder="e.g. Mrs. Adaeze Nwosu">
        </div>
        <div class="field">
          <label for="admin-account-email">Login email</label>
          <input type="email" id="admin-account-email" placeholder="admin@school.edu.ng">
        </div>
        <div class="field">
          <label for="admin-account-password">Temporary password</label>
          <input type="text" id="admin-account-password" placeholder="At least 8 characters">
        </div>
      </div>
      <button class="btn-gold" onclick="createAdminAccount()">Create admin login</button>
      <div id="admin-account-error" class="error-banner"></div>
      <div id="admin-account-success" class="error-banner" style="background:#E8F3EA; color:#3A7D44;"></div>
    </div>
  `;
}

function selectedChildrenChipsHtml() {
  if (!selectedChildIds.length) return '<span class="text-muted" style="font-size:13px;">No children selected yet.</span>';
  return selectedChildIds.map((id) => {
    const child = currentStudentsList.find((s) => s.id === id);
    return `<span style="background:var(--cream); border-radius:999px; padding:5px 10px; font-size:13px; display:inline-flex; align-items:center; gap:6px;">
      ${child ? child.name : 'Unknown'}
      <a href="#" onclick="event.preventDefault(); removeSelectedChild(${id});" style="color:#A33A3A; font-weight:700;">&times;</a>
    </span>`;
  }).join('');
}

function renderSelectedChildrenChips() {
  document.getElementById('parent-selected-children').innerHTML = selectedChildrenChipsHtml();
}

function renderParentChildSearchResults() {
  const query = document.getElementById('parent-child-search').value.trim().toLowerCase();
  const resultsEl = document.getElementById('parent-child-search-results');
  if (!query) { resultsEl.innerHTML = ''; return; }

  const matches = currentStudentsList
    .filter((s) => !selectedChildIds.includes(s.id))
    .filter((s) => s.name.toLowerCase().includes(query))
    .slice(0, 10);

  resultsEl.innerHTML = matches.length ? matches.map((s) => `
    <div class="queue-row" style="cursor:pointer;" onclick="addSelectedChild(${s.id})">
      <span>${s.name}</span>
      <span class="text-muted">${s.admission_no || ''}</span>
    </div>
  `).join('') : `<div class="empty-state">No matching students.</div>`;
}

function addSelectedChild(studentId) {
  if (!selectedChildIds.includes(studentId)) selectedChildIds.push(studentId);
  document.getElementById('parent-child-search').value = '';
  document.getElementById('parent-child-search-results').innerHTML = '';
  renderSelectedChildrenChips();
}

function removeSelectedChild(studentId) {
  selectedChildIds = selectedChildIds.filter((id) => id !== studentId);
  renderSelectedChildrenChips();
}

function startEditParentLogin(loginId) {
  const login = currentParentLogins.find((l) => l.id === loginId);
  if (!login) return;
  editingParentLoginEmail = login.email;
  selectedChildIds = login.children.map((c) => c.id);
  renderLoginsBody();
  document.getElementById('parent-account-email').value = login.email;
  document.getElementById('parent-account-pin').value = '';
  document.getElementById('parent-account-pin').placeholder = 'Enter a new 6-digit PIN to save changes';
}

function cancelEditParentLogin() {
  editingParentLoginEmail = null;
  selectedChildIds = [];
  renderLoginsBody();
}

async function saveParentLogin() {
  const email = document.getElementById('parent-account-email').value.trim();
  const pin = document.getElementById('parent-account-pin').value.trim();

  if (!email) { showError('parent-account-error', 'Enter an email address.'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError('parent-account-error', 'Enter a valid email address.'); return; }
  if (!/^\d{6}$/.test(pin)) { showError('parent-account-error', 'PIN must be exactly 6 digits.'); return; }
  if (!selectedChildIds.length) { showError('parent-account-error', 'Select at least one child to link.'); return; }

  const { error } = await supabaseClient.rpc('upsert_parent_login', {
    p_email: email,
    p_pin: pin,
    p_student_ids: selectedChildIds,
  });

  if (error) { showError('parent-account-error', error.message); return; }

  showSuccess('parent-account-success', `Parent login "${email}" saved. Share the email and PIN with the parent directly.`);
  editingParentLoginEmail = null;
  selectedChildIds = [];
  await loadLoginsPage();
}

async function deleteParentLogin(loginId) {
  if (!confirm('Remove this parent login? The parent will no longer be able to sign in with it.')) return;
  const { error } = await supabaseClient.from('parent_logins').delete().eq('id', loginId);
  if (error) { alert('Could not remove this login: ' + error.message); return; }
  await loadLoginsPage();
}

function showError(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.classList.add('visible');
}
function showSuccess(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.classList.add('visible');
}

async function createTeacherAccount() {
  const teacherId = document.getElementById('teacher-account-select').value;
  const email = document.getElementById('teacher-account-email').value.trim();
  const password = document.getElementById('teacher-account-password').value;

  if (!teacherId || !email || !password) { showError('teacher-account-error', 'All fields are required.'); return; }
  if (password.length < 8) { showError('teacher-account-error', 'Password must be at least 8 characters.'); return; }

  const teacher = currentTeachersList.find((t) => String(t.id) === String(teacherId));

  const { data: signUpData, error: signUpError } = await tempAuthClient.auth.signUp({ email, password });
  if (signUpError) { showError('teacher-account-error', signUpError.message); return; }
  if (!signUpData.user) { showError('teacher-account-error', 'Could not create the login. Check that email confirmation is off in Supabase.'); return; }

  const { error: profileError } = await supabaseClient.from('profiles').insert({
    id: signUpData.user.id, school_id: currentSchoolId, name: teacher.name, role: 'teacher',
  });
  if (profileError) { showError('teacher-account-error', profileError.message); return; }

  const { error: linkError } = await supabaseClient.from('teachers').update({ profile_id: signUpData.user.id }).eq('id', teacherId);
  if (linkError) { showError('teacher-account-error', linkError.message); return; }

  showSuccess('teacher-account-success', `Login created for ${teacher.name}. Share the email and password with them directly.`);
  await loadLoginsPage();
  showSuccessToast('Teacher login created');
}

async function createAdminAccount() {
  const name = document.getElementById('admin-account-name').value.trim();
  const email = document.getElementById('admin-account-email').value.trim();
  const password = document.getElementById('admin-account-password').value;

  if (!name || !email || !password) { showError('admin-account-error', 'All fields are required.'); return; }
  if (password.length < 8) { showError('admin-account-error', 'Password must be at least 8 characters.'); return; }

  const { data: signUpData, error: signUpError } = await tempAuthClient.auth.signUp({ email, password });
  if (signUpError) { showError('admin-account-error', signUpError.message); return; }
  if (!signUpData.user) { showError('admin-account-error', 'Could not create the login. Check that email confirmation is off in Supabase.'); return; }

  const { error: profileError } = await supabaseClient.from('profiles').insert({
    id: signUpData.user.id, school_id: currentSchoolId, name, role: 'admin',
  });
  if (profileError) { showError('admin-account-error', profileError.message); return; }

  showSuccess('admin-account-success', `Admin login created for ${name}. Share the email and password with them directly.`);
  showSuccessToast('Admin login created');
  document.getElementById('admin-account-name').value = '';
  document.getElementById('admin-account-email').value = '';
  document.getElementById('admin-account-password').value = '';
}

loadLoginsPage();
