/*
 * Broker Today — shared phone-OTP session.
 * One verification is reused across all user features (rent, sell, homepage ads,
 * 2D floor plan, WhatsApp marketing). NO backend change: this uses the EXISTING
 * mkt-otp-send / mkt-otp-verify webhooks and the server-issued token.
 *
 * Storage: localStorage key "bt_session" = { phone: "<10 digits>", token, name? }.
 * Survives reloads/navigation; naturally lost on cache-clear or a different
 * device/browser. No client-side TTL — the session lives until logout() or until
 * an authenticated call reports the token invalid (the caller clears it on
 * HTTP 401 / { ok:false }). This mirrors how marketing.html already behaves.
 *
 * NOTE: this is the end-USER session only. The admin panel (admin-sp.html) keeps
 * its own separate admin token — do not mix the two.
 */
(function () {
    var BASE = 'https://llcsolution.duckdns.org/webhook';
    var KEY = 'bt_session';

    function digits10(p) { return String(p == null ? '' : p).replace(/\D/g, '').slice(-10); }

    function read() {
        try {
            var s = JSON.parse(localStorage.getItem(KEY) || 'null');
            return (s && s.token && s.phone) ? s : null;
        } catch (e) { return null; }
    }

    function save(phone, token, name) {
        var s = { phone: digits10(phone), token: String(token) };
        var existing = read();
        // keep a previously stored name if this call doesn't supply one
        if (name) s.name = String(name);
        else if (existing && existing.name) s.name = existing.name;
        localStorage.setItem(KEY, JSON.stringify(s));
        return s;
    }

    function clear() { localStorage.removeItem(KEY); }

    // One-time migration from the older per-feature keys, so users who already
    // verified (marketing mkt_token / ads bt_ad_sess) are not logged out.
    (function migrate() {
        if (read()) return;
        try {
            var mt = localStorage.getItem('mkt_token'), mp = localStorage.getItem('mkt_phone');
            if (mt && mp) { save(mp, mt); return; }
            var ad = JSON.parse(localStorage.getItem('bt_ad_sess') || 'null');
            if (ad && ad.token && ad.phone) { save(ad.phone, ad.token); return; }
        } catch (e) { /* ignore */ }
    })();

    function otpSend(phone) {
        try { localStorage.setItem('bt_last_phone', digits10(phone)); } catch (e) {}  // remember for faster re-login
        return fetch(BASE + '/mkt-otp-send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: digits10(phone) })
        });
    }
    function otpVerify(phone, otp) {
        return fetch(BASE + '/mkt-otp-verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: digits10(phone), otp: String(otp) })
        });
    }

    // Auto-fill forms so a user never re-types.
    //  - data-bt="phone"  → logged-in user's number (enquiry/contact forms)
    //  - data-bt="name"   → logged-in user's name (if known)
    //  - data-bt="loginphone" → the last number they used to log in (works even when logged OUT,
    //    so re-verifying after expiry/device change is ~one tap)
    // Only fills EMPTY inputs; never overwrites typed input; fields stay editable.
    // Call BTSession.autofill(modalEl) after opening a modal that resets its fields.
    function autofill(root) {
        var scope = (root && root.querySelectorAll) ? root : document;
        var s = read();
        if (s) {
            scope.querySelectorAll('[data-bt="phone"]').forEach(function (el) { if (!el.value) el.value = s.phone; });
            if (s.name) scope.querySelectorAll('[data-bt="name"]').forEach(function (el) { if (!el.value) el.value = s.name; });
        }
        try {
            var last = localStorage.getItem('bt_last_phone');
            if (last) scope.querySelectorAll('[data-bt="loginphone"]').forEach(function (el) { if (!el.value) el.value = last; });
        } catch (e) {}
    }

    // Global "signed in as … / logout" chip rendered into #btMenuAccount (present in every page's
    // hamburger drawer). Logout clears the shared session site-wide.
    function renderMenuAccount() {
        var el = document.getElementById('btMenuAccount'); if (!el) return;
        var s = read();
        if (!s) { el.innerHTML = ''; return; }
        el.innerHTML =
            '<div class="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-700">' +
                '<span class="text-xs text-slate-400 truncate">लॉग इन: <span class="font-bold text-slate-200">+91 ' + s.phone + '</span></span>' +
                '<button type="button" onclick="BTSession.logout()" class="text-xs font-bold text-red-400 hover:text-red-300 whitespace-nowrap">लॉग आउट</button>' +
            '</div>';
    }
    function logout() { clear(); try { location.reload(); } catch (e) {} }

    // Resend-OTP button with a countdown. Call after each send; the button is disabled for
    // `seconds`, then clicking it runs resendFn() and restarts the countdown. Binds its click once.
    function startResend(btnId, resendFn, seconds) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        seconds = seconds || 30;
        if (!btn._btLabel) btn._btLabel = btn.getAttribute('data-label') || btn.textContent || 'OTP दोबारा भेजें';
        btn._btResend = resendFn;
        if (!btn._btBound) {
            btn._btBound = true;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (btn.disabled) return;
                try { if (btn._btResend) btn._btResend(); } catch (err) {}
                startResend(btnId, btn._btResend, seconds);
            });
        }
        clearTimeout(btn._btTimer);
        (function tick(n) {
            if (n <= 0) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); btn.textContent = btn._btLabel; return; }
            btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); btn.textContent = btn._btLabel + ' (' + n + 's)';
            btn._btTimer = setTimeout(function () { tick(n - 1); }, 1000);
        })(seconds);
    }

    // Shared footer on every page that doesn't already have one (index keeps its own richer footer).
    function renderFooter() {
        if (document.querySelector('footer')) return;
        var f = document.createElement('footer');
        f.className = 'bg-slate-900 text-slate-400 mt-12';
        f.innerHTML =
            '<div class="max-w-6xl mx-auto px-4 py-8 text-center">' +
                '<a href="index.html" class="text-[#FF6D5A] font-extrabold text-lg">Broker Today</a>' +
                '<p class="text-xs mt-2">सिरोही, राजस्थान की भरोसेमंद प्रॉपर्टी सेवा</p>' +
                '<nav class="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 text-sm">' +
                    '<a href="index.html" class="hover:text-white">होम</a>' +
                    '<a href="rentals.html?type=rent" class="hover:text-white">किराया</a>' +
                    '<a href="rentals.html?type=sell" class="hover:text-white">बिक्री</a>' +
                    '<a href="agents.html" class="hover:text-white">एक्सपर्ट्स</a>' +
                    '<a href="news.html" class="hover:text-white">न्यूज़</a>' +
                    '<a href="privacy.html" class="hover:text-white">गोपनीयता नीति</a>' +
                '</nav>' +
                '<p class="text-xs mt-5 pt-4 border-t border-slate-800">© 2026 Broker Today · सिरोही, राजस्थान · सभी अधिकार सुरक्षित</p>' +
            '</div>';
        document.body.appendChild(f);
    }

    window.BTSession = {
        BASE: BASE,
        get: read,
        set: save,
        clear: clear,
        logout: logout,
        isValid: function () { return !!read(); },
        phone: function () { var s = read(); return s ? s.phone : ''; },
        token: function () { var s = read(); return s ? s.token : ''; },
        name: function () { var s = read(); return s ? (s.name || '') : ''; },
        digits10: digits10,
        otpSend: otpSend,
        otpVerify: otpVerify,
        autofill: autofill,
        renderMenuAccount: renderMenuAccount,
        startResend: startResend
    };

    function onReady() { autofill(); renderMenuAccount(); renderFooter(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else onReady();
})();
