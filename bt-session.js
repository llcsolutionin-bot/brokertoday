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

    window.BTSession = {
        BASE: BASE,
        get: read,
        set: save,
        clear: clear,
        isValid: function () { return !!read(); },
        phone: function () { var s = read(); return s ? s.phone : ''; },
        token: function () { var s = read(); return s ? s.token : ''; },
        name: function () { var s = read(); return s ? (s.name || '') : ''; },
        digits10: digits10,
        otpSend: otpSend,
        otpVerify: otpVerify
    };
})();
