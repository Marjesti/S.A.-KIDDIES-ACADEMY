let timetableSchoolId = null;
let timetableProfile = null;
let timetableSessions = [];
let timetableClasses = [];
let timetableSubjects = [];
let timetableTeachers = [];
let timetablePeriods = [];
let timetableEntries = [];
let timetableView = 'class';
let timetablePanel = 'board';
let editingTimetableEntryId = null;
let autoPlanRows = [];

const TT_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

function ttEsc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function ttTimeLabel(period) { const f=v=>String(v||'').slice(0,5); return `${f(period.start_time)}–${f(period.end_time)}`; }
function ttClassName(id) { return timetableClasses.find(c=>Number(c.id)===Number(id))?.name || 'Class'; }
function ttSubjectName(id) { return timetableSubjects.find(s=>Number(s.id)===Number(id))?.name || 'Subject'; }
function ttTeacherName(id) { return timetableTeachers.find(t=>Number(t.id)===Number(id))?.name || 'Teacher'; }
function ttTeacher(id) { return timetableTeachers.find(t=>Number(t.id)===Number(id)); }
function ttClass(id) { return timetableClasses.find(c=>Number(c.id)===Number(id)); }
function ttSubject(id) { return timetableSubjects.find(s=>Number(s.id)===Number(id)); }
function ttSection(value) { return String(value || '').trim().toLowerCase(); }
function subjectsForClass(classId) {
  const c = ttClass(classId);
  if (!c) return [];
  const section = ttSection(c.section);
  return timetableSubjects.filter(s => ttSection(s.section) === section);
}
function teachersForClass(classId) {
  return timetableTeachers.filter(t => (t.teacher_classes || []).some(x => Number(x.class_id) === Number(classId)));
}
function teachersForClassAndSubject(classId, subjectId) {
  return teachersForClass(classId).filter(t => (t.teacher_subjects || []).some(x => Number(x.subject_id) === Number(subjectId)));
}
function populateEntrySubjectOptions(classId, selectedSubjectId='') {
  const el = document.getElementById('tt-entry-subject');
  if (!el) return;
  el.innerHTML = subjectOptions(classId);
  if (selectedSubjectId && subjectsForClass(classId).some(s => Number(s.id) === Number(selectedSubjectId))) el.value = String(selectedSubjectId);
}
function populateEntryTeacherOptions(classId, subjectId, selectedTeacherId='') {
  const el = document.getElementById('tt-entry-teacher');
  if (!el) return;
  const list = classId && subjectId ? teachersForClassAndSubject(classId, subjectId) : (classId ? teachersForClass(classId) : timetableTeachers);
  el.innerHTML = '<option value="">Select teacher</option>' + list.map(t => `<option value="${t.id}">${ttEsc(t.name)}${t.employment_type?` — ${ttEsc(t.employment_type)}`:''}</option>`).join('');
  if (selectedTeacherId && list.some(t => Number(t.id) === Number(selectedTeacherId))) el.value = String(selectedTeacherId);
}
function periodsForDay(day) { return timetablePeriods.filter(p=>p.day_of_week===day && !p.is_break).sort((a,b)=>a.period_no-b.period_no); }
function sessionOptions() { return timetableSessions.map(s=>`<option value="${s.id}" ${s.is_active?'selected':''}>${ttEsc(s.year_label)} — ${ttEsc(s.term)}</option>`).join(''); }
function classOptions(includeAll=false) { return `${includeAll?'<option value="">All classes</option>':'<option value="">Select class</option>'}${timetableClasses.map(c=>`<option value="${c.id}">${ttEsc(c.name)}${c.section?` — ${ttEsc(c.section)}`:''}</option>`).join('')}`; }
function teacherOptions() { return '<option value="">Select teacher</option>'+timetableTeachers.map(t=>`<option value="${t.id}">${ttEsc(t.name)}${t.employment_type?` — ${ttEsc(t.employment_type)}`:''}</option>`).join(''); }
function subjectOptions(classId=null) { const list=classId?subjectsForClass(classId):timetableSubjects; return '<option value="">Select subject</option>'+list.map(s=>`<option value="${s.id}">${ttEsc(s.name)}${s.section?` — ${ttEsc(s.section)}`:''}</option>`).join(''); }

async function initTimetable() {
  const {profile}=await requireSession();
  timetableProfile=profile; timetableSchoolId=profile.school_id;
  renderShell({active:'timetable',profile});
  const [sessions,classes,subjects,teachers,periods]=await Promise.all([
    supabaseClient.from('academic_sessions').select('id,year_label,term,is_active').eq('school_id',timetableSchoolId).order('created_at',{ascending:false}),
    supabaseClient.from('classes').select('id,name,section').eq('school_id',timetableSchoolId).order('name'),
    supabaseClient.from('subjects').select('id,name,section').eq('school_id',timetableSchoolId).order('name'),
    supabaseClient.from('teachers').select('id,name,employment_type,teacher_classes(class_id),teacher_subjects(subject_id)').eq('school_id',timetableSchoolId).order('name'),
    supabaseClient.from('timetable_periods').select('*').eq('school_id',timetableSchoolId).order('day_of_week').order('period_no')
  ]);
  timetableSessions=sessions.data||[]; timetableClasses=classes.data||[]; timetableSubjects=subjects.data||[]; timetableTeachers=teachers.data||[]; timetablePeriods=periods.data||[];
  renderTimetablePage(timetablePeriods.length?'':'No timetable periods found. Run the timetable SQL first.');
  if(timetablePeriods.length) await loadTimetableEntries();
}

function renderTimetablePage(message='') {
  const isAdmin=timetableProfile?.role==='admin';
  document.getElementById('page-body').innerHTML=`
    <p class="page-date">Academic scheduling</p>
    <h1 class="page-title">Timetable Dashboard</h1>
    <p class="page-subtitle">Build, audit, print and plan timetables using the existing teacher catalogue.</p>
    <div class="tt-summary-row">
      <div class="panel tt-stat"><div class="eyebrow">Teachers</div><strong>${timetableTeachers.length}</strong><span>existing catalogue</span></div>
      <div class="panel tt-stat"><div class="eyebrow">Classes</div><strong>${timetableClasses.length}</strong><span>school classes</span></div>
      <div class="panel tt-stat"><div class="eyebrow">Subjects</div><strong>${timetableSubjects.length}</strong><span>school subjects</span></div>
      <div class="panel tt-stat"><div class="eyebrow">Scheduled</div><strong id="tt-scheduled-count">0</strong><span>lessons in selected session</span></div>
    </div>
    <div class="panel tt-controls">
      <div class="tt-controls-grid">
        <div class="field"><label>Academic session / term</label><select id="tt-session">${sessionOptions()}</select></div>
        <div class="field"><label>View</label><select id="tt-view"><option value="class">Class timetable</option><option value="teacher">Teacher timetable</option></select></div>
        <div class="field" id="tt-class-field"><label>Class</label><select id="tt-class">${classOptions()}</select></div>
        <div class="field" id="tt-teacher-field" style="display:none"><label>Teacher</label><select id="tt-teacher">${teacherOptions()}</select></div>
      </div>
      <div class="tt-action-row">
        <button class="btn-gold" id="tt-add-btn">+ Add lesson</button>
        <button class="btn-outline" id="tt-print-btn">Print timetable</button>
        
        <span class="tt-rule-note">Database protection blocks class and teacher clashes.</span>
      </div>
      <div id="tt-error" class="error-banner"></div>
    </div>
    <div class="tt-tabs">
      <button class="tt-tab active" data-panel="board">Timetable</button>
      <button class="tt-tab" data-panel="workload">Teacher workload</button>
      <button class="tt-tab" data-panel="audit">Clash & assignment audit</button>
      ${isAdmin?'<button class="tt-tab" data-panel="auto">Auto planner</button>':''}
    </div>
    <div id="tt-panel-board" class="tt-panel"><div class="panel"><div id="tt-board">${message?`<div class="empty-state">${ttEsc(message)}</div>`:''}</div></div></div>
    <div id="tt-panel-workload" class="tt-panel" style="display:none"><div class="panel"><div id="tt-workload"></div></div></div>
    <div id="tt-panel-audit" class="tt-panel" style="display:none"><div class="panel"><div id="tt-audit"></div></div></div>
    ${isAdmin?'<div id="tt-panel-auto" class="tt-panel" style="display:none"><div class="panel"><div id="tt-auto"></div></div></div>':''}
    <div class="panel tt-help"><h3 class="panel-title">How the timetable connects to the existing catalogue</h3><div class="tt-help-grid"><div><b>Teacher → class</b><span>Only existing teacher-class assignments are accepted.</span></div><div><b>Teacher → subject</b><span>Only existing teacher-subject assignments are accepted.</span></div><div><b>Clash protection</b><span>One class and one teacher cannot occupy the same period twice.</span></div><div><b>History safe</b><span>Timetable entries are tied to the academic session and do not alter results.</span></div></div></div>
    <div id="tt-modal" class="tt-modal" aria-hidden="true"><div class="tt-modal-card"><div class="tt-modal-head"><div><div class="eyebrow" id="tt-modal-eyebrow">Schedule lesson</div><h2 id="tt-modal-title">Add lesson</h2></div><button class="icon-btn" id="tt-close-modal">Close</button></div><div class="form-grid"><div class="field"><label>Day</label><select id="tt-day">${TT_DAYS.map(d=>`<option value="${d}">${d}</option>`).join('')}</select></div><div class="field"><label>Period</label><select id="tt-period"></select></div><div class="field"><label>Class</label><select id="tt-entry-class">${classOptions()}</select></div><div class="field"><label>Subject</label><select id="tt-entry-subject">${subjectOptions()}</select></div><div class="field"><label>Teacher</label><select id="tt-entry-teacher">${teacherOptions()}</select></div><div class="field"><label>Room / venue (optional)</label><input id="tt-room" type="text" placeholder="e.g. Science Lab"></div></div><div id="tt-eligibility" class="tt-eligibility"></div><div id="tt-modal-error" class="error-banner"></div><div class="tt-modal-actions"><button class="btn-outline" id="tt-delete-btn" style="display:none">Delete lesson</button><span></span><button class="btn-outline" id="tt-cancel-btn">Cancel</button><button class="btn-gold" id="tt-save-btn">Save lesson</button></div></div></div>
  `;
  document.getElementById('tt-view').addEventListener('change',()=>{timetableView=document.getElementById('tt-view').value; document.getElementById('tt-class-field').style.display=timetableView==='class'?'':'none'; document.getElementById('tt-teacher-field').style.display=timetableView==='teacher'?'':'none'; loadTimetableEntries();});
  document.getElementById('tt-session').addEventListener('change',loadTimetableEntries);
  document.getElementById('tt-class').addEventListener('change',loadTimetableEntries);
  document.getElementById('tt-teacher').addEventListener('change',loadTimetableEntries);
  document.getElementById('tt-add-btn').addEventListener('click',()=>openTimetableModal());
  document.getElementById('tt-print-btn').addEventListener('click',printTimetable);
  document.getElementById('tt-close-modal').addEventListener('click',closeTimetableModal); document.getElementById('tt-cancel-btn').addEventListener('click',closeTimetableModal); document.getElementById('tt-save-btn').addEventListener('click',saveTimetableEntry); document.getElementById('tt-delete-btn').addEventListener('click',deleteTimetableEntry); document.getElementById('tt-day').addEventListener('change',()=>populatePeriodOptions());
  document.getElementById('tt-entry-class').addEventListener('change',()=>{const classId=document.getElementById('tt-entry-class').value;populateEntrySubjectOptions(classId);populateEntryTeacherOptions(classId,'');updateEligibility();});document.getElementById('tt-entry-subject').addEventListener('change',()=>{const classId=document.getElementById('tt-entry-class').value;const subjectId=document.getElementById('tt-entry-subject').value;populateEntryTeacherOptions(classId,subjectId);updateEligibility();});document.getElementById('tt-entry-teacher').addEventListener('change',updateEligibility);
  document.querySelectorAll('.tt-tab').forEach(btn=>btn.addEventListener('click',()=>switchTtPanel(btn.dataset.panel)));
}

function switchTtPanel(panel){ timetablePanel=panel; document.querySelectorAll('.tt-tab').forEach(b=>b.classList.toggle('active',b.dataset.panel===panel)); document.querySelectorAll('.tt-panel').forEach(p=>p.style.display=p.id===`tt-panel-${panel}`?'':'none'); if(panel==='workload')renderWorkload(); if(panel==='audit')renderAudit(); if(panel==='auto')renderAutoPlanner(); }

async function loadTimetableEntries(){
  const sessionId=document.getElementById('tt-session')?.value; if(!sessionId)return;
  const {data,error}=await supabaseClient.from('timetable_entries').select('id,session_id,class_id,subject_id,teacher_id,day_of_week,period_no,room,notes').eq('school_id',timetableSchoolId).eq('session_id',sessionId);
  if(error){showTtError(error.message);return;} timetableEntries=data||[]; document.getElementById('tt-scheduled-count').textContent=timetableEntries.length; renderBoard(); if(timetablePanel==='workload')renderWorkload(); if(timetablePanel==='audit')renderAudit(); if(timetablePanel==='auto')renderAutoPlanner();
}

function renderBoard(){
  const board=document.getElementById('tt-board'); if(!board)return;
  const selectedClass=document.getElementById('tt-class')?.value, selectedTeacher=document.getElementById('tt-teacher')?.value;
  let visible=timetableEntries; if(timetableView==='class'&&selectedClass)visible=visible.filter(e=>String(e.class_id)===String(selectedClass)); if(timetableView==='teacher'&&selectedTeacher)visible=visible.filter(e=>String(e.teacher_id)===String(selectedTeacher));
  const maxPeriods=Math.max(...TT_DAYS.map(d=>periodsForDay(d).length),0);
  if(!maxPeriods){board.innerHTML='<div class="empty-state">No teaching periods configured.</div>';return;}
  let html=`<div class="tt-board-scroll"><table class="tt-grid"><thead><tr><th class="tt-time-head">Period</th>${TT_DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;
  for(let i=1;i<=maxPeriods;i++){const ref=timetablePeriods.find(p=>p.day_of_week==='Monday'&&p.period_no===i)||timetablePeriods.find(p=>p.period_no===i);if(!ref)continue;html+=`<tr><th class="tt-time-cell"><b>P${i}</b><span>${ttTimeLabel(ref)}</span></th>`;for(const day of TT_DAYS){const p=timetablePeriods.find(x=>x.day_of_week===day&&x.period_no===i&&!x.is_break);if(!p){html+='<td class="tt-empty-day">—</td>';continue;}const e=visible.find(x=>x.day_of_week===day&&Number(x.period_no)===i);if(!e)html+=`<td><button class="tt-empty-cell" data-day="${day}" data-period="${i}">+ Add</button></td>`;else html+=`<td><button class="tt-entry" data-entry="${e.id}"><strong>${ttEsc(ttSubjectName(e.subject_id))}</strong><span>${ttEsc(timetableView==='class'?ttTeacherName(e.teacher_id):ttClassName(e.class_id))}</span>${e.room?`<small>${ttEsc(e.room)}</small>`:''}</button></td>`;}html+='</tr>';}
  html+='</tbody></table></div>'; board.innerHTML=html; board.querySelectorAll('.tt-empty-cell').forEach(b=>b.addEventListener('click',()=>openTimetableModal(null,b.dataset.day,Number(b.dataset.period)))); board.querySelectorAll('.tt-entry').forEach(b=>b.addEventListener('click',()=>openTimetableModal(Number(b.dataset.entry))));
}

function populatePeriodOptions(selected=null){const day=document.getElementById('tt-day').value,select=document.getElementById('tt-period');select.innerHTML=periodsForDay(day).map(p=>`<option value="${p.period_no}" ${Number(p.period_no)===Number(selected)?'selected':''}>P${p.period_no} — ${ttTimeLabel(p)}</option>`).join('');}
function teacherCanHandle(teacherId,classId,subjectId){const t=ttTeacher(teacherId);if(!t)return{ok:false,reason:'Select a teacher.'};const c=(t.teacher_classes||[]).some(x=>Number(x.class_id)===Number(classId));const s=(t.teacher_subjects||[]).some(x=>Number(x.subject_id)===Number(subjectId));if(!c)return{ok:false,reason:'This teacher is not assigned to the selected class.'};if(!s)return{ok:false,reason:'This teacher is not assigned to the selected subject.'};return{ok:true,reason:'Teacher assignment matches the existing Teacher Catalog.'};}
function updateEligibility(){const el=document.getElementById('tt-eligibility');if(!el)return;const c=document.getElementById('tt-entry-class').value,s=document.getElementById('tt-entry-subject').value,t=document.getElementById('tt-entry-teacher').value;if(!c||!s||!t){el.textContent='Select class, subject and teacher to validate the assignment.';el.className='tt-eligibility';return;}const r=teacherCanHandle(t,c,s);el.textContent=r.reason;el.className=`tt-eligibility ${r.ok?'ok':'bad'}`;}
function openTimetableModal(entryId=null,day='Monday',periodNo=1){editingTimetableEntryId=entryId;const e=entryId?timetableEntries.find(x=>Number(x.id)===Number(entryId)):null;document.getElementById('tt-modal-title').textContent=e?'Edit lesson':'Add lesson';document.getElementById('tt-modal-eyebrow').textContent=e?'Update scheduled lesson':'Schedule a lesson';document.getElementById('tt-delete-btn').style.display=e?'':'none';document.getElementById('tt-day').value=e?.day_of_week||day;populatePeriodOptions(e?.period_no||periodNo);const entryClassId=e?.class_id||(timetableView==='class'?(document.getElementById('tt-class').value||''):'');document.getElementById('tt-entry-class').value=entryClassId||'';populateEntrySubjectOptions(entryClassId,e?.subject_id||'');populateEntryTeacherOptions(entryClassId,e?.subject_id||'',e?.teacher_id||(timetableView==='teacher'?(document.getElementById('tt-teacher').value||''):''));document.getElementById('tt-room').value=e?.room||'';document.getElementById('tt-modal-error').classList.remove('visible');updateEligibility();const m=document.getElementById('tt-modal');m.classList.add('open');m.setAttribute('aria-hidden','false');}
function closeTimetableModal(){const m=document.getElementById('tt-modal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');editingTimetableEntryId=null;}
function showTtModalError(m){const e=document.getElementById('tt-modal-error');e.textContent=m;e.classList.add('visible');}
function showTtError(m){const e=document.getElementById('tt-error');if(e){e.textContent=m;e.classList.add('visible');}}

async function saveTimetableEntry(){
  const sessionId=Number(document.getElementById('tt-session').value),day=document.getElementById('tt-day').value,periodNo=Number(document.getElementById('tt-period').value),classId=Number(document.getElementById('tt-entry-class').value),subjectId=Number(document.getElementById('tt-entry-subject').value),teacherId=Number(document.getElementById('tt-entry-teacher').value),room=document.getElementById('tt-room').value.trim()||null;
  if(!sessionId||!day||!periodNo||!classId||!subjectId||!teacherId){showTtModalError('Please complete session, day, period, class, subject and teacher.');return;}
  const elig=teacherCanHandle(teacherId,classId,subjectId);if(!elig.ok){showTtModalError(elig.reason);return;}
  const clashClass=timetableEntries.find(e=>Number(e.class_id)===classId&&e.day_of_week===day&&Number(e.period_no)===periodNo&&Number(e.id)!==Number(editingTimetableEntryId));if(clashClass){showTtModalError('Class clash: this class already has a lesson in this period.');return;}
  const clashTeacher=timetableEntries.find(e=>Number(e.teacher_id)===teacherId&&e.day_of_week===day&&Number(e.period_no)===periodNo&&Number(e.id)!==Number(editingTimetableEntryId));if(clashTeacher){showTtModalError(`Teacher clash: ${ttTeacherName(teacherId)} is already teaching another class in this period.`);return;}
  const payload={school_id:timetableSchoolId,session_id:sessionId,class_id:classId,subject_id:subjectId,teacher_id:teacherId,day_of_week:day,period_no:periodNo,room};
  const q=editingTimetableEntryId?supabaseClient.from('timetable_entries').update(payload).eq('id',editingTimetableEntryId).eq('school_id',timetableSchoolId).select().single():supabaseClient.from('timetable_entries').insert(payload).select().single();const {error}=await q;if(error){showTtModalError(error.code==='23505'?'This timetable slot clashes with an existing class or teacher assignment.':error.message);return;}closeTimetableModal();showSuccessToast(editingTimetableEntryId?'Lesson updated':'Lesson scheduled');await loadTimetableEntries();
}
async function deleteTimetableEntry(){if(!editingTimetableEntryId)return;if(!confirm('Remove this lesson from the timetable?'))return;const {error}=await supabaseClient.from('timetable_entries').delete().eq('id',editingTimetableEntryId).eq('school_id',timetableSchoolId);if(error){showTtModalError(error.message);return;}closeTimetableModal();showSuccessToast('Lesson removed');await loadTimetableEntries();}

function renderWorkload(){const el=document.getElementById('tt-workload');if(!el)return;const counts={};timetableEntries.forEach(e=>counts[e.teacher_id]=(counts[e.teacher_id]||0)+1);const rows=timetableTeachers.map(t=>({name:t.name,type:t.employment_type||'—',lessons:counts[t.id]||0})).sort((a,b)=>b.lessons-a.lessons||a.name.localeCompare(b.name));el.innerHTML=`<div class="tt-section-head"><div><h2>Teacher workload</h2><p>Scheduled teaching periods in the selected session.</p></div><span class="tt-pill">${timetableEntries.length} total lessons</span></div><div class="table-wrapper"><table class="students-table"><thead><tr><th>Teacher</th><th>Employment</th><th>Lessons</th><th>Load</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${ttEsc(r.name)}</td><td>${ttEsc(r.type)}</td><td>${r.lessons}</td><td><div class="tt-load"><i style="width:${Math.min(100,r.lessons*4)}%"></i></div></td></tr>`).join('')}</tbody></table></div>`;}

function renderAudit(){const el=document.getElementById('tt-audit');if(!el)return;const issues=[];const seenClass=new Set(),seenTeacher=new Set();for(const e of timetableEntries){const ck=`${e.class_id}|${e.day_of_week}|${e.period_no}`,tk=`${e.teacher_id}|${e.day_of_week}|${e.period_no}`;if(seenClass.has(ck))issues.push(`Class clash: ${ttClassName(e.class_id)} ${e.day_of_week} P${e.period_no}`);if(seenTeacher.has(tk))issues.push(`Teacher clash: ${ttTeacherName(e.teacher_id)} ${e.day_of_week} P${e.period_no}`);seenClass.add(ck);seenTeacher.add(tk);const r=teacherCanHandle(e.teacher_id,e.class_id,e.subject_id);if(!r.ok)issues.push(`${ttTeacherName(e.teacher_id)} → ${ttClassName(e.class_id)} / ${ttSubjectName(e.subject_id)}: ${r.reason}`);}
el.innerHTML=`<div class="tt-section-head"><div><h2>Clash & assignment audit</h2><p>Checks scheduled entries against current timetable and teacher-catalogue rules.</p></div><span class="tt-pill ${issues.length?'bad':'good'}">${issues.length?issues.length+' issue(s)':'PASS — no issues'}</span></div>${issues.length?`<div class="tt-audit-list">${issues.map(x=>`<div>⚠ ${ttEsc(x)}</div>`).join('')}</div>`:'<div class="tt-pass">✓ No class clashes, teacher clashes, or invalid teacher assignments were found.</div>'}`;}

function candidateTeachers(classId,subjectId){return teachersForClassAndSubject(classId,subjectId);}
function renderAutoPlanner(preferredClassId=''){const el=document.getElementById('tt-auto');if(!el)return;const existingAutoClass=document.getElementById('tt-auto-class')?.value||'';const classId=String(preferredClassId||existingAutoClass||document.getElementById('tt-class').value||timetableClasses[0]?.id||'');const subjects=subjectsForClass(classId);if(!subjects.length){el.innerHTML='<div class="empty-state">No subjects are configured for this class section.</div>';return;}if(!autoPlanRows.length||autoPlanRows[0]?.class_id!=classId){autoPlanRows=subjects.map(s=>({class_id:Number(classId),subject_id:Number(s.id),weekly:0}));}
el.innerHTML=`<div class="tt-section-head"><div><h2>Auto planner</h2><p>Enter how many periods each subject should receive. The planner then finds non-conflicting teacher/period slots and previews the result before saving.</p></div><span class="tt-pill">Guided generation</span></div><div class="tt-auto-tools"><div class="field"><label>Class</label><select id="tt-auto-class">${classOptions()}</select></div><button class="btn-outline" id="tt-auto-reset">Reset</button><button class="btn-gold" id="tt-generate">Generate preview</button><button class="btn-outline" id="tt-save-generated" disabled>Save preview</button></div><div id="tt-auto-error" class="error-banner"></div><div class="table-wrapper"><table class="students-table"><thead><tr><th>Subject</th><th>Eligible teachers</th><th>Weekly periods</th></tr></thead><tbody>${autoPlanRows.map((r,i)=>{const s=ttSubject(r.subject_id),ts=candidateTeachers(classId,r.subject_id);return `<tr><td>${ttEsc(s?.name||'Subject')}</td><td>${ts.length?ttEsc(ts.map(t=>t.name).join(', ')):'<span style="color:#9a3b3b;font-weight:700;">No eligible teacher</span>'}</td><td><input class="tt-weekly-input" data-i="${i}" type="number" min="0" max="10" value="${r.weekly}"></td></tr>`;}).join('')}</tbody></table></div><div id="tt-auto-preview"></div>`;
document.getElementById('tt-auto-class').value=String(classId);document.getElementById('tt-auto-class').addEventListener('change',e=>{const selectedClassId=e.target.value;autoPlanRows=[];window._ttGenerated=[];renderAutoPlanner(selectedClassId);});document.getElementById('tt-auto-reset').addEventListener('click',()=>{autoPlanRows=[];window._ttGenerated=[];renderAutoPlanner(classId);});document.querySelectorAll('.tt-weekly-input').forEach(inp=>inp.addEventListener('input',()=>autoPlanRows[Number(inp.dataset.i)].weekly=Math.max(0,Math.min(10,Number(inp.value)||0))));document.getElementById('tt-generate').addEventListener('click',generateAutoPreview);document.getElementById('tt-save-generated').addEventListener('click',saveAutoPreview);
}

function generateAutoPreview(){
  const err=document.getElementById('tt-auto-error');
  err.classList.remove('visible');
  const classId=Number(document.getElementById('tt-auto-class').value);
  const invalid=autoPlanRows.find(r=>r.weekly>0&&candidateTeachers(classId,r.subject_id).length===0);
  if(invalid){
    err.textContent=`${ttSubjectName(invalid.subject_id)} has no teacher assigned to both this class and subject in the Teacher Catalog. Assign the teacher first, then generate again.`;
    err.classList.add('visible');
    document.getElementById('tt-save-generated').disabled=true;
    return;
  }

  const slots=[];
  TT_DAYS.forEach(day=>periodsForDay(day).forEach(p=>slots.push({day,period:p.period_no})));
  const occupiedClass=new Set(timetableEntries.filter(e=>Number(e.class_id)===classId).map(e=>`${e.day_of_week}|${e.period_no}`));
  const occupiedTeacher=new Set(timetableEntries.map(e=>`${e.teacher_id}|${e.day_of_week}|${e.period_no}`));
  const load={};
  timetableEntries.forEach(e=>load[e.teacher_id]=(load[e.teacher_id]||0)+1);

  const req=autoPlanRows
    .filter(r=>r.weekly>0)
    .sort((a,b)=>{
      const ca=candidateTeachers(classId,a.subject_id).length;
      const cb=candidateTeachers(classId,b.subject_id).length;
      return ca-cb||b.weekly-a.weekly;
    });

  const generated=[];
  const generatedForClassDay=(day)=>generated.filter(x=>x.class_id===classId&&x.day_of_week===day).length;
  const generatedForTeacherDay=(teacherId,day)=>generated.filter(x=>x.teacher_id===teacherId&&x.day_of_week===day).length;

  // Timetable rule: build each weekly allocation as consecutive doubles first.
  // Examples: 2 => 2; 3 => 2+1; 4 => 2+2; 5 => 2+2+1; 6 => 2+2+2.
  // A double is always two consecutive teaching periods on the same day.
  function blockCandidates(subjectId, blockLength){
    const candidates=[];
    const teachers=candidateTeachers(classId,subjectId);
    for(const day of TT_DAYS){
      const dayPeriods=periodsForDay(day);
      for(let i=0;i<=dayPeriods.length-blockLength;i++){
        const block=dayPeriods.slice(i,i+blockLength);
        if(block.length!==blockLength)continue;
        const consecutive=block.every((p,idx)=>idx===0||Number(p.period_no)===Number(block[idx-1].period_no)+1);
        if(!consecutive)continue;
        const classFree=block.every(p=>!occupiedClass.has(`${day}|${p.period_no}`));
        if(!classFree)continue;
        for(const t of teachers){
          const teacherFree=block.every(p=>!occupiedTeacher.has(`${t.id}|${day}|${p.period_no}`));
          if(!teacherFree)continue;
          const sameTeacherDay=generatedForTeacherDay(t.id,day);
          const classDay=generatedForClassDay(day);
          const loadScore=(load[t.id]||0)*2;
          const spacingScore=classDay*1.5;
          const teacherDayScore=sameTeacherDay*3;
          const morningPreference=block.reduce((sum,p)=>sum+Math.abs(Number(p.period_no)-4)*0.15,0);
          const blockScore=blockLength===2?-5:0;
          candidates.push({day,block,teacher:t,score:loadScore+spacingScore+teacherDayScore+morningPreference+blockScore});
        }
      }
    }
    candidates.sort((a,b)=>a.score-b.score||a.day.localeCompare(b.day)||a.block[0].period_no-b.block[0].period_no);
    return candidates;
  }

  function placeBlock(subjectId,blockLength){
    const options=blockCandidates(subjectId,blockLength);
    if(!options.length)return false;
    const best=options[0];
    for(const p of best.block){
      const item={
        day_of_week:best.day,
        period_no:Number(p.period_no),
        teacher_id:Number(best.teacher.id),
        subject_id:Number(subjectId),
        class_id:classId,
        score:best.score
      };
      generated.push(item);
      occupiedClass.add(`${best.day}|${p.period_no}`);
      occupiedTeacher.add(`${best.teacher.id}|${best.day}|${p.period_no}`);
      load[best.teacher.id]=(load[best.teacher.id]||0)+1;
    }
    return true;
  }

  for(const r of req){
    let remaining=Number(r.weekly)||0;

    // Always consume pairs first. If a pair cannot be placed because of a real
    // scheduling constraint, gracefully fall back to singles rather than fail.
    while(remaining>=2){
      if(placeBlock(r.subject_id,2)){
        remaining-=2;
        continue;
      }
      break;
    }

    if(remaining===1 && !placeBlock(r.subject_id,1)){
      err.textContent=`Could not place the remaining single period for ${ttSubjectName(r.subject_id)}. Reduce the requested periods or free some existing slots.`;
      err.classList.add('visible');
      document.getElementById('tt-save-generated').disabled=true;
      return;
    }

    if(remaining>=2){
      // No double was available. Place the remaining periods as singles only
      // as a fallback, while keeping the preferred double rule intact.
      while(remaining>0){
        if(!placeBlock(r.subject_id,1)){
          err.textContent=`Could not place all requested periods for ${ttSubjectName(r.subject_id)}. Reduce the requested periods or free some existing slots.`;
          err.classList.add('visible');
          document.getElementById('tt-save-generated').disabled=true;
          return;
        }
        remaining--;
      }
    }
  }

  window._ttGenerated=generated;
  document.getElementById('tt-save-generated').disabled=!generated.length;

  const grouped=generated.reduce((a,e)=>{(a[e.day_of_week]??=[]).push(e);return a;},{});
  const previewDays=TT_DAYS.map(d=>{
    const rows=(grouped[d]||[]).sort((a,b)=>a.period_no-b.period_no);
    const chunks=[];
    for(let i=0;i<rows.length;i++){
      const a=rows[i],b=rows[i+1];
      if(b&&a.subject_id===b.subject_id&&a.teacher_id===b.teacher_id&&Number(b.period_no)===Number(a.period_no)+1){
        chunks.push(`P${a.period_no}–P${b.period_no} ${ttSubjectName(a.subject_id)} — ${ttTeacherName(a.teacher_id)}`);
        i++;
      }else{
        chunks.push(`P${a.period_no} ${ttSubjectName(a.subject_id)} — ${ttTeacherName(a.teacher_id)}`);
      }
    }
    return `<div><b>${d}</b>: ${chunks.join(' · ')||'—'}</div>`;
  }).join('');

  document.getElementById('tt-auto-preview').innerHTML=`<div class="tt-preview"><h3>Generated preview — ${generated.length} lessons</h3><p style="margin:0 0 10px;color:#666;font-size:.9rem;">Double periods are preferred: 2 → 2, 3 → 2+1, 4 → 2+2, 5 → 2+2+1, 6 → 2+2+2. Singles are used only when a consecutive double cannot be placed.</p>${previewDays}</div>`;
}
async function saveAutoPreview(){const rows=window._ttGenerated||[];if(!rows.length)return;const sessionId=Number(document.getElementById('tt-session').value);const payload=rows.map(e=>({class_id:e.class_id,subject_id:e.subject_id,teacher_id:e.teacher_id,day_of_week:e.day_of_week,period_no:e.period_no,room:null}));const {data,error}=await supabaseClient.rpc('save_timetable_batch',{p_school_id:timetableSchoolId,p_session_id:sessionId,p_entries:payload});if(error){const el=document.getElementById('tt-auto-error');el.textContent=error.message;el.classList.add('visible');return;}showSuccessToast(`Auto timetable saved: ${data||rows.length} lessons`);window._ttGenerated=[];await loadTimetableEntries();switchTtPanel('board');}

function printTimetable(){const board=document.getElementById('tt-board');if(!board)return;const session=timetableSessions.find(s=>String(s.id)===String(document.getElementById('tt-session').value));const target=timetableView==='class'?ttClassName(document.getElementById('tt-class').value):ttTeacherName(document.getElementById('tt-teacher').value);const title=`${timetableView==='class'?'Class':'Teacher'} Timetable — ${target}`;const win=window.open('','_blank');if(!win)return;win.document.write(`<!doctype html><html><head><title>${ttEsc(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#16213A}h1{margin:0 0 6px}p{margin:0 0 18px;color:#666}.tt-grid{width:100%;border-collapse:collapse}.tt-grid th,.tt-grid td{border:1px solid #ccc;padding:8px;text-align:center}.tt-grid th{background:#f3f0e4}.tt-entry{font-weight:700}.tt-entry span{display:block;font-weight:400;margin-top:3px}.tt-entry small{display:block;margin-top:3px;color:#666}</style></head><body><h1>${ttEsc(title)}</h1><p>${ttEsc(session?.year_label||'')} — ${ttEsc(session?.term||'')}</p>${board.innerHTML}</body></html>`);win.document.close();win.focus();win.print();}

initTimetable();
