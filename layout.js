// ============================================================
// Shared dashboard shell: sidebar + topbar.
// Every dashboard page includes this after config.js, then calls
// renderShell({ active: 'overview', pendingCount: 0 }).
// ============================================================

// Resolves a student's photo to a public URL. Prefers the new
// path-based storage column (photo_path); falls back to the old
// full-URL column (photo_url) for records saved before that upgrade.
function studentPhotoDisplayUrl(student) {
  if (student.photo_path) {
    const { data } = supabaseClient.storage.from('student-photos').getPublicUrl(student.photo_path);
    return data.publicUrl;
  }
  return student.photo_url || null;
}

// A small toast that pops up bottom-center to confirm an action worked,
// then fades itself out. Call this after any successful save/update/delete
// anywhere in the app: showSuccessToast('Student saved').
function showSuccessToast(message) {
  let toast = document.getElementById('global-success-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-success-toast';
    toast.className = 'success-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('visible');
  // restart the animation even if a toast is already showing
  void toast.offsetWidth;
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.classList.remove('visible'); }, 2600);
}

const NAV_ITEMS = [
  { key: 'overview',        label: 'Overview',        href: 'overview.html',        icon: '&#9635;' },
  { key: 'results-queue',   label: 'Results queue',   href: 'results-queue.html',   icon: '&#9745;' },
  { key: 'result-template', label: 'Result template', href: 'result-template.html', icon: '&#128196;' },
  { key: 'students',        label: 'Students',        href: 'students.html',        icon: '&#128101;' },
  { key: 'promotion',       label: 'Promotion',       href: 'promotion.html',       icon: '&#9650;' },
  { key: 'id-cards',        label: 'ID Cards',        href: 'id-cards.html',        icon: '&#128100;' },
  { key: 'classes',         label: 'Classes',         href: 'classes.html',         icon: '&#127979;' },
  { key: 'subjects',        label: 'Subjects',        href: 'subjects.html',        icon: '&#128218;' },
  { key: 'academics',       label: 'Academics',       href: 'academics.html',       icon: '&#128214;' },
  { key: 'teachers',        label: 'Teachers',        href: 'teachers.html',        icon: '&#127891;' },
  { key: 'timetable',       label: 'Timetable',       href: 'timetable.html',       icon: '&#128197;' },
  { key: 'analytics',       label: 'Analytics',       href: 'analytics.html',       icon: '&#128200;' },
  { key: 'notifications',   label: 'Notifications',   href: 'notifications.html',   icon: '&#128276;' },
  { key: 'logins',          label: 'Logins',          href: 'logins.html',          icon: '&#128273;' },
  { key: 'school-setup',    label: 'School setup',    href: 'school-setup.html',    icon: '&#9881;' },
  { key: 'activity-log',    label: 'Activity log',    href: 'activity-log.html',    icon: '&#128203;' },
];

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Redirects to login.html if there is no active session.
// Returns { session, profile } on success.
async function requireSession() {
  if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
    return {
      session: { user: { id: 'dev-user' } },
      profile: {
        name: 'Amina Bello',
        role: 'admin',
        school_id: 0,
        schools: { name: 'S.A. Kiddies Academy (dev mode)' },
      },
    };
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('No session');
  }

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('name, role, school_id, schools ( name, logo_url )')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    console.error('Could not load profile', error);
    document.body.innerHTML = `
      <div style="max-width:480px;margin:60px auto;padding:24px;font-family:sans-serif;">
        <h2>Could not load your profile</h2>
        <p>You're signed in, but no profile record was found for this account.</p>
        <p style="color:#A33A3A;">${error ? error.message : 'No profile row for this user.'}</p>
        <p><a href="login.html">Back to sign in</a></p>
      </div>
    `;
    throw new Error('No profile');
  }

  return { session, profile };
}

function renderShell({ active, profile, pendingCount = 0 }) {
  const navHtml = NAV_ITEMS.map((item) => {
    const isActive = item.key === active;
    const badge = item.key === 'results-queue' && pendingCount > 0
      ? `<span class="badge">${pendingCount}</span>` : '';
    return `
      <li>
        <a href="${item.href}" class="${isActive ? 'active' : ''}">
          <span>${item.label}</span>${badge}
        </a>
      </li>`;
  }).join('');

  const schoolName = profile.schools?.name || 'Your school';
  const logoUrl = profile.schools?.logo_url || null;
  const bustedLogoUrl = logoUrl ? `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}cb=${Date.now()}` : null;
  const sidebarLogoHtml = bustedLogoUrl
    ? `<img src="${bustedLogoUrl}" alt="${schoolName}" class="sidebar-logo-img">`
    : `<div class="sidebar-logo">${initials(schoolName)}</div>`;

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app-shell" id="app-shell">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar">
        <div class="sidebar-header">
          ${sidebarLogoHtml}
          <div>
            <div class="school-name">${schoolName}</div>
            <div class="school-sub">Academy results</div>
          </div>
        </div>

        <div class="sidebar-section-label">Workspace</div>
        <ul class="nav-list">${navHtml}</ul>

        <div class="sidebar-footer">
          <button id="shell-signout-btn">Sign out</button>
        </div>
      </aside>

      <main class="main-content">
        <div class="topbar">
          <div style="display:flex; align-items:center; gap:12px;">
            <button id="shell-menu-toggle" class="menu-toggle-btn" aria-label="Menu">
              <span></span><span></span><span></span>
            </button>
            <h2 id="shell-page-heading"></h2>
          </div>
          <div class="avatar-badge">${initials(profile.name)}</div>
        </div>
        <div id="page-body"></div>
      </main>
    </div>
  `);

  const activeItem = NAV_ITEMS.find((i) => i.key === active);
  document.getElementById('shell-page-heading').textContent = activeItem ? activeItem.label : '';

  document.getElementById('shell-signout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  const appShell = document.getElementById('app-shell');
  document.getElementById('shell-menu-toggle').addEventListener('click', () => {
    appShell.classList.toggle('sidebar-open');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    appShell.classList.remove('sidebar-open');
  });
}
