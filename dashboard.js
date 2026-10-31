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
    root.style.minHeight = '0';
    root.classList.remove('dash-compact', 'dash-compact2');
    const top = root.getBoundingClientRect().top + window.scrollY;
    const bodyPad = parseFloat(getComputedStyle(document.body).paddingBottom) || 80;
    const avail = Math.floor(window.innerHeight - top - bodyPad - 20);
    // Прокрутки на Dashboard быть не должно: не помещается — сначала компактнее, потом ещё компактнее
    if (root.offsetHeight > avail) root.classList.add('dash-compact');
    if (root.offsetHeight > avail) root.classList.add('dash-compact2');
    root.style.minHeight = Math.max(0, avail) + 'px';
}
window.addEventListener('resize', dashFit);
window.addEventListener('orientationchange', () => setTimeout(dashFit, 200));

// ---------- отрисовка ----------
// Слово «заказ» по числу (ru/uk/lt/en) — ключи dash_ord_1 / dash_ord_2 / dash_ord_5
function _dashOrdWord(n) {
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
    const a = Math.abs(n), m10 = a % 10, m100 = a % 100;
    let k;
    if (lang === 'en') k = a === 1 ? 'dash_ord_1' : 'dash_ord_5';
    else if (lang === 'lt') k = (m10 === 1 && m100 !== 11) ? 'dash_ord_1' : (m10 === 0 || (m100 >= 11 && m100 <= 19)) ? 'dash_ord_5' : 'dash_ord_2';
    else k = (m10 === 1 && m100 !== 11) ? 'dash_ord_1' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? 'dash_ord_2' : 'dash_ord_5';
    return t(k);
}
// Нижняя строка плашки: «6 заказов · 312 €» (сумма — только если заказы есть)
function _dashFoot(g) {
    return `${g.count} ${escapeHtml(_dashOrdWord(g.count))}` + (g.count ? `<span> · ${_dashMoney(g.sum)}</span>` : '');
}
function _dashWeekday(dateStr) {
    try {
        const w = new Date(dateStr + 'T12:00:00').toLocaleDateString(typeof currentLang !== 'undefined' ? currentLang : undefined, { weekday: 'short' }).replace('.', '');
        return w.charAt(0).toUpperCase() + w.slice(1);
    } catch (e) { return ''; }
}
// Столбики «Принятые» на 7 дней вперёд (сегодня + 6) + восьмой столбик «Позже» (всё дальше шестого дня):
// число принятых заказов на каждый день. Пик (тёмный) выбирается только среди 7 дней.
function _dashBars(saved) {
    const days = [], cnt = [];
    for (let i = 0; i < 7; i++) {
        const d = getLocalDateStr(i);
        days.push(d);
        cnt.push(saved.filter(o => o.status === 'принят' && o.date === d).length);
    }
    const lastDay = days[6];
    const later = saved.filter(o => o.status === 'принят' && o.date > lastDay).length;
    const max7 = Math.max(...cnt);
    const peak = max7 > 0 ? cnt.indexOf(max7) : -1;
    const max = Math.max(max7, later);
    const h = c => c ? Math.max(14, Math.round(c / max * 100)) : 8;
    let bars = cnt.map((c, i) => `<i class="${i === peak ? 't' : (c ? '' : 'z')}" style="height:${h(c)}%" title="${escapeHtml(_dashWeekday(days[i]))}: ${c}"></i>`).join('');
    bars += `<i class="later${later ? '' : ' z'}" style="height:${h(later)}%" title="${escapeHtml(t('dash_later'))}: ${later}"></i>`;
    const lbl = days.map(d => `<span>${escapeHtml(_dashWeekday(d))}</span>`).join('')
        + `<span class="later${later ? '' : ' z'}">${escapeHtml(t('dash_later'))}</span>`;
    return { bars, lbl };
}
// Главный должник: у кого больше всего неоплаченного остатка (по всем неоплаченным заказам)
function _dashTopDebtor(saved) {
    const map = {};
    saved.forEach(o => {
        const st = getOrderPaymentStatus(o);
        if (st.status === 'paid') return;
        const rem = Math.max(0, Math.round(st.grandAmt * 100) - Math.round(st.paidAmt * 100));
        if (!rem) return;
        const key = o.customer_id != null ? 'id' + o.customer_id : 'n' + (o.customer || '');
        if (!map[key]) map[key] = { name: o.customer || '—', rem: 0 };
        map[key].rem += rem;
    });
    let best = null;
    Object.values(map).forEach(x => { if (!best || x.rem > best.rem) best = x; });
    return best ? { name: best.name, rem: best.rem / 100 } : null;
}
// Выручка: этот месяц (по сегодня), тот же период прошлого месяца, прибыль, число заказов
// и накопительные суммы по дням (для графика: прошлый месяц целиком + этот до сегодня)
function _dashRevenue(saved) {
    const today = getLocalDateStr(0);
    const y = +today.slice(0, 4), m = +today.slice(5, 7), dayN = +today.slice(8, 10);
    const cur = today.slice(0, 7);
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    const prev = `${py}-${String(pm).padStart(2, '0')}`;
    const dimPrev = new Date(py, pm, 0).getDate(), dimCur = new Date(y, m, 0).getDate();
    let revenue = 0, profit = 0, count = 0, prevRev = 0;
    const dayCur = new Array(dayN).fill(0), dayPrev = new Array(dimPrev).fill(0);
    saved.forEach(o => {
        if (!o.date) return;
        const p = o.date.slice(0, 7), d = +o.date.slice(8, 10);
        if (p === cur) {
            const g = orderGrandTotal(o);
            revenue += g; profit += orderProfit(o); count++;
            if (d >= 1 && d <= dayN) dayCur[d - 1] += g;
        } else if (p === prev) {
            const g = orderGrandTotal(o);
            if (d >= 1 && d <= dimPrev) dayPrev[d - 1] += g;
            if (d <= dayN) prevRev += g;
        }
    });
    const cum = arr => { let s = 0; return arr.map(v => (s += v)); };
    return { revenue, profit, count, prevRev, cumCur: cum(dayCur), cumPrev: cum(dayPrev), dimMax: Math.max(dimPrev, dimCur), curMonth: m, prevMonth: pm, y, py };
}
// График «Выручка»: две накопительные линии (прошлый месяц — бледная, этот — яркая с заливкой и точкой «мы здесь»)
function _dashMonthShort(year, month) {
    try {
        const w = new Date(year, month - 1, 15).toLocaleDateString(typeof currentLang !== 'undefined' ? currentLang : undefined, { month: 'short' }).replace('.', '');
        return w.charAt(0).toUpperCase() + w.slice(1);
    } catch (e) { return ''; }
}
function _dashSpark(r) {
    const cc = r.cumCur;
    if (!cc || cc.length < 2) return '';
    const total = cc[cc.length - 1], prevTotal = r.cumPrev.length ? r.cumPrev[r.cumPrev.length - 1] : 0;
    const maxV = Math.max(total, prevTotal, 1), W = 100, H = 50, pad = 3, n = r.dimMax;
    const X = i => (1 + (W - 6) * i / (n - 1));
    const Y = v => (H - pad - (H - 2 * pad) * v / maxV);
    const pts = (arr) => arr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    let svg = `<line x1="1" x2="${W - 5}" y1="${H - pad}" y2="${H - pad}" stroke="#e6e1d3" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    if (prevTotal > 0) svg += `<polyline fill="none" stroke="#d3cdbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts(r.cumPrev)}"/>`;
    const lastI = cc.length - 1;
    svg += `<polygon fill="#7c9473" opacity=".14" points="${X(0).toFixed(1)},${H - pad} ${pts(cc)} ${X(lastI).toFixed(1)},${H - pad}"/>`;
    svg += `<polyline fill="none" stroke="#7c9473" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts(cc)}"/>`;
    const dx = X(lastI) / W * 100, dy = Y(total) / H * 100;
    const legend = `<div class="dc-lg"><u style="color:#7c9473">${escapeHtml(_dashMonthShort(r.y, r.curMonth))}</u>` + (prevTotal > 0 ? `<u style="color:#d3cdbb">${escapeHtml(_dashMonthShort(r.py, r.prevMonth))}</u>` : '') + '</div>';
    return `<div class="dc-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg><i class="dc-dot" style="left:${dx.toFixed(1)}%;top:${dy.toFixed(1)}%"></i></div>${legend}`;
}

// Безопасна при любом состоянии данных: при ошибке в блоке — «—», страница не ломается.
function renderDashboard() {
    if (!_dashEl('dashboard')) return;
    try { _dashRenderStrip(); } catch (e) { console.error('dashboard: strip', e); }
    try {
        const saved = _dashSavedOrders();
        const today = getLocalDateStr(0), tomorrow = getLocalDateStr(1);
        // Принятые: число + столбики на 7 дней + «N заказов · сумма»
        const acc = calcGroupTotals(saved, o => o.status === 'принят');
        _dashSet('dashAccepted', String(acc.count));
        _dashSet('dashAcceptedSub', _dashFoot(acc));
        const br = _dashBars(saved);
        _dashSet('dashBars', br.bars); _dashSet('dashBarsLbl', br.lbl);
        // Сегодня: «выполнено из всех» + полоска + «N заказов · сумма»
        const td = calcGroupTotals(saved, o => o.date === today);
        const done = saved.filter(o => o.date === today && o.status === 'выполнен').length;
        _dashSet('dashToday', String(done));
        _dashSet('dashTodayCap', td.count ? escapeHtml(t('dash_of_done').replace('{n}', td.count)) : '');
        const bar = _dashEl('dashTodayBar'); if (bar) bar.style.width = (td.count ? Math.round(done / td.count * 100) : 0) + '%';
        { const tc = bar && bar.closest('.dashboard-card'); if (tc) tc.classList.toggle('dc-alldone', td.count > 0 && done === td.count); } // всё выполнено → полоска и иконка фисташковые
        _dashSet('dashTodaySub', _dashFoot(td));
        // Завтра
        const tm = calcGroupTotals(saved, o => o.date === tomorrow);
        _dashSet('dashTomorrow', String(tm.count));
        _dashSet('dashTomorrowSub', _dashFoot(tm));
        // Выручка
        const r = _dashRevenue(saved);
        { // длинная сумма (6+ цифр) уменьшается, чтобы не вылезать из плашки
            const digits = String(Math.round(Math.abs(r.revenue))).length;
            const rv = _dashEl('dashRevenue');
            if (rv) rv.style.fontSize = digits >= 7 ? '19px' : digits >= 6 ? '23px' : '';
        }
        _dashSet('dashRevenue', `${Math.round(r.revenue).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined)}&nbsp;<small>${_dashMoney(0).replace(/^[\d\s.,\u00a0\u202f]+/, '')}</small>`);
        // Сравнение с прошлым месяцем и график — аналитика: только Full (31.10); на Light/Free плашка — число и «заказов за месяц»
        const revAnalytics = _dashStockFull();
        let delta = '';
        if (revAnalytics && r.prevRev > 0) {
            const pct = Math.round((r.revenue / r.prevRev - 1) * 100);
            delta = `<b class="${pct < 0 ? 'neg' : ''}">${pct < 0 ? '▼' : '▲'} ${pct > 0 ? '+' : ''}${pct}%</b> ${escapeHtml(t('dash_vs_prev'))}`;
        }
        _dashSet('dashRevDelta', delta || '&nbsp;');
        _dashSet('dashRevSpark', revAnalytics ? _dashSpark(r) : '');
        const showProfit = hasPermission('can_view_costs') && hasPlanFeature('cost_analytics');
        _dashSet('dashRevenueSub', showProfit
            ? `${escapeHtml(t('dash_profit_s'))}<span> · ${_dashMoney(r.profit)}</span>`
            : `${escapeHtml(t('dash_orders_month'))}<span> · ${r.count}</span>`);
        // Ждут оплаты
        const u = _dashUnpaid(saved);
        _dashSet('dashUnpaid', String(u.n));
        _dashSet('dashUnpaidSub', u.n ? `${escapeHtml(t('dash_to_pay_s'))}<span> · ${_dashMoney(u.rem)}</span>` : '&nbsp;');
        const debtor = u.n ? _dashTopDebtor(saved) : null;
        _dashSet('dashDebtLbl', debtor ? escapeHtml(t('dash_biggest')) : '&nbsp;');
        _dashSet('dashDebtName', debtor ? escapeHtml(debtor.name) : '&nbsp;');
        _dashSet('dashDebtSum', debtor ? _dashMoney(debtor.rem) : '');
    } catch (e) {
        console.error('dashboard: orders', e);
        ['dashAccepted', 'dashToday', 'dashTomorrow', 'dashRevenue', 'dashUnpaid'].forEach(id => _dashSet(id, '—'));
    }
    try {
        const full = _dashStockFull();
        // Full: большая цифра «не хватает» + два счётчика; Light/Free: «—» и строка «Доступно на тарифе Full»
        ['dashRowIng', 'dashRowSemi'].forEach(id => { const el = _dashEl(id); if (el) el.style.display = full ? '' : 'none'; });
        const lock = _dashEl('dashStockLock'); if (lock) lock.style.display = full ? 'none' : '';
        if (full) {
            const s = _dashStock();
            const tot = s.ing + s.sf;
            _dashSet('dashStockTotal', String(tot), tot > 0 ? 'bad' : '');
            _dashSet('dashStockCap', escapeHtml(t('dash_short').toLowerCase()));
            _dashSet('dashIngredients', String(s.ing), s.ing > 0 ? 'bad' : '');
            _dashSet('dashSemi', String(s.sf), s.sf > 0 ? 'bad' : '');
        } else {
            // Light/Free: счётчиков нет; позже здесь появятся данные о сроке годности
            _dashSet('dashStockTotal', '—', 'muted');
            _dashSet('dashStockCap', '');
        }
    } catch (e) {
        console.error('dashboard: stock', e);
        ['dashStockTotal', 'dashIngredients', 'dashSemi'].forEach(id => _dashSet(id, '—'));
    }
    dashFit();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(dashFit);
}

// Обновить, только если Dashboard сейчас на экране (вызывается при изменении данных)
function renderDashboardIfVisible() {
    if (typeof currentTabId !== 'undefined' && currentTabId === 'dashboard') renderDashboard();
}
