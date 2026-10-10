-- ============================================================
-- S.A. KIDDIES ACADEMY SRMS
-- Teacher timetable read-only access
--
-- Teachers can read ONLY timetable entries assigned to their
-- own teacher record. Admins retain full timetable visibility.
-- No timetable data is changed by this migration.
-- ============================================================

ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "School users view timetable entries"
ON public.timetable_entries;

CREATE POLICY "Admins and teachers view permitted timetable entries"
ON public.timetable_entries
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.school_id = timetable_entries.school_id
          AND (
              p.role = 'admin'
              OR (
                  p.role = 'teacher'
                  AND EXISTS (
                      SELECT 1
                      FROM public.teachers t
                      WHERE t.id = timetable_entries.teacher_id
                        AND t.profile_id = auth.uid()
                        AND t.school_id = p.school_id
                  )
              )
          )
    )
);
