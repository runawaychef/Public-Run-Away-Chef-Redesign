// ==================== DASHBOARD — стартовый экран (26.10.2026, v2) ====================
// Только СВОДКА по данным, уже загруженным в память (orders, ingredients, semiFinished, memoDates,
// кэш склада и платежей). Своих запросов к серверу и своего хранилища нет; логику разделов не меняет.
// Сверху полоска: ближайшая памятная дата клиента ИЛИ приветствие. Шесть плашек (2×3):
//   Принятые заказы | Заказы на сегодня | Склад | Заказы на завтра | Ждут оплаты | Выручка за месяц.
// Нажатие на плашку открывает нужный раздел (выручка не нажимается).
// Зависит от: orders.js (ordersStatusFilter, _dashSavedOnly, _dashUnpaidOnly, calcGroupTotals,
// getOrderPaymentStatus), payments.js (orderHasInvoice), money.js (orderGrandTotal, orderProfit),
// inventory.js (stockState, stockStateContext), customers.js (memoUpcoming, ...), helpers.js, showTab() в index.html.

// Фильтры списка заказов, выставленные ИЗ Dashboard, живут только до следующего обычного
// захода на «Заказы» (через нижнее меню и т.п.) — иначе пользователь удивился бы «пустому» списку.
let _dashEnteringOrders = false; // true только в момент перехода с Dashboard
let _dashDayFilter = false;      // фильтр «один день» поставлен Dashboard (а не пользователем)
let _dashEnteringStock = false;  // true только в момент перехода на «Склад» с Dashboard
let _dashMemoList = [];          // ближайшие памятные даты, показанные в полоске

function _dashEl(id) { return document.getElementById(id); }

// Сбрасывает ВСЕ фильтры списка заказов, чтобы число на плашке совпало со списком.
function _dashResetOrderFilters() {
    try {
        selectedOrderCustomers = [];
        if (typeof updateOrderCustomerFilter === 'function') updateOrderCustomerFilter();
        const set = (id, v) => { const el = _dashEl(id); if (el) el.value = v; };
        set('orderEmployeeFilter', '');
        set('orderPaymentFilter', '');
        set('orderDateRangeFilter', 'all');
        set('orderDateFrom', '');
        set('orderDateTo', '');
        if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
    } catch (e) { console.error('dashboard: reset filters', e); }
    ordersStatusFilter = '';
    _dashSavedOnly = false;
    _dashUnpaidOnly = false;
    _dashDayFilter = false;
}

// Вызывается из showTab('orders'): обычный заход на «Заказы» снимает фильтры Dashboard.
function dashOnEnterOrders() {
    if (_dashEnteringOrders) return;
    if (ordersStatusFilter || _dashSavedOnly || _dashUnpaidOnly || _dashDayFilter) {
        if (_dashDayFilter) {
            const set = (id, v) => { const el = _dashEl(id); if (el) el.value = v; };
            set('orderDateRangeFilter', 'all'); set('orderDateFrom', ''); set('orderDateTo', '');
            if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
        }
        ordersStatusFilter = '';
        _dashSavedOnly = false;
        _dashUnpaidOnly = false;
        _dashDayFilter = false;
        if (typeof updateOrderFilterButtonsState === 'function') updateOrderFilterButtonsState();
    }
}

// Вызывается из showTab('ingredients' | 'semiFinished'): обычный заход на «Склад» снимает фильтр Dashboard.
function dashOnEnterStock(kind) {
    if (_dashEnteringStock) return;
    if (kind === 'ing') stockLowOnlyIng = false;
    if (kind === 'sf') stockLowOnlySf = false;
}

function _dashGoOrders() {
    _dashEnteringOrders = true;
    try { showTab('orders'); } finally { _dashEnteringOrders = false; }
    if (typeof resetOrdersRenderLimits === 'function') resetOrdersRenderLimits();
    if (typeof updateOrderFilterButtonsState === 'function') updateOrderFilterButtonsState();
    if (typeof displayOrders === 'function') displayOrders();
}

function _dashOpenDay(dateStr) {
    _dashResetOrderFilters();
    const set = (id, v) => { const el = _dashEl(id); if (el) el.value = v; };
    set('orderDateRangeFilter', 'custom'); set('orderDateFrom', dateStr); set('orderDateTo', dateStr);
    if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
    _dashDayFilter = true;
    _dashSavedOnly = true;
    _dashGoOrders();
}

// Плашка «Принятые заказы» → список заказов со статусом «принят»
function dashOpenAccepted() {
    _dashResetOrderFilters();
    ordersStatusFilter = 'принят';
    _dashSavedOnly = true;
    _dashGoOrders();
}
// «Заказы на сегодня» / «на завтра» → список за этот день (дата заказа, часовой пояс пекарни)
function dashOpenToday() { _dashOpenDay(getLocalDateStr(0)); }
function dashOpenTomorrow() { _dashOpenDay(getLocalDateStr(1)); }
// «Ждут оплаты» → заказы, оплаченные не полностью
function dashOpenUnpaid() {
    _dashResetOrderFilters();
    _dashUnpaidOnly = true;
    _dashSavedOnly = true;
    _dashGoOrders();
}

// Строки плашки «Склад»: на Full (аналитика) — только позиции с критичным остатком; на Light/Free — список целиком
function _dashStockFull() {
    try { return hasPlanFeature('cost_analytics'); } catch (e) { return false; }
}
function dashOpenIngredients() {
    stockLowOnlyIng = _dashStockFull();
    _dashEnteringStock = true;
    try { showTab('ingredients'); } finally { _dashEnteringStock = false; }
}
function dashOpenSemiFinished() {
    stockLowOnlySf = _dashStockFull();
    _dashEnteringStock = true;
    try { showTab('semiFinished'); } finally { _dashEnteringStock = false; }
}

// Кнопка «+ Новый заказ» — та же функция, что у плавающей «+» на вкладке «Заказы»
function dashNewOrder() {
    _dashResetOrderFilters();
    _dashEnteringOrders = true;
    try { showTab('orders'); } finally { _dashEnteringOrders = false; }
    createDraftOrderAndOpen();
}

// ---------- расчёт чисел ----------
function _dashMoney(sum) {
    const sym = (typeof CURRENCY_SYMBOLS !== 'undefined' && CURRENCY_SYMBOLS[typeof currentOrgCurrency !== 'undefined' ? currentOrgCurrency : 'EUR']) || 'EUR';
    let num;
    try { num = Math.round(sum).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined); }
    catch (e) { num = String(Math.round(sum)); }
    return `${num} ${sym}`;
}

function _dashSavedOrders() {
    return (typeof orders !== 'undefined' ? orders : []).filter(isOrderSaved);
}

// «N шт. · сумма» под числом заказов; при нуле заказов — пусто
function _dashGroup(saved, pred) {
    const g = calcGroupTotals(saved, pred);
    const sub = g.count ? `${g.qty} ${t('unit_pcs')} · ${_dashMoney(g.sum)}` : '';
    return { count: g.count, sub };
}

function _dashRevenue(saved) {
    const monthPrefix = getLocalDateStr(0).slice(0, 7); // ГГГГ-ММ в часовом поясе пекарни
    let revenue = 0, profit = 0;
    saved.forEach(o => {
        if (o.date && o.date.slice(0, 7) === monthPrefix) { revenue += orderGrandTotal(o); profit += orderProfit(o); }
    });
    return { revenue, profit };
}

// Все неоплаченные (полностью) заказы. Режим «По счёту»: отдельно считаем заказы, по которым счёт ещё не выставлен.
function _dashUnpaid(saved) {
    const byInvoice = typeof currentOrgPaymentMode !== 'undefined' && currentOrgPaymentMode === 'invoice';
    let n = 0, remC = 0, overdue = 0, noInvoice = 0;
    saved.forEach(o => {
        const st = getOrderPaymentStatus(o);
        if (st.status === 'paid') return;
        n++;
        remC += Math.max(0, Math.round(st.grandAmt * 100) - Math.round(st.paidAmt * 100));
        if (st.overdue) overdue++;
        if (byInvoice && !orderHasInvoice(o)) noInvoice++;
    });
    return { n, rem: remC / 100, overdue, noInvoice, byInvoice };
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

function _dashSet(id, html, cls) {
    const el = _dashEl(id);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle('dashboard-bad', cls === 'bad');
    el.classList.toggle('dashboard-muted', cls === 'muted');
}

// ---------- полоска: напоминание или приветствие ----------
function _dashLineIcon(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
const _DASH_ICON_SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>';
const _DASH_ICON_SUNSET = '<path d="M7 17a5 5 0 0 1 10 0"/><path d="M12 5v3M4.5 10.5l1.8 1.8M19.5 10.5l-1.8 1.8M3 17h18M6 20.5h12"/>';
const _DASH_ICON_MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
function _dashGreeting() {
    let h = 12;
    try { h = orgNowDate().getHours(); } catch (e) { h = new Date().getHours(); }
    let key, icon;
    if (h >= 5 && h < 12)       { key = 'dash_greet_morning'; icon = _DASH_ICON_SUN; }
    else if (h >= 12 && h < 18) { key = 'dash_greet_day';     icon = _DASH_ICON_SUN; }
    else if (h >= 18 && h < 23) { key = 'dash_greet_evening'; icon = _DASH_ICON_SUNSET; }
    else                        { key = 'dash_greet_night';   icon = _DASH_ICON_MOON; }
    const name = (typeof currentEmployee !== 'undefined' && currentEmployee && currentEmployee.name ? String(currentEmployee.name) : '').trim();
    return { icon: _dashLineIcon(icon), text: t(key) + (name ? ', ' + name : '') + '!' };
}

function _dashRenderStrip() {
    const el = _dashEl('dashStrip');
    if (!el) return;
    let list = [];
    try {
        if (typeof memoBannerEnabled === 'function' && memoBannerEnabled() && typeof memoDates !== 'undefined' && memoDates.length) list = memoUpcoming(null);
    } catch (e) { console.error('dashboard: memo', e); list = []; }
    _dashMemoList = list;
    if (list.length) {
        const x = list[0];
        const c = (typeof customers !== 'undefined' ? customers : []).find(cc => cc.id === x.m.customer_id);
        const gold = typeof MEMO_GOLD !== 'undefined' ? MEMO_GOLD : '#c9973a';
        const more = list.length > 1 ? `<span class="dashboard-strip__more">+${list.length - 1}</span>` : '';
        el.className = 'dashboard-strip';
        el.innerHTML = `<span class="dashboard-strip__ic">${_memoHeartSvg(gold, 22)}</span>`
            + `<span class="dashboard-strip__t">${escapeHtml(memoShortWhen(x))} · ${escapeHtml(x.m.title)}${c && c.name ? ' — ' + escapeHtml(c.name) : ''}</span>${more}`;
    } else {
        const g = _dashGreeting();
        el.className = 'dashboard-strip dashboard-strip--hi';
        el.innerHTML = `<span class="dashboard-strip__ic">${g.icon}</span><span class="dashboard-strip__t">${escapeHtml(g.text)}</span>`;
    }
}

// Нажатие на полоску: одна дата — сразу клиент; несколько — список
function dashStripTap() {
    if (!_dashMemoList.length) return;
    if (_dashMemoList.length === 1) { memoBannerOpenCustomer(_dashMemoList[0].m.customer_id); return; }
    const body = _dashEl('dashMemoBody');
    if (!body) return;
    body.innerHTML = _dashMemoList.map(x => {
        const c = customers.find(cc => cc.id === x.m.customer_id);
        return _memoItemHtml(x.m, { onTap: `dashMemoPick(${x.m.customer_id})`, soon: true, whenHtml: escapeHtml(_memoWhenText(x.n)) })
            .replace('</div>\n        <div class="memo-item-when', () => `${c && c.name ? `<div class="memo-item-s">${escapeHtml(c.name)}</div>` : ''}</div>\n        <div class="memo-item-when`);
    }).join('');
    _dashEl('dashMemoModal').style.display = 'flex';
}
function dashMemoClose() { const m = _dashEl('dashMemoModal'); if (m) m.style.display = 'none'; }
function dashMemoPick(custId) { dashMemoClose(); memoBannerOpenCustomer(custId); }

// ---------- высота: плашки занимают всё место до нижнего меню ----------
function dashFit() {
    const root = _dashEl('dashboardRoot'), tab = _dashEl('dashboard');
    if (!root || !tab || tab.classList.contains('hidden')) return;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const bodyPad = parseFloat(getComputedStyle(document.body).paddingBottom) || 80;
    const h = window.innerHeight - top - bodyPad - 12;
    root.style.minHeight = Math.max(440, Math.floor(h)) + 'px';
}
window.addEventListener('resize', dashFit);
window.addEventListener('orientationchange', () => setTimeout(dashFit, 200));

// ---------- отрисовка ----------
// Безопасна при любом состоянии данных: при ошибке в блоке — «—», страница не ломается.
function renderDashboard() {
    if (!_dashEl('dashboard')) return;
    try { _dashRenderStrip(); } catch (e) { console.error('dashboard: strip', e); }
    try {
        const saved = _dashSavedOrders();
        const today = getLocalDateStr(0), tomorrow = getLocalDateStr(1);
        const acc = _dashGroup(saved, o => o.status === 'принят');
        const td = _dashGroup(saved, o => o.date === today);
        const tm = _dashGroup(saved, o => o.date === tomorrow);
        _dashSet('dashAccepted', String(acc.count)); _dashSet('dashAcceptedSub', acc.sub || '&nbsp;');
        _dashSet('dashToday', String(td.count));     _dashSet('dashTodaySub', td.sub || '&nbsp;');
        _dashSet('dashTomorrow', String(tm.count));  _dashSet('dashTomorrowSub', tm.sub || '&nbsp;');
        const r = _dashRevenue(saved);
        { // длинная сумма (6+ цифр) уменьшается, чтобы не вылезать из плашки
            const digits = String(Math.round(Math.abs(r.revenue))).length;
            const rv = _dashEl('dashRevenue');
            if (rv) rv.style.fontSize = digits >= 7 ? '17px' : digits >= 6 ? '21px' : '';
        }
        _dashSet('dashRevenue', `${Math.round(r.revenue).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined)}&nbsp;<small>${_dashMoney(0).split(' ')[1]}</small>`);
        const showProfit = hasPermission('can_view_costs') && hasPlanFeature('cost_analytics');
        _dashSet('dashRevenueSub', showProfit ? escapeHtml(t('dash_profit').replace('{sum}', _dashMoney(r.profit))) : '&nbsp;');
        const u = _dashUnpaid(saved);
        _dashSet('dashUnpaid', String(u.n));
        const lines = [];
        if (u.n) lines.push(escapeHtml(t('dash_to_pay').replace('{sum}', _dashMoney(u.rem))));
        const second = [];
        if (u.byInvoice && u.noInvoice) second.push(escapeHtml(t('dash_no_invoice').replace('{n}', u.noInvoice)));
        if (u.overdue) second.push(`<span class="dashboard-bad">${escapeHtml(t('dash_overdue').replace('{n}', u.overdue))}</span>`);
        lines.push(...second); // по строкам: на узком экране длинные подписи не рвутся посреди фразы
        _dashSet('dashUnpaidSub', lines.join('<br>') || '&nbsp;');
    } catch (e) {
        console.error('dashboard: orders', e);
        ['dashAccepted', 'dashToday', 'dashTomorrow', 'dashRevenue', 'dashUnpaid'].forEach(id => _dashSet(id, '—'));
    }
    try {
        const full = _dashStockFull();
        // Full: «Не хватает» + два счётчика; Light/Free: вместо них строка «Доступно на тарифе Full»
        ['dashRowIng', 'dashRowSemi'].forEach(id => { const el = _dashEl(id); if (el) el.style.display = full ? '' : 'none'; });
        const lock = _dashEl('dashStockLock'); if (lock) lock.style.display = full ? 'none' : '';
        if (full) {
            const s = _dashStock();
            _dashSet('dashIngredients', String(s.ing), s.ing > 0 ? 'bad' : '');
            _dashSet('dashSemi', String(s.sf), s.sf > 0 ? 'bad' : '');
        } else {
            // Light/Free: счётчики скрыты; позже здесь появятся данные о сроке годности
        }
    } catch (e) {
        console.error('dashboard: stock', e);
        ['dashIngredients', 'dashSemi'].forEach(id => _dashSet(id, '—'));
    }
    dashFit();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(dashFit);
}

// Обновить, только если Dashboard сейчас на экране (вызывается при изменении данных)
function renderDashboardIfVisible() {
    if (typeof currentTabId !== 'undefined' && currentTabId === 'dashboard') renderDashboard();
}
