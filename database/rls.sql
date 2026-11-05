-- =============================================================================
-- 02. BẢO MẬT + RPC (chế độ 1 người dùng, không đăng nhập)
--
-- Chạy file này SAU schema.sql.
--
-- Row Level Security của Supabase chỉ có ý nghĩa khi có auth.uid(); chế độ này
-- không có người dùng đăng nhập nên RLS = false cho mọi bảng. Thay vào đó:
--   1. Bảng được truy cập qua RPC (search_vocabulary có giới hạn và lọc).
--   2. Nếu đặt biến `app_access_key` (xem bên dưới), mọi yêu cầu ghi/đọc RPC
--      đều phải kèm mã truy cập -> người lạ biết anon key cũng không dùng được.
--
-- ⚠️ QUAN TRỌNG: THU HỒI quyền truy cập trực tiếp của role anon vào bảng.
--    Website chỉ dùng anon key + RPC. Nếu frontend cần đọc bảng trực tiếp
--    (không qua RPC), xem phần "Tùy chọn: cho phép anon đọc trực tiếp".
-- =============================================================================

alter table public.vocabulary        disable row level security;
alter table public.learning_progress disable row level security;
alter table public.review_records    disable row level security;
alter table public.daily_sessions    disable row level security;
alter table public.learning_settings disable row level security;
alter table public.favorites         disable row level security;

revoke all on table public.vocabulary, public.learning_progress, public.review_records,
  public.daily_sessions, public.learning_settings, public.favorites from anon, authenticated;

-- =============================================================================
-- MÃ TRUY CẬP (tùy chọn nhưng nên bật)
-- Chạy SQL Editor (KHÔNG commit mã này lên GitHub):
--   update public.app_config set value = 'ma-cua-ban' where key = 'app_access_key';
-- Rồi thêm biến môi trường Vercel APP_ACCESS_KEY cùng giá trị.
-- Để trống = không yêu cầu mã (website vẫn chạy được, nhưng bất kỳ ai có
-- URL + anon key đều gọi được RPC).
-- =============================================================================
create table if not exists public.app_config (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_config disable row level security;
revoke all on table public.app_config from anon, authenticated;
insert into public.app_config (key, value) values ('app_access_key', '') on conflict (key) do nothing;

create or replace function public.check_access_key(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  require_key text;
begin
  select coalesce(value, '') into require_key from public.app_config where key = 'app_access_key';
  if coalesce(require_key, '') = '' then
    return;
  end if;
  if coalesce(p_key, '') <> require_key then
    raise exception 'invalid access key' using errcode = '42501';
  end if;
end;
$$;

-- =============================================================================
-- HÀM CÔNG KHAI (RPC) – frontend gọi qua supabase.rpc(...)
-- =============================================================================

-- Bảng gọn để tính buổi học / lịch: id, từ, ngày tạo + tiến trình.
create or replace function public.get_study_rows(p_key text default null)
returns table (
  id uuid,
  word text,
  pinyin text,
  meaning text,
  hsk text,
  topic text,
  created_at timestamptz,
  progress jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.check_access_key(p_key);
  return query
    select v.id, v.word, v.pinyin, v.meaning, v.hsk, v.topic, v.created_at,
           case when lp.id is null then null else to_jsonb(lp) end
    from public.vocabulary v
    left join public.learning_progress lp on lp.vocabulary_id = v.id
    order by v.created_at asc, v.id asc;
end;
$$;

-- Ghi nhận một lượt ôn nguyên tử: review_records + learning_progress.
-- Lịch SM-2 do client tính (js/scheduler.js) để mọi thiết bị ra cùng kết quả.
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
  p_incorrect_count      integer,
  p_key                  text default null
)
returns public.learning_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_progress;
begin
  perform public.check_access_key(p_key);

  if p_rating not in ('again', 'hard', 'good', 'easy') then
    raise exception 'invalid rating: %', p_rating using errcode = '22023';
  end if;

  if not exists (select 1 from public.vocabulary where id = p_vocabulary_id) then
    raise exception 'vocabulary not found' using errcode = '42501';
  end if;

  insert into public.review_records (
    vocabulary_id, rating, previous_next_review_at, new_next_review_at
  ) values (
    p_vocabulary_id, p_rating, p_previous_next_review, p_new_next_review
  );

  insert into public.learning_progress (
    vocabulary_id, status, first_learned_at, last_reviewed_at, next_review_at,
    review_count, correct_count, incorrect_count, repetition, easiness_factor, interval_days
  ) values (
    p_vocabulary_id, p_status, now(), now(), p_new_next_review,
    coalesce(p_review_count, 1), coalesce(p_correct_count, 0), coalesce(p_incorrect_count, 0),
    coalesce(p_repetition, 0), coalesce(p_easiness_factor, 2.5), coalesce(p_interval_days, 0)
  )
  on conflict (vocabulary_id) do update set
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

-- Đưa một từ vào danh sách ôn ngay (trang Tra từ).
create or replace function public.queue_for_review(p_vocabulary_id uuid, p_key text default null)
returns public.learning_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_progress;
begin
  perform public.check_access_key(p_key);
  insert into public.learning_progress (vocabulary_id, status, next_review_at)
  values (p_vocabulary_id, 'new', now())
  on conflict (vocabulary_id) do update set next_review_at = now()
  returning * into result;
  return result;
end;
$$;

-- Tạo hồ sơ "new" cho lượt học đầu tiên.
create or replace function public.start_learning(p_vocabulary_id uuid, p_key text default null)
returns public.learning_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_progress;
begin
  perform public.check_access_key(p_key);
  insert into public.learning_progress (vocabulary_id, status, next_review_at)
  values (p_vocabulary_id, 'new', now())
  on conflict (vocabulary_id) do nothing;
  select * into result from public.learning_progress where vocabulary_id = p_vocabulary_id;
  return result;
end;
$$;

-- Cập nhật buổi học theo ngày (giờ địa phương của người dùng).
create or replace function public.mark_session(
  p_session_date      date,
  p_new_words_count   integer,
  p_due_words_count   integer,
  p_backlog_count     integer,
  p_completed_count   integer,
  p_status            text,
  p_started_at        timestamptz default null,
  p_completed_at      timestamptz default null,
  p_key               text default null
)
returns public.daily_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.daily_sessions;
begin
  perform public.check_access_key(p_key);
  insert into public.daily_sessions (
    session_date, new_words_count, due_words_count, backlog_count,
    completed_count, status, started_at, completed_at
  ) values (
    p_session_date, greatest(p_new_words_count, 0), greatest(p_due_words_count, 0),
    greatest(p_backlog_count, 0), greatest(p_completed_count, 0), p_status,
    p_started_at, p_completed_at
  )
  on conflict (session_date) do update set
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

-- Tra từ: Hán tự / pinyin (bỏ dấu) / nghĩa, lọc HSK/chủ đề ở DB.
create or replace function public.search_vocabulary(
  p_query text,
  p_limit integer default 30,
  p_offset integer default 0,
  p_hsk text default null,
  p_topic text default null,
  p_key text default null
)
returns setof public.vocabulary
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.check_access_key(p_key);
  return query
  select v.*
  from public.vocabulary v
  where length(btrim(coalesce(p_query, ''))) > 0
    and (
      v.word ilike '%' || btrim(p_query) || '%'
      or lower(v.pinyin) like '%' || lower(btrim(p_query)) || '%'
      or lower(regexp_replace(v.pinyin, '[^a-zA-Z0-9]', '', 'g'))
         like '%' || lower(regexp_replace(btrim(p_query), '[^a-zA-Z0-9]', '', 'g')) || '%'
      or v.meaning ilike '%' || btrim(p_query) || '%'
    )
    and (nullif(btrim(coalesce(p_hsk, '')), '') is null or v.hsk = btrim(p_hsk))
    and (nullif(btrim(coalesce(p_topic, '')), '') is null or v.topic = btrim(p_topic))
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
  limit greatest(1, least(coalesce(p_limit, 30), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Đọc dữ liệu cho backup / lịch sử.
create or replace function public.get_backup(p_key text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.check_access_key(p_key);
  select jsonb_build_object(
    'vocabulary', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.vocabulary v), '[]'::jsonb),
    'learning_progress', coalesce((select jsonb_agg(to_jsonb(lp)) from public.learning_progress lp), '[]'::jsonb),
    'review_records', coalesce((select jsonb_agg(to_jsonb(rr) order by rr.reviewed_at) from public.review_records rr), '[]'::jsonb),
    'daily_sessions', coalesce((select jsonb_agg(to_jsonb(ds) order by ds.session_date) from public.daily_sessions ds), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(to_jsonb(f)) from public.favorites f), '[]'::jsonb),
    'settings', coalesce((select to_jsonb(ls) from public.learning_settings ls limit 1), '{}'::jsonb),
    'exported_at', to_jsonb(now())
  ) into result;
  return result;
end;
$$;

-- Import theo batch: upsert từ vựng, giữ nguyên learning_progress (không chạm lịch sử).
--   p_mode = 'skip'   → bỏ qua từ đã có
--   p_mode = 'update' → cập nhật nội dung từ đã có
-- Trả về id của từng từ theo đúng thứ tự.
create or replace function public.import_vocabulary(
  p_rows jsonb,
  p_mode text default 'skip',
  p_key text default null
)
returns table (idx integer, id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_access_key(p_key);
  if p_mode not in ('skip', 'update') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  create temp table import_input on commit drop as
    select (row_number() over ())::integer - 1 as idx, r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      word text, pinyin text, pos text, meaning text, hsk text, topic text,
      example text, example_pinyin text, example_meaning text
    );

  if p_mode = 'update' then
    insert into public.vocabulary (word, pinyin, pos, meaning, hsk, topic, example, example_pinyin, example_meaning)
      select word, pinyin, pos, meaning, hsk, topic, example, example_pinyin, example_meaning
      from import_input
      on conflict (word) do update set
        pinyin          = excluded.pinyin,
        pos             = excluded.pos,
        meaning         = excluded.meaning,
        hsk             = excluded.hsk,
        topic           = excluded.topic,
        example         = excluded.example,
        example_pinyin  = excluded.example_pinyin,
        example_meaning = excluded.example_meaning;
  else
    insert into public.vocabulary (word, pinyin, pos, meaning, hsk, topic, example, example_pinyin, example_meaning)
      select word, pinyin, pos, meaning, hsk, topic, example, example_pinyin, example_meaning
      from import_input
      on conflict (word) do nothing;
  end if;

  return query
    select i.idx, v.id::uuid as id
    from import_input i
    join public.vocabulary v on v.word = i.word
    order by i.idx;
end;
$$;

-- Cập nhật cài đặt học tập.
create or replace function public.update_settings(
  p_new_words_per_day integer,
  p_max_words_per_day integer,
  p_preferred_study_time time default null,
  p_timezone text default null,
  p_key text default null
)
returns public.learning_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_settings;
begin
  perform public.check_access_key(p_key);
  if p_max_words_per_day < p_new_words_per_day then
    raise exception 'max_words_per_day must be >= new_words_per_day' using errcode = '22023';
  end if;
  insert into public.learning_settings as s (id) values (true) on conflict (id) do nothing;
  update public.learning_settings set
    new_words_per_day    = greatest(coalesce(p_new_words_per_day, 10), 0),
    max_words_per_day    = greatest(coalesce(p_max_words_per_day, 30), 1),
    preferred_study_time = p_preferred_study_time,
    timezone             = coalesce(nullif(p_timezone, ''), s.timezone)
  where id = true
  returning * into result;
  return result;
end;
$$;

-- Xoá một hoặc nhiều từ (kèm tiến trình, lịch sử, yêu thích nhờ ON DELETE CASCADE).
create or replace function public.delete_vocabulary(p_ids uuid[], p_key text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  perform public.check_access_key(p_key);
  with gone as (delete from public.vocabulary where id = any(p_ids) returning 1)
  select count(*) into removed from gone;
  return removed;
end;
$$;

-- Bật/tắt yêu thích.
create or replace function public.toggle_favorite(
  p_vocabulary_id uuid,
  p_favorite boolean,
  p_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_access_key(p_key);
  if p_favorite then
    insert into public.favorites (vocabulary_id) values (p_vocabulary_id)
    on conflict (vocabulary_id) do nothing;
  else
    delete from public.favorites where vocabulary_id = p_vocabulary_id;
  end if;
  return jsonb_build_object('vocabulary_id', p_vocabulary_id, 'favorite', p_favorite);
end;
$$;

-- Khôi phục toàn bộ dữ liệu từ file JSON (đã được client xác nhận trước).
-- Giữ nguyên id để khôi phục đúng liên kết giữa các bảng; bản ghi đã có bị bỏ qua.
create or replace function public.restore_backup(p_data jsonb, p_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  counts jsonb;
begin
  perform public.check_access_key(p_key);

  insert into public.vocabulary
    (id, word, pinyin, pos, meaning, hsk, topic, example, example_pinyin, example_meaning, created_at, updated_at)
  select coalesce(r.id, gen_random_uuid()), r.word, coalesce(r.pinyin, ''), r.pos, coalesce(r.meaning, ''),
         r.hsk, r.topic, r.example, r.example_pinyin, r.example_meaning,
         coalesce(r.created_at, now()), coalesce(r.updated_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'vocabulary', '[]'::jsonb)) as r(
    id uuid, word text, pinyin text, pos text, meaning text, hsk text, topic text,
    example text, example_pinyin text, example_meaning text, created_at timestamptz, updated_at timestamptz
  )
  where coalesce(r.word, '') <> '' and coalesce(r.meaning, '') <> ''
  on conflict (word) do nothing;

  insert into public.learning_progress
    (vocabulary_id, status, first_learned_at, last_reviewed_at, next_review_at, review_count,
     correct_count, incorrect_count, repetition, easiness_factor, interval_days, created_at, updated_at)
  select lp.vocabulary_id, coalesce(lp.status, 'new'), lp.first_learned_at, lp.last_reviewed_at,
         lp.next_review_at, coalesce(lp.review_count, 0), coalesce(lp.correct_count, 0),
         coalesce(lp.incorrect_count, 0), coalesce(lp.repetition, 0), coalesce(lp.easiness_factor, 2.5),
         coalesce(lp.interval_days, 0), coalesce(lp.created_at, now()), coalesce(lp.updated_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'learning_progress', '[]'::jsonb)) as lp(
    vocabulary_id uuid, status text, first_learned_at timestamptz, last_reviewed_at timestamptz,
    next_review_at timestamptz, review_count integer, correct_count integer, incorrect_count integer,
    repetition integer, easiness_factor numeric, interval_days numeric, created_at timestamptz, updated_at timestamptz
  )
  join public.vocabulary v on v.id = lp.vocabulary_id
  on conflict (vocabulary_id) do nothing;

  insert into public.review_records
    (id, vocabulary_id, rating, reviewed_at, previous_next_review_at, new_next_review_at)
  select coalesce(rr.id, gen_random_uuid()), rr.vocabulary_id, rr.rating, coalesce(rr.reviewed_at, now()),
         rr.previous_next_review_at, rr.new_next_review_at
  from jsonb_to_recordset(coalesce(p_data -> 'review_records', '[]'::jsonb)) as rr(
    id uuid, vocabulary_id uuid, rating text, reviewed_at timestamptz,
    previous_next_review_at timestamptz, new_next_review_at timestamptz
  )
  join public.vocabulary v on v.id = rr.vocabulary_id
  where rr.rating in ('again', 'hard', 'good', 'easy');

  insert into public.daily_sessions
    (session_date, new_words_count, due_words_count, backlog_count, completed_count, status, started_at, completed_at)
  select ds.session_date, coalesce(ds.new_words_count, 0), coalesce(ds.due_words_count, 0),
         coalesce(ds.backlog_count, 0), coalesce(ds.completed_count, 0), coalesce(ds.status, 'completed'),
         ds.started_at, ds.completed_at
  from jsonb_to_recordset(coalesce(p_data -> 'daily_sessions', '[]'::jsonb)) as ds(
    session_date date, new_words_count integer, due_words_count integer, backlog_count integer,
    completed_count integer, status text, started_at timestamptz, completed_at timestamptz
  )
  on conflict (session_date) do nothing;

  insert into public.favorites (vocabulary_id)
  select f.vocabulary_id
  from jsonb_to_recordset(coalesce(p_data -> 'favorites', '[]'::jsonb)) as f(vocabulary_id uuid)
  join public.vocabulary v on v.id = f.vocabulary_id
  on conflict (vocabulary_id) do nothing;

  if (p_data -> 'settings') is not null then
    update public.learning_settings set
      new_words_per_day = least(greatest(coalesce((p_data -> 'settings' ->> 'new_words_per_day')::integer, new_words_per_day), 0), 500),
      max_words_per_day = least(greatest(coalesce((p_data -> 'settings' ->> 'max_words_per_day')::integer, max_words_per_day), 1), 2000),
      preferred_study_time = nullif(p_data -> 'settings' ->> 'preferred_study_time', '')::time,
      timezone = coalesce(nullif(p_data -> 'settings' ->> 'timezone', ''), timezone)
    where id = true;
  end if;

  select jsonb_build_object(
    'vocabulary', (select count(*) from public.vocabulary),
    'learning_progress', (select count(*) from public.learning_progress),
    'review_records', (select count(*) from public.review_records),
    'daily_sessions', (select count(*) from public.daily_sessions),
    'favorites', (select count(*) from public.favorites)
  ) into counts;
  return counts;
end;
$$;

-- Xoá toàn bộ dữ liệu (trang Cài đặt, sau khi người dùng nhập xác nhận).
create or replace function public.delete_all_data(p_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_access_key(p_key);
  delete from public.review_records;
  delete from public.favorites;
  delete from public.learning_progress;
  delete from public.daily_sessions;
  delete from public.vocabulary;
end;
$$;

-- =============================================================================
-- QUYỀN GỌI RPC
-- =============================================================================
grant execute on function public.check_access_key(text) to anon, authenticated;
grant execute on function public.get_study_rows(text) to anon, authenticated;
grant execute on function public.record_review(uuid, text, timestamptz, timestamptz, text, numeric, integer, numeric, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.queue_for_review(uuid, text) to anon, authenticated;
grant execute on function public.start_learning(uuid, text) to anon, authenticated;
grant execute on function public.mark_session(date, integer, integer, integer, integer, text, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.search_vocabulary(text, integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.get_backup(text) to anon, authenticated;
grant execute on function public.import_vocabulary(jsonb, text, text) to anon, authenticated;
grant execute on function public.update_settings(integer, integer, time, text, text) to anon, authenticated;
grant execute on function public.delete_vocabulary(uuid[], text) to anon, authenticated;
grant execute on function public.toggle_favorite(uuid, boolean, text) to anon, authenticated;
grant execute on function public.restore_backup(jsonb, text) to anon, authenticated;
grant execute on function public.delete_all_data(text) to anon, authenticated;

-- =============================================================================
-- TÙY CHỌN: cho phép frontend đọc/ghi bảng trực tiếp bằng anon key.
-- Không khuyến nghị khi chạy công khai vì không có ĐĂNG NHẬP bảo vệ dữ liệu.
-- Chỉ mở nếu bạn tin tưởng tuyệt đối URL của website là bí mật.
-- =============================================================================
-- grant select, insert, update, delete on public.vocabulary, public.learning_progress,
--   public.review_records, public.daily_sessions, public.learning_settings, public.favorites
--   to anon;
