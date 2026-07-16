// ==================== ЛОКАЛЬНЫЙ КЭШ ДАННЫХ (мгновенный запуск) ====================
// Android регулярно выгружает процесс WebAPK из памяти в фоне (даже установленный
// на главный экран) — при каждом возврате в приложение без этого модуля происходит
// полный цикл заново: HTML → запрос к Supabase → пусто/сплэш, что ощущается как
// заметное мигание почти на секунду при каждом переключении между приложениями.
//
// Решение — stale-while-revalidate: последний успешно загруженный набор данных
// сохраняется в localStorage. При старте, если снимок есть, интерфейс собирается
// из него МГНОВЕННО (без сплэша/спиннера), а актуальные данные тихо подгружаются
// в фоне и подменяют картинку, когда будут готовы.
//
// Обычный скрипт (без модулей) — функции доступны глобально.
// Зависит от: db (supabaseClient.js), глобальные переменные данных (главный скрипт),
// currentOrgId/currentEmployee и права (employees.js), initAuth/showAuthScreen (auth.js).

const APP_SNAPSHOT_KEY = 'appDataSnapshot_v1';

// true, если в текущей загрузке страницы интерфейс уже был мгновенно собран
// из кэша — используется в auth.js, чтобы не показывать спиннер/выбор сотрудника
// повторно поверх уже показанного приложения, а просто тихо освежить данные.
let _instantRestoreDone = false;

// user_id, под которым был сохранён снимок, из которого мгновенно восстановили
// интерфейс — auth.js сверяет его с реально авторизованным пользователем,
// как только это станет известно, и если они не совпадают (снимок остался от
// ДРУГОГО Google-аккаунта на этом же устройстве) — отменяет доверие к снимку
// вместо того чтобы тихо продолжать работать с чужой организацией.
let _snapshotAuthUserId = null;

// Сохраняет текущее состояние всех данных приложения одним снимком.
// Вызывается из loadAllData() после каждой успешной загрузки — чтобы кэш
// всегда был не старше последнего реального обращения к серверу.
// authUserId обязателен — без него при входе под ДРУГИМ Google-аккаунтом на
// том же устройстве/браузере старый снимок мог мгновенно подставиться и
// временно выдать чужую организацию за текущую (реальный случай, ловили на
// живом тестировании 15.07.2026: демо-данные ушли не в ту org).
async function saveAppSnapshot() {
    try {
        let authUserId = null;
        try {
            const { data } = await db.auth.getSession();
            authUserId = data?.session?.user?.id || null;
        } catch (e) { /* сеть недоступна — сохраняем без привязки, ниже просто не будем доверять такому снимку */ }

        const snapshot = {
            orders, customers, products, ingredients, semiFinished, employees,
            _orderPaidTotals,
            _inventoryCache,
            currentOrgId, currentOrgName, currentOrgPlan,
            currentOrgCustomersUsed, currentOrgOrdersUsed,
            currentOrgCurrency, currentOrgVatRate,
            currentEmployee,
            authUserId,
            savedAt: Date.now()
        };
        localStorage.setItem(APP_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (e) {
        // localStorage переполнен или недоступен (приватный режим) — не критично,
        // просто в этот раз не будет мгновенного запуска из кэша.
        console.warn('[cache] Не удалось сохранить снимок данных:', e);
    }
}

// Читает последний сохранённый снимок. Возвращает null, если снимка нет,
// он повреждён, или в нём нет сотрудника/организации (значит, кэш неполный —
// например, сохранение прервалось до входа — и восстанавливать из него нельзя).
function loadAppSnapshot() {
    try {
        const raw = localStorage.getItem(APP_SNAPSHOT_KEY);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        if (!snapshot || !snapshot.currentEmployee || !snapshot.currentOrgId) return null;
        return snapshot;
    } catch (e) {
        console.warn('[cache] Не удалось прочитать снимок данных:', e);
        return null;
    }
}

function clearAppSnapshot() {
    try { localStorage.removeItem(APP_SNAPSHOT_KEY); } catch (e) { /* ignore */ }
}

// Мгновенно собирает интерфейс из сохранённого снимка — без сплэша, без сети.
// Вызывается один раз, из init(), до попытки любого обращения к серверу.
function restoreAppFromSnapshot(snapshot) {
    orders = snapshot.orders || [];
    customers = snapshot.customers || [];
    products = snapshot.products || [];
    ingredients = snapshot.ingredients || [];
    semiFinished = snapshot.semiFinished || [];
    employees = snapshot.employees || [];
    _orderPaidTotals = snapshot._orderPaidTotals || {};
    _inventoryCache = snapshot._inventoryCache || {};
    currentOrgId = snapshot.currentOrgId;
    currentOrgName = snapshot.currentOrgName || '';
    currentOrgPlan = snapshot.currentOrgPlan || 'free';
    currentOrgCustomersUsed = snapshot.currentOrgCustomersUsed || 0;
    currentOrgOrdersUsed = snapshot.currentOrgOrdersUsed || 0;
    currentOrgCurrency = snapshot.currentOrgCurrency || 'EUR';
    currentOrgVatRate = snapshot.currentOrgVatRate != null ? snapshot.currentOrgVatRate : 0.21;
    currentEmployee = snapshot.currentEmployee;
    _snapshotAuthUserId = snapshot.authUserId || null;

    updateHeaderOrgName();
    applyPermissions(currentEmployee);
    applyScreenAccessPermissions();

    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('app-locked');
    document.getElementById('settingsBtn').classList.remove('hidden');
    if (typeof currentTabId === 'undefined' || currentTabId === 'orders') {
        document.getElementById('ordersViewToggle')?.classList.remove('hidden');
    }
    if (typeof positionOrdersViewToggle === 'function') setTimeout(positionOrdersViewToggle, 150);
    document.getElementById('employeesManageBtn')?.classList.toggle('hidden', !hasPermission('can_manage_team'));
    document.getElementById('companyInfoBtnBlock')?.classList.toggle('hidden', !currentEmployee.is_owner);

    renderAllScreens();
    startPeriodicRefresh();
    refreshFab();
}

// Вызывается из auth.js (_doShowAuthedApp), когда сессия подтверждена валидной
// ПОСЛЕ того, как приложение уже мгновенно показано из кэша. Тихо, без единого
// спиннера, освежает организацию/права/данные и запускает realtime.
// Сюда НЕ включён processPendingInventory() — это фоновое списание склада не
// должно выполняться на потенциально устаревших кэшированных данных, только
// на свежих (внутри самого loadAllData()).
async function backgroundRefreshAfterInstantRestore() {
    try {
        await loadCurrentOrg();
        updateHeaderOrgName();
        await refreshCurrentEmployeePermissions();
        await loadAllData(true);
        await loadInventory();
        initRealtime();
        refreshFab();
    } catch (e) {
        // Плохая сеть при фоновом обновлении — не критично, пользователь пока
        // продолжает работать с уже показанными кэшированными данными.
        console.error('[cache] Фоновое обновление после мгновенного восстановления не удалось:', e);
    }
}

// Вызывается из auth.js, когда снимок был мгновенно восстановлен из кэша, но
// реально авторизованный пользователь оказался ДРУГИМ (сменили Google-аккаунт
// на этом же устройстве/браузере) — снимок принадлежит предыдущему аккаунту,
// доверять его currentOrgId/currentEmployee нельзя ни секунды. Полностью
// сбрасываем и грузим всё заново с нуля для реального текущего пользователя —
// без этого действия могли молча уйти в чужую организацию (реальный случай,
// пойман на живом тестировании 15.07.2026).
// handleInstantRestoreWrongAccount() вызывается из auth.js в двух разных
// местах (onAuthStateChange и ручная проверка getSession()), которые могут
// сработать почти одновременно — та же гонка, что уже была починена для
// showAuthedApp() (см. auth.js). Без этой защиты initLogin() запускался
// дважды параллельно, и оба запуска успевали увидеть "сотрудников ещё нет"
// до того, как первый успевал создать владельца — в результате создавались
// два сотрудника-владельца на одну организацию (пойман на org_id=8, 15.07.2026).
let _handleWrongAccountPromise = null;

function handleInstantRestoreWrongAccount() {
    if (_handleWrongAccountPromise) return _handleWrongAccountPromise;
    _handleWrongAccountPromise = _doHandleInstantRestoreWrongAccount()
        .finally(() => { _handleWrongAccountPromise = null; });
    return _handleWrongAccountPromise;
}

async function _doHandleInstantRestoreWrongAccount() {
    clearAppSnapshot();
    _instantRestoreDone = false;
    _snapshotAuthUserId = null;
    orders = []; customers = []; products = []; ingredients = []; semiFinished = []; employees = [];
    currentOrgId = null; currentOrgName = ''; currentEmployee = null;
    localStorage.removeItem('currentEmployee');
    document.getElementById('appContent').classList.add('app-locked');
    showLoading();
    const autoSelected = await initLogin();
    if (!autoSelected) hideLoading();
}


// из кэша обнаружила, что сессии реально больше нет (не ошибка сети, а именно
// невалидная/отозванная сессия) — мягко предупреждаем и переводим на экран входа,
// вместо того чтобы молча выкинуть пользователя посреди работы.
async function handleInstantRestoreSessionExpired() {
    await showInfo('Сессия истекла. Пожалуйста, войдите снова.');
    clearAppSnapshot();
    _instantRestoreDone = false;
    currentEmployee = null;
    localStorage.removeItem('currentEmployee');
    document.getElementById('appContent').classList.add('app-locked');
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    document.getElementById('inventoryBtn')?.classList.add('hidden');
    showAuthScreen();
}
