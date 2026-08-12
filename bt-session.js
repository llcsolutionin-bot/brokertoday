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

    function clear() {
        localStorage.removeItem(KEY);
        // Also purge the legacy per-feature keys, else migrate() below would re-create the
        // session on the next load and logout would never stick.
        try { localStorage.removeItem('mkt_token'); localStorage.removeItem('mkt_phone'); localStorage.removeItem('bt_ad_sess'); } catch (e) {}
    }

    // One-time migration from the older per-feature keys, THEN delete them so a stale key can
    // never resurrect a session after logout.
    (function migrate() {
        try {
            if (!read()) {
                var mt = localStorage.getItem('mkt_token'), mp = localStorage.getItem('mkt_phone');
                if (mt && mp) { save(mp, mt); }
                else {
                    var ad = JSON.parse(localStorage.getItem('bt_ad_sess') || 'null');
                    if (ad && ad.token && ad.phone) save(ad.phone, ad.token);
                }
            }
            localStorage.removeItem('mkt_token');
            localStorage.removeItem('mkt_phone');
            localStorage.removeItem('bt_ad_sess');
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
        if (!s) {
            el.innerHTML = '<button type="button" onclick="BTSession.openLogin()" class="w-full text-left px-4 py-3 border-b border-slate-700 text-sm font-bold text-[#FF6D5A] hover:bg-slate-800 transition-colors">लॉगिन / साइन-अप →</button>';
            return;
        }
        el.innerHTML =
            '<div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-700 bg-slate-800/40">' +
                '<span class="text-xs text-slate-300 truncate">लॉग इन: <span class="font-bold text-white">+91 ' + s.phone + '</span></span>' +
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
                    '<a href="terms.html" class="hover:text-white">नियम व शर्तें</a>' +
                    '<a href="privacy.html" class="hover:text-white">गोपनीयता नीति</a>' +
                    '<a href="refund.html" class="hover:text-white">रिफंड नीति</a>' +
                '</nav>' +
                '<p class="text-xs mt-5 pt-4 border-t border-slate-800">© 2026 Broker Today · brokertoday.in — LLC Solution (Udyam UDYAM-RJ-31-0033742) · सिरोही, राजस्थान · सभी अधिकार सुरक्षित</p>' +
            '</div>';
        document.body.appendChild(f);
    }

    // ---- Master login (one OTP sign-in usable from the hamburger, works everywhere) ----
    function closeMenu() { var a = document.getElementById('mainMenu'), o = document.getElementById('mainMenuOverlay'); if (a) a.classList.add('hidden'); if (o) o.classList.add('hidden'); }
    function injectLoginModal() {
        if (document.getElementById('btLoginModal')) return;
        var d = document.createElement('div');
        d.id = 'btLoginModal';
        d.className = 'hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-[130] flex items-center justify-center p-4';
        d.innerHTML =
            '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onclick="event.stopPropagation()">' +
                '<div class="flex justify-between items-center mb-4"><h3 class="text-lg font-bold text-slate-800">लॉगिन / साइन-अप</h3>' +
                '<button type="button" onclick="BTSession.closeLogin()" aria-label="बंद करें" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">✖</button></div>' +
                '<div id="btLoginPhoneStep" class="space-y-3">' +
                    '<p class="text-sm text-slate-500">अपना WhatsApp नंबर डालें — एक बार लॉगिन करें, पूरी वेबसाइट पर काम करेगा।</p>' +
                    '<div class="flex items-stretch rounded-lg border border-slate-300 overflow-hidden focus-within:border-[#FF6D5A]"><span class="px-3 flex items-center bg-slate-100 text-slate-600 font-bold border-r border-slate-300">+91</span>' +
                    '<input id="btLoginPhone" data-bt="loginphone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-अंकों का नंबर" aria-label="WhatsApp नंबर" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" class="flex-1 px-3 py-2.5 focus:outline-none"></div>' +
                    '<button type="button" id="btLoginSend" onclick="BTSession._sendLogin()" class="w-full bg-[#FF6D5A] hover:opacity-90 text-white font-bold py-2.5 rounded-lg">OTP भेजें</button>' +
                '</div>' +
                '<div id="btLoginOtpStep" class="space-y-3 hidden">' +
                    '<p class="text-sm text-slate-500">6-अंकों का OTP भेजा गया <span id="btLoginOtpPhone" class="font-bold"></span> पर</p>' +
                    '<input id="btLoginOtp" autocomplete="one-time-code" type="text" inputmode="numeric" maxlength="6" placeholder="••••••" aria-label="OTP" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" class="w-full text-center text-2xl tracking-[0.3em] font-bold px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:border-[#FF6D5A]">' +
                    '<button type="button" id="btLoginVerify" onclick="BTSession._verifyLogin()" class="w-full bg-[#FF6D5A] hover:opacity-90 text-white font-bold py-2.5 rounded-lg">वेरिफाई करें</button>' +
                    '<p class="text-center text-sm text-slate-500">OTP नहीं मिला? <button type="button" id="btLoginResend" data-label="दोबारा भेजें" class="font-semibold text-[#FF6D5A]">दोबारा भेजें</button></p>' +
                '</div>' +
                '<p id="btLoginMsg" class="hidden mt-3 text-center text-sm font-semibold"></p>' +
            '</div>';
        d.addEventListener('click', function () { closeLogin(); });   // click backdrop to close
        document.body.appendChild(d);
    }
    function _lmsg(t, ok) { var m = document.getElementById('btLoginMsg'); if (!m) return; m.textContent = t; m.className = 'mt-3 text-center text-sm font-semibold ' + (ok ? 'text-green-600' : 'text-red-600'); m.classList.remove('hidden'); }
    function openLogin() {
        if (read()) return;                       // already signed in
        injectLoginModal();
        var m = document.getElementById('btLoginModal'); if (!m) return;
        document.getElementById('btLoginPhoneStep').classList.remove('hidden');
        document.getElementById('btLoginOtpStep').classList.add('hidden');
        var msg = document.getElementById('btLoginMsg'); if (msg) msg.classList.add('hidden');
        m.classList.remove('hidden');
        autofill(m);
        closeMenu();
    }
    function closeLogin() { var m = document.getElementById('btLoginModal'); if (m) m.classList.add('hidden'); }
    var _loginPhone = '';
    function _sendLogin() {
        var el = document.getElementById('btLoginPhone');
        var p = digits10(el ? el.value : '');
        if (!/^[6-9]\d{9}$/.test(p)) return _lmsg('सही 10-अंकों का नंबर डालें।', false);
        _loginPhone = p;
        var b = document.getElementById('btLoginSend'); if (b) { b.disabled = true; b.textContent = 'भेज रहे हैं…'; }
        otpSend(p).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
            if (d && d.ok !== false) {
                document.getElementById('btLoginOtpPhone').textContent = '+91 ' + p;
                document.getElementById('btLoginPhoneStep').classList.add('hidden');
                document.getElementById('btLoginOtpStep').classList.remove('hidden');
                var o = document.getElementById('btLoginOtp'); if (o) o.focus();
                var msg = document.getElementById('btLoginMsg'); if (msg) msg.classList.add('hidden');
                startResend('btLoginResend', function () { otpSend(p); }, 30);
            } else _lmsg((d && d.error) || 'OTP नहीं भेज सके।', false);
        }).catch(function () { _lmsg('नेटवर्क त्रुटि।', false); })
            .then(function () { if (b) { b.disabled = false; b.textContent = 'OTP भेजें'; } });
    }
    function _verifyLogin() {
        var el = document.getElementById('btLoginOtp');
        var otp = (el ? el.value : '').trim();
        if (otp.length < 4) return _lmsg('OTP डालें।', false);
        var b = document.getElementById('btLoginVerify'); if (b) { b.disabled = true; b.textContent = 'जाँच हो रही है…'; }
        otpVerify(_loginPhone, otp).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
            if (d && d.ok !== false && d.token) {
                save(_loginPhone, d.token);
                closeLogin();
                try { location.reload(); } catch (e) { renderMenuAccount(); }
            } else _lmsg((d && d.error) || 'गलत या एक्सपायर OTP।', false);
        }).catch(function () { _lmsg('नेटवर्क त्रुटि।', false); })
            .then(function () { if (b) { b.disabled = false; b.textContent = 'वेरिफाई करें'; } });
    }
    // Cross-tab sync: a login OR logout in any tab reflects in every open tab (master logout).
    var _wasLoggedIn = !!read();
    function _onStorage(e) {
        if (e && e.key && e.key !== KEY) return;
        var now = !!read();
        if (now !== _wasLoggedIn) { _wasLoggedIn = now; try { location.reload(); } catch (x) { renderMenuAccount(); } }
        else renderMenuAccount();
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
        startResend: startResend,
        openLogin: openLogin,
        closeLogin: closeLogin,
        _sendLogin: _sendLogin,
        _verifyLogin: _verifyLogin
    };

    function onReady() { injectLoginModal(); autofill(); renderMenuAccount(); renderFooter(); }
    window.addEventListener('storage', _onStorage);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else onReady();
})();
