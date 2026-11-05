/* =============================================================================
 * app.js - Điều phối ứng dụng: khởi động, routing, sự kiện toàn cục
 * ============================================================================= */

import { bootstrap, state } from './store.js';
import { initSupabase, ensureSession } from './supabase.js';
import { setupDictionary } from './dictionary.js';
import { mountReview, render as renderReview, addToReview, startToday, resetFinalizeFlag } from './flashcard.js';
import { mountVocabulary, renderVocabulary } from './vocabulary.js';
import { mountImport } from './csv-import.js';
import { mountCalendar, renderCalendar } from './calendar.js';
import { mountSettings, renderSettings } from './settings.js';
import { mountBackup } from './backup.js';
import { renderHome } from './home.js';
import { getErrorMessage, toast } from './ui.js';

const PAGES = ['home', 'dictionary', 'review', 'vocabulary', 'import', 'calendar', 'settings'];
const PAGE_TITLES = {
  home: 'Hán Ngữ – Từ điển & ôn từ vựng',
  dictionary: 'Tra từ – Hán Ngữ',
  review: 'Ôn tập hôm nay – Hán Ngữ',
  vocabulary: 'Kho từ vựng – Hán Ngữ',
  import: 'Nhập CSV – Hán Ngữ',
  calendar: 'Lịch ôn tập – Hán Ngữ',
  settings: 'Cài đặt – Hán Ngữ',
};

let current = null;

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showBootError(error) {
  const boot = document.getElementById('boot-screen');
  const msg = document.getElementById('boot-message');
  const err = document.getElementById('boot-error');
  if (msg) msg.textContent = 'Không thể kết nối dữ liệu.';
  if (boot) boot.hidden = false;
  if (!err) return;
  err.hidden = false;

  if (error?.message === 'MISSING_CONFIG') {
    err.innerHTML = `
      <strong>Thiếu cấu hình Supabase.</strong>
      <ol>
        <li>Tạo project tại <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
        <li>Chạy <code>database/schema.sql</code> rồi <code>database/rls.sql</code> trong SQL Editor.</li>
        <li>Bật <em>Authentication → Sign In / Providers → Anonymous sign-ins</em>.</li>
        <li>Thêm biến môi trường <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code> trên Vercel
            (hoặc meta <code>supabase-url</code> / <code>supabase-anon-key</code> trong index.html khi chạy local).</li>
      </ol>
      <p>Xem chi tiết trong <code>README.md</code>.</p>`;
    return;
  }

  err.innerHTML = `<strong>${escapeText(error?.message || 'Lỗi không xác định')}</strong><br>
    <span class="small">${escapeText(error?.detail || '')}</span><br>
    <button class="btn btn-primary btn-sm" type="button" id="boot-retry" style="margin-top:0.75rem">Thử lại</button>`;
  document.getElementById('boot-retry')?.addEventListener('click', () => location.reload());
}

function pageFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PAGES.includes(raw) ? raw : 'home';
}

function setActiveNav(page) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === page);
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function closeMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('mobile-nav');
  if (toggle && nav) {
    toggle.setAttribute('aria-expanded', 'false');
    nav.hidden = true;
  }
}

async function navigate(page) {
  if (!PAGES.includes(page)) page = 'home';
  const changed = current !== page;
  current = page;
  setActiveNav(page);
  document.title = PAGE_TITLES[page] || PAGE_TITLES.home;

  document.querySelectorAll('.page').forEach((section) => {
    section.hidden = section.dataset.page !== page;
  });
  const boot = document.getElementById('boot-screen');
  if (boot && state.ready) boot.hidden = true;

  if (changed) window.scrollTo({ top: 0, behavior: 'auto' });

  switch (page) {
    case 'home':
      renderHome();
      break;
    case 'dictionary':
      break;
    case 'review':
      resetFinalizeFlag();
      mountReview();
      renderReview();
      break;
    case 'vocabulary':
      await renderVocabulary();
      break;
    case 'import':
      mountImport();
      break;
    case 'calendar':
      mountCalendar();
      await renderCalendar();
      break;
    case 'settings':
      mountSettings();
      mountBackup();
      renderSettings();
      break;
    default:
      break;
  }
}

function setupRouting() {
  window.addEventListener('hashchange', () => navigate(pageFromHash()));

  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', closeMobileNav);
  });

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('mobile-nav');
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    nav.hidden = open;
  });

  document.getElementById('start-today')?.addEventListener('click', () => {
    if (!state.rows.length) {
      toast('Kho từ đang trống. Hãy nhập CSV trước.', 'error');
      location.hash = '#import';
      return;
    }
    if (current !== 'review') location.hash = '#review';
    resetFinalizeFlag();
    startToday();
  });
}

function setupGlobalEvents() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.ready) return;
    if (current === 'review') renderReview();
    if (current === 'home') renderHome();
  });

  window.addEventListener('online', () => toast('Đã có kết nối lại.', 'success', 1800));
  window.addEventListener('offline', () => toast('Mất kết nối mạng — thao tác lưu sẽ thất bại.', 'error', 4000));

  window.addEventListener('unhandledrejection', (event) => {
    const message = getErrorMessage(event.reason);
    if (/JWT|session|refresh/i.test(message)) {
      ensureSession({ force: true }).catch(() => {});
    }
  });
}

async function init() {
  setupRouting();
  setupGlobalEvents();

  try {
    await initSupabase();
    await bootstrap();

    setupDictionary({
      onReview: async (row) => {
        await addToReview(row);
      },
    });

    const boot = document.getElementById('boot-screen');
    if (boot) boot.hidden = true;

    await navigate(pageFromHash());
  } catch (error) {
    console.error(error);
    showBootError(error);
  }
}

init();
