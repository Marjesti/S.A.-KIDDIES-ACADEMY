-- ============================================================
-- S.A. KIDDIES ACADEMY SRMS
-- FORM MASTER STUDENT MANAGEMENT
-- ============================================================
--
-- Admin-controlled permission for Form Masters to:
--   • Add students to their own Form Master class
--   • Edit students in their own Form Master class
--   • Never remove/delete students
--
-- Admins retain their existing full student-management access.
--
-- The switch can be turned ON/OFF at any time by an admin.
-- Existing students and existing Form Master assignments are kept.
-- ============================================================


-- ============================================================
-- 1. ADD THE ADMIN CONTROL SWITCH
-- ============================================================

ALTER TABLE public.schools
ADD COLUMN IF NOT EXISTS form_master_student_edit_enabled
BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 2. FORM MASTERS: VIEW THEIR OWN CLASS
-- ============================================================
--
-- This policy is included so the feature remains self-contained.
-- It is safe to run repeatedly.

DROP POLICY IF EXISTS "Form masters can view their class's students"
ON public.students;

CREATE POLICY "Form masters can view their class's students"
ON public.students
FOR SELECT
TO authenticated
USING (
    class_id IN (
        SELECT t.form_master_class_id
        FROM public.teachers t
        WHERE t.profile_id = auth.uid()
          AND t.form_master_class_id IS NOT NULL
    )
);


-- ============================================================
-- 3. FORM MASTERS: ADD STUDENTS
-- ============================================================
--
-- The school switch MUST be ON.
-- The new student MUST belong to the Form Master's own class.
--
-- This is deliberately a RESTRICTIVE policy so an existing broad
-- INSERT policy cannot accidentally bypass this feature's switch.

DROP POLICY IF EXISTS "Restrict Form Master student inserts"
ON public.students;

CREATE POLICY "Restrict Form Master student inserts"
ON public.students
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
              AND p.school_id = students.school_id
        )
    )
    OR
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.schools sc
              ON sc.id = p.school_id
            JOIN public.teachers t
              ON t.profile_id = p.id
            WHERE p.id = auth.uid()
              AND p.role = 'teacher'
              AND p.school_id = students.school_id
              AND sc.form_master_student_edit_enabled = TRUE
              AND t.form_master_class_id IS NOT NULL
              AND t.form_master_class_id = students.class_id
        )
    )
);


-- ============================================================
-- 4. FORM MASTERS: EDIT STUDENTS
-- ============================================================
--
-- USING checks the existing student belongs to their Form Master
-- class.
-- WITH CHECK prevents them from moving the student to another class
-- or another school during an edit.

DROP POLICY IF EXISTS "Restrict Form Master student updates"
ON public.students;

CREATE POLICY "Restrict Form Master student updates"
ON public.students
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
              AND p.school_id = students.school_id
        )
    )
    OR
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.schools sc
              ON sc.id = p.school_id
            JOIN public.teachers t
              ON t.profile_id = p.id
            WHERE p.id = auth.uid()
              AND p.role = 'teacher'
              AND p.school_id = students.school_id
              AND sc.form_master_student_edit_enabled = TRUE
              AND t.form_master_class_id IS NOT NULL
              AND t.form_master_class_id = students.class_id
        )
    )
)
WITH CHECK (
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
              AND p.school_id = students.school_id
        )
    )
    OR
    (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.schools sc
              ON sc.id = p.school_id
            JOIN public.teachers t
              ON t.profile_id = p.id
            WHERE p.id = auth.uid()
              AND p.role = 'teacher'
              AND p.school_id = students.school_id
              AND sc.form_master_student_edit_enabled = TRUE
              AND t.form_master_class_id IS NOT NULL
              AND t.form_master_class_id = students.class_id
        )
    )
);


-- ============================================================
-- 5. FORM MASTERS: NEVER DELETE STUDENTS
-- ============================================================
--
-- Admins are explicitly allowed through this restrictive guard.
-- Form Masters are always rejected for DELETE.

DROP POLICY IF EXISTS "Restrict student deletes to admins"
ON public.students;

CREATE POLICY "Restrict student deletes to admins"
ON public.students
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
          AND p.school_id = students.school_id
    )
);


-- ============================================================
-- 6. VERIFY THE SETTING
-- ============================================================

SELECT
    id,
    name,
    form_master_student_edit_enabled
FROM public.schools
ORDER BY id;
