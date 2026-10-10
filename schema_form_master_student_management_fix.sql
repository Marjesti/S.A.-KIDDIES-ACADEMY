-- ============================================================
-- S.A. KIDDIES ACADEMY SRMS
-- FORM MASTER STUDENT MANAGEMENT - RLS WRITE FIX
-- ============================================================
--
-- Fixes:
--   "new row violates row-level security policy for table students"
--
-- Form Masters write students through SECURITY DEFINER RPC functions.
-- The database functions enforce the permission themselves:
--   1. User must be a teacher.
--   2. The teacher must have a Form Master class.
--   3. Admin must have enabled the school setting.
--   4. A new student is automatically placed in that Form Master's class.
--   5. An existing student can only be edited if it is in that class.
--   6. Class/school cannot be changed by the Form Master.
--   7. Form Masters cannot delete students.
--
-- Existing QR tokens, students and teacher assignments are untouched.
-- ============================================================


-- ============================================================
-- 1. FORM MASTER: ADD STUDENT
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

    SELECT
        p.school_id,
        t.form_master_class_id
    INTO
        v_school_id,
        v_class_id
    FROM public.profiles p
    JOIN public.teachers t
      ON t.profile_id = p.id
    JOIN public.schools sc
      ON sc.id = p.school_id
    WHERE p.id = v_user_id
      AND p.role = 'teacher'
      AND t.form_master_class_id IS NOT NULL
      AND sc.form_master_student_edit_enabled = TRUE
    LIMIT 1;

    IF v_school_id IS NULL OR v_class_id IS NULL THEN
        RAISE EXCEPTION
            'Form Master student adding is currently disabled by the administrator.';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Student name is required.';
    END IF;

    INSERT INTO public.students (
        school_id,
        class_id,
        name,
        admission_no,
        guardian_email,
        guardian_phone,
        photo_path
    )
    VALUES (
        v_school_id,
        v_class_id,
        BTRIM(p_name),
        NULLIF(BTRIM(COALESCE(p_admission_no, '')), ''),
        NULLIF(BTRIM(COALESCE(p_guardian_email, '')), ''),
        NULLIF(BTRIM(COALESCE(p_guardian_phone, '')), ''),
        NULLIF(BTRIM(COALESCE(p_photo_path, '')), '')
    )
    RETURNING id INTO v_student_id;

    RETURN v_student_id;
END;
$$;


-- ============================================================
-- 2. FORM MASTER: UPDATE STUDENT
-- ============================================================

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

    SELECT
        p.school_id,
        t.form_master_class_id
    INTO
        v_school_id,
        v_class_id
    FROM public.profiles p
    JOIN public.teachers t
      ON t.profile_id = p.id
    JOIN public.schools sc
      ON sc.id = p.school_id
    WHERE p.id = v_user_id
      AND p.role = 'teacher'
      AND t.form_master_class_id IS NOT NULL
      AND sc.form_master_student_edit_enabled = TRUE
    LIMIT 1;

    IF v_school_id IS NULL OR v_class_id IS NULL THEN
        RAISE EXCEPTION
            'Form Master student editing is currently disabled by the administrator.';
    END IF;

    SELECT
        s.school_id,
        s.class_id
    INTO
        v_student_school_id,
        v_student_class_id
    FROM public.students s
    WHERE s.id = p_student_id
    LIMIT 1;

    IF v_student_school_id IS NULL THEN
        RAISE EXCEPTION 'Student not found.';
    END IF;

    IF v_student_school_id <> v_school_id
       OR v_student_class_id <> v_class_id THEN
        RAISE EXCEPTION
            'You can only edit students in your Form Master class.';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Student name is required.';
    END IF;

    UPDATE public.students
    SET
        name = BTRIM(p_name),
        admission_no = NULLIF(BTRIM(COALESCE(p_admission_no, '')), ''),
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


-- ============================================================
-- 3. ONLY SIGNED-IN USERS MAY CALL THE FUNCTIONS
-- ============================================================

REVOKE ALL
ON FUNCTION public.form_master_add_student(TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.form_master_update_student(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.form_master_add_student(TEXT, TEXT, TEXT, TEXT, TEXT)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.form_master_update_student(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT)
TO authenticated;


-- ============================================================
-- 4. CONFIRM THE ADMIN SWITCH
-- ============================================================

SELECT
    id,
    name,
    form_master_student_edit_enabled
FROM public.schools
ORDER BY id;
