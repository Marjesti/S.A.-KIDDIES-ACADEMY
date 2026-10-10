let promotionSchoolId = null;
let promotionProfile = null;
let promotionSessions = [];
let promotionClasses = [];
let selectedSourceClassId = null;
let promotionStudents = [];
let promotionResults = [];
let promotionDestinationClassId = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function numericAverage(values) {
  const valid = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)));
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + Number(v), 0) / valid.length;
}

function classOrderName(name) {
  const m = String(name || '').trim().toUpperCase().match(/^(?:JSS|SS|PRI-|NURSERY|PRE-NURSERY)\s*[- ]?(\d+)/);
  return m ? Number(m[1]) : 999;
}

function suggestedNextClass(sourceClass) {
  if (!sourceClass) return null;
  const name = String(sourceClass.name || '').trim().toUpperCase();
  let targetName = null;
  if (/^JSS\s*1$/.test(name)) targetName = 'JSS 2';
  else if (/^JSS\s*2$/.test(name)) targetName = 'JSS 3';
  else if (/^JSS\s*3$/.test(name)) targetName = 'SS 1';
  else if (/^SS\s*1$/.test(name)) targetName = 'SS 2';
  else if (/^SS\s*2$/.test(name)) targetName = 'SS 3';
  else if (/^PRI-?1$/.test(name)) targetName = 'PRI-2';
  else if (/^PRI-?2$/.test(name)) targetName = 'PRI-3';
  else if (/^PRI-?3$/.test(name)) targetName = 'PRI-4';
  else if (/^PRI-?4$/.test(name)) targetName = 'PRI-5';
  else if (/^NURSERY\s*ONE$/.test(name)) targetName = 'NURSERY TWO';
  const found = promotionClasses.find((c) => String(c.name).trim().toUpperCase() === targetName);
  return found || null;
}

async function loadPromotionPage() {
  const { profile } = await requireSession();
  if (profile.role !== 'admin') {
    document.body.innerHTML = '<div style="max-width:560px;margin:70px auto;padding:24px;font-family:sans-serif;"><h2>Administrator access required</h2><p>Promotion is controlled by the school administrator.</p><p><a href="teacher-dashboard.html">Back to dashboard</a></p></div>';
    return;
  }

  promotionProfile = profile;
  promotionSchoolId = profile.school_id;
  renderShell({ active: 'promotion', profile });
  await loadPromotionSetup();
}

async function loadPromotionSetup() {
  const [{ data: sessions, error: sessionError }, { data: classes, error: classError }] = await Promise.all([
    supabaseClient.from('academic_sessions').select('id, year_label, term, is_active, start_date, end_date').eq('school_id', promotionSchoolId).order('year_label', { ascending: false }).order('id', { ascending: false }),
    supabaseClient.from('classes').select('id, name, section').eq('school_id', promotionSchoolId).order('section').order('name'),
  ]);

  if (sessionError || classError) {
    showPromotionPageError((sessionError || classError).message);
    return;
  }
  promotionSessions = sessions || [];
  promotionClasses = classes || [];
  renderPromotionHome();
}

function showPromotionPageError(message) {
  document.getElementById('page-body').innerHTML = `<div class="panel"><div class="error-banner visible">${esc(message)}</div></div>`;
}

function renderPromotionHome() {
  const thirdTermSessions = promotionSessions.filter((s) => String(s.term).toLowerCase() === 'third term');
  const sourceSessions = thirdTermSessions.length ? thirdTermSessions : promotionSessions;
  const sessionOptions = sourceSessions.map((s) => `<option value="${s.id}">${esc(s.year_label)} &middot; ${esc(s.term)}</option>`).join('');
  const classOptions = promotionClasses.map((c) => `<option value="${c.id}">${esc(c.name)} &middot; ${esc(c.section || '')}</option>`).join('');

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">Academic progression</p>
    <h1 class="page-title">Promotion</h1>
    <p class="page-subtitle">Review class promotion with automatic recommendations. Results are never changed or deleted.</p>

    <div class="panel">
      <div style="padding:4px 0 16px;">
        <p class="eyebrow">Promotion rules</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:8px;">
          <div style="padding:12px;border-radius:10px;background:var(--gold-soft);"><strong>Above 35%</strong><br><span class="text-muted">Automatically recommended for promotion</span></div>
          <div style="padding:12px;border-radius:10px;background:#F4F5F7;"><strong>35% or below</strong><br><span class="text-muted">Administrator decision required</span></div>
          <div style="padding:12px;border-radius:10px;background:#F4F5F7;"><strong>Missing results</strong><br><span class="text-muted">Do not block promotion</span></div>
          <div style="padding:12px;border-radius:10px;background:#FDEDEC;"><strong>Unpublished results</strong><br><span class="text-muted">Block the class promotion</span></div>
        </div>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="promotion-source-session">Source term</label>
          <select id="promotion-source-session" onchange="updateDestinationSessions()">
            <option value="">Select source term</option>${sessionOptions}
          </select>
          <p class="text-muted" style="font-size:12px;margin-top:4px;">Promotion normally starts from Third Term.</p>
        </div>
        <div class="field">
          <label for="promotion-destination-session">Destination term</label>
          <select id="promotion-destination-session">
            <option value="">Select destination term</option>
          </select>
        </div>
        <div class="field">
          <label for="promotion-source-class">Class to promote</label>
          <select id="promotion-source-class" onchange="preparePromotionClass()">
            <option value="">Select class</option>${classOptions}
          </select>
        </div>
        <div class="field">
          <label for="promotion-destination-class">Default destination class</label>
          <select id="promotion-destination-class">
            <option value="">Select destination class</option>${classOptions}
          </select>
          <p class="text-muted" style="font-size:12px;margin-top:4px;">Students marked Promote use this class unless changed in the review table.</p>
        </div>
      </div>
      <div id="promotion-home-error" class="error-banner"></div>
      <button class="btn-gold" onclick="startPromotionReview()">Review promotion</button>
    </div>

    <div class="panel" style="margin-top:16px;">
      <p class="eyebrow">Safety</p>
      <p style="margin:6px 0 0;font-size:13.5px;">The system blocks only when an existing result is still unpublished. Missing subject entries remain flagged in the existing results workflow and do not stop this promotion review.</p>
    </div>
  `;
  updateDestinationSessions();
}

function updateDestinationSessions() {
  const sourceId = Number(document.getElementById('promotion-source-session')?.value || 0);
  const select = document.getElementById('promotion-destination-session');
  if (!select) return;
  const options = promotionSessions.filter((s) => s.id !== sourceId)
    .sort((a,b) => String(b.year_label).localeCompare(String(a.year_label)) || b.id - a.id)
    .map((s) => `<option value="${s.id}">${esc(s.year_label)} &middot; ${esc(s.term)}${s.is_active ? ' (Active)' : ''}</option>`).join('');
  select.innerHTML = `<option value="">Select destination term</option>${options}`;
}

function preparePromotionClass() {
  const sourceId = Number(document.getElementById('promotion-source-class').value || 0);
  const source = promotionClasses.find((c) => c.id === sourceId);
  const suggested = suggestedNextClass(source);
  const destination = document.getElementById('promotion-destination-class');
  if (suggested) destination.value = String(suggested.id);
}

function setPromotionError(message) {
  const el = document.getElementById('promotion-home-error');
  if (el) { el.textContent = message; el.classList.add('visible'); }
}

async function startPromotionReview() {
  const sourceSessionId = Number(document.getElementById('promotion-source-session').value || 0);
  const destinationSessionId = Number(document.getElementById('promotion-destination-session').value || 0);
  const sourceClassId = Number(document.getElementById('promotion-source-class').value || 0);
  const destinationClassId = Number(document.getElementById('promotion-destination-class').value || 0) || null;
  if (!sourceSessionId || !destinationSessionId || !sourceClassId) { setPromotionError('Select the source term, destination term and source class.'); return; }
  if (!destinationClassId) { setPromotionError('Select a default destination class.'); return; }

  selectedSourceClassId = sourceClassId;
  promotionDestinationClassId = destinationClassId;

  const [{ data: students, error: studentError }, { data: results, error: resultError }] = await Promise.all([
    supabaseClient.from('students').select('id, name, admission_no, class_id').eq('school_id', promotionSchoolId).eq('class_id', sourceClassId).order('name'),
    supabaseClient.from('results').select('student_id, total_score, status, subject_id').eq('school_id', promotionSchoolId).eq('session_id', sourceSessionId),
  ]);
  if (studentError || resultError) { setPromotionError((studentError || resultError).message); return; }
  promotionStudents = students || [];
  promotionResults = results || [];

  const unpublished = promotionResults.filter((r) => r.status !== 'published');
  if (unpublished.length) {
    document.getElementById('page-body').innerHTML += `<div class="panel" style="margin-top:16px;"><div class="error-banner visible"><strong>Promotion blocked.</strong> ${unpublished.length} existing result record${unpublished.length === 1 ? '' : 's'} for this class are not published yet. Publish them from <a href="results-queue.html">Results queue</a> and return here.</div></div>`;
    return;
  }

  renderPromotionReview(sourceSessionId, destinationSessionId, sourceClassId, destinationClassId);
}

function averageForStudent(studentId) {
  return numericAverage(promotionResults.filter((r) => r.student_id === studentId && r.status === 'published').map((r) => r.total_score));
}

function renderPromotionReview(sourceSessionId, destinationSessionId, sourceClassId, defaultDestinationClassId) {
  const source = promotionClasses.find((c) => c.id === sourceClassId);
  const destination = promotionClasses.find((c) => c.id === defaultDestinationClassId);
  const sourceSession = promotionSessions.find((s) => s.id === sourceSessionId);
  const destinationSession = promotionSessions.find((s) => s.id === destinationSessionId);
  const destinationOptions = promotionClasses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const rows = promotionStudents.map((student) => {
    const avg = averageForStudent(student.id);
    const auto = avg !== null && avg > 35;
    const recommendation = avg === null ? 'No published results' : auto ? 'Auto-promote' : 'Manual review';
    const decision = auto ? 'promote' : 'hold';
    const selectedDestination = auto ? defaultDestinationClassId : sourceClassId;
    return `
      <tr data-student-row="${student.id}">
        <td><strong>${esc(student.name)}</strong><br><span class="text-muted">${esc(student.admission_no || 'No admission no.')}</span></td>
        <td>${avg === null ? '&mdash;' : avg.toFixed(2) + '%'}</td>
        <td><span class="status-badge ${auto ? 'active-status' : ''}">${recommendation}</span></td>
        <td>
          <select data-decision="${student.id}" onchange="togglePromotionDestination(${student.id})">
            <option value="promote" ${decision === 'promote' ? 'selected' : ''}>Promote</option>
            <option value="repeat" ${decision === 'repeat' ? 'selected' : ''}>Repeat class</option>
            <option value="hold" ${decision === 'hold' ? 'selected' : ''}>Hold</option>
          </select>
        </td>
        <td>
          <select data-destination="${student.id}" ${decision !== 'promote' ? 'disabled' : ''}>
            ${destinationOptions.replace(`value="${selectedDestination}"`, `value="${selectedDestination}" selected`)}
          </select>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${esc(sourceSession?.year_label)} &middot; ${esc(sourceSession?.term)} &rarr; ${esc(destinationSession?.year_label)} &middot; ${esc(destinationSession?.term)}</p>
    <h1 class="page-title">Promotion review: ${esc(source?.name)}</h1>
    <p class="page-subtitle">Default destination: <strong>${esc(destination?.name || 'Not selected')}</strong>. Students above 35% are pre-selected for automatic promotion; 35% or below requires an administrator decision.</p>

    <div class="panel">
      <div class="panel-toolbar">
        <span class="text-muted">${promotionStudents.length} student${promotionStudents.length === 1 ? '' : 's'} in class</span>
        <button class="btn-outline" onclick="renderPromotionHome()">Change class</button>
      </div>
      <div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Student</th><th>Average</th><th>Recommendation</th><th>Admin decision</th><th>Destination class</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><div class="empty-state">No students in this class.</div></td></tr>`}</tbody>
      </table></div>
      <div id="promotion-review-error" class="error-banner"></div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-gold" onclick="confirmPromotion(${sourceSessionId}, ${destinationSessionId}, ${sourceClassId}, ${defaultDestinationClassId})">Confirm promotion</button>
        <button class="btn-outline" onclick="renderPromotionHome()">Cancel</button>
      </div>
    </div>
  `;
}

function togglePromotionDestination(studentId) {
  const decision = document.querySelector(`[data-decision="${studentId}"]`)?.value;
  const destination = document.querySelector(`[data-destination="${studentId}"]`);
  if (destination) destination.disabled = decision !== 'promote';
}

async function confirmPromotion(sourceSessionId, destinationSessionId, sourceClassId, defaultDestinationClassId) {
  const rows = promotionStudents.map((student) => {
    const decision = document.querySelector(`[data-decision="${student.id}"]`)?.value;
    const destination = document.querySelector(`[data-destination="${student.id}"]`)?.value;
    const avg = averageForStudent(student.id);
    return {
      student_id: student.id,
      destination_class_id: decision === 'promote' ? Number(destination || defaultDestinationClassId) : sourceClassId,
      decision,
      reason: avg !== null && avg > 35 ? 'Average above 35% — automatic promotion recommendation.' : 'Average at or below 35% — administrator decision.',
    };
  });

  if (!rows.length) return;
  const manualCount = rows.filter((r) => r.decision !== 'promote').length;
  const promotedCount = rows.filter((r) => r.decision === 'promote').length;
  if (!confirm(`Confirm this promotion batch?\n\n${promotedCount} student(s) will be promoted.\n${manualCount} student(s) will remain/hold according to the selected decisions.\n\nExisting results will not be changed.`)) return;

  const errorEl = document.getElementById('promotion-review-error');
  errorEl.classList.remove('visible');
  const button = document.querySelector('.btn-gold');
  if (button) { button.disabled = true; button.textContent = 'Processing…'; }

  const { data, error } = await supabaseClient.rpc('execute_promotion_batch', {
    p_source_session_id: sourceSessionId,
    p_destination_session_id: destinationSessionId,
    p_source_class_id: sourceClassId,
    p_destination_class_id: defaultDestinationClassId,
    p_decisions: rows,
  });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.add('visible');
    if (button) { button.disabled = false; button.textContent = 'Confirm promotion'; }
    return;
  }

  document.getElementById('page-body').innerHTML = `
    <div class="panel" style="text-align:center;padding:34px 20px;">
      <div style="font-size:40px;margin-bottom:10px;">✓</div>
      <h2 style="margin:0 0 8px;">Promotion completed</h2>
      <p class="text-muted">Batch #${esc(data)} was recorded successfully. Historical results remain untouched, and the current student class placements have been updated.</p>
      <div style="margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
        <button class="btn-gold" onclick="renderPromotionHome()">Start another promotion</button>
        <a class="btn-outline" href="students.html" style="text-decoration:none;display:inline-flex;align-items:center;">View students</a>
      </div>
    </div>`;
  showSuccessToast('Promotion completed');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPromotionPage);
else loadPromotionPage();
