async function loadSchoolBrandingLogo() {
  const el = document.getElementById('school-brand-logo');
  if (!el) return;
  try {
    const { data, error } = await supabaseClient.rpc('get_school_branding');
    const school = Array.isArray(data) ? data[0] : data;
    if (!error && school && school.logo_url) {
      const busted = `${school.logo_url}${school.logo_url.includes('?') ? '&' : '?'}cb=${Date.now()}`;
      el.innerHTML = `<img src="${busted}" alt="${school.name || 'School logo'}" class="school-brand-logo-img">`;
    }
  } catch (e) {
    // Fails silently -- the "Powered by" footer logo is always there regardless.
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.classList.add('visible');
}

function clearError() {
  const banner = document.getElementById('error-banner');
  banner.textContent = '';
  banner.classList.remove('visible');
}

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function handleRegister(event) {
  event.preventDefault();
  clearError();
  const button = document.getElementById('submit-btn');
  button.disabled = true;
  button.textContent = 'Creating your workspace...';

  const schoolName = document.getElementById('schoolName').value.trim();
  const adminName = document.getElementById('adminName').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    // 1. Create the login (Supabase Auth handles the password securely)
    const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
      email,
      password,
    });
    if (signUpError) throw new Error(signUpError.message);

    const userId = signUpData.user?.id;
    const hasSession = !!signUpData.session;
    if (!userId || !hasSession) {
      throw new Error(
        'Your account was created, but email confirmation is still turned on in ' +
        'Supabase, so there is no active session yet to create the school with. ' +
        'Go to Supabase -> Authentication -> Providers -> Email and turn off ' +
        '"Confirm email", delete this user under Authentication -> Users, then try again.'
      );
    }

    // 2. Create the school (created_by lets us read it back immediately,
    //    before the profile linking us to it exists yet)
    const slug = slugify(schoolName) + '-' + Math.floor(Math.random() * 10000);
    const { data: school, error: schoolError } = await supabaseClient
      .from('schools')
      .insert({ name: schoolName, slug, created_by: userId })
      .select()
      .single();
    if (schoolError) throw new Error(schoolError.message);

    // 3. Create the profile linking this user to the school as admin
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .insert({ id: userId, school_id: school.id, name: adminName, role: 'admin' });
    if (profileError) throw new Error(profileError.message);

    window.location.href = 'overview.html';
  } catch (err) {
    showError(err.message);
    button.disabled = false;
    button.textContent = 'Create workspace';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearError();
  const button = document.getElementById('submit-btn');
  button.disabled = true;
  button.textContent = 'Signing in...';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const { data: profile } = await supabaseClient
      .from('profiles').select('role').eq('id', data.user.id).single();

    window.location.href = profile?.role === 'teacher' ? 'teacher-dashboard.html' : 'overview.html';
  } catch (err) {
    showError(err.message);
    button.disabled = false;
    button.textContent = 'Sign in';
  }
}
