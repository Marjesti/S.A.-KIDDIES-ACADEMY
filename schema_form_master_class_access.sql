-- ============================================================
-- PART 3: Form Master class-level access, enforced in RLS.
--
-- This ONLY ADDS policies under names unique to this feature --
-- it never touches or replaces any existing policy on these
-- tables, so nothing already working can be weakened by this.
--
-- Mirrors the exact pattern your existing, working
-- "Form masters can view all results for their form class" policy
-- already uses: t.form_master_class_id = <the student's class>,
-- scoped to t.profile_id = auth.uid().
-- ============================================================

drop policy if exists "Form masters can view their class's students" on students;
create policy "Form masters can view their class's students"
on students
for select
using (
  class_id in (
    select t.form_master_class_id from teachers t
    where t.profile_id = auth.uid() and t.form_master_class_id is not null
  )
);

drop policy if exists "Form masters can view their class's term notes" on student_term_notes;
create policy "Form masters can view their class's term notes"
on student_term_notes
for select
using (
  student_id in (
    select st.id from students st
    join teachers t on t.form_master_class_id = st.class_id
    where t.profile_id = auth.uid()
  )
);
