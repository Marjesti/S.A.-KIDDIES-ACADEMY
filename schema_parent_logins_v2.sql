-- ============================================================
-- Redesigns parent logins:
-- 1. One parent login can now link to MULTIPLE children (siblings),
--    not just one student.
-- 2. The admin now chooses the username and PIN directly, instead
--    of the system auto-generating them.
--
-- If you already ran the earlier schema_parent_logins.sql, this
-- migrates any logins created that way onto the new structure
-- automatically. Safe to run again either way.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists parent_logins (
  id bigint generated always as identity primary key,
  school_id bigint not null references schools(id) on delete cascade,
  username text not null,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists parent_logins_username_per_school
  on parent_logins (school_id, username);

create table if not exists parent_login_students (
  parent_login_id bigint not null references parent_logins(id) on delete cascade,
  student_id bigint not null references students(id) on delete cascade,
  primary key (parent_login_id, student_id)
);

-- If the OLD one-child-per-login version of this table exists, migrate its
-- links into the new junction table, then drop the now-unused column.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'parent_logins' and column_name = 'student_id') then
    insert into parent_login_students (parent_login_id, student_id)
    select id, student_id from parent_logins where student_id is not null
    on conflict do nothing;

    alter table parent_logins drop column student_id;
  end if;
end $$;

alter table parent_logins enable row level security;
alter table parent_login_students enable row level security;

drop policy if exists "Admins can manage parent logins for their school" on parent_logins;
create policy "Admins can manage parent logins for their school"
on parent_logins
for all
using (
  school_id in (select school_id from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
)
with check (
  school_id in (select school_id from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

drop policy if exists "Admins can manage parent login student links" on parent_login_students;
create policy "Admins can manage parent login student links"
on parent_login_students
for all
using (
  parent_login_id in (
    select id from parent_logins
    where school_id in (select school_id from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  )
)
with check (
  parent_login_id in (
    select id from parent_logins
    where school_id in (select school_id from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  )
);

-- Drop the old single-student version of this function before recreating it
-- with a different signature (Postgres treats a different parameter list as
-- a completely different function, so the old one needs removing explicitly).
drop function if exists public.create_parent_login(bigint);

-- ============================================================
-- Admin-only: creates a NEW parent login, or updates an EXISTING
-- one (matched by username), setting the linked children to
-- exactly the list provided. The admin chooses both the username
-- and the PIN -- nothing is auto-generated.
-- ============================================================
create or replace function public.upsert_parent_login(p_username text, p_pin text, p_student_ids bigint[])
returns table (id bigint)
language plpgsql
security definer
as $$
declare
  v_school_id bigint;
  v_login_id bigint;
  v_bad_student bigint;
begin
  select school_id into v_school_id from profiles where id = auth.uid() and role = 'admin';
  if v_school_id is null then
    raise exception 'Not authorized.';
  end if;

  if p_username is null or trim(p_username) = '' then
    raise exception 'Username is required.';
  end if;
  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'Select at least one child to link.';
  end if;

  select st.id into v_bad_student
  from unnest(p_student_ids) as sid(id)
  left join students st on st.id = sid.id and st.school_id = v_school_id
  where st.id is null
  limit 1;

  if v_bad_student is not null then
    raise exception 'One of the selected students was not found in your school.';
  end if;

  insert into parent_logins (school_id, username, pin_hash)
  values (v_school_id, trim(p_username), crypt(p_pin, gen_salt('bf')))
  on conflict (school_id, username) do update
    set pin_hash = excluded.pin_hash
  returning parent_logins.id into v_login_id;

  delete from parent_login_students where parent_login_id = v_login_id;
  insert into parent_login_students (parent_login_id, student_id)
  select v_login_id, sid from unnest(p_student_ids) as sid;

  return query select v_login_id;
end;
$$;

grant execute on function public.upsert_parent_login(text, text, bigint[]) to authenticated;

-- Drop the old single-student version of this function too, before recreating
-- it with a new return shape (each row now also identifies which child it's for).
drop function if exists public.parent_login(text, text);

-- ============================================================
-- Public: verifies a parent's username + PIN and, if correct,
-- returns the complete current-term report for EVERY child linked
-- to that login (scores with class ranking, attendance, every
-- behaviour field, both remarks, and school branding). Each row
-- is tagged with student_id so the app can group rows into one
-- report card per child.
-- ============================================================
create or replace function public.parent_login(p_username text, p_pin text)
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
  where lower(pl.username) = lower(p_username)
    and pl.pin_hash = crypt(p_pin, pl.pin_hash);

  if v_login_id is null then
    return; -- wrong username/PIN: zero rows, same as "not found"
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
