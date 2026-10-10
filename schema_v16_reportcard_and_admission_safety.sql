-- SRMS V16 MIGRATION: report-card signature URLs + immutable unique admission numbers
-- Run duplicate check first. If rows are returned, resolve them manually before index creation.
SELECT school_id, admission_no, COUNT(*) AS duplicate_count
FROM public.students
WHERE NULLIF(BTRIM(admission_no), '') IS NOT NULL
GROUP BY school_id, admission_no
HAVING COUNT(*) > 1;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS principal_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS headteacher_signature_url TEXT;

-- Generator must only fill blank admission numbers during INSERT.
CREATE OR REPLACE FUNCTION public.auto_generate_student_admission_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND NULLIF(BTRIM(COALESCE(NEW.admission_no, '')), '') IS NULL
     AND NEW.school_id IS NOT NULL AND NEW.class_id IS NOT NULL THEN
    NEW.admission_no := public.generate_student_admission_no(NEW.school_id, NEW.class_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_generate_student_admission_no ON public.students;
CREATE TRIGGER trg_auto_generate_student_admission_no
BEFORE INSERT ON public.students
FOR EACH ROW EXECUTE FUNCTION public.auto_generate_student_admission_no();

-- Do not silently alter admission numbers during student updates.
CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_no_unique
ON public.students (school_id, admission_no)
WHERE admission_no IS NOT NULL AND BTRIM(admission_no) <> '';
