/* =============================================================================
 * app.js - Điều phối ứng dụng: khởi động, menu dropdown, routing
 * Chế độ 1 người dùng: không đăng nhập; dữ liệu là 1 kho trên Supabase.
 * ============================================================================= */

import { bootstrap, state, refreshAll } from './store.js';
import { initSupabase, setAccessKey, getAccessKey } from './supabase.js';
import { setupDictionary } from './dictionary.js';
import { mountReview, render as renderReview, addToReview, startToday, resetFinalizeFlag } from './flashcard.js';
import { mountVocabulary, renderVocabulary } from './vocabulary.js';
import { mountImport } from './csv-import.js';
import { mountCalendar, renderCalendar } from './calendar.js';
import { mountSettings, renderSettings } from './settings.js';
import { mountBackup } from './backup.js';
import { renderHome } from './home.js';
import { el, esc, getErrorMessage, toast } from './ui.js';

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

// Nhóm trên menu desktop:
// - Học: Trang chủ, Ôn tập hôm nay, Lịch ôn tập
// - Từ vựng: Tra từ, Kho từ vựng, Nhập CSV
// - (riêng) Cài đặt
const MENU_GROUPS = [
  {
    id: 'study',
    label: 'Học',
    icon: '📘',
    items: [
      { page: 'home', label: 'Trang chủ' },
      { page: 'review', label: 'Ôn tập hôm nay', hint: 'Từ mới + từ cần ôn' },
      { page: 'calendar', label: 'Lịch ôn tập' },
    ],
  },
  {
    id: 'vocab',
    label: 'Từ vựng',
    icon: '📚',
    items: [
      { page: 'dictionary', label: 'Tra từ' },
      { page: 'vocabulary', label: 'Kho từ vựng' },
      { page: 'import', label: 'Nhập CSV' },
    ],
  },
  {
    id: 'settings',
    label: 'Cài đặt',
    icon: '⚙️',
    items: [{ page: 'settings', label: 'Cài đặt & sao lưu' }],
  },
];

let current = null;

/* -------------------------------------------------------------------------- */
/* LỖI KHỞI ĐỘNG                                                               */
/* -------------------------------------------------------------------------- */
function showBootError(error) {
  const boot = document.getElementById('boot-screen');
  const msg = document.getElementById('boot-message');
  const err = document.getElementById('boot-error');
  if (msg) msg.textContent = 'Không thể kết nối dữ liệu.';
  if (boot) boot.hidden = false;
  if (!err) return;
  err.hidden = false;

  const retry = '<button class="btn btn-primary btn-sm" type="button" id="boot-retry" style="margin-top:0.75rem">Thử lại</button>';

  if (error?.message === 'MISSING_CONFIG') {
    err.innerHTML = `
      <strong>Thiếu cấu hình Supabase.</strong>
      <ol>
        <li>Tạo project tại <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
        <li>Chạy <code>database/schema.sql</code> rồi <code>database/rls.sql</code> trong SQL Editor.</li>
        <li>Thêm biến môi trường <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code> trên Vercel
            (hoặc meta <code>supabase-url</code> / <code>supabase-anon-key</code> trong index.html khi chạy local).</li>
      </ol>
      <p>Xem chi tiết trong <code>README.md</code>.</p>`;
    return;
  }

  if (error?.code === 'ACCESS_KEY_REQUIRED') {
    err.innerHTML = `
      <strong>Cần mã truy cập.</strong>
      <p class="small">Dữ liệu trên Supabase đang được bảo vệ bằng mã truy cập. Nhập mã bên dưới để mở kho từ.</p>
      <form id="boot-access-form" class="button-row" style="margin-top:0.5rem">
        <input class="input" id="boot-access-key" type="password" placeholder="Mã truy cập" autocomplete="current-password" required />
        <button class="btn btn-primary" type="submit">Mở khoá</button>
      </form>`;
    document.getElementById('boot-access-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = document.getElementById('boot-access-key').value;
      setAccessKey(value);
      try {
        await refreshAll();
        await enterApp();
      } catch (next) {
        setAccessKey('');
        showBootError(next);
      }
    });
    return;
  }

  err.innerHTML = `<strong>${esc(error?.message || 'Lỗi không xác định')}</strong><br>
    <span class="small">${esc(error?.detail || '')}</span><br>${retry}`;
  document.getElementById('boot-retry')?.addEventListener('click', () => location.reload());
}

/* -------------------------------------------------------------------------- */
/* MENU DROPDOWN (desktop + tablet)                                            */
/* -------------------------------------------------------------------------- */
function buildMenus() {
  const nav = document.getElementById('main-nav');
  const mobileNav = document.getElementById('mobile-nav');
  if (nav && !nav.dataset.built) {
    nav.dataset.built = '1';
    nav.innerHTML = '';
    for (const group of MENU_GROUPS) {
      nav.appendChild(buildDropdown(group));
    }
  }

  if (mobileNav && !mobileNav.dataset.built) {
    mobileNav.dataset.built = '1';
    mobileNav.innerHTML = '';
    for (const group of MENU_GROUPS) {
      mobileNav.appendChild(el('div', { class: 'm-group' }, [
        el('span', { class: 'm-group-title' }, group.label),
        ...group.items.map((item) =>
          el('a', {
            href: `#${item.page}`,
            'data-nav': item.page,
            onclick: () => closeAllMenus(),
          }, item.label),
        ),
      ]));
    }
  }
}

function buildDropdown(group) {
  const triggerId = `menu-trigger-${group.id}`;
  const menuId = `menu-panel-${group.id}`;
  const trigger = el('button', {
    class: 'menu-trigger',
    type: 'button',
    id: triggerId,
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-controls': menuId,
    'data-menu-group': group.id,
  }, [
    el('span', { class: 'menu-icon', 'aria-hidden': 'true' }, group.icon),
    el('span', { class: 'menu-label' }, group.label),
    el('span', { class: 'menu-caret', 'aria-hidden': 'true' }),
  ]);

  const panel = el('div', { class: 'dropdown-panel', id: menuId, role: 'menu', 'aria-labelledby': triggerId });
  for (const item of group.items) {
    panel.appendChild(
      el('a', { class: 'dropdown-item', role: 'menuitem', href: `#${item.page}`, 'data-nav': item.page, tabindex: '-1' }, [
        el('span', { class: 'di-label' }, item.label),
        item.hint ? el('span', { class: 'di-hint' }, item.hint) : null,
      ]),
    );
  }

  const wrap = el('div', { class: 'menu-group', dataset: { group: group.id } }, [trigger, panel]);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.contains('is-open');
    closeAllMenus();
    if (!open) openMenu(wrap);
  });

  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllMenus(true);
    if (e.key === 'ArrowDown' && e.target === trigger) {
      e.preventDefault();
      openMenu(wrap);
      panel.querySelector('a')?.focus();
    }
  });

  return wrap;
}

function openMenu(wrap) {
  wrap.classList.add('is-open');
  wrap.querySelector('.menu-trigger')?.setAttribute('aria-expanded', 'true');
  wrap.querySelectorAll('.dropdown-item').forEach((item) => item.setAttribute('tabindex', '0'));
}

function closeAllMenus(focusTrigger = false) {
  document.querySelectorAll('.menu-group.is-open').forEach((wrap) => {
    wrap.classList.remove('is-open');
    const trigger = wrap.querySelector('.menu-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
    wrap.querySelectorAll('.dropdown-item').forEach((item) => item.setAttribute('tabindex', '-1'));
    if (focusTrigger) trigger?.focus();
  });
}

/* -------------------------------------------------------------------------- */
/* ROUTING                                                                     */
/* -------------------------------------------------------------------------- */
function pageFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PAGES.includes(raw) ? raw : 'home';
}

function markActive(page) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.dataset.nav === page;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.menu-group').forEach((wrap) => {
    wrap.classList.toggle('has-active', Boolean(wrap.querySelector('[data-nav].is-active')));
  });
}

async function navigate(page) {
  if (!PAGES.includes(page)) page = 'home';
  const changed = current !== page;
  current = page;
  markActive(page);
  document.title = PAGE_TITLES[page] || PAGE_TITLES.home;

  document.querySelectorAll('.page').forEach((section) => {
    section.hidden = section.dataset.page !== page;
  });
  const boot = document.getElementById('boot-screen');
  if (boot && state.ready) {
    boot.hidden = true;
    const err = document.getElementById('boot-error');
    if (err) err.hidden = true;
  }
  closeAllMenus();
  closeMobileDrawer();

  if (changed) window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    await renderPage(page);
  } catch (error) {
    console.error(error);
    toast(getErrorMessage(error), 'error', 5000);
  }
}

async function renderPage(page) {
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

/* -------------------------------------------------------------------------- */
/* MOBILE DRAWER + SỰ KIỆN                                                     */
/* -------------------------------------------------------------------------- */
let backdrop = null;

function closeMobileDrawer() {
  const drawer = document.getElementById('mobile-nav');
  const toggle = document.querySelector('.nav-toggle');
  if (drawer && !drawer.hidden) {
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
  }
  backdrop?.remove();
  backdrop = null;
  toggle?.setAttribute('aria-expanded', 'false');
}

function openMobileDrawer() {
  const drawer = document.getElementById('mobile-nav');
  const toggle = document.querySelector('.nav-toggle');
  if (!drawer) return;
  drawer.hidden = false;
  toggle?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('drawer-open');
  backdrop = el('button', {
    class: 'drawer-backdrop',
    type: 'button',
    'aria-label': 'Đóng menu',
    onclick: closeMobileDrawer,
  });
  document.body.appendChild(backdrop);
  drawer.querySelector('a')?.focus();
}

function setupMobileDrawer() {
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('mobile-nav');
  toggle?.addEventListener('click', () => {
    if (drawer.hidden) openMobileDrawer();
    else closeMobileDrawer();
  });
  drawer?.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeMobileDrawer();
  });
}

function setupRouting() {
  window.addEventListener('hashchange', () => navigate(pageFromHash()));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-group')) closeAllMenus();
  });

  document.getElementById('start-today')?.addEventListener('click', () => {
    if (!state.rows.length) {
      toast('Kho từ đang trống. Hãy nhập CSV trước.', 'error');
      location.hash = '#import';
      return;
    }
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
}

async function enterApp() {
  document.querySelectorAll('#main, .app-header, .app-footer').forEach((node) => node.classList.remove('is-locked'));
  const boot = document.getElementById('boot-screen');
  if (boot) boot.hidden = true;
  await navigate(pageFromHash());
}

async function init() {
  buildMenus();
  setupMobileDrawer();
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
    void getAccessKey();
    await enterApp();
  } catch (error) {
    console.error(error);
    showBootError(error);
  }
}

init();
