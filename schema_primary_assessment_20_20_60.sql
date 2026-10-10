-- ============================================================
-- SRMS: PRIMARY ASSESSMENT STRUCTURE
-- Primary only: CA1 20 + CA2 20 + Exam 60 = 100.
-- Other sections retain the existing 15 + 15 + 70 structure.
-- This is section-aware and works with section values such as
-- "Primary" or "Primary School".
-- ============================================================

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS primary_ca1_max NUMERIC NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS primary_ca2_max NUMERIC NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS primary_exam_max NUMERIC NOT NULL DEFAULT 60;

UPDATE public.schools
SET primary_ca1_max = 20,
    primary_ca2_max = 20,
    primary_exam_max = 60;

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
  SELECT c.section INTO v_section
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

  IF NEW.ca1_score IS NOT NULL AND NEW.ca1_score > coalesce(v_ca1_max, 15) THEN
    RAISE EXCEPTION 'CA1 cannot exceed % marks for this student''s section.', coalesce(v_ca1_max, 15);
  END IF;
  IF NEW.ca2_score IS NOT NULL AND NEW.ca2_score > coalesce(v_ca2_max, 15) THEN
    RAISE EXCEPTION 'CA2 cannot exceed % marks for this student''s section.', coalesce(v_ca2_max, 15);
  END IF;
  IF NEW.exam_score IS NOT NULL AND NEW.exam_score > coalesce(v_exam_max, 70) THEN
    RAISE EXCEPTION 'Exam cannot exceed % marks for this student''s section.', coalesce(v_exam_max, 70);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_result_score_limits ON public.results;
CREATE TRIGGER trg_check_result_score_limits
BEFORE INSERT OR UPDATE ON public.results
FOR EACH ROW EXECUTE FUNCTION public.check_result_score_limits();

CREATE OR REPLACE FUNCTION public.check_ca_within_school_max()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_section TEXT;
  v_ca1_max NUMERIC;
  v_ca2_max NUMERIC;
BEGIN
  SELECT c.section INTO v_section
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
FOR EACH ROW EXECUTE FUNCTION public.check_ca_within_school_max();
