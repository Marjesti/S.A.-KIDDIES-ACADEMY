-- ============================================================
-- Two fixes:
-- 1. "column reference id is ambiguous" -- upsert_parent_login's
--    own return type was called "id", which collides with the
--    "id" column on every table it queries internally. Renaming
--    the function's own output column avoids this entirely.
-- 2. Parents now sign in with an EMAIL ADDRESS, not an arbitrary
--    username -- matching how every other login in this system
--    already works. Real format validation is enforced.
--
-- Safe to run again, and safe even if you already ran the earlier
-- username-based version -- this renames that column in place.
-- ============================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'parent_logins' and column_name = 'username') then
    alter table parent_logins rename column username to email;
  end if;
end $$;

drop function if exists public.upsert_parent_login(text, text, bigint[]);
drop function if exists public.parent_login(text, text);

-- ============================================================
-- Admin-only: creates a NEW parent login, or updates an EXISTING
-- one (matched by email), setting the linked children to exactly
-- the list provided. The admin chooses both the email and the
-- PIN -- nothing is auto-generated.
-- ============================================================
create or replace function public.upsert_parent_login(p_email text, p_pin text, p_student_ids bigint[])
returns table (login_id bigint)
language plpgsql
security definer
as $$
declare
  v_school_id bigint;
  v_new_id bigint;
  v_bad_student bigint;
begin
  select school_id into v_school_id from profiles where id = auth.uid() and role = 'admin';
  if v_school_id is null then
    raise exception 'Not authorized.';
  end if;

  if p_email is null or trim(p_email) = '' then
    raise exception 'Email address is required.';
  end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'Select at least one child to link.';
  end if;

  select st.id into v_bad_student
  from unnest(p_student_ids) as sid(student_id)
  left join students st on st.id = sid.student_id and st.school_id = v_school_id
  where st.id is null
  limit 1;

  if v_bad_student is not null then
    raise exception 'One of the selected students was not found in your school.';
  end if;

  insert into parent_logins (school_id, email, pin_hash)
  values (v_school_id, lower(trim(p_email)), crypt(p_pin, gen_salt('bf')))
  on conflict (school_id, email) do update
    set pin_hash = excluded.pin_hash
  returning parent_logins.id into v_new_id;

  delete from parent_login_students where parent_login_id = v_new_id;
  insert into parent_login_students (parent_login_id, student_id)
  select v_new_id, student_id from unnest(p_student_ids) as student_id;

  return query select v_new_id;
end;
$$;

grant execute on function public.upsert_parent_login(text, text, bigint[]) to authenticated;

-- ============================================================
-- Public: verifies a parent's email + PIN and, if correct,
-- returns the complete current-term report for every linked
-- child. Same shape as before, just keyed by email now.
-- ============================================================
create or replace function public.parent_login(p_email text, p_pin text)
returns table (
  student_id bigint,
  student_name text,
  class_name text,
  year_label text,
  term text,
  subject_name text,
  ca_score numeric,
  exam_score numeric,
  total_score numeric,
  grade text,
  subject_position integer,
  subject_highest numeric,
  subject_lowest numeric,
  overall_position integer,
  g_total numeric,
  student_average numeric,
  class_highest_avg numeric,
  class_lowest_avg numeric,
  days_opened integer,
  days_present integer,
  days_absent integer,
  punctuality integer,
  attendance_rating integer,
  neatness integer,
  handwriting integer,
  politeness integer,
  initiative integer,
  attitude_to_school integer,
  teacher_remark text,
  headteacher_remark text,
  school_name text,
  school_logo_url text,
  school_address text,
  school_phone text
)
language plpgsql
security definer
as $$
declare
  v_login_id bigint;
  v_school_id bigint;
  v_session_id bigint;
  v_student_id bigint;
begin
  select pl.id, pl.school_id into v_login_id, v_school_id
  from parent_logins pl
  where lower(pl.email) = lower(trim(p_email))
    and pl.pin_hash = crypt(p_pin, pl.pin_hash);

  if v_login_id is null then
    return;
  end if;

  select acs.id into v_session_id from academic_sessions acs
  where acs.school_id = v_school_id and acs.is_active = true
  limit 1;

  if v_session_id is null then
    return;
  end if;

  for v_student_id in
    select pls.student_id from parent_login_students pls where pls.parent_login_id = v_login_id
  loop
    return query
    with class_results as (
      select r.*
      from results r
      join students st on st.id = r.student_id
      where r.session_id = v_session_id
        and st.class_id = (select class_id from students where id = v_student_id)
        and r.status = 'published'
    ),
    student_avgs as (
      select cr.student_id, avg(cr.total_score) as avg_score, sum(cr.total_score) as g_total
      from class_results cr
      group by cr.student_id
    )
    select
      v_student_id,
      s.name,
      c.name,
      ses.year_label,
      ses.term,
      sub.name,
      r.ca_score,
      r.exam_score,
      r.total_score,
      r.grade,
      (select count(*) + 1 from class_results r2
         where r2.subject_id = r.subject_id and r2.total_score > r.total_score),
      (select max(total_score) from class_results r3 where r3.subject_id = r.subject_id),
      (select min(total_score) from class_results r4 where r4.subject_id = r.subject_id),
      (select count(*) + 1 from student_avgs sa2 where sa2.avg_score > sa.avg_score),
      sa.g_total,
      sa.avg_score,
      (select max(avg_score) from student_avgs),
      (select min(avg_score) from student_avgs),
      n.days_opened,
      n.days_present,
      n.days_absent,
      n.punctuality,
      n.attendance_rating,
      n.neatness,
      n.handwriting,
      n.politeness,
      n.initiative,
      n.attitude_to_school,
      n.teacher_remark,
      n.headteacher_remark,
      sch.name,
      sch.logo_url,
      sch.address,
      sch.phone
    from students s
    join classes c on c.id = s.class_id
    join academic_sessions ses on ses.id = v_session_id
    join class_results r on r.student_id = s.id
    join subjects sub on sub.id = r.subject_id
    join student_avgs sa on sa.student_id = s.id
    join schools sch on sch.id = v_school_id
    left join student_term_notes n on n.student_id = s.id and n.session_id = v_session_id
    where s.id = v_student_id;
  end loop;
end;
$$;

grant execute on function public.parent_login(text, text) to anon;
