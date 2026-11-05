-- =============================================================================
-- 02. ROW LEVEL SECURITY + RPC
-- Chạy file này SAU schema.sql.
-- Nguyên tắc: mọi bảng dữ liệu người dùng đều bật RLS, mọi policy đều dùng
-- auth.uid() để chỉ cho phép đọc/ghi đúng dữ liệu của chính phiên hiện tại.
-- =============================================================================

alter table public.vocabulary        enable row level security;
alter table public.learning_progress enable row level security;
alter table public.review_records    enable row level security;
alter table public.daily_sessions    enable row level security;
alter table public.learning_settings enable row level security;
alter table public.favorites         enable row level security;

-- -----------------------------------------------------------------------------
-- POLICIES (xoá policy cũ cùng tên để chạy lại an toàn)
-- -----------------------------------------------------------------------------
drop policy if exists "vocabulary_select_own" on public.vocabulary;
drop policy if exists "vocabulary_insert_own" on public.vocabulary;
drop policy if exists "vocabulary_update_own" on public.vocabulary;
drop policy if exists "vocabulary_delete_own" on public.vocabulary;

create policy "vocabulary_select_own" on public.vocabulary
  for select to authenticated using (user_id = (select auth.uid()));
create policy "vocabulary_insert_own" on public.vocabulary
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "vocabulary_update_own" on public.vocabulary
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "vocabulary_delete_own" on public.vocabulary
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "progress_select_own" on public.learning_progress;
drop policy if exists "progress_insert_own" on public.learning_progress;
drop policy if exists "progress_update_own" on public.learning_progress;
drop policy if exists "progress_delete_own" on public.learning_progress;

create policy "progress_select_own" on public.learning_progress
  for select to authenticated using (user_id = (select auth.uid()));
create policy "progress_insert_own" on public.learning_progress
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "progress_update_own" on public.learning_progress
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "progress_delete_own" on public.learning_progress
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "records_select_own" on public.review_records;
drop policy if exists "records_insert_own" on public.review_records;
drop policy if exists "records_update_own" on public.review_records;
drop policy if exists "records_delete_own" on public.review_records;

create policy "records_select_own" on public.review_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "records_insert_own" on public.review_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "records_update_own" on public.review_records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "records_delete_own" on public.review_records
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "sessions_select_own" on public.daily_sessions;
drop policy if exists "sessions_insert_own" on public.daily_sessions;
drop policy if exists "sessions_update_own" on public.daily_sessions;
drop policy if exists "sessions_delete_own" on public.daily_sessions;

create policy "sessions_select_own" on public.daily_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "sessions_insert_own" on public.daily_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sessions_update_own" on public.daily_sessions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sessions_delete_own" on public.daily_sessions
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "settings_select_own" on public.learning_settings;
drop policy if exists "settings_insert_own" on public.learning_settings;
drop policy if exists "settings_update_own" on public.learning_settings;
drop policy if exists "settings_delete_own" on public.learning_settings;

create policy "settings_select_own" on public.learning_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "settings_insert_own" on public.learning_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "settings_update_own" on public.learning_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "settings_delete_own" on public.learning_settings
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "favorites_select_own" on public.favorites;
drop policy if exists "favorites_insert_own" on public.favorites;
drop policy if exists "favorites_update_own" on public.favorites;
drop policy if exists "favorites_delete_own" on public.favorites;

create policy "favorites_select_own" on public.favorites
  for select to authenticated using (user_id = (select auth.uid()));
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "favorites_update_own" on public.favorites
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (user_id = (select auth.uid()));

-- =============================================================================
-- RPC: TRA TỪ ĐIỂN (không phân biệt hoa/thường, tìm theo Hán tự / pinyin / nghĩa)
-- Chạy ở phía DB để kết quả không phụ thuộc giới hạn 1000 dòng mặc định.
-- =============================================================================
drop function if exists public.search_vocabulary(text, integer, integer);
drop function if exists public.search_vocabulary(public.vocabulary, text, integer, integer);
create function public.search_vocabulary(
  p_query text,
  p_limit integer default 30,
  p_offset integer default 0
)
returns setof public.vocabulary
language sql
stable
security invoker
set search_path = public
as $$
  select v.*
  from public.vocabulary v
  where v.user_id = (select auth.uid())
    and length(btrim(coalesce(p_query, ''))) > 0
    and (
      v.word ilike '%' || btrim(p_query) || '%'
      or lower(v.pinyin) like '%' || lower(btrim(p_query)) || '%'
      or lower(regexp_replace(v.pinyin, '[^a-zA-Z0-9]', '', 'g'))
         like '%' || lower(regexp_replace(btrim(p_query), '[^a-zA-Z0-9]', '', 'g')) || '%'
      or v.meaning ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when v.word = btrim(p_query) then 0
         when lower(regexp_replace(v.pinyin, '[^a-zA-Z0-9]', '', 'g')) =
              lower(regexp_replace(btrim(p_query), '[^a-zA-Z0-9]', '', 'g')) then 1
         when v.word like btrim(p_query) || '%' then 2
         when lower(v.pinyin) like lower(btrim(p_query)) || '%' then 3
         when lower(regexp_replace(v.pinyin, '[^a-zA-Z0-9]', '', 'g'))
              like lower(regexp_replace(btrim(p_query), '[^a-zA-Z0-9]', '', 'g')) || '%' then 4
         when v.meaning ilike btrim(p_query) || '%' then 5
         else 6
    end,
    length(v.word),
    v.word
  limit greatest(1, least(coalesce(p_limit, 30), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- =============================================================================
-- RPC: LƯU KẾT QUẢ ÔN TẬP NGUYÊN TỬ
-- Insert review_records + update learning_progress trong một transaction.
-- Server KHÔNG tự tính lịch: client gửi lên đúng dữ liệu SM-2 đã tính
-- (nguồn duy nhất là js/scheduler.js) để lịch trên mọi thiết bị luôn nhất quán.
-- =============================================================================
create or replace function public.record_review(
  p_vocabulary_id        uuid,
  p_rating               text,
  p_previous_next_review timestamptz,
  p_new_next_review      timestamptz,
  p_status               text,
  p_interval_days        numeric,
  p_repetition           integer,
  p_easiness_factor      numeric,
  p_review_count         integer,
  p_correct_count        integer,
  p_incorrect_count      integer
)
returns public.learning_progress
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  result public.learning_progress;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_rating not in ('again', 'hard', 'good', 'easy') then
    raise exception 'invalid rating: %', p_rating using errcode = '22023';
  end if;

  if not exists (select 1 from public.vocabulary where id = p_vocabulary_id and user_id = uid) then
    raise exception 'vocabulary not found' using errcode = '42501';
  end if;

  insert into public.review_records (
    user_id, vocabulary_id, rating, previous_next_review_at, new_next_review_at
  ) values (
    uid, p_vocabulary_id, p_rating, p_previous_next_review, p_new_next_review
  );

  insert into public.learning_progress (
    user_id, vocabulary_id, status, first_learned_at, last_reviewed_at, next_review_at,
    review_count, correct_count, incorrect_count, repetition, easiness_factor, interval_days
  ) values (
    uid, p_vocabulary_id, p_status, now(), now(), p_new_next_review,
    coalesce(p_review_count, 1), coalesce(p_correct_count, 0), coalesce(p_incorrect_count, 0),
    coalesce(p_repetition, 0), coalesce(p_easiness_factor, 2.5), coalesce(p_interval_days, 0)
  )
  on conflict (user_id, vocabulary_id) do update set
    status           = excluded.status,
    first_learned_at = coalesce(public.learning_progress.first_learned_at, now()),
    last_reviewed_at = now(),
    next_review_at   = excluded.next_review_at,
    review_count     = excluded.review_count,
    correct_count    = excluded.correct_count,
    incorrect_count  = excluded.incorrect_count,
    repetition       = excluded.repetition,
    easiness_factor  = excluded.easiness_factor,
    interval_days    = excluded.interval_days
  returning * into result;

  return result;
end;
$$;

-- =============================================================================
-- RPC: ĐÁNH DẤU BUỔI HỌC (upsert daily_sessions, dùng giờ địa phương của client)
-- =============================================================================
create or replace function public.mark_session(
  p_session_date      date,
  p_new_words_count   integer,
  p_due_words_count   integer,
  p_backlog_count     integer,
  p_completed_count   integer,
  p_status            text,
  p_started_at        timestamptz default null,
  p_completed_at      timestamptz default null
)
returns public.daily_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  result public.daily_sessions;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.daily_sessions (
    user_id, session_date, new_words_count, due_words_count, backlog_count,
    completed_count, status, started_at, completed_at
  ) values (
    uid, p_session_date, greatest(p_new_words_count, 0), greatest(p_due_words_count, 0),
    greatest(p_backlog_count, 0), greatest(p_completed_count, 0), p_status,
    p_started_at, p_completed_at
  )
  on conflict (user_id, session_date) do update set
    new_words_count = greatest(public.daily_sessions.new_words_count, excluded.new_words_count),
    due_words_count = greatest(public.daily_sessions.due_words_count, excluded.due_words_count),
    backlog_count   = greatest(public.daily_sessions.backlog_count, excluded.backlog_count),
    completed_count = greatest(public.daily_sessions.completed_count, excluded.completed_count),
    status          = case when public.daily_sessions.status = 'completed' then 'completed' else excluded.status end,
    started_at      = coalesce(public.daily_sessions.started_at, excluded.started_at),
    completed_at    = case when excluded.status = 'completed'
                          then coalesce(public.daily_sessions.completed_at, excluded.completed_at)
                          else public.daily_sessions.completed_at end
  returning * into result;

  return result;
end;
$$;

grant execute on function public.ensure_learning_settings() to authenticated;
grant execute on function public.search_vocabulary(text, integer, integer) to authenticated;
grant execute on function public.record_review(uuid, text, timestamptz, timestamptz, text, numeric, integer, numeric, integer, integer, integer) to authenticated;
grant execute on function public.mark_session(date, integer, integer, integer, integer, text, timestamptz, timestamptz) to authenticated;

revoke all on function public.ensure_learning_settings() from anon;
revoke all on function public.search_vocabulary(text, integer, integer) from anon;
revoke all on function public.record_review(uuid, text, timestamptz, timestamptz, text, numeric, integer, numeric, integer, integer, integer) from anon;
revoke all on function public.mark_session(date, integer, integer, integer, integer, text, timestamptz, timestamptz) from anon;

-- Bảng không dùng cho anonymous auth thường (nếu bật, cần cấp quyền ở Supabase Config).
grant select, insert, update, delete on public.vocabulary, public.learning_progress,
  public.review_records, public.daily_sessions, public.learning_settings, public.favorites
  to authenticated;

-- =============================================================================
-- TÙY CHỌN: nếu bật "Anonymous sign-ins", role `authenticated` được cấp tự động.
-- Không cần thêm gì. Nếu muốn cấp quyền bảng cho role `anon` (không khuyến nghị),
-- RLS vẫn chặn mọi truy cập vì auth.uid() là null.
-- =============================================================================
