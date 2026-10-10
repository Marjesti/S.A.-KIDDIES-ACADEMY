-- S.A. KIDDIES ACADEMY SRMS V17
-- 1) Find first missing admission serial before using higher numbers.
-- 2) Preserve any existing admission number on student updates.
-- 3) Permit manual numbers on new-student inserts (the existing insert
--    generator only fills the field when it is blank).
-- 4) Enforce per-school uniqueness.
-- IMPORTANT: Run the duplicate check first. If it returns rows, resolve
-- duplicates manually before creating the unique index.

SELECT school_id, admission_no, COUNT(*) AS duplicate_count
FROM public.students
WHERE NULLIF(BTRIM(admission_no), '') IS NOT NULL
GROUP BY school_id, admission_no
HAVING COUNT(*) > 1;

CREATE OR REPLACE FUNCTION public.generate_student_admission_no(
    p_school_id BIGINT,
    p_class_id BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_section TEXT;
    v_code TEXT;
    v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    v_year2 TEXT;
    v_next INTEGER := 1;
    v_number_in_use BOOLEAN;
BEGIN
    IF p_school_id IS NULL OR p_class_id IS NULL THEN RETURN NULL; END IF;

    SELECT c.section INTO v_section
    FROM public.classes c
    WHERE c.id = p_class_id AND c.school_id = p_school_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cannot generate admission number: class not found in this school.';
    END IF;

    v_code := public.admission_section_code(v_section);
    IF v_code IS NULL THEN
        RAISE EXCEPTION 'Cannot generate admission number: unsupported class section "%".', COALESCE(v_section, '');
    END IF;
    v_year2 := RIGHT(v_year::TEXT, 2);

    INSERT INTO public.admission_number_counters(school_id, section_code, admission_year, last_number)
    VALUES (p_school_id, v_code, v_year, 0)
    ON CONFLICT (school_id, section_code, admission_year) DO NOTHING;

    PERFORM 1 FROM public.admission_number_counters
    WHERE school_id = p_school_id AND section_code = v_code AND admission_year = v_year
    FOR UPDATE;

    LOOP
        SELECT EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.school_id = p_school_id
              AND s.admission_no = FORMAT('SAK/%s/%s/%s', v_code, v_year2, LPAD(v_next::TEXT, 4, '0'))
        ) INTO v_number_in_use;
        EXIT WHEN NOT v_number_in_use;
        v_next := v_next + 1;
        IF v_next > 9999 THEN
            RAISE EXCEPTION 'All 4-digit admission numbers are in use for section % and year %.', v_code, v_year2;
        END IF;
    END LOOP;

    UPDATE public.admission_number_counters
    SET last_number = GREATEST(COALESCE(last_number, 0), v_next)
    WHERE school_id = p_school_id AND section_code = v_code AND admission_year = v_year;

    RETURN FORMAT('SAK/%s/%s/%s', v_code, v_year2, LPAD(v_next::TEXT, 4, '0'));
END;
$$;

CREATE OR REPLACE FUNCTION public.keep_existing_student_admission_no()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NULLIF(BTRIM(COALESCE(OLD.admission_no, '')), '') IS NOT NULL THEN
        NEW.admission_no := OLD.admission_no;
    ELSIF TG_OP = 'UPDATE'
      AND NULLIF(BTRIM(COALESCE(NEW.admission_no, '')), '') IS NULL
      AND NEW.school_id IS NOT NULL AND NEW.class_id IS NOT NULL THEN
        NEW.admission_no := public.generate_student_admission_no(NEW.school_id, NEW.class_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_existing_student_admission_no ON public.students;
CREATE TRIGGER trg_keep_existing_student_admission_no
BEFORE UPDATE OF admission_no ON public.students
FOR EACH ROW EXECUTE FUNCTION public.keep_existing_student_admission_no();

-- Backfill currently blank admission numbers only; never overwrite a number.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, school_id, class_id FROM public.students
           WHERE NULLIF(BTRIM(COALESCE(admission_no, '')), '') IS NULL AND class_id IS NOT NULL
           ORDER BY school_id, id
  LOOP
    UPDATE public.students
    SET admission_no = public.generate_student_admission_no(r.school_id, r.class_id)
    WHERE id = r.id AND school_id = r.school_id
      AND NULLIF(BTRIM(COALESCE(admission_no, '')), '') IS NULL;
  END LOOP;
END;
$$;

-- Run only after the duplicate-check query above returns zero rows.
CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_no_unique
ON public.students (school_id, admission_no)
WHERE admission_no IS NOT NULL AND BTRIM(admission_no) <> '';
