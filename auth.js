// Адрес приложения в Google Play. Пока приложение не опубликовано — оставить пустым:
// значок на экране входа остаётся серым и неактивным, а в тексте приглашения сотруднику строки про магазин нет.
// После публикации вписать сюда ссылку вида 'https://play.google.com/store/apps/details?id=...'.
const PLAY_STORE_URL = '';

// Значок Google Play на экране входа: до публикации серый, после — ссылка.
// Не показываем тем, кто уже пользуется установленным приложением (иконка на экране / из Google Play).
function setupPlayBadge() {
    const el = document.getElementById('playBadge');
    if (!el) return;
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true
        || (document.referrer || '').startsWith('android-app://');
    if (standalone) { el.classList.add('hidden'); return; }
    const txt = document.getElementById('playBadgeText');
    if (PLAY_STORE_URL) {
        el.href = PLAY_STORE_URL;
        el.classList.remove('play-badge-off');
        el.removeAttribute('aria-disabled');
        if (txt) { txt.setAttribute('data-i18n', 'auth_play_get'); txt.textContent = t('auth_play_get'); }
    }
}

// ==================== АУТЕНТИФИКАЦИЯ (Supabase Auth) ====================
// Поддерживает три режима: вход, регистрация, сброс пароля.
// Поддерживает вход через Google OAuth.
// После успешного входа/регистрации — переход к выбору сотрудника.
//
// Обычный скрипт (без модулей) — функции доступны глобально.
// Зависит от: db (supabaseClient.js), initLogin/selectEmployee (employees.js).

// Текущий режим экрана: 'login' | 'register' | 'reset' | 'newpass'
let _authMode = 'login';

// ===== Ссылка из письма «Сброс пароля» (23.10) =====
// Supabase (implicit flow) возвращает на сайт с #access_token=…&type=recovery
// и сам выполняет вход. Раньше программа просто пускала внутрь — задать новый
// пароль было негде. Запоминаем признак СРАЗУ при загрузке скрипта, пока SDK
// не убрал хэш из адреса; страховка — событие PASSWORD_RECOVERY.
// Просроченная / уже использованная ссылка: #error=…&error_code=otp_expired.
// Признак дублируем в sessionStorage: при первом заходе с вкладки браузера
// service worker может перезагрузить страницу (controllerchange) — хэша уже
// не будет, а экран «Новый пароль» должен остаться.
const _authUrlTail = (location.hash || '') + '&' + (location.search || '');
function _ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function _ssSet(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
if (/type=recovery/.test(_authUrlTail)) _ssSet('sb_pw_recovery', '1');
if (/error_code=otp_expired|error=access_denied/.test(_authUrlTail)) _ssSet('sb_pw_link_error', '1');
let _pwRecoveryPending = _ssGet('sb_pw_recovery') === '1';
const _pwRecoveryLinkError = _ssGet('sb_pw_link_error') === '1';

async function initAuth() {
    // Обработка возврата после Google OAuth —
    // Supabase сам восстанавливает сессию из URL-хэша
    db.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
            _pwRecoveryPending = true;
            showNewPasswordScreen(session);
            return;
        }
        if (event === 'SIGNED_IN' && session) {
            if (_pwRecoveryPending) return; // идёт смена пароля — приложение откроется после неё
            // Флаг ставится непосредственно перед уходом на Google (handleGoogleSignIn) —
            // отличает "вернулись из Google OAuth" от обычного восстановления сессии
            // (например, простого перезапуска приложения с уже активным входом).
            const isGoogleReturn = sessionStorage.getItem('sb_google_oauth_pending') === '1';
            if (isGoogleReturn) sessionStorage.removeItem('sb_google_oauth_pending');

            if (_instantRestoreDone && session.user?.id && _snapshotAuthUserId !== session.user.id) {
                await handleInstantRestoreWrongAccount();
                return;
            }

            if (isGoogleReturn) {
                document.getElementById('googleAuthReturningScreen').classList.remove('hidden');
                // Держим экран минимум 2 сек, чтобы не мелькал — даже если showAuthedApp()
                // отработает быстрее (например, данные уже есть в кэше).
                const minDelay = new Promise(resolve => setTimeout(resolve, 2000));
                await Promise.all([showAuthedApp(), minDelay]);
                document.getElementById('googleAuthReturningScreen').classList.add('hidden');
            } else {
                await showAuthedApp();
            }
        }
    });

    document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
    setupPlayBadge();
    document.getElementById('toggleAuthMode').addEventListener('click', toggleAuthMode);
    document.getElementById('forgotPasswordLink').addEventListener('click', showResetMode);
    document.getElementById('backToLoginLink').addEventListener('click', showLoginMode);
    document.getElementById('newPasswordLaterLink').addEventListener('click', skipNewPassword);

    let session = null;
    let networkError = false;
    try {
        const { data, error } = await db.auth.getSession();
        if (error) throw error;
        session = data.session;
    } catch (e) {
        console.error('Auth check error:', e);
        networkError = true;
    }

    if (session) {
        // Снимок мог мгновенно восстановиться из кэша ЕЩЁ ДО этой проверки (см.
        // index.html/cache.js) — если он принадлежит другому Google-аккаунту
        // (сменили пользователя на этом устройстве), нельзя тихо продолжать
        // фоновое обновление поверх чужой организации — сбрасываем и грузим
        // всё заново для реального текущего пользователя.
        if (_instantRestoreDone && session.user?.id && _snapshotAuthUserId !== session.user.id) {
            await handleInstantRestoreWrongAccount();
            return;
        }
        if (_pwRecoveryPending) { showNewPasswordScreen(session); return; }
        await showAuthedApp();
    } else if (_instantRestoreDone) {
        if (networkError) {
            // Интерфейс уже показан мгновенно из локального кэша (см. cache.js) —
            // не удалось проверить сессию (скорее всего, просто нет сети сейчас).
            // Не трогаем уже показанное приложение, тихо остаёмся как есть.
            return;
        }
        // Проверка прошла успешно, и сессии действительно нет — она реально
        // истекла или была отозвана (не путать с временной проблемой сети).
        await handleInstantRestoreSessionExpired();
    } else {
        showAuthScreen();
        if (_pwRecoveryLinkError) {
            // Ссылка устарела или по ней уже переходили — сразу режим сброса с пояснением
            showResetMode();
            const errEl = document.getElementById('authError');
            errEl.textContent = t('auth_reset_link_expired');
            errEl.classList.remove('hidden');
            _clearAuthUrlTail(); // флаг ошибки снимается при «Назад к входу» / отправке ссылки
        }
    }
}

function _clearAuthUrlTail() {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

function showAuthScreen() {
    revealAppReady();
    if (typeof closeAllAppPages === 'function') closeAllAppPages(); // открытые страницы (Настройки и др.) — закрыть (22.10)
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContent').classList.add('app-locked');
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    document.getElementById('inventoryBtn').classList.add('hidden');
    showLoginMode();
}

// Supabase может вызвать onAuthStateChange('SIGNED_IN') сразу при восстановлении
// уже существующей сессии из хранилища — почти одновременно с ручной проверкой
// getSession() в initAuth(). Без защиты это запускает showAuthedApp() дважды
// параллельно, и один вызов может домешать своё состояние DOM поверх другого —
// внешне это выглядит как вспышка экрана выбора сотрудника. Кэшируем промис,
// чтобы повторные вызовы просто дожидались уже идущего.
let _showAuthedAppPromise = null;

function showAuthedApp() {
    if (_showAuthedAppPromise) return _showAuthedAppPromise;
    _showAuthedAppPromise = _doShowAuthedApp().finally(() => { _showAuthedAppPromise = null; });
    return _showAuthedAppPromise;
}

async function _doShowAuthedApp() {
    document.getElementById('authScreen').classList.add('hidden');

    if (_instantRestoreDone) {
        // Интерфейс уже собран мгновенно из локального кэша (см. cache.js) —
        // сессия подтвердилась валидной, просто тихо освежаем данные в фоне,
        // без спиннера и без повторного экрана выбора сотрудника.
        await backgroundRefreshAfterInstantRestore();
        return;
    }

    // Пока не выяснили, нужен ли реальный выбор сотрудника (или он определится
    // автоматически / возьмётся из кэша устройства) — держим нейтральный спиннер,
    // а не экран "Кто вводит данные?". Иначе он мелькает на экране при каждом
    // открытии приложения, пока идут запросы к базе (organization + employees).
    showLoading();
    const autoSelected = await initLogin();

    if (autoSelected) {
        // Если только что открылось окно "Назовите вашу пекарню" (новый
        // владелец) — сплэш пока НЕ скрываем: он останется красивым фоном
        // под этим окном вместо пустого недорисованного экрана приложения.
        // Скрываем его только после того, как человек заполнит форму —
        // см. revealAppReady() в saveOrgNameSetup() (employees.js).
        const orgSetupOpen = document.getElementById('orgNameSetupModal')?.style.display === 'flex';
        if (!orgSetupOpen) revealAppReady();
        hideLoading();
        return;
    }

    // Подставляем сотрудника из кэша устройства только если:
    // 1) организация действительно загрузилась (currentOrgId определён), и
    // 2) вход ещё не произошёл автоматически по личному аккаунту
    if (currentOrgId) {
        const saved = localStorage.getItem('currentEmployee');
        if (saved) {
            try {
                const cached = JSON.parse(saved);
                if (cached && cached.id && cached.name) {
                    // Права могли измениться с прошлого раза, когда сотрудник
                    // выбрал себя на этом устройстве — сохранённая копия могла устареть.
                    // initLogin() выше уже загрузил свежий список сотрудников из базы,
                    // поэтому берём актуальные права оттуда, а не из старого кэша.
                    const fresh = (typeof employees !== 'undefined')
                        ? employees.find(e => e.id === cached.id)
                        : null;
                    if (fresh || cached) {
                        await selectEmployee(fresh || cached);
                        revealAppReady();
                        hideLoading();
                        return;
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Ни автовхода, ни валидного кэша — только теперь реально показываем выбор сотрудника.
    revealAppReady();
    hideLoading();
    document.getElementById('loginScreen').classList.remove('hidden');
}

// ===== Переключение режимов =====

// Текст + data-i18n вместе: иначе перевод, применённый позже (загрузка языка),
// возвращает заголовок/кнопку к исходному «Вход» из разметки. 23.10
function _setI18nText(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = t(key);
    el.setAttribute('data-i18n', key);
}

// Какие элементы экрана входа видны в каждом режиме (23.10):
// - вход через Google и «или» — только во входе и регистрации;
// - поле пароля скрыто в «Сброс пароля» (там нужен только e-mail);
// - поле e-mail скрыто в «Новый пароль» (вход по ссылке уже выполнен).
function _applyAuthChrome(mode) {
    const tog = (id, show) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !show); };
    const social = mode === 'login' || mode === 'register';
    const np = mode === 'newpass';
    tog('googleSignInBtn', social);
    tog('googleAuthNote', social);
    tog('authOrDivider', social);
    tog('authEmail', !np);
    tog('authPassword', mode !== 'reset');
    tog('authPassword2', np);
    tog('authPasswordHint', np);
    tog('authSubtitle', np && !!document.getElementById('authSubtitle').textContent);
    tog('newPasswordLaterLink', np);
    tog('toggleAuthMode', social);
    const email = document.getElementById('authEmail');
    if (email) email.required = !np;
    const pw = document.getElementById('authPassword');
    if (pw) {
        const phKey = np ? 'auth_new_password_placeholder' : 'auth_password_placeholder';
        pw.placeholder = t(phKey);
        pw.setAttribute('data-i18n-placeholder', phKey);
        pw.autocomplete = np ? 'new-password' : (mode === 'register' ? 'new-password' : 'current-password');
    }
}

function showNewPasswordScreen(session) {
    _pwRecoveryPending = true;
    _ssSet('sb_pw_recovery', '1');
    showAuthScreen();
    _authMode = 'newpass';
    _setI18nText('authTitle', 'auth_title_new_password');
    const sub = document.getElementById('authSubtitle');
    const em = session && session.user && session.user.email ? session.user.email : '';
    sub.textContent = em ? t('auth_new_password_for').replace('{email}', em) : '';
    _applyAuthChrome('newpass');
    _setI18nText('authSubmitBtn', 'auth_submit_new_password');
    document.getElementById('forgotPasswordLink').classList.add('hidden');
    document.getElementById('backToLoginLink').classList.add('hidden');
    document.getElementById('authPassword').value = '';
    document.getElementById('authPassword2').value = '';
    _clearAuthUrlTail();
}

async function handleNewPasswordSubmit() {
    const p1 = document.getElementById('authPassword').value;
    const p2 = document.getElementById('authPassword2').value;
    const errEl = document.getElementById('authError');
    const okEl = document.getElementById('authSuccess');
    const btn = document.getElementById('authSubmitBtn');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    const fail = (key) => { errEl.textContent = t(key); errEl.classList.remove('hidden'); };
    if (!p1 || p1.length < 6) return fail('auth_error_password_too_short');
    if (p1 !== p2) return fail('auth_error_passwords_mismatch');
    btn.disabled = true;
    btn.textContent = t('auth_saving_password');
    try {
        const { error } = await db.auth.updateUser({ password: p1 });
        if (error) throw error;
        document.getElementById('authPassword').value = '';
        document.getElementById('authPassword2').value = '';
        okEl.textContent = t('auth_password_changed');
        okEl.classList.remove('hidden');
        await new Promise(r => setTimeout(r, 1200));
        await _finishNewPassword();
    } catch (err) {
        console.error(err);
        const m = (err && err.message) || '';
        if (/different from the old|same as the old|should be different/i.test(m)) fail('auth_error_same_password');
        else if (/Password should be|at least/i.test(m)) fail('auth_error_password_too_short');
        else fail('auth_error_generic');
    } finally {
        btn.disabled = false;
        if (_authMode === 'newpass') btn.textContent = t('auth_submit_new_password');
    }
}

async function _finishNewPassword() {
    _pwRecoveryPending = false;
    _ssSet('sb_pw_recovery', null);
    showLoginMode();
    await showAuthedApp();
}

function skipNewPassword() {
    _finishNewPassword();
}

function showLoginMode() {
    if (_authMode === 'reset') _ssSet('sb_pw_link_error', null);
    _authMode = 'login';
    _applyAuthChrome('login');
    _setI18nText('authTitle', 'auth_title_login');
    _setI18nText('authSubmitBtn', 'auth_submit_login');
    _setI18nText('toggleAuthMode', 'auth_toggle_to_register');
    document.getElementById('forgotPasswordLink').classList.remove('hidden');
    document.getElementById('backToLoginLink').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('authSuccess').classList.add('hidden');
}

function showRegisterMode() {
    _authMode = 'register';
    _applyAuthChrome('register');
    _setI18nText('authTitle', 'auth_title_register');
    _setI18nText('authSubmitBtn', 'auth_submit_register');
    _setI18nText('toggleAuthMode', 'auth_toggle_to_login');
    document.getElementById('forgotPasswordLink').classList.add('hidden');
    document.getElementById('backToLoginLink').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('authSuccess').classList.add('hidden');
}

function showResetMode() {
    _authMode = 'reset';
    _applyAuthChrome('reset');
    _setI18nText('authTitle', 'auth_title_reset');
    _setI18nText('authSubmitBtn', 'auth_submit_reset');
    document.getElementById('toggleAuthMode').textContent = '';
    document.getElementById('toggleAuthMode').removeAttribute('data-i18n');
    document.getElementById('forgotPasswordLink').classList.add('hidden');
    document.getElementById('backToLoginLink').classList.remove('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('authSuccess').classList.add('hidden');
}

function toggleAuthMode() {
    if (_authMode === 'login') {
        showRegisterMode();
    } else {
        showLoginMode();
    }
}

// ===== Обработка формы =====

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (_authMode === 'newpass') {
        await handleNewPasswordSubmit();
        return;
    }
    if (_authMode === 'reset') {
        await handlePasswordReset();
        return;
    }
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    const btn = document.getElementById('authSubmitBtn');
    errEl.classList.add('hidden');
    btn.disabled = true;

    try {
        if (_authMode === 'login') {
            btn.textContent = t('auth_signing_in');
            const { error } = await db.auth.signInWithPassword({ email, password });
            if (error) throw error;
            document.getElementById('authPassword').value = '';
            await showAuthedApp();
        } else {
            btn.textContent = t('auth_registering');
            const { data, error } = await db.auth.signUp({ email, password });
            if (error) throw error;
            document.getElementById('authPassword').value = '';
            if (data && data.session) {
                // Подтверждение email сейчас отключено в Supabase — сессия создаётся
                // сразу же, без письма. Пускаем пользователя в приложение напрямую,
                // как после обычного входа.
                await showAuthedApp();
            } else {
                // Подтверждение email включено — реально отправлено письмо, ждём его.
                document.getElementById('authSuccess').textContent = t('auth_confirm_email_sent');
                document.getElementById('authSuccess').classList.remove('hidden');
            }
        }
    } catch (err) {
        console.error(err);
        if (err.message && err.message.includes('already registered')) {
            errEl.textContent = t('auth_error_already_registered');
        } else if (err.message && err.message.includes('Invalid login credentials')) {
            errEl.textContent = t('auth_error_invalid_credentials');
        } else if (err.message && err.message.includes('Password should be')) {
            errEl.textContent = t('auth_error_password_too_short');
        } else {
            errEl.textContent = t('auth_error_generic');
        }
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        if (_authMode === 'login') btn.textContent = t('auth_submit_login');
        else btn.textContent = t('auth_submit_register');
    }
}

// ===== Сброс пароля =====

async function handlePasswordReset() {
    const email = document.getElementById('authEmail').value.trim();
    const errEl = document.getElementById('authError');
    const btn = document.getElementById('authSubmitBtn');
    errEl.classList.add('hidden');

    if (!email) {
        errEl.textContent = t('auth_error_enter_email');
        errEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = t('auth_sending');

    try {
        const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://simple-bake.com/Public-Run-Away-Chef-Redesign/'
        });
        if (error) throw error;
        _ssSet('sb_pw_link_error', null);
        document.getElementById('authSuccess').textContent = t('auth_reset_email_sent');
        document.getElementById('authSuccess').classList.remove('hidden');
    } catch (err) {
        console.error(err);
        errEl.textContent = t('auth_error_reset_failed');
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = t('auth_submit_reset');
    }
}

// ===== Вход через Google =====

async function handleGoogleSignIn() {
    const errEl = document.getElementById('authError');
    errEl.classList.add('hidden');
    // Переход на Google занимает около секунды — всё это время кнопка показывает «Открываем Google…»
    // и заблокирована (иначе из-за двойного нажатия можно запустить вход дважды).
    const gBtn = document.getElementById('googleSignInBtn');
    const gLabel = gBtn.querySelector('span');
    const gLabelText = gLabel ? gLabel.textContent : '';
    gBtn.disabled = true;
    if (gLabel) gLabel.textContent = t('auth_google_opening');
    try {
        // Ставим флаг ДО редиректа — по нему onAuthStateChange распознает
        // возврат из Google OAuth и покажет экран "Возвращаемся в Simple Bake"
        // (см. initAuth). sessionStorage переживает сам редирект на google.com и обратно.
        sessionStorage.setItem('sb_google_oauth_pending', '1');
        const { error } = await db.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: 'https://simple-bake.com/Public-Run-Away-Chef-Redesign/'
            }
        });
        if (error) throw error;
        // Google перенаправит пользователя — дальнейший код не выполняется
    } catch (err) {
        console.error(err);
        sessionStorage.removeItem('sb_google_oauth_pending');
        gBtn.disabled = false;
        if (gLabel) gLabel.textContent = gLabelText;
        errEl.textContent = t('auth_error_google_failed');
        errEl.classList.remove('hidden');
    }
}

// ===== Выход из аккаунта =====

async function signOutAccount() {
    if (!(await showConfirm(t('signout_confirm')))) return;
    closeModal();
    try { await db.auth.signOut(); } catch (e) { console.error(e); }
    try { localStorage.removeItem('bank_ui_cache'); } catch (e) {}
    localStorage.removeItem('currentEmployee');
    clearAppSnapshot();
    _instantRestoreDone = false;
    currentEmployee = null;
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    showAuthScreen();
}

// Если пользователь вернулся кнопкой «Назад» со страницы Google (браузер восстановил экран
// из кэша), кнопка не должна остаться заблокированной с надписью «Открываем Google…».
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const gBtn = document.getElementById('googleSignInBtn');
    if (!gBtn) return;
    gBtn.disabled = false;
    const gLabel = gBtn.querySelector('span');
    if (gLabel) gLabel.textContent = t('auth_google_signin');
    sessionStorage.removeItem('sb_google_oauth_pending');
});
