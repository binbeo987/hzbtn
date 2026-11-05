-- =============================================================================
-- Hán Ngữ – Chinese Dictionary & Vocabulary Review
-- 01. SCHEMA (chế độ 1 người dùng – không có đăng nhập, không có auth.uid())
--
-- Chạy file này rồi tới rls.sql trong Supabase SQL Editor.
-- An toàn khi chạy lại nhiều lần: nếu database cũ còn cột user_id (từ phiên bản
-- dùng Anonymous Auth), file sẽ TỰ BỎ cột đó và cộng dồn dữ liệu về một kho duy nhất.
--
-- ⚠️ Bảo mật: anon key là public, ai biết URL cũng gọi được API. Vì vậy:
--   - Xem "Bảo vệ dữ liệu" trong rls.sql để đặt mã truy cập (X-App-Key).
--   - Nếu cần riêng tư tuyệt đối, hãy tắt public access của Supabase (xem README).
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Bỏ khoá ngoại tới auth.users của bản cũ trước khi bỏ cột user_id.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['vocabulary', 'learning_progress', 'review_records', 'daily_sessions', 'learning_settings', 'favorites']
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = t
          and con.contype = 'f'
          and pg_get_constraintdef(con.oid) ilike '%auth.users%'
      loop
        execute format('alter table public.%I drop constraint if exists %I', t, c);
      end loop;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- vocabulary
-- -----------------------------------------------------------------------------
create table if not exists public.vocabulary (
  id              uuid primary key default gen_random_uuid(),
  word            text not null,
  pinyin          text not null,
  pos             text,
  meaning         text not null,
  hsk             text,
  topic           text,
  example         text,
  example_pinyin  text,
  example_meaning text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vocabulary_word_not_blank    check (btrim(word) <> ''),
  constraint vocabulary_pinyin_not_blank  check (btrim(pinyin) <> ''),
  constraint vocabulary_meaning_not_blank check (btrim(meaning) <> '')
);

-- -----------------------------------------------------------------------------
-- learning_progress
-- -----------------------------------------------------------------------------
create table if not exists public.learning_progress (
  id                uuid primary key default gen_random_uuid(),
  vocabulary_id     uuid not null references public.vocabulary (id) on delete cascade,
  status            text not null default 'new'
                    check (status in ('new', 'learning', 'review', 'remembered', 'mastered')),
  first_learned_at  timestamptz,
  last_reviewed_at  timestamptz,
  next_review_at    timestamptz,
  review_count      integer not null default 0 check (review_count >= 0),
  correct_count     integer not null default 0 check (correct_count >= 0),
  incorrect_count   integer not null default 0 check (incorrect_count >= 0),
  repetition        integer not null default 0 check (repetition >= 0),
  easiness_factor   numeric(4, 2) not null default 2.50 check (easiness_factor >= 1.30),
  interval_days     numeric(10, 4) not null default 0 check (interval_days >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- review_records
-- -----------------------------------------------------------------------------
create table if not exists public.review_records (
  id                       uuid primary key default gen_random_uuid(),
  vocabulary_id            uuid not null references public.vocabulary (id) on delete cascade,
  rating                   text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at              timestamptz not null default now(),
  previous_next_review_at  timestamptz,
  new_next_review_at       timestamptz
);

-- -----------------------------------------------------------------------------
-- daily_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.daily_sessions (
  id                  uuid primary key default gen_random_uuid(),
  session_date        date not null,
  new_words_count     integer not null default 0,
  due_words_count     integer not null default 0,
  backlog_count       integer not null default 0,
  completed_count     integer not null default 0,
  status              text not null default 'pending'
                      check (status in ('pending', 'in_progress', 'completed', 'partial', 'skipped')),
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- learning_settings (chỉ 1 dòng)
-- -----------------------------------------------------------------------------
create table if not exists public.learning_settings (
  id                     boolean primary key default true check (id),
  new_words_per_day      integer not null default 10 check (new_words_per_day between 0 and 500),
  max_words_per_day      integer not null default 30 check (max_words_per_day between 1 and 2000),
  study_start_date       date not null default current_date,
  preferred_study_time   time,
  timezone               text not null default 'Asia/Ho_Chi_Minh',
  updated_at             timestamptz not null default now(),
  constraint learning_settings_max_gte_new check (max_words_per_day >= new_words_per_day)
);

-- -----------------------------------------------------------------------------
-- favorites
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  vocabulary_id uuid primary key references public.vocabulary (id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- =============================================================================
-- MIGRATION: cộng dồn dữ liệu cũ (user_id) về một kho duy nhất rồi bỏ cột.
-- =============================================================================
-- 1. vocabulary: giữ 1 dòng / word (ưu tiên dòng cập nhật gần nhất).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vocabulary' and column_name = 'user_id') then
    create temp table map_vocab on commit drop as
      select id as old_id, keep_id
      from (
        select id, first_value(id) over (partition by word order by updated_at desc nulls last, created_at) as keep_id
        from public.vocabulary
      ) s;

    -- Chuyển tiến trình / lịch sử / yêu thích của dòng bị gộp sang dòng giữ lại.
    update public.learning_progress lp set vocabulary_id = m.keep_id
      from map_vocab m where lp.vocabulary_id = m.old_id and m.old_id <> m.keep_id;
    update public.review_records rr set vocabulary_id = m.keep_id
      from map_vocab m where rr.vocabulary_id = m.old_id and m.old_id <> m.keep_id;
    insert into public.favorites (vocabulary_id, created_at)
      select distinct m.keep_id, f.created_at from public.favorites f join map_vocab m on m.old_id = f.vocabulary_id
      on conflict (vocabulary_id) do nothing;
    delete from public.favorites f using map_vocab m where f.vocabulary_id = m.old_id and m.old_id <> m.keep_id;
    delete from public.vocabulary v using map_vocab m where v.id = m.old_id and m.old_id <> m.keep_id;
  end if;

  -- 2. learning_progress: 1 dòng / vocabulary_id, giữ bản ôn gần nhất.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_progress' and column_name = 'user_id') then
    delete from public.learning_progress lp
    using public.learning_progress keep
    where lp.vocabulary_id = keep.vocabulary_id
      and lp.id <> keep.id
      and (keep.last_reviewed_at, keep.id) > (lp.last_reviewed_at, lp.id);
  end if;
end;
$$;

-- Bỏ unique (user_id, x) cũ + cột user_id, sau đó thêm unique mới (1 người dùng).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vocabulary' and column_name = 'user_id') then
    alter table public.vocabulary drop constraint if exists vocabulary_user_word_key;
    alter table public.vocabulary drop column user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_progress' and column_name = 'user_id') then
    alter table public.learning_progress drop constraint if exists learning_progress_user_vocab_key;
    alter table public.learning_progress drop column user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'review_records' and column_name = 'user_id') then
    alter table public.review_records drop column user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_sessions' and column_name = 'user_id') then
    alter table public.daily_sessions drop constraint if exists daily_sessions_user_date_key;
    alter table public.daily_sessions drop column user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_settings' and column_name = 'user_id') then
    -- Giữ 1 bộ cài đặt (mới nhất) trước khi đổi khoá chính.
    delete from public.learning_settings a
      using public.learning_settings b
      where a.ctid > b.ctid;
    alter table public.learning_settings drop constraint if exists learning_settings_pkey;
    alter table public.learning_settings drop column user_id;
    alter table public.learning_settings add column id boolean primary key default true check (id);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'favorites' and column_name = 'user_id') then
    alter table public.favorites drop constraint if exists favorites_pkey;
    alter table public.favorites drop column user_id;
    delete from public.favorites a using public.favorites b where a.ctid > b.ctid and a.vocabulary_id = b.vocabulary_id;
    alter table public.favorites add primary key (vocabulary_id);
  end if;
end;
$$;

-- Unique một người dùng (thêm sau khi đã dọn dữ liệu để không lỗi trùng).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vocabulary_word_key' and conrelid = 'public.vocabulary'::regclass) then
    alter table public.vocabulary add constraint vocabulary_word_key unique (word);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'learning_progress_vocab_key' and conrelid = 'public.learning_progress'::regclass) then
    alter table public.learning_progress add constraint learning_progress_vocab_key unique (vocabulary_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_sessions_date_key' and conrelid = 'public.daily_sessions'::regclass) then
    alter table public.daily_sessions add constraint daily_sessions_date_key unique (session_date);
  end if;
end;
$$;

comment on table public.vocabulary is 'Kho từ vựng Trung - Việt (một người dùng). Khóa chống trùng: word.';

-- =============================================================================
-- INDEXES
-- =============================================================================
create index if not exists vocabulary_pinyin_idx  on public.vocabulary (lower(pinyin));
create index if not exists vocabulary_meaning_idx on public.vocabulary (lower(meaning));
create index if not exists vocabulary_created_idx on public.vocabulary (created_at desc);
create index if not exists vocabulary_hsk_idx     on public.vocabulary (hsk);
create index if not exists vocabulary_topic_idx   on public.vocabulary (topic);
create index if not exists vocabulary_word_trgm_idx    on public.vocabulary using gin (word gin_trgm_ops);
create index if not exists vocabulary_pinyin_trgm_idx  on public.vocabulary using gin (pinyin gin_trgm_ops);
create index if not exists vocabulary_meaning_trgm_idx on public.vocabulary using gin (meaning gin_trgm_ops);

create index if not exists learning_progress_next_idx   on public.learning_progress (next_review_at);
create index if not exists learning_progress_status_idx on public.learning_progress (status);

create index if not exists review_records_time_idx  on public.review_records (reviewed_at desc);
create index if not exists review_records_vocab_idx on public.review_records (vocabulary_id, reviewed_at desc);

create index if not exists daily_sessions_date_idx on public.daily_sessions (session_date desc);

-- =============================================================================
-- TRIGGERS: updated_at
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vocabulary_set_updated_at on public.vocabulary;
create trigger vocabulary_set_updated_at before update on public.vocabulary
  for each row execute function public.set_updated_at();

drop trigger if exists learning_progress_set_updated_at on public.learning_progress;
create trigger learning_progress_set_updated_at before update on public.learning_progress
  for each row execute function public.set_updated_at();

drop trigger if exists daily_sessions_set_updated_at on public.daily_sessions;
create trigger daily_sessions_set_updated_at before update on public.daily_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists learning_settings_set_updated_at on public.learning_settings;
create trigger learning_settings_set_updated_at before update on public.learning_settings
  for each row execute function public.set_updated_at();

-- Đảm bảo luôn có 1 dòng cài đặt mặc định.
insert into public.learning_settings (id) values (true) on conflict (id) do nothing;
