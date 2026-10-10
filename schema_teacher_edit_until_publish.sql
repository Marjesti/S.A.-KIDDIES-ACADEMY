-- S.A. Kiddies Academy SRMS: allow teachers to update their own results
-- while pending or approved. Published results remain locked to teachers.
-- Run in Supabase SQL Editor. This does not change email notifications.

DROP POLICY IF EXISTS "Teachers can edit their own pending submissions" ON public.results;
DROP POLICY IF EXISTS "Teachers can edit their own submissions before publish" ON public.results;
CREATE POLICY "Teachers can edit their own submissions before publish"
ON public.results FOR UPDATE
USING (submitted_by = auth.uid() AND status IN ('pending', 'approved'))
WITH CHECK (submitted_by = auth.uid() AND status IN ('pending', 'approved'));

-- Keep the automatic calculation and review workflow: when an approved result's
-- marks change, the existing sync_ca_and_total trigger returns it to pending.
-- Published records cannot be updated by the teacher policy above.
