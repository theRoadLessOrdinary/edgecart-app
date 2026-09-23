// <me-monthday id="ts-start" value="12/25"></me-monthday>
// Access via MeMonthDay['ts-start'].mm / .dd / .val() / .clear()

const MeMonthDay = {};

class MeMonthDayElement extends HTMLElement {
    connectedCallback() {
        const id  = this.getAttribute('id') || '';
        const val = this.getAttribute('value') || '';

        // ── Build DOM ──────────────────────────────────────────────────────────
        const wrap = document.createElement('span');
        wrap.className = 'me-monthday';

        const mmEl = document.createElement('input');
        mmEl.type        = 'text';
        mmEl.inputMode   = 'numeric';
        mmEl.maxLength   = 2;
        mmEl.placeholder = 'MM';
        mmEl.className   = 'me-md-seg';
        mmEl.setAttribute('aria-label', 'Month');

        const sep = document.createElement('span');
        sep.className   = 'me-md-sep';
        sep.textContent = '/';
        sep.setAttribute('aria-hidden', 'true');

        const ddEl = document.createElement('input');
        ddEl.type        = 'text';
        ddEl.inputMode   = 'numeric';
        ddEl.maxLength   = 2;
        ddEl.placeholder = 'DD';
        ddEl.className   = 'me-md-seg';
        ddEl.setAttribute('aria-label', 'Day');

        wrap.appendChild(mmEl);
        wrap.appendChild(sep);
        wrap.appendChild(ddEl);

        // ── Helpers ────────────────────────────────────────────────────────────
        function padded(n) { return String(n).padStart(2, '0'); }

        function setMM(v) {
            mmEl.value = v ? padded(Math.min(12, Math.max(1, parseInt(v, 10)))) : '';
        }
        function setDD(v) {
            ddEl.value = v ? padded(Math.min(31, Math.max(1, parseInt(v, 10)))) : '';
        }

        function parseInitial(str) {
            const m = /^(\d{1,2})\/(\d{1,2})$/.exec(str);
            if (m) { setMM(m[1]); setDD(m[2]); }
        }

        if (val) parseInitial(val);

        // ── Segment highlight ─────────────────────────────────────────────────
        function highlight(el) { el.classList.add('me-md-active'); }
        function unhighlight(el) { el.classList.remove('me-md-active'); }

        mmEl.addEventListener('focus', () => { highlight(mmEl); mmEl.select(); });
        mmEl.addEventListener('blur',  () => {
            unhighlight(mmEl);
            if (mmEl.value && mmEl.value !== '00') setMM(mmEl.value);
            else mmEl.value = '';
        });
        ddEl.addEventListener('focus', () => { highlight(ddEl); ddEl.select(); });
        ddEl.addEventListener('blur',  () => {
            unhighlight(ddEl);
            if (ddEl.value && ddEl.value !== '00') setDD(ddEl.value);
            else ddEl.value = '';
        });

        // ── MM keyboard ───────────────────────────────────────────────────────
        mmEl.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight' || e.key === '/') { e.preventDefault(); ddEl.focus(); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); const n = parseInt(mmEl.value || 0, 10); setMM(n < 12 ? n + 1 : 1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); const n = parseInt(mmEl.value || 0, 10); setMM(n > 1  ? n - 1 : 12); }
        });

        mmEl.addEventListener('input', function () {
            const raw = mmEl.value.replace(/\D/g, '');
            mmEl.value = raw.slice(0, 2);
            const n = parseInt(raw, 10);
            // Auto-advance: first digit > 1, OR two digits entered
            if (raw.length === 2 || (raw.length === 1 && n > 1)) ddEl.focus();
        });

        // ── DD keyboard ───────────────────────────────────────────────────────
        ddEl.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); mmEl.focus(); }
            if (e.key === 'Backspace' && ddEl.value === '') { e.preventDefault(); mmEl.focus(); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); const n = parseInt(ddEl.value || 0, 10); setDD(n < 31 ? n + 1 : 1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); const n = parseInt(ddEl.value || 0, 10); setDD(n > 1  ? n - 1 : 31); }
        });

        ddEl.addEventListener('input', function () {
            const raw = ddEl.value.replace(/\D/g, '');
            ddEl.value = raw.slice(0, 2);
            const n = parseInt(raw, 10);
            // Auto-advance hint: first digit > 3
            if (raw.length === 2 || (raw.length === 1 && n > 3)) ddEl.blur();
        });

        // Clicking the separator focuses MM
        sep.addEventListener('mousedown', function (e) { e.preventDefault(); mmEl.focus(); });

        // ── API ────────────────────────────────────────────────────────────────
        const api = {
            get mm() { return mmEl.value; },
            get dd() { return ddEl.value; },
            val(v) {
                if (v === undefined) {
                    if (!mmEl.value && !ddEl.value) return '';
                    return (mmEl.value || '00') + '/' + (ddEl.value || '00');
                }
                if (!v) { mmEl.value = ''; ddEl.value = ''; return this; }
                parseInitial(v);
                return this;
            },
            setMM(v) { setMM(v); return this; },
            setDD(v) { setDD(v); return this; },
            clear() { mmEl.value = ''; ddEl.value = ''; return this; },
            focus() { mmEl.focus(); return this; },
        };

        if (id) MeMonthDay[id] = api;

        this.replaceWith(wrap);
    }
}

customElements.define('me-monthday', MeMonthDayElement);
