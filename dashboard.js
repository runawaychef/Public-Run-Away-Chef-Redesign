// ==================== DASHBOARD — стартовый экран (26.10.2026) ====================
// Только СВОДКА по данным, уже загруженным в память (orders, ingredients, semiFinished и
// кэш склада). Своих запросов к серверу и своего хранилища нет; логику разделов не меняет.
// Четыре плашки: «Принятые заказы», «Заказы на сегодня», «Склад» (ингредиенты и
// полуфабрикаты — критичные позиции), «Выручка за месяц». Нажатие открывает
// соответствующий раздел. Открывается стартовым экраном и по нажатию на шапку «Simple bake».
// Зависит от: orders.js (ordersStatusFilter, isOrderSaved, orderGrandTotal — money.js),
// inventory.js (stockState, stockStateContext), helpers.js (orgNowDate, getLocalDateStr), showTab() в index.html.

// Фильтры списка заказов, выставленные ИЗ Dashboard, живут только до следующего обычного
// захода на «Заказы» (через нижнее меню и т.п.) — иначе пользователь удивился бы «пустому»
// списку. Сам фильтр по статусу (ordersStatusFilter) и флаг _dashSavedOnly объявлены в orders.js.
let _dashEnteringOrders = false; // true только в момент перехода с Dashboard
let _dashDayFilter = false;      // фильтр «один день» поставлен Dashboard (а не пользователем)

// Сбрасывает ВСЕ фильтры списка заказов, чтобы число на плашке совпало со списком.
function _dashResetOrderFilters() {
    try {
        selectedOrderCustomers = [];
        if (typeof updateOrderCustomerFilter === 'function') updateOrderCustomerFilter();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('orderEmployeeFilter', '');
        set('orderPaymentFilter', '');
        set('orderDateRangeFilter', 'all');
        set('orderDateFrom', '');
        set('orderDateTo', '');
        if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
    } catch (e) { console.error('dashboard: reset filters', e); }
    ordersStatusFilter = '';
    _dashSavedOnly = false;
    _dashDayFilter = false;
}

// Вызывается из showTab('orders'): обычный заход на «Заказы» снимает фильтры Dashboard.
function dashOnEnterOrders() {
    if (_dashEnteringOrders) return;
    if (ordersStatusFilter || _dashSavedOnly || _dashDayFilter) {
        if (_dashDayFilter) {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('orderDateRangeFilter', 'all'); set('orderDateFrom', ''); set('orderDateTo', '');
            if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
        }
        ordersStatusFilter = '';
        _dashSavedOnly = false;
        _dashDayFilter = false;
        if (typeof updateOrderFilterButtonsState === 'function') updateOrderFilterButtonsState();
    }
}

function _dashGoOrders() {
    _dashEnteringOrders = true;
    try { showTab('orders'); } finally { _dashEnteringOrders = false; }
    if (typeof resetOrdersRenderLimits === 'function') resetOrdersRenderLimits();
    if (typeof updateOrderFilterButtonsState === 'function') updateOrderFilterButtonsState();
    if (typeof displayOrders === 'function') displayOrders();
}

// Плашка «Принятые заказы» → список заказов со статусом «принят»
function dashOpenAccepted() {
    _dashResetOrderFilters();
    ordersStatusFilter = 'принят';
    _dashSavedOnly = true;
    _dashGoOrders();
}

// Плашка «Заказы на сегодня» → список заказов на сегодня (дата заказа = сегодня в часовом поясе пекарни)
function dashOpenToday() {
    _dashResetOrderFilters();
    const today = getLocalDateStr(0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('orderDateRangeFilter', 'custom'); set('orderDateFrom', today); set('orderDateTo', today);
    if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
    _dashDayFilter = true;
    _dashSavedOnly = true;
    _dashGoOrders();
}

// Строки плашки «Склад» → соответствующие списки (критичные позиции в них уже сверху)
function dashOpenIngredients() { showTab('ingredients'); }
function dashOpenSemiFinished() { showTab('semiFinished'); }

// Плашка «Выручка за месяц» → статистика, только если она доступна пользователю
function _dashCanOpenStats() {
    try { return hasPermission('can_view_reports') && hasPlanFeature('stats'); } catch (e) { return false; }
}
function dashOpenRevenue() { if (_dashCanOpenStats()) showTab('stats'); }

// Кнопка «+ Новый заказ» — та же функция, что у плавающей «+» на вкладке «Заказы»
function dashNewOrder() {
    _dashResetOrderFilters();
    _dashEnteringOrders = true;
    try { showTab('orders'); } finally { _dashEnteringOrders = false; }
    createDraftOrderAndOpen();
}

// ---------- расчёт чисел ----------
function _dashCounts() {
    const saved = (typeof orders !== 'undefined' ? orders : []).filter(isOrderSaved);
    const today = getLocalDateStr(0);
    const monthPrefix = today.slice(0, 7); // ГГГГ-ММ в часовом поясе пекарни
    let accepted = 0, todayCnt = 0, revenue = 0;
    saved.forEach(o => {
        if (o.status === 'принят') accepted++;
        if (o.date === today) todayCnt++;
        if (o.date && o.date.slice(0, 7) === monthPrefix) revenue += orderGrandTotal(o);
    });
    return { accepted, today: todayCnt, revenue };
}

// «Критично» — остаток после списаний ≤ 0 (та же проверка, что подсвечивает позиции в списке «Склад»)
function _dashStock() {
    const ctx = stockStateContext(30);
    let ing = 0, sf = 0;
    (typeof ingredients !== 'undefined' ? ingredients : []).forEach(i => {
        const a = stockState('ing', i.id, ctx).after;
        if (a !== null && a <= 0) ing++;
    });
    (typeof semiFinished !== 'undefined' ? semiFinished : []).forEach(s => {
        const a = stockState('sf', s.id, ctx).after;
        if (a !== null && a <= 0) sf++;
    });
    return { ing, sf };
}

function _dashFmtRevenue(sum) {
    const sym = (typeof CURRENCY_SYMBOLS !== 'undefined' && CURRENCY_SYMBOLS[typeof currentOrgCurrency !== 'undefined' ? currentOrgCurrency : 'EUR']) || 'EUR';
    let num;
    try { num = Math.round(sum).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined); }
    catch (e) { num = String(Math.round(sum)); }
    return `${num}&nbsp;<small>${sym}</small>`;
}

function _dashSet(id, html, bad) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle('dashboard-bad', !!bad);
}

// Отрисовка. Безопасна при любом состоянии данных: при ошибке — «—», страница не ломается.
function renderDashboard() {
    if (!document.getElementById('dashboard')) return;
    try {
        const c = _dashCounts();
        _dashSet('dashAccepted', String(c.accepted));
        _dashSet('dashToday', String(c.today));
        _dashSet('dashRevenue', _dashFmtRevenue(c.revenue));
    } catch (e) {
        console.error('dashboard: orders', e);
        ['dashAccepted', 'dashToday', 'dashRevenue'].forEach(id => _dashSet(id, '—'));
    }
    try {
        const s = _dashStock();
        _dashSet('dashIngredients', String(s.ing), s.ing > 0);
        _dashSet('dashSemi', String(s.sf), s.sf > 0);
    } catch (e) {
        console.error('dashboard: stock', e);
        ['dashIngredients', 'dashSemi'].forEach(id => _dashSet(id, '—'));
    }
    const rev = document.getElementById('dashCardRevenue');
    if (rev) rev.classList.toggle('dashboard-card--static', !_dashCanOpenStats());
}

// Обновить, только если Dashboard сейчас на экране (вызывается при изменении данных)
function renderDashboardIfVisible() {
    if (typeof currentTabId !== 'undefined' && currentTabId === 'dashboard') renderDashboard();
}
