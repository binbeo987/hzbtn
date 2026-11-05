/* =============================================================================
 * ui.js - Tiện ích DOM/an toàn hiển thị, toast, modal, định dạng ngày giờ.
 * Không chứa logic nghiệp vụ.
 * ============================================================================= */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Escape HTML để mọi dữ liệu người dùng nhập vào không thực thi được script. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  const textProps = ['textContent', 'value', 'disabled', 'checked', 'selected', 'readOnly', 'required', 'multiple', 'placeholder'];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (textProps.includes(k)) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
export function toast(message, type = 'info', duration = 3200) {
  const host = document.getElementById('toast-root') || document.body.appendChild(el('div', { id: 'toast-root' }));
  host.innerHTML = '';
  const node = el('div', { class: `toast toast-${type}`, role: 'status' }, [
    el('span', { class: 'toast-icon' }, type === 'error' ? '!' : type === 'success' ? '✓' : 'i'),
    el('span', {}, message),
  ]);
  host.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hide'), duration);
  setTimeout(() => node.remove(), duration + 350);
}

/** Dialog xác nhận (Promise<boolean>). */
export function confirmDialog({ title = 'Xác nhận', message = '', okText = 'Đồng ý', cancelText = 'Huỷ', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal' });
    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.append(
      el('form', { method: 'dialog', class: 'modal-body' }, [
        el('h2', { class: 'modal-title' }, title),
        el('div', { class: 'modal-text', html: message }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', value: 'cancel', onclick: () => close(false) }, cancelText),
          el('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            value: 'ok',
            onclick: () => close(true),
          }, okText),
        ]),
      ]),
    );
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    dialog.showModal();
  });
}

/** Dialog nhập liệu, trả về giá trị hoặc null. */
export function promptDialog({ title, label, value = '', okText = 'Lưu', type = 'text', min, max, help = '' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal' });
    const input = el('input', { class: 'input', type, value, min, max });
    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.append(
      el('form', {
        method: 'dialog',
        class: 'modal-body',
        onsubmit: (e) => {
          e.preventDefault();
          close(input.value);
        },
      }, [
        el('h2', { class: 'modal-title' }, title),
        el('label', { class: 'field' }, [el('span', {}, label), input]),
        help ? el('p', { class: 'muted small' }, help) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Huỷ'),
          el('button', { class: 'btn btn-primary', type: 'submit' }, okText),
        ]),
      ]),
    );
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

/** Định dạng ngày giờ theo múi giờ máy người dùng. */
export function formatDateTime(iso, { withTime = true } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const opts = withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat('vi-VN', opts).format(d);
}

export function formatDayKey(key, opts = { dateStyle: 'full' }) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', opts).format(new Date(y, m - 1, d));
}

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function setBusy(button, busy, busyText = 'Đang xử lý…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-busy');
    if (busyText) button.innerHTML = `<span class="spinner"></span>${esc(busyText)}`;
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

export function progressBar(value, max, label = '') {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bar = el('div', {
    class: 'progress',
    role: 'progressbar',
    'aria-valuenow': value,
    'aria-valuemax': max,
    html: `<span style="width:${pct}%"></span>`,
  });
  if (!label) return bar;
  return el('div', { class: 'review-progress-line' }, [
    el('span', { class: 'review-progress-text' }, label),
    bar,
    el('span', { class: 'review-progress-text muted' }, `${pct}%`),
  ]);
}

/** Chia mảng thành các batch nhỏ để insert/upsert. */
export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

export function downloadBlob(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function debounce(fn, wait = 220) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function labelHsk(hsk) {
  if (!hsk) return '';
  const clean = String(hsk).trim();
  return /^hsk/i.test(clean) ? clean.toUpperCase() : `HSK ${clean}`;
}

export const TOPIC_LABELS = {
  daily: 'Giao tiếp hàng ngày',
  family: 'Gia đình',
  school: 'Trường học',
  food: 'Ăn uống',
  home: 'Nhà cửa',
  work: 'Công việc',
  shopping: 'Mua sắm',
  travel: 'Du lịch',
  emotion: 'Cảm xúc',
  time: 'Thời gian',
  weather: 'Thời tiết',
  health: 'Sức khỏe',
};

export function labelTopic(topic) {
  if (!topic) return '';
  return TOPIC_LABELS[topic] || topic;
}

export function speakable(text) {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && Boolean(text);
}

export function speak(text, { rate = 0.9 } = {}) {
  if (!speakable(text)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = rate;
  const voices = synth.getVoices().filter((v) => /zh|cmn/i.test(v.lang));
  if (voices.length) utter.voice = voices[0];
  synth.speak(utter);
  return true;
}

export function getErrorMessage(error) {
  if (!error) return 'Lỗi không xác định.';
  if (typeof error === 'string') return error;
  const msg = error.message || error.error_description || '';
  const code = error.code ? ` [${error.code}]` : '';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Không kết nối được Supabase. Kiểm tra mạng hoặc cấu hình URL/key.';
  if (/relation .* does not exist/i.test(msg)) return 'Chưa chạy file SQL database/schema.sql trên Supabase.';
  if (/could not find the function|function .* does not exist/i.test(msg)) return 'Chưa chạy file SQL database/rls.sql (thiếu RPC).';
  if (/Invalid API key|JWT/i.test(msg)) return 'SUPABASE_ANON_KEY không hợp lệ.';
  if (/Anonymous sign-ins are disabled/i.test(msg)) return 'Cần bật Anonymous Sign-ins trong Supabase → Authentication → Providers.';
  return `${msg || 'Lỗi không xác định.'}${code}`;
}
