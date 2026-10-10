-- ============================================================
-- PART 1: CA1 / CA2 split
-- Adds two independently-editable CA columns. total ca_score is
-- now DERIVED (ca1 + ca2) via a trigger, kept in sync automatically
-- so nothing downstream (grading, report cards, analytics) needs
-- to change -- they all still just read ca_score.
--
-- Max marks per CA are school-configurable (no such config existed
-- before -- this adds the minimum needed rather than hardcoding
-- forever). Defaults to 15/15 to match the current 30-mark total.
-- ============================================================

alter table schools add column if not exists ca1_max numeric not null default 15;
alter table schools add column if not exists ca2_max numeric not null default 15;

alter table results add column if not exists ca1_score numeric;
alter table results add column if not exists ca2_score numeric;

-- Keep ca_score and total_score correct automatically whenever ca1/ca2 change,
-- so every existing feature (grading, report cards, analytics, verify page)
-- keeps working unmodified -- they already read ca_score/total_score.
create or replace function public.sync_ca_and_total()
returns trigger
language plpgsql
as $$
begin
  if new.ca1_score is not null or new.ca2_score is not null then
    new.ca_score := coalesce(new.ca1_score, 0) + coalesce(new.ca2_score, 0);
  end if;

  if new.ca_score is not null and new.exam_score is not null then
    new.total_score := new.ca_score + new.exam_score;
  else
    new.total_score := null;
  end if;

  -- If this is a genuine content edit (CA1/CA2/Exam actually changed) on a
  -- result that was already approved, silently send it back to pending so
  -- the Form Master reviews the corrected numbers, not the old ones.
  -- Pure status-transition updates (Approve/Publish) never touch these
  -- score columns, so they're untouched by this and proceed normally.
  if TG_OP = 'UPDATE' and OLD.status = 'approved' then
    if new.ca1_score is distinct from old.ca1_score
       or new.ca2_score is distinct from old.ca2_score
       or new.exam_score is distinct from old.exam_score then
      new.status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_ca_and_total on results;
create trigger trg_sync_ca_and_total
before insert or update on results
for each row
execute function public.sync_ca_and_total();

-- Stop a CA1/CA2 combination from ever exceeding this school's configured
-- 30-mark cap, enforced at the database level (not just the UI).
create or replace function public.check_ca_within_school_max()
returns trigger
language plpgsql
as $$
declare
  v_ca1_max numeric;
  v_ca2_max numeric;
begin
  select ca1_max, ca2_max into v_ca1_max, v_ca2_max from schools where id = new.school_id;

  if new.ca1_score is not null and new.ca1_score > coalesce(v_ca1_max, 15) then
    raise exception 'CA1 cannot exceed % marks for this school.', coalesce(v_ca1_max, 15);
  end if;
  if new.ca2_score is not null and new.ca2_score > coalesce(v_ca2_max, 15) then
    raise exception 'CA2 cannot exceed % marks for this school.', coalesce(v_ca2_max, 15);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_ca_within_school_max on results;
create trigger trg_check_ca_within_school_max
before insert or update on results
for each row
execute function public.check_ca_within_school_max();

-- ============================================================
-- PART 2: Editable through approval, locked only at publish --
-- enforced in RLS itself, not just hidden in the UI.
-- ============================================================

drop policy if exists "Teachers can edit their own pending submissions" on results;
create policy "Teachers can edit their own submissions before publish"
on results
for update
using (
  submitted_by = auth.uid() and status in ('pending', 'approved')
)
with check (
  submitted_by = auth.uid() and status in ('pending', 'approved')
);

-- DELETE stays scoped to pending only, deliberately -- once a Form Master
-- has approved a result, removing it entirely (rather than correcting it)
-- is a bigger action than this feature asked to unlock. Admin's own
-- unrestricted delete policy still covers any exceptional case.
-- (No change needed here -- confirming it's left as-is on purpose.)
