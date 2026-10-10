let currentSchoolId = null;
let schoolInfo = {};
let activeSession = null;
let currentClasses = [];
let selectedClassId = null;
let classStudents = [];
let classResults = [];
let classNotes = [];

function gradeFor(total) {
  if (total === null || total === undefined) return '';
  if (total >= 90) return 'A+';
  if (total >= 80) return 'A';
  if (total >= 75) return 'B2';
  if (total >= 70) return 'B3';
  if (total >= 65) return 'C4';
  if (total >= 60) return 'C5';
  if (total >= 50) return 'C6';
  if (total >= 40) return 'D7';
  if (total >= 30) return 'E8';
  return 'F9';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function loadResultTemplatePage() {
  const { profile } = await requireSession();
  renderShell({ active: 'result-template', profile });
  currentSchoolId = profile.school_id;

  const [{ data: school }, { data: session }, { data: classes }] = await Promise.all([
    supabaseClient.from('schools').select('name, address, phone, logo_url, principal_signature_url, headteacher_signature_url').eq('id', currentSchoolId).single(),
    supabaseClient.from('academic_sessions').select('id, year_label, term').eq('school_id', currentSchoolId).eq('is_active', true).maybeSingle(),
    supabaseClient.from('classes').select('id, name, section').eq('school_id', currentSchoolId).order('name'),
  ]);
  schoolInfo = school || {};
  activeSession = session;
  currentClasses = classes || [];

  renderPageShell();
}

function renderPageShell() {
  if (!activeSession) {
    document.getElementById('page-body').innerHTML = `
      <p class="page-date">Result template</p>
      <h1 class="page-title">Result template</h1>
      <div class="panel"><div class="empty-state">No active academic session is set. Go to <a href="academics.html">Academics</a> first.</div></div>
    `;
    return;
  }

  const classOptions = currentClasses.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

  document.getElementById('page-body').innerHTML = `
    <p class="page-date">${activeSession.year_label} &middot; ${activeSession.term}</p>
    <h1 class="page-title">Result template</h1>
    <p class="page-subtitle">Pick a class to view report cards, print one, or download the whole class at once.</p>

    <div class="panel">
      <div class="form-grid">
        <div class="field">
          <label for="class-select">Class</label>
          <select id="class-select" onchange="onClassChange()">
            <option value="">Select a class</option>
            ${classOptions}
          </select>
        </div>
      </div>
      <div id="class-actions" style="display:none;">
        <div class="panel-toolbar">
          <button class="btn-outline" onclick="downloadWholeClass()">Download/print whole class</button>
        </div>
        <div id="student-list"></div>
      </div>
    </div>

    <div id="report-card-container"></div>
  `;
}

async function onClassChange() {
  selectedClassId = document.getElementById('class-select').value;
  document.getElementById('report-card-container').innerHTML = '';
  if (!selectedClassId) { document.getElementById('class-actions').style.display = 'none'; return; }

  document.getElementById('class-actions').style.display = 'block';
  document.getElementById('student-list').innerHTML = `<div class="empty-state">Loading class...</div>`;

  const [{ data: students }, { data: results }, { data: notes }] = await Promise.all([
    supabaseClient.from('students').select('id, name, admission_no, guardian_phone').eq('class_id', selectedClassId).order('name'),
    supabaseClient.from('results')
      .select('student_id, subject_id, ca_score, exam_score, total_score, grade, status, subjects ( id, name )')
      .eq('session_id', activeSession.id).eq('status', 'published'),
    supabaseClient.from('student_term_notes').select('*').eq('session_id', activeSession.id),
  ]);

  classStudents = students || [];
  // Only keep results for students actually in this class
  const studentIds = new Set(classStudents.map((s) => s.id));
  classResults = (results || []).filter((r) => studentIds.has(r.student_id));
  classNotes = notes || [];

  renderStudentList();
}

function computeClassStats() {
  // Per-subject stats across the whole class: highest, lowest, and each student's rank
  const bySubject = {};
  classResults.forEach((r) => {
    const key = r.subject_id;
    if (!bySubject[key]) bySubject[key] = [];
    bySubject[key].push(r);
  });

  const subjectStats = {};
  Object.entries(bySubject).forEach(([subjectId, rows]) => {
    const scored = rows.filter((r) => r.total_score !== null).sort((a, b) => b.total_score - a.total_score);
    const highest = scored.length ? scored[0].total_score : null;
    const lowest = scored.length ? scored[scored.length - 1].total_score : null;
    const ranks = {};
    let rank = 0, prevScore = null, seen = 0;
    scored.forEach((r) => {
      seen++;
      if (r.total_score !== prevScore) { rank = seen; prevScore = r.total_score; }
      ranks[r.student_id] = rank;
    });
    subjectStats[subjectId] = { highest, lowest, ranks };
  });

  // Overall per-student total/average, and class-wide rank + highest/lowest average
  const byStudent = {};
  classResults.forEach((r) => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = [];
    if (r.total_score !== null) byStudent[r.student_id].push(Number(r.total_score));
  });
  const studentTotals = Object.entries(byStudent).map(([studentId, scores]) => ({
    studentId: Number(studentId),
    total: scores.reduce((a, b) => a + b, 0),
    average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  })).sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

  const overallRanks = {};
  let rank = 0, prevAvg = null, seen = 0;
  studentTotals.forEach((s) => {
    seen++;
    if (s.average !== prevAvg) { rank = seen; prevAvg = s.average; }
    overallRanks[s.studentId] = rank;
  });

  const averages = studentTotals.map((s) => s.average).filter((a) => a !== null);
  const highestAvg = averages.length ? Math.max(...averages) : null;
  const lowestAvg = averages.length ? Math.min(...averages) : null;

  return { subjectStats, studentTotals, overallRanks, highestAvg, lowestAvg };
}

function renderStudentList() {
  const html = classStudents.length ? classStudents.map((s) => `
    <div class="queue-row" style="cursor:pointer;" onclick="showReportCard(${s.id})">
      <span>${s.name}</span>
      <span class="text-muted">${s.admission_no || ''}</span>
    </div>
  `).join('') : `<div class="empty-state">No students in this class yet.</div>`;

  document.getElementById('student-list').innerHTML = html;
}

async function getOrCreateToken(studentId) {
  const { data: existing } = await supabaseClient
    .from('report_verifications').select('token')
    .eq('student_id', studentId).eq('session_id', activeSession.id).maybeSingle();
  if (existing) return existing.token;

  const { data: created, error } = await supabaseClient
    .from('report_verifications')
    .insert({ school_id: currentSchoolId, student_id: studentId, session_id: activeSession.id })
    .select('token').single();
  return error ? null : created.token;
}

function reportCardHtml(student, stats, token, verifyUrl) {
  const studentResults = classResults.filter((r) => r.student_id === student.id);
  const totals = stats.studentTotals.find((t) => t.studentId === student.id);
  const overallPosition = stats.overallRanks[student.id];
  const notes = classNotes.find((n) => n.student_id === student.id) || {};
  const className = currentClasses.find((c) => String(c.id) === String(selectedClassId))?.name || '';

  const rowsHtml = studentResults.length ? studentResults.map((r) => {
    const subjStats = stats.subjectStats[r.subject_id] || {};
    return `
      <tr>
        <td>${r.subjects?.name || ''}</td>
        <td>${r.ca_score ?? '--'}</td>
        <td>${r.exam_score ?? '--'}</td>
        <td>${r.total_score ?? '--'}</td>
        <td>${r.grade || gradeFor(r.total_score)}</td>
        <td>${subjStats.ranks?.[student.id] ? ordinal(subjStats.ranks[student.id]) : '--'}</td>
        <td>${subjStats.highest ?? '--'}</td>
        <td>${subjStats.lowest ?? '--'}</td>
      </tr>`;
  }).join('') : `<tr><td colspan="8" style="text-align:center; padding:20px;">No published results yet.</td></tr>`;

  const behaviorRow = (label, field) => `
    <tr><td>${label}</td><td style="text-align:center;">${notes[field] ?? '--'}</td></tr>`;

  return `
    <div class="report-card" data-student-id="${student.id}">
      <div class="report-header">
        <div class="report-logo">${schoolInfo.logo_url ? `<img src="${schoolInfo.logo_url}${schoolInfo.logo_url.includes('?') ? '&' : '?'}cb=${Date.now()}" alt="logo">` : ''}</div>
        <div class="report-header-text">
          <h1>${schoolInfo.name || 'School Name'}</h1>
          ${schoolInfo.address ? `<p class="report-address">ADDRESS: ${schoolInfo.address}</p>` : ''}
          ${schoolInfo.phone ? `<p class="report-phone">Tel.: ${schoolInfo.phone}</p>` : ''}
        </div>
      </div>
      <h2 class="report-title">REPORT SHEET</h2>
      <div class="report-meta">
        <span><strong>NAME:</strong> ${student.name}</span>
        <span><strong>CLASS:</strong> ${className}</span>
        <span><strong>POSITION:</strong> ${overallPosition ? ordinal(overallPosition) : '--'}</span>
        <span><strong>TERM:</strong> ${activeSession.term}</span>
      </div>

      <table class="report-table">
        <thead>
          <tr>
            <th>SUBJECT</th><th>C.A</th><th>EXAM</th><th>TOTAL</th><th>GRADE</th>
            <th>POSITION</th><th>HIGHEST</th><th>LOWEST</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="report-footer-grid">
        <div class="report-panel">
          <p class="report-panel-title">BEHAVIOUR</p>
          <table class="behavior-table">
            ${behaviorRow('Punctuality', 'punctuality')}
            ${behaviorRow('Attendance', 'attendance_rating')}
            ${behaviorRow('Neatness', 'neatness')}
            ${behaviorRow('Handwriting', 'handwriting')}
            ${behaviorRow('Politeness', 'politeness')}
            ${behaviorRow('Initiative', 'initiative')}
            ${behaviorRow('Attitude to school', 'attitude_to_school')}
          </table>
          <p class="report-keys">Keys: Excellent = 5, V.Good = 4, Good = 3, Average = 2, Poor = 1</p>
        </div>

        <div class="report-panel">
          <p class="report-panel-title">GRADE SYSTEM</p>
          <table class="behavior-table">
            <tr><td>90 - 100</td><td>A+</td></tr>
            <tr><td>80 - 89</td><td>A</td></tr>
            <tr><td>75 - 79</td><td>B2</td></tr>
            <tr><td>70 - 74</td><td>B3</td></tr>
            <tr><td>65 - 69</td><td>C4</td></tr>
            <tr><td>60 - 64</td><td>C5</td></tr>
            <tr><td>50 - 59</td><td>C6</td></tr>
            <tr><td>40 - 49</td><td>D7</td></tr>
            <tr><td>30 - 39</td><td>E8</td></tr>
            <tr><td>0 - 29</td><td>F9</td></tr>
          </table>
        </div>

        <div class="report-panel">
          <p class="report-panel-title">SUMMARY</p>
          <table class="behavior-table">
            <tr><td>G. Total</td><td>${totals?.total ?? '--'}</td></tr>
            <tr><td>Average</td><td>${totals?.average ? totals.average.toFixed(1) + '%' : '--'}</td></tr>
            <tr><td>Highest avg. in class</td><td>${stats.highestAvg !== null ? stats.highestAvg.toFixed(1) + '%' : '--'}</td></tr>
            <tr><td>Lowest avg. in class</td><td>${stats.lowestAvg !== null ? stats.lowestAvg.toFixed(1) + '%' : '--'}</td></tr>
          </table>
          <p class="report-panel-title" style="margin-top:12px;">ATTENDANCE</p>
          <table class="behavior-table">
            <tr><td>Days opened</td><td>${notes.days_opened ?? '--'}</td></tr>
            <tr><td>Days present</td><td>${notes.days_present ?? '--'}</td></tr>
            <tr><td>Days absent</td><td>${notes.days_absent ?? '--'}</td></tr>
          </table>
          ${token ? `<div class="report-verification-block"><div class="report-qr" id="qr-${student.id}"></div></div>` : ''}
        </div>
      </div>

      <div class="report-remarks">
        <p><strong>Headteacher/Principal's remarks:</strong> ${notes.headteacher_remark || '_______________________________________________'}</p>
        <p><strong>Teacher's remark:</strong> ${notes.teacher_remark || '_______________________________________________'}</p>
      </div>
      ${(() => {
        const cls = currentClasses.find((c) => String(c.id) === String(selectedClassId));
        const section = String(cls?.section || '').toLowerCase();
        const isPrimary = section.includes('primary') || section.includes('nursery') || section.includes('pre-nursery') || section.includes('playgroup') || section === 'nur';
        const signatureUrl = isPrimary ? schoolInfo.headteacher_signature_url : schoolInfo.principal_signature_url;
        const signatoryLabel = isPrimary ? 'Headteacher' : 'Principal';
        return signatureUrl ? `<div class="report-signature-url"><img src="${escapeAttribute(signatureUrl)}" alt="${signatoryLabel} signature"><div class="signature-line"></div><strong>${signatoryLabel}</strong></div>` : '';
      })()}
      <div class="report-official-stamp"><img src="assets/sak-original-stamp.png" alt="S.A. Kiddies Academy original verification stamp"></div>
    </div>
  `;
}

async function showReportCard(studentId) {
  const student = classStudents.find((s) => s.id === studentId);
  const container = document.getElementById('report-card-container');
  container.innerHTML = `<div class="panel"><div class="empty-state">Building report card...</div></div>`;

  const stats = computeClassStats();
  const token = await getOrCreateToken(studentId);
  const verifyUrl = token ? `${window.location.origin}${window.location.pathname.replace('result-template.html', '')}verify.html?token=${token}` : null;

  container.innerHTML = `
    ${reportCardHtml(student, stats, token, verifyUrl)}
    <div class="panel-toolbar" style="margin-top:12px;">
      <button class="btn-outline" onclick="window.print()">Print this report card</button>
      ${verifyUrl ? `<button class="btn-outline" onclick="shareViaWhatsApp('${student.name.replace(/'/g, "\\'")}', '${verifyUrl}', '${student.guardian_phone || ''}')">Share via WhatsApp</button>` : ''}
    </div>
  `;

  if (verifyUrl && window.QRCode) {
    new QRCode(document.getElementById(`qr-${studentId}`), { text: verifyUrl, width: 90, height: 90 });
  }
}

async function downloadWholeClass() {
  const container = document.getElementById('report-card-container');
  container.innerHTML = `<div class="panel"><div class="empty-state">Preparing all report cards...</div></div>`;

  const stats = computeClassStats();
  const cardsHtml = [];
  const tokens = {};

  for (const student of classStudents) {
    const token = await getOrCreateToken(student.id);
    tokens[student.id] = token;
    cardsHtml.push(reportCardHtml(student, stats, token, null));
  }

  container.innerHTML = `
    ${cardsHtml.join('')}
    <div class="panel-toolbar" style="margin-top:12px;">
      <button class="btn-outline" onclick="window.print()">Print / save all as PDF</button>
    </div>
  `;

  classStudents.forEach((student) => {
    const token = tokens[student.id];
    if (token && window.QRCode) {
      const verifyUrl = `${window.location.origin}${window.location.pathname.replace('result-template.html', '')}verify.html?token=${token}`;
      const holder = document.getElementById(`qr-${student.id}`);
      if (holder) new QRCode(holder, { text: verifyUrl, width: 90, height: 90 });
    }
  });
}

function shareViaWhatsApp(studentName, verifyUrl, guardianPhone) {
  const message = `Hello! ${studentName}'s result is ready. You can view and verify it here: ${verifyUrl}`;
  const encodedMessage = encodeURIComponent(message);

  // If we have a guardian phone number, target them directly.
  // Otherwise, open a generic WhatsApp share (pick any contact/group).
  const digitsOnly = (guardianPhone || '').replace(/[^0-9]/g, '');
  const url = digitsOnly
    ? `https://wa.me/${digitsOnly}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  window.open(url, '_blank');
}

loadResultTemplatePage();


function escapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}
