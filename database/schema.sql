-- =============================================================================
-- Hán Ngữ – Chinese Dictionary & Vocabulary Review
-- 01. SCHEMA
-- Chạy file này TRƯỚC rls.sql trong Supabase SQL Editor.
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- vocabulary: kho từ vựng của từng người dùng
-- -----------------------------------------------------------------------------
create table if not exists public.vocabulary (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
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
  constraint vocabulary_meaning_not_blank check (btrim(meaning) <> ''),
  constraint vocabulary_user_word_key     unique (user_id, word)
);

comment on table public.vocabulary is 'Kho từ vựng Trung - Việt. Khóa chống trùng: (user_id, word).';

-- -----------------------------------------------------------------------------
-- learning_progress: trạng thái spaced repetition của từng từ
-- -----------------------------------------------------------------------------
create table if not exists public.learning_progress (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
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
  updated_at        timestamptz not null default now(),
  constraint learning_progress_user_vocab_key unique (user_id, vocabulary_id)
);

-- -----------------------------------------------------------------------------
-- review_records: lịch sử từng lượt ôn
-- -----------------------------------------------------------------------------
create table if not exists public.review_records (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vocabulary_id            uuid not null references public.vocabulary (id) on delete cascade,
  rating                   text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at              timestamptz not null default now(),
  previous_next_review_at  timestamptz,
  new_next_review_at       timestamptz
);

-- -----------------------------------------------------------------------------
-- daily_sessions: thống kê buổi học theo ngày (timezone địa phương của người dùng)
-- -----------------------------------------------------------------------------
create table if not exists public.daily_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_date        date not null,
  new_words_count     integer not null default 0,
  due_words_count     integer not null default 0,
  backlog_count       integer not null default 0,
  completed_count     integer not null default 0,
  status              text not null default 'pending'
                      check (status in ('pending', 'in_progress', 'completed', 'partial', 'skipped')),
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  constraint daily_sessions_user_date_key unique (user_id, session_date)
);

-- -----------------------------------------------------------------------------
-- learning_settings: cài đặt học tập (1 dòng / người dùng)
-- -----------------------------------------------------------------------------
create table if not exists public.learning_settings (
  user_id                uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  new_words_per_day      integer not null default 10 check (new_words_per_day between 0 and 500),
  max_words_per_day      integer not null default 30 check (max_words_per_day between 1 and 2000),
  study_start_date       date not null default current_date,
  preferred_study_time   time,
  timezone               text not null default 'Asia/Ho_Chi_Minh',
  updated_at             timestamptz not null default now()
);

alter table public.learning_settings
  drop constraint if exists learning_settings_max_gte_new;
alter table public.learning_settings
  add constraint learning_settings_max_gte_new check (max_words_per_day >= new_words_per_day);

-- -----------------------------------------------------------------------------
-- favorites
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, vocabulary_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Tra từ nhanh theo chữ Hán / pinyin / nghĩa tiếng Việt (không phân biệt hoa thường).
create index if not exists vocabulary_user_word_idx    on public.vocabulary (user_id, word);
create index if not exists vocabulary_user_pinyin_idx  on public.vocabulary (user_id, lower(pinyin));
create index if not exists vocabulary_user_meaning_idx on public.vocabulary (user_id, lower(meaning));
create index if not exists vocabulary_user_created_idx on public.vocabulary (user_id, created_at desc);
create index if not exists vocabulary_user_hsk_idx     on public.vocabulary (user_id, hsk);
create index if not exists vocabulary_user_topic_idx   on public.vocabulary (user_id, topic);
create index if not exists vocabulary_word_trgm_idx    on public.vocabulary using gin (word gin_trgm_ops);
create index if not exists vocabulary_pinyin_trgm_idx  on public.vocabulary using gin (pinyin gin_trgm_ops);
create index if not exists vocabulary_meaning_trgm_idx on public.vocabulary using gin (meaning gin_trgm_ops);

-- Lịch ôn: tìm từ đến hạn nhanh.
create index if not exists learning_progress_user_next_idx on public.learning_progress (user_id, next_review_at);
create index if not exists learning_progress_user_status_idx on public.learning_progress (user_id, status);
create index if not exists learning_progress_vocab_idx on public.learning_progress (vocabulary_id);

create index if not exists review_records_user_time_idx on public.review_records (user_id, reviewed_at desc);
create index if not exists review_records_user_vocab_idx on public.review_records (user_id, vocabulary_id, reviewed_at desc);

create index if not exists daily_sessions_user_date_idx on public.daily_sessions (user_id, session_date desc);

create index if not exists favorites_vocab_idx on public.favorites (vocabulary_id);

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

-- =============================================================================
-- HÀM TỰ ĐỘNG TẠO SETTINGS + KIỂM TRA user_id TRÙNG VỚI auth.uid()
-- =============================================================================
create or replace function public.ensure_learning_settings()
returns public.learning_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_settings;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.learning_settings (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select * into result from public.learning_settings where user_id = auth.uid();
  return result;
end;
$$;

-- Đảm bảo không thể ghi dữ liệu thay cho người dùng khác dù client gửi user_id sai.
create or replace function public.enforce_user_id()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  new.user_id := auth.uid();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['vocabulary', 'learning_progress', 'review_records', 'daily_sessions', 'favorites']
  loop
    execute format('drop trigger if exists %I_force_user on public.%I', t, t);
    execute format('create trigger %I_force_user before insert or update on public.%I
                    for each row execute function public.enforce_user_id()', t, t);
  end loop;
end;
$$;

-- Ràng buộc: tiến trình học chỉ được trỏ tới từ vựng của chính người dùng đó.
create or replace function public.check_progress_vocabulary_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.vocabulary v
    where v.id = new.vocabulary_id and v.user_id = new.user_id
  ) then
    raise exception 'vocabulary does not belong to user' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_progress_check_owner on public.learning_progress;
create trigger learning_progress_check_owner before insert or update on public.learning_progress
  for each row execute function public.check_progress_vocabulary_owner();

drop trigger if exists review_records_check_owner on public.review_records;
create trigger review_records_check_owner before insert on public.review_records
  for each row execute function public.check_progress_vocabulary_owner();

drop trigger if exists favorites_check_owner on public.favorites;
create trigger favorites_check_owner before insert on public.favorites
  for each row execute function public.check_progress_vocabulary_owner();
