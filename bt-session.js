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
        renderMenuAccount: renderMenuAccount
    };

    function onReady() { autofill(); renderMenuAccount(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else onReady();
})();
