-- ============================================================
-- READ-ONLY. Everything in ONE query this time (Supabase's SQL
-- editor only shows the last statement's result when you run
-- several separately -- this avoids that).
-- ============================================================

select 'results column' as category, column_name as key, data_type as value
from information_schema.columns
where table_schema = 'public' and table_name = 'results'

union all

select 'results RLS policy', policyname, cmd::text || ' | USING: ' || coalesce(qual, '(none)') || ' | WITH CHECK: ' || coalesce(with_check, '(none)')
from pg_policies
where schemaname = 'public' and tablename = 'results'

union all

select 'possible assessment-config table', table_name, ''
from information_schema.tables
where table_schema = 'public'
  and (table_name ilike '%assessment%' or table_name ilike '%grading%' or table_name ilike '%mark_config%' or table_name ilike '%ca_config%')

union all

select 'student_term_notes column', column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'student_term_notes'

union all

select 'teachers column', column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'teachers'

union all

select 'form-master-related function', routine_name, ''
from information_schema.routines
where routine_schema = 'public'
  and (routine_name ilike '%form_master%' or routine_name ilike '%teacher_school%' or routine_name ilike '%get_%teacher%')

union all

select 'teacher_classes/teacher_subjects RLS policy', tablename || ' -> ' || policyname, cmd::text || ' | USING: ' || coalesce(qual, '(none)') || ' | WITH CHECK: ' || coalesce(with_check, '(none)')
from pg_policies
where schemaname = 'public' and tablename in ('teacher_classes', 'teacher_subjects')

union all

select 'students RLS policy', policyname, cmd::text || ' | USING: ' || coalesce(qual, '(none)') || ' | WITH CHECK: ' || coalesce(with_check, '(none)')
from pg_policies
where schemaname = 'public' and tablename = 'students'

order by category, key;
