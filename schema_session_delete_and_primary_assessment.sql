-- ============================================================
-- SRMS FIX: academic-session deletion + Primary assessment split
--
-- 1) Promotion batches are historical records tied to an academic
--    session. If an admin deliberately deletes that session, its
--    promotion batch/decision records are deleted with it. This
--    removes the FK block while keeping the database consistent.
--
-- 2) Primary uses 40% CA + 60% Exam:
--       CA1 = 20, CA2 = 20, Exam = 60
--    Other sections keep the existing school defaults:
--       CA1 = ca1_max (normally 15), CA2 = ca2_max (normally 15), Exam = 70
-- ============================================================

-- ------------------------------------------------------------
-- PART 1: Allow academic sessions to be deleted safely.
-- ------------------------------------------------------------

ALTER TABLE public.promotion_batches
  DROP CONSTRAINT IF EXISTS promotion_batches_source_session_id_fkey;

ALTER TABLE public.promotion_batches
  ADD CONSTRAINT promotion_batches_source_session_id_fkey
  FOREIGN KEY (source_session_id)
  REFERENCES public.academic_sessions(id)
  ON DELETE CASCADE;

ALTER TABLE public.promotion_batches
  DROP CONSTRAINT IF EXISTS promotion_batches_destination_session_id_fkey;

ALTER TABLE public.promotion_batches
  ADD CONSTRAINT promotion_batches_destination_session_id_fkey
  FOREIGN KEY (destination_session_id)
  REFERENCES public.academic_sessions(id)
  ON DELETE CASCADE;

-- ------------------------------------------------------------
-- PART 2: Section-specific Primary assessment maxima.
-- ------------------------------------------------------------

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS primary_ca1_max NUMERIC NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS primary_ca2_max NUMERIC NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS primary_exam_max NUMERIC NOT NULL DEFAULT 60;

-- Ensure the intended Primary defaults are applied to existing schools
-- that are receiving this migration for the first time.
UPDATE public.schools
SET primary_ca1_max = 20,
    primary_ca2_max = 20,
    primary_exam_max = 60
WHERE primary_ca1_max IS NULL
   OR primary_ca2_max IS NULL
   OR primary_exam_max IS NULL;

-- ------------------------------------------------------------
-- PART 3: Validate Primary/other-section score limits in DB.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_result_score_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_section TEXT;
  v_ca1_max NUMERIC;
  v_ca2_max NUMERIC;
  v_exam_max NUMERIC;
BEGIN
  SELECT c.section
    INTO v_section
  FROM public.students s
  LEFT JOIN public.classes c ON c.id = s.class_id
  WHERE s.id = NEW.student_id
    AND s.school_id = NEW.school_id;

  IF lower(trim(coalesce(v_section, ''))) LIKE '%primary%' THEN
    SELECT primary_ca1_max, primary_ca2_max, primary_exam_max
      INTO v_ca1_max, v_ca2_max, v_exam_max
    FROM public.schools
    WHERE id = NEW.school_id;
  ELSE
    SELECT ca1_max, ca2_max, 70
      INTO v_ca1_max, v_ca2_max, v_exam_max
    FROM public.schools
    WHERE id = NEW.school_id;
  END IF;

  v_ca1_max := coalesce(v_ca1_max, 15);
  v_ca2_max := coalesce(v_ca2_max, 15);
  v_exam_max := coalesce(v_exam_max, 70);

  IF NEW.ca1_score IS NOT NULL AND NEW.ca1_score > v_ca1_max THEN
    RAISE EXCEPTION 'CA1 cannot exceed % marks for this student''s section.', v_ca1_max;
  END IF;

  IF NEW.ca2_score IS NOT NULL AND NEW.ca2_score > v_ca2_max THEN
    RAISE EXCEPTION 'CA2 cannot exceed % marks for this student''s section.', v_ca2_max;
  END IF;

  IF NEW.exam_score IS NOT NULL AND NEW.exam_score > v_exam_max THEN
    RAISE EXCEPTION 'Exam cannot exceed % marks for this student''s section.', v_exam_max;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_result_score_limits ON public.results;
CREATE TRIGGER trg_check_result_score_limits
BEFORE INSERT OR UPDATE ON public.results
FOR EACH ROW
EXECUTE FUNCTION public.check_result_score_limits();

-- Keep the existing older CA trigger from rejecting valid Primary CA1/CA2
-- values of 16-20 by making it section-aware too.
CREATE OR REPLACE FUNCTION public.check_ca_within_school_max()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_section TEXT;
  v_ca1_max NUMERIC;
  v_ca2_max NUMERIC;
BEGIN
  SELECT c.section
    INTO v_section
  FROM public.students s
  LEFT JOIN public.classes c ON c.id = s.class_id
  WHERE s.id = NEW.student_id
    AND s.school_id = NEW.school_id;

  IF lower(trim(coalesce(v_section, ''))) LIKE '%primary%' THEN
    SELECT primary_ca1_max, primary_ca2_max
      INTO v_ca1_max, v_ca2_max
    FROM public.schools
    WHERE id = NEW.school_id;
  ELSE
    SELECT ca1_max, ca2_max
      INTO v_ca1_max, v_ca2_max
    FROM public.schools
    WHERE id = NEW.school_id;
  END IF;

  IF NEW.ca1_score IS NOT NULL AND NEW.ca1_score > coalesce(v_ca1_max, 15) THEN
    RAISE EXCEPTION 'CA1 cannot exceed % marks for this student''s section.', coalesce(v_ca1_max, 15);
  END IF;

  IF NEW.ca2_score IS NOT NULL AND NEW.ca2_score > coalesce(v_ca2_max, 15) THEN
    RAISE EXCEPTION 'CA2 cannot exceed % marks for this student''s section.', coalesce(v_ca2_max, 15);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_ca_within_school_max ON public.results;
CREATE TRIGGER trg_check_ca_within_school_max
BEFORE INSERT OR UPDATE ON public.results
FOR EACH ROW
EXECUTE FUNCTION public.check_ca_within_school_max();
