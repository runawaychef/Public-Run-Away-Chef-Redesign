// ==================== АУТЕНТИФИКАЦИЯ (Supabase Auth) ====================
// Поддерживает три режима: вход, регистрация, сброс пароля.
// Поддерживает вход через Google OAuth.
// После успешного входа/регистрации — переход к выбору сотрудника.
//
// Обычный скрипт (без модулей) — функции доступны глобально.
// Зависит от: db (supabaseClient.js), initLogin/selectEmployee (employees.js).

// Текущий режим экрана: 'login' | 'register' | 'reset'
let _authMode = 'login';

async function initAuth() {
    // Обработка возврата после Google OAuth —
    // Supabase сам восстанавливает сессию из URL-хэша
    db.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            await showAuthedApp();
        }
    });

    document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('toggleAuthMode').addEventListener('click', toggleAuthMode);
    document.getElementById('forgotPasswordLink').addEventListener('click', showResetMode);
    document.getElementById('backToLoginLink').addEventListener('click', showLoginMode);

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
    }
}

function showAuthScreen() {
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
        // initLogin() уже сам вызвал selectEmployee() и скрыл loginScreen/спиннер не нужен —
        // но на всякий случай гасим спиннер явно.
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
                        hideLoading();
                        return;
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Ни автовхода, ни валидного кэша — только теперь реально показываем выбор сотрудника.
    hideLoading();
    document.getElementById('loginScreen').classList.remove('hidden');
}

// ===== Переключение режимов =====

function showLoginMode() {
    _authMode = 'login';
    document.getElementById('authTitle').textContent = t('auth_title_login');
    document.getElementById('authSubmitBtn').textContent = t('auth_submit_login');
    document.getElementById('toggleAuthMode').textContent = t('auth_toggle_to_register');
    document.getElementById('forgotPasswordLink').classList.remove('hidden');
    document.getElementById('backToLoginLink').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('authSuccess').classList.add('hidden');
}

function showRegisterMode() {
    _authMode = 'register';
    document.getElementById('authTitle').textContent = t('auth_title_register');
    document.getElementById('authSubmitBtn').textContent = t('auth_submit_register');
    document.getElementById('toggleAuthMode').textContent = t('auth_toggle_to_login');
    document.getElementById('forgotPasswordLink').classList.add('hidden');
    document.getElementById('backToLoginLink').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('authSuccess').classList.add('hidden');
}

function showResetMode() {
    _authMode = 'reset';
    document.getElementById('authTitle').textContent = t('auth_title_reset');
    document.getElementById('authSubmitBtn').textContent = t('auth_submit_reset');
    document.getElementById('toggleAuthMode').textContent = '';
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
            redirectTo: 'https://runawaychef.github.io/Public-Run-Away-Chef-Redesign/'
        });
        if (error) throw error;
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
    try {
        const { error } = await db.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: 'https://runawaychef.github.io/Public-Run-Away-Chef-Redesign/'
            }
        });
        if (error) throw error;
        // Google перенаправит пользователя — дальнейший код не выполняется
    } catch (err) {
        console.error(err);
        errEl.textContent = t('auth_error_google_failed');
        errEl.classList.remove('hidden');
    }
}

// ===== Выход из аккаунта =====

async function signOutAccount() {
    if (!(await showConfirm(t('signout_confirm')))) return;
    closeModal();
    try { await db.auth.signOut(); } catch (e) { console.error(e); }
    localStorage.removeItem('currentEmployee');
    clearAppSnapshot();
    _instantRestoreDone = false;
    currentEmployee = null;
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    showAuthScreen();
}
