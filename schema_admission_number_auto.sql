-- ============================================================
-- S.A. KIDDIES ACADEMY SRMS
-- AUTOMATIC STUDENT ADMISSION NUMBERS
-- Format: SAK/SECTION/YY/NNNN
-- Examples: SAK/NUR/26/0001, SAK/PR/26/0001, SAK/JS/26/0001, SAK/SS/26/0001
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admission_number_counters (
    school_id BIGINT NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    section_code TEXT NOT NULL CHECK (section_code IN ('NUR','PR','JS','SS')),
    admission_year INTEGER NOT NULL CHECK (admission_year BETWEEN 2000 AND 2100),
    last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    PRIMARY KEY (school_id, section_code, admission_year)
);

-- Expand the existing counter constraint safely for Nursery/Pre-Nursery.
ALTER TABLE public.admission_number_counters DROP CONSTRAINT IF EXISTS admission_number_counters_section_code_check;
ALTER TABLE public.admission_number_counters ADD CONSTRAINT admission_number_counters_section_code_check CHECK (section_code IN ('NUR','PR','JS','SS'));

CREATE INDEX IF NOT EXISTS idx_admission_number_counters_school
ON public.admission_number_counters(school_id, admission_year);

CREATE OR REPLACE FUNCTION public.admission_section_code(p_section TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v TEXT := LOWER(TRIM(COALESCE(p_section, '')));
BEGIN
    IF v LIKE '%nursery%' OR v LIKE '%pre-nursery%' OR v LIKE '%playgroup%' OR v = 'nur' THEN
        RETURN 'NUR';
    ELSIF v LIKE '%primary%' OR v IN ('pr', 'pri') THEN
        RETURN 'PR';
    ELSIF v LIKE '%junior%' OR v LIKE '%jss%' OR v = 'js' THEN
        RETURN 'JS';
    ELSIF v LIKE '%senior%' OR v LIKE '%sss%' OR v = 'ss' THEN
        RETURN 'SS';
    END IF;
    RETURN NULL;
END;
$$;

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
    v_last INTEGER;
    v_existing_max INTEGER;
    v_next INTEGER := 1;
    v_number_in_use BOOLEAN;
BEGIN
    IF p_school_id IS NULL OR p_class_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT c.section
    INTO v_section
    FROM public.classes c
    WHERE c.id = p_class_id
      AND c.school_id = p_school_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cannot generate admission number: class not found in this school.';
    END IF;

    v_code := public.admission_section_code(v_section);

    IF v_code IS NULL THEN
        RAISE EXCEPTION
            'Cannot generate admission number: class section "%" is not Nursery/Pre-Nursery, Primary, Junior Secondary, or Senior Secondary.',
            COALESCE(v_section, '');
    END IF;

    v_year2 := RIGHT(v_year::TEXT, 2);

    INSERT INTO public.admission_number_counters (
        school_id, section_code, admission_year, last_number
    )
    VALUES (p_school_id, v_code, v_year, 0)
    ON CONFLICT (school_id, section_code, admission_year) DO NOTHING;

    -- Lock this section/year counter so simultaneous student creation
    -- cannot receive the same number.
    SELECT last_number
    INTO v_last
    FROM public.admission_number_counters
    WHERE school_id = p_school_id
      AND section_code = v_code
      AND admission_year = v_year
    FOR UPDATE;

    -- Find the FIRST available serial rather than using MAX + 1.
    -- This fills missing gaps (for example, 0002) before moving to 0005.
    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM public.students s
            WHERE s.school_id = p_school_id
              AND s.admission_no = FORMAT(
                  'SAK/%s/%s/%s', v_code, v_year2, LPAD(v_next::TEXT, 4, '0')
              )
        ) INTO v_number_in_use;

        EXIT WHEN NOT v_number_in_use;
        v_next := v_next + 1;

        IF v_next > 9999 THEN
            RAISE EXCEPTION 'All 4-digit admission numbers are in use for section % and year %.', v_code, v_year2;
        END IF;
    END LOOP;

    UPDATE public.admission_number_counters
    SET last_number = GREATEST(COALESCE(last_number, 0), v_next)
    WHERE school_id = p_school_id
      AND section_code = v_code
      AND admission_year = v_year;

    RETURN FORMAT('SAK/%s/%s/%s', v_code, v_year2, LPAD(v_next::TEXT, 4, '0'));
END;
$$;

-- Generate automatically only when a student is first inserted.
-- Updating a student's name, contact details, photo, or class must never
-- silently change their established admission number.
CREATE OR REPLACE FUNCTION public.auto_generate_student_admission_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT'
       AND NULLIF(BTRIM(COALESCE(NEW.admission_no, '')), '') IS NULL
       AND NEW.school_id IS NOT NULL
       AND NEW.class_id IS NOT NULL THEN
        NEW.admission_no := public.generate_student_admission_no(
            NEW.school_id,
            NEW.class_id
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_generate_student_admission_no
ON public.students;

CREATE TRIGGER trg_auto_generate_student_admission_no
BEFORE INSERT
ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_student_admission_no();

-- Backfill students who currently have no admission number and already
-- belong to a supported class. Existing admission numbers are untouched.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT s.id, s.school_id, s.class_id
        FROM public.students s
        WHERE NULLIF(BTRIM(COALESCE(s.admission_no, '')), '') IS NULL
          AND s.class_id IS NOT NULL
        ORDER BY s.school_id, s.id
    LOOP
        UPDATE public.students
        SET admission_no = public.generate_student_admission_no(r.school_id, r.class_id)
        WHERE id = r.id
          AND school_id = r.school_id
          AND NULLIF(BTRIM(COALESCE(admission_no, '')), '') IS NULL;
    END LOOP;
END;
$$;

-- ============================================================
-- FORM MASTER RPC SAFETY
-- New Form Master students always receive an automatic number.
-- Existing Form Master students keep their current number unless a
-- non-empty admission number is explicitly supplied by legacy code.
-- ============================================================

CREATE OR REPLACE FUNCTION public.form_master_add_student(
    p_name TEXT,
    p_admission_no TEXT DEFAULT NULL,
    p_guardian_email TEXT DEFAULT NULL,
    p_guardian_phone TEXT DEFAULT NULL,
    p_photo_path TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_school_id BIGINT;
    v_class_id BIGINT;
    v_student_id BIGINT;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    SELECT p.school_id, t.form_master_class_id
    INTO v_school_id, v_class_id
    FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id
    JOIN public.schools sc ON sc.id = p.school_id
    WHERE p.id = v_user_id
      AND p.role = 'teacher'
      AND t.form_master_class_id IS NOT NULL
      AND sc.form_master_student_edit_enabled = TRUE
    LIMIT 1;

    IF v_school_id IS NULL OR v_class_id IS NULL THEN
        RAISE EXCEPTION 'Form Master student adding is currently disabled by the administrator.';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Student name is required.';
    END IF;

    INSERT INTO public.students (
        school_id, class_id, name, admission_no,
        guardian_email, guardian_phone, photo_path
    )
    VALUES (
        v_school_id, v_class_id, BTRIM(p_name), NULL,
        NULLIF(BTRIM(COALESCE(p_guardian_email, '')), ''),
        NULLIF(BTRIM(COALESCE(p_guardian_phone, '')), ''),
        NULLIF(BTRIM(COALESCE(p_photo_path, '')), '')
    )
    RETURNING id INTO v_student_id;

    RETURN v_student_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.form_master_update_student(
    p_student_id BIGINT,
    p_name TEXT,
    p_admission_no TEXT DEFAULT NULL,
    p_guardian_email TEXT DEFAULT NULL,
    p_guardian_phone TEXT DEFAULT NULL,
    p_photo_path TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_school_id BIGINT;
    v_class_id BIGINT;
    v_student_school_id BIGINT;
    v_student_class_id BIGINT;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    SELECT p.school_id, t.form_master_class_id
    INTO v_school_id, v_class_id
    FROM public.profiles p
    JOIN public.teachers t ON t.profile_id = p.id
    JOIN public.schools sc ON sc.id = p.school_id
    WHERE p.id = v_user_id
      AND p.role = 'teacher'
      AND t.form_master_class_id IS NOT NULL
      AND sc.form_master_student_edit_enabled = TRUE
    LIMIT 1;

    IF v_school_id IS NULL OR v_class_id IS NULL THEN
        RAISE EXCEPTION 'Form Master student editing is currently disabled by the administrator.';
    END IF;

    SELECT s.school_id, s.class_id
    INTO v_student_school_id, v_student_class_id
    FROM public.students s
    WHERE s.id = p_student_id
    LIMIT 1;

    IF v_student_school_id IS NULL THEN
        RAISE EXCEPTION 'Student not found.';
    END IF;

    IF v_student_school_id <> v_school_id OR v_student_class_id <> v_class_id THEN
        RAISE EXCEPTION 'You can only edit students in your Form Master class.';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Student name is required.';
    END IF;

    UPDATE public.students
    SET
        name = BTRIM(p_name),
        admission_no = CASE
            WHEN NULLIF(BTRIM(COALESCE(p_admission_no, '')), '') IS NULL
                THEN admission_no
            ELSE BTRIM(p_admission_no)
        END,
        guardian_email = NULLIF(BTRIM(COALESCE(p_guardian_email, '')), ''),
        guardian_phone = NULLIF(BTRIM(COALESCE(p_guardian_phone, '')), ''),
        photo_path = CASE
            WHEN p_photo_path IS NULL THEN photo_path
            ELSE NULLIF(BTRIM(p_photo_path), '')
        END
    WHERE id = p_student_id;

    RETURN p_student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.form_master_add_student(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_master_update_student(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_master_add_student(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.form_master_update_student(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Verify before/after migration with:
-- SELECT id, name, admission_no, class_id FROM public.students ORDER BY id;

-- The counter is internal; clients should use the trigger/RPC, not this table.
ALTER TABLE public.admission_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admission_number_counters FROM anon, authenticated;


-- ============================================================
-- V16 SAFETY: immutable-on-update admission numbers + uniqueness
-- ============================================================
-- Before creating the unique index, check whether old duplicates exist.
-- If any are returned, resolve those duplicates manually before rerunning
-- the CREATE UNIQUE INDEX statement. Do not automatically renumber students.
-- SELECT school_id, admission_no, COUNT(*)
-- FROM public.students
-- WHERE NULLIF(BTRIM(admission_no), '') IS NOT NULL
-- GROUP BY school_id, admission_no HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_no_unique
ON public.students (school_id, admission_no)
WHERE admission_no IS NOT NULL AND BTRIM(admission_no) <> '';

-- Add URL fields for the administrator to save their own preferred signature PNGs.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS principal_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS headteacher_signature_url TEXT;


-- ============================================================
-- V17: FIRST-MISSING SERIAL + IMMUTABLE EXISTING ADMISSION NO.
-- ============================================================

-- The generator above now searches from 0001 for the first unused serial.
-- Preserve an established admission number during any UPDATE, regardless
-- of which frontend or legacy function performs the update.
CREATE OR REPLACE FUNCTION public.keep_existing_student_admission_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NULLIF(BTRIM(COALESCE(OLD.admission_no, '')), '') IS NOT NULL THEN
        NEW.admission_no := OLD.admission_no;
    ELSIF TG_OP = 'UPDATE'
       AND NULLIF(BTRIM(COALESCE(NEW.admission_no, '')), '') IS NULL
       AND NEW.school_id IS NOT NULL
       AND NEW.class_id IS NOT NULL THEN
        NEW.admission_no := public.generate_student_admission_no(NEW.school_id, NEW.class_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_existing_student_admission_no ON public.students;
CREATE TRIGGER trg_keep_existing_student_admission_no
BEFORE UPDATE OF admission_no ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.keep_existing_student_admission_no();

-- Ensure a manual or automatically generated admission number is unique
-- within each school. Check duplicates before creating this index.
-- SELECT school_id, admission_no, COUNT(*) FROM public.students
-- WHERE NULLIF(BTRIM(admission_no), '') IS NOT NULL
-- GROUP BY school_id, admission_no HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_no_unique
ON public.students (school_id, admission_no)
WHERE admission_no IS NOT NULL AND BTRIM(admission_no) <> '';
