// ==================== СКЛАД ====================
// Учёт остатков ингредиентов: приход (ручной), расход (автоматически из заказов).
// Зависит от: db, ingredients, orders, semiFinished, products, UNIT_LABELS,
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, logActivity.

// Подписи единиц измерения (г/кг/мл/л/шт) — короткие, переводятся под текущий
// язык через i18n.js. Раньше этот словарь копипастился локальной константой
// в каждой функции файла по отдельности — свели к одной общей функции.
function unitAbbrev(code) {
    const map = { g: 'unit_g', kg: 'unit_kg', ml: 'unit_ml', l: 'unit_l', pcs: 'unit_pcs', lb: 'unit_lb', oz: 'unit_oz', fl_oz: 'unit_fl_oz', gal: 'unit_gal' };
    return (typeof t === 'function' && map[code]) ? t(map[code]) : code;
}

const STOCK_LOW_DAYS = 7; // порог «критически мало» — менее N дней запаса

function openSettingsModal() {
    closeModal();
    document.getElementById('settingsBtn').classList.add('active');
    document.getElementById('settingsCurrentEmployee').textContent = currentEmployee ? currentEmployee.name : '—';
    renderPlanInfo();
    if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
    if (typeof refreshDeleteDemoDataVisibility === 'function') refreshDeleteDemoDataVisibility();
    if (typeof refreshFillDemoDataVisibility === 'function') refreshFillDemoDataVisibility(); // ВРЕМЕННО, см. demoData.js
    if (typeof refreshPushSettingsUI === 'function') refreshPushSettingsUI();
    if (typeof refreshMemoSettingsUI === 'function') refreshMemoSettingsUI();
    if (typeof refreshPaymentModeUI === 'function') refreshPaymentModeUI();
    document.getElementById('settingsModal').style.display = 'flex';
}

// Показывает текущий тариф и, для бесплатного — сколько уже использовано из лимита.
// Считаем реально существующие записи (уже загружены в приложении), а не отдельный
// счётчик "за всё время" — так честнее для пользователя и надёжнее технически.
function renderPlanInfo() {
    const badge = document.getElementById('settingsPlanBadge');
    const usage = document.getElementById('settingsPlanUsage');
    if (!badge || !usage) return;

    const isFree = currentOrgPlan === 'free';
    if (isFree) {
        badge.textContent = t('settings_plan_free');
        badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
        badge.style.cssText = 'background:#ece7db; color:#6b6355;';

        // Лимита по клиентам нет — показываем только квоту заказов. Числа считает сервер
        // (get_order_quota): демо-заказы и удалённые заказы учитываются по правилам базы.
        const q = (typeof _orderQuota !== 'undefined') ? _orderQuota : null;
        if (q && q.limited === false) {
            usage.innerHTML = `<div>${t('settings_limits_not_apply')}</div>`;
        } else if (q) {
            const orderColor = q.used >= q.limit ? '#c0685c' : q.used >= q.warn_at ? '#96712a' : '#6b7280';
            usage.innerHTML =
                `<div style="color:${orderColor};">${t('settings_orders_label')}: ${q.used} ${t('settings_of')} ${q.limit}</div>` +
                `<div style="color:#6b7280;">${t('settings_free_deletions_label')}: ${q.deletes_left} ${t('settings_of')} ${q.allowance}</div>`;
        } else {
            usage.innerHTML = `<div style="color:#6b7280;">${t('settings_orders_label')}: …</div>`;
        }
    } else {
        badge.textContent = t('settings_plan_paid');
        badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
        badge.style.cssText = 'background:#e3e8df; color:#4f6349;';
        usage.innerHTML = `<div>${t('settings_limits_not_apply')}</div>`;
    }
}

// Кэш данных склада: { ingredient_id: { total_in, total_out, balance } }
let _inventoryCache = {};
let _inventoryMovements = []; // сырые движения (нужны для расчёта "остатка до списания" по незавершённым заказам)

// ── Загрузка и расчёт остатков ──────────────────────────────────────────────

// Отложенная перезагрузка склада: несколько вызовов подряд сливаются в один,
// пользователь не ждёт её окончания (остатки нужны на экране склада, не в заказе).
let _invReloadTimer = null;
function scheduleLoadInventory() {
    clearTimeout(_invReloadTimer);
    _invReloadTimer = setTimeout(() => { loadInventory().catch(e => console.error(e)); }, 400);
}

async function loadInventory() {
    try {
        // Порциями по 1000: потолок «Max rows» у Supabase обрезал бы длинный .limit(50000),
        // а остатки склада считаются суммой ВСЕХ движений — обрезка дала бы неверные остатки.
        const { data, error } = await fetchAllRows(() => db
            .from('inventory')
            .select('ingredient_id, semi_finished_id, type, quantity, order_item_id, created_at')
            .order('id'));
        if (error) throw error;

        const cache = {};
        (data || []).forEach(row => {
            const key = row.semi_finished_id ? `sf_${row.semi_finished_id}` : `ing_${row.ingredient_id}`;
            if (!cache[key]) cache[key] = { in: 0, out: 0 };
            if (row.type === 'приход')  cache[key].in  += Number(row.quantity);
            if (row.type === 'расход')  cache[key].out += Number(row.quantity);
            if (row.type === 'сторно')  cache[key].out -= Number(row.quantity);
        });
        _inventoryCache = cache;
        _inventoryMovements = data || [];
        updateInventoryAlertDot();
        if (typeof isAppPageOpen === 'function' && isAppPageOpen('inventoryPage')) renderInventoryPage();
    } catch (e) { console.error('Ошибка загрузки склада:', e); }
}

// ── Общий расчёт состояния позиции склада (21.10) ──────────────────────────
// Один алгоритм для «Склада», «Умного склада» и красной точки на тележке.
//   Сейчас          — физический остаток (остаток + уже списанное по невыполненным заказам).
//   Под заказы      — всё, что нужно на невыполненные заказы: уже списанное + отложенное
//                     (заказы далеко вперёд, inventory_pending).
//   После списания  — Сейчас − Под заказы; < 0 — нехватка.
//   Расход в день   — РЕАЛЬНО ушедшее со склада за период по движениям (расход − сторно:
//                     выполненные заказы, изготовление п/ф, ручные списания, инвентаризация),
//                     без резерва под ещё не выполненные заказы.
//   Хватит на       — После списания / расход в день (только при прогнозе, тариф Full).
function _pendingOrderItemIds() {
    const ids = new Set();
    (orders || []).forEach(o => {
        if (o.status === 'выполнен') return;
        (o.items || []).forEach(it => { if (it && it.id != null) ids.add(it.id); });
    });
    return ids;
}

// Отложенные списания: заказы с inventory_pending, ещё не выполненные. Состав — как при
// реальном списании (writeOff… выше): прямые ингредиенты и п/ф как единица склада.
function _deferredNeedMap() {
    const map = {};
    (orders || []).filter(o => o.inventory_pending && o.status !== 'выполнен').forEach(o => {
        (o.items || []).forEach(item => {
            const prod = (products || []).find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                const key = ri.semi_finished_id ? `sf_${ri.semi_finished_id}` : ri.ingredient_id ? `ing_${ri.ingredient_id}` : null;
                if (!key) return;
                map[key] = (map[key] || 0) + Number(ri.quantity) * Number(item.quantity) * factor;
            });
        });
    });
    return map;
}

// Контекст расчёта на один экран (считается один раз, потом stockState по каждой позиции).
// Короткая память на 1 с — чтобы десятки вызовов подряд (сортировка, карточки, точка)
// не пересчитывали всё заново.
let _stockCtxMemo = null;
function stockStateContext(periodDays) {
    periodDays = Number(periodDays) || 30;
    const nowMs = Date.now();
    // Подпись заказов: какие не выполнены и какие с отложенным списанием (смена статуса
    // или флага сразу сбрасывает память, не дожидаясь секунды).
    let sig = (orders || []).length;
    (orders || []).forEach(o => { if (o.status !== 'выполнен') sig += (Number(o.id) || 0) * (o.inventory_pending ? 3 : 1) % 1000003; });
    if (_stockCtxMemo && _stockCtxMemo.periodDays === periodDays && _stockCtxMemo.mov === _inventoryMovements
        && _stockCtxMemo.sig === sig && nowMs - _stockCtxMemo.at < 1000) return _stockCtxMemo.ctx;

    const pendingIds = _pendingOrderItemIds();
    const pending = {};
    const usage = {};
    const byItem = {}; // order_item_id → { key: списанное количество } (невыполненные заказы)
    const cutoffMs = nowMs - periodDays * 86400000;
    let firstMs = null;
    _inventoryMovements.forEach(row => {
        const key = row.semi_finished_id ? `sf_${row.semi_finished_id}` : `ing_${row.ingredient_id}`;
        const q = Number(row.quantity) || 0;
        const sign = row.type === 'расход' ? 1 : row.type === 'сторно' ? -1 : 0;
        const ms = row.created_at ? Date.parse(row.created_at) : NaN;
        if (!isNaN(ms) && (firstMs === null || ms < firstMs)) firstMs = ms;
        if (!sign) return;
        if (row.order_item_id != null && pendingIds.has(row.order_item_id)) {
            pending[key] = (pending[key] || 0) + sign * q; // резерв под невыполненный заказ
            const bi = byItem[row.order_item_id] || (byItem[row.order_item_id] = {});
            bi[key] = (bi[key] || 0) + sign * q;           // по позиции заказа — для «нехватка с даты»
            return;
        }
        if (!isNaN(ms) && ms >= cutoffMs) usage[key] = (usage[key] || 0) + sign * q;
    });
    // Делитель — дни периода, но не больше, чем ведётся склад (у новой пекарни история
    // короче 30 дней — иначе расход в день вышел бы заниженным, а прогноз — завышенным).
    const histDays = firstMs === null ? 0 : Math.max(1, Math.ceil((nowMs - firstMs) / 86400000));
    const divisor = Math.max(1, Math.min(periodDays, histDays || periodDays));
    const ctx = { periodDays, pending, deferred: _deferredNeedMap(), usage, divisor, byItem, forecast: stockForecastEnabled() };
    _stockCtxMemo = { periodDays, mov: _inventoryMovements, sig, at: nowMs, ctx };
    return ctx;
}

function stockForecastEnabled() {
    return typeof hasPlanFeature === 'function' && hasPlanFeature('cost_analytics');
}

const _r4 = x => parseFloat(Number(x).toFixed(4));

// kind: 'ing' | 'sf'. Возвращает цифры и зону ('critical' | 'warning' | 'ok').
function stockState(kind, id, ctx) {
    ctx = ctx || stockStateContext(30);
    const key = (kind === 'sf' ? 'sf_' : 'ing_') + id;
    const c = _inventoryCache[key];
    const balance = c ? _r4(c.in - c.out) : null;          // после уже прошедших списаний
    const written = ctx.pending[key] || 0;                  // уже списано под невыполненные заказы
    const deferred = ctx.deferred[key] || 0;                // ещё не списано (отложенные заказы)
    const known = balance !== null || written !== 0 || deferred !== 0;
    const now = known ? _r4((balance || 0) + written) : null;
    const reserved = _r4(written + deferred);
    const after = known ? _r4((balance || 0) - deferred) : null;
    const used = Math.max(0, ctx.usage[key] || 0);
    const daily = used / ctx.divisor;
    const daysLeft = (ctx.forecast && after !== null && after > 0 && daily > 0) ? Math.floor(after / daily) : null;
    const shortage = after !== null && after < 0;
    const critical = shortage || (after !== null && after <= 0) || (daysLeft !== null && daysLeft < 3);
    const warning = !critical && daysLeft !== null && daysLeft < 7;
    return { now, reserved, after, daily, usedInPeriod: _r4(used), daysLeft, shortage,
             zone: critical ? 'critical' : warning ? 'warning' : 'ok' };
}

// «Закончится к дате» (21.10): идём по невыполненным заказам по датам (просроченные —
// первыми) и вычитаем из «Сейчас» то, что реально списано под каждый заказ. Первый заказ,
// на котором остаток уходит в минус, — «Нехватка с …». Если на все заказы хватает —
// прогноз по реальному расходу: «Запас до ≈ …» (сегодня + «Хватит на» дней).
function stockRunout(kind, id, ctx) {
    ctx = ctx || stockStateContext(30);
    const key = (kind === 'sf' ? 'sf_' : 'ing_') + id;
    const st = stockState(kind, id, ctx);
    const list = [];
    let running = st.now || 0;
    (orders || []).filter(o => o.status !== 'выполнен')
        .slice().sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.id - b.id))
        .forEach(o => {
            let need = 0;
            (o.items || []).forEach(it => { const m = it && ctx.byItem[it.id]; if (m && m[key]) need += m[key]; });
            if (need <= 1e-9) return;
            running = _r4(running - need);
            list.push({ order: o, need: _r4(need), short: running < -1e-9 });
        });
    const firstShort = list.find(x => x.short) || null;
    const deficit = st.after !== null && st.after < 0 ? _r4(-st.after) : 0;
    const forecastDate = st.daysLeft !== null && typeof getLocalDateStr === 'function' ? getLocalDateStr(st.daysLeft) : null;
    return { st, orders: list, firstShort, deficit, forecastDate };
}

// 'YYYY-MM-DD' → 'DD.MM'
function _invDM(d) { return d && d.length >= 10 ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—'; }

// Текст «Не хватит с 27.10 · клиент, №заказа · докупить 0,6 л»
function stockShortLineHtml(r, unit) {
    if (!r.firstShort) return '';
    const o = r.firstShort.order;
    const num = typeof orderNumLabel === 'function' ? orderNumLabel(o) : (o.order_number ? '№' + o.order_number : '#' + o.id);
    const who = [o.customer ? escapeHtml(o.customer) : '', num].filter(Boolean).join(', ');
    return `<div class="inv-batch-warn">${typeof INV_WARN_ICON !== 'undefined' ? INV_WARN_ICON : ''}<span><b>${t('inv_short_since')} ${_invDM(o.date)}</b> · ${who} · ${t('inv_buy_more')} <b>${_invFmt(r.deficit)} ${unit}</b></span></div>`;
}

// Считает, сколько уже списано по заказам, которые ФИЗИЧЕСКИ ещё не выполнены
// (статус ≠ "выполнен"), независимо от даты заказа. Пока заказ не отмечен
// выполненным — ингредиент/п-ф реально ещё лежит на складе, просто в системе
// уже "зарезервирован". Используется для показа остатка "до списания".
function computePendingWriteoffMap() {
    const pendingItemIds = new Set();
    (orders || []).forEach(o => {
        if (o.status === 'выполнен') return;
        (o.items || []).forEach(it => { if (it && it.id != null) pendingItemIds.add(it.id); });
    });
    const map = {};
    _inventoryMovements.forEach(row => {
        if (row.order_item_id == null || !pendingItemIds.has(row.order_item_id)) return;
        const key = row.semi_finished_id ? `sf_${row.semi_finished_id}` : `ing_${row.ingredient_id}`;
        if (!map[key]) map[key] = 0;
        if (row.type === 'расход') map[key] += Number(row.quantity);
        if (row.type === 'сторно') map[key] -= Number(row.quantity);
    });
    return map;
}

// Остаток ингредиента "до списания" — физический остаток без учёта ещё не
// выполненных заказов (см. computePendingWriteoffMap выше).
function getIngredientBalanceBeforeWriteoff(ingId, pendingMap) {
    const after = getIngredientBalance(ingId);
    const pending = (pendingMap && pendingMap[`ing_${ingId}`]) || 0;
    if (after === null) return pending ? pending : null;
    return parseFloat((after + pending).toFixed(4));
}

// То же самое для полуфабрикатов.
function getSemiFinishedBalanceBeforeWriteoff(sfId, pendingMap) {
    const after = getSemiFinishedBalance(sfId);
    const pending = (pendingMap && pendingMap[`sf_${sfId}`]) || 0;
    if (after === null) return pending ? pending : null;
    return parseFloat((after + pending).toFixed(4));
}

// Остаток ингредиента
function getIngredientBalance(ingId) {
    const c = _inventoryCache[`ing_${ingId}`];
    if (!c) return null;
    return parseFloat((c.in - c.out).toFixed(4));
}

// Остаток полуфабриката
function getSemiFinishedBalance(sfId) {
    const c = _inventoryCache[`sf_${sfId}`];
    if (!c) return null;
    return parseFloat((c.in - c.out).toFixed(4));
}

// Проверяет используется ли ингредиент напрямую в изделиях (не через п/ф)
function isIngredientUsedDirectlyInProducts(ingId) {
    return (products || []).some(prod =>
        (prod.ingredients || []).some(ri => ri.ingredient_id === ingId)
    );
}

// Возвращает список п/ф в которых участвует ингредиент
function getSfContainingIngredient(ingId) {
    return (semiFinished || []).filter(sf =>
        (sf.ingredients || []).some(ri => ri.ingredient_id === ingId)
    );
}

// Возвращает зону тревоги п/ф: 'red', 'yellow', или null
function getSfAlertZone(sf, neededSfForOrders) {
    const balance  = getSemiFinishedBalance(sf.id);
    const daily    = avgDailySfUsage(sf.id);
    const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
    const shortage = neededSfForOrders && neededSfForOrders[sf.id] > 0 &&
        (balance === null || balance < neededSfForOrders[sf.id]);
    if (shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3)) return 'red';
    if (daysLeft !== null && daysLeft < 7) return 'yellow';
    return null;
}

// Средний расход ингредиента в день — по реальным движениям склада (21.10, см. stockState).
function avgDailyUsage(ingId, periodDays) {
    return stockState('ing', ingId, stockStateContext(periodDays || 30)).daily;
}

// Показывает/скрывает пульсирующую точку на иконке корзины
function updateInventoryAlertDot() {
    const dot = document.getElementById('inventoryAlertDot');
    if (!dot) return;
    // Точка горит ровно тогда, когда в «Умном складе» есть что-то в «Требует внимания»
    // (тот же список и те же правила, решение владельца 21.10).
    const on = smartStockRows(stockStateContext(30)).some(r => r.attention);
    dot.classList.toggle('hidden', !on);
}


// ── «Умный склад» — страница (21.10) ─────────────────────────────────────────
// Срез склада по ОТСЛЕЖИВАЕМЫМ позициям + анализ расхода за период 7/30/90 дней.
// Считает тем же stockState, что и «Склад». Список покупок и «Плановые списания»
// убраны (решение владельца 21.10). Только тариф Full и право can_manage_inventory.
let _invPage = { period: 30 };
// Вид «Умного склада» (карточки / таблица) запоминается на этом устройстве.
function _invViewMode() { try { return localStorage.getItem('inv_view_mode') === 'table' ? 'table' : 'cards'; } catch (e) { return 'cards'; } }
function setInventoryPageView(mode) {
    try { localStorage.setItem('inv_view_mode', mode === 'table' ? 'table' : 'cards'); } catch (e) { /* без хранилища — только до перезапуска */ }
    _invViewFallback = mode === 'table' ? 'table' : 'cards';
    renderInventoryPage();
}
let _invViewFallback = null;
function _invView() { return _invViewFallback || _invViewMode(); }

// Старое имя — кнопка-тележка в шапке и прежние вызовы.
async function openInventoryModal() { return openInventoryPage(); }

// opts (при возврате из карточки позиции): { period, scrollY } — прежнее место.
async function openInventoryPage(opts) {
    if (!hasPermission('can_manage_inventory')) { showInfo(t('inv_no_access')); return; }
    if (!hasPlanFeature('cost_analytics')) { showInfo(t('inv_full_only')); return; }
    _invPage = { period: opts && [7, 30, 90].includes(opts.period) ? opts.period : 30 };
    openAppPage('inventoryPage');
    renderInventoryPage();
    if (opts && opts.scrollY) requestAnimationFrame(() => window.scrollTo(0, opts.scrollY));
    showLoading(); // без подписи — только бегущие точки (владелец 21.10)
    try { await loadInventory(); } finally { hideLoading(); }
}

function closeInventoryPage() {
    if (appPageTop() === 'inventoryPage') closeAppPage();
}

function setInventoryPagePeriod(days) {
    _invPage.period = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    renderInventoryPage();
}

function _invFmt(x) { return x === null || x === undefined ? '—' : String(Math.round(Number(x) * 10) / 10).replace('.', ','); }

// Значок полуфабриката в общем списке — «слои» (выбор владельца 21.10)
const INV_SF_ICON = '<svg class="inv-sf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l-8 4l8 4l8-4l-8-4"/><path d="M4 12l8 4l8-4"/><path d="M4 16l8 4l8-4"/></svg>';
const INV_WARN_ICON = '<svg class="inv-warn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>';

// Состав общего списка «Умного склада» (решение владельца 21.10):
//   — полуфабрикаты: отмеченные сами или входящие в рецепт отслеживаемого изделия;
//   — ингредиенты: только стоящие НАПРЯМУЮ в рецепте отслеживаемого изделия
//     (ингредиенты, которые есть лишь внутри полуфабрикатов, отдельно не показываем).
function smartStockItemIds() {
    const sf = new Set(), ing = new Set();
    (semiFinished || []).forEach(x => { if (x.track_stock) sf.add(x.id); });
    (products || []).filter(p => p.track_stock).forEach(prod => {
        (prod.ingredients || []).forEach(ri => {
            if (ri.semi_finished_id) sf.add(ri.semi_finished_id);
            else if (ri.ingredient_id) ing.add(ri.ingredient_id);
        });
    });
    return { sf, ing };
}

// Вариант В: каких ингредиентов полуфабриката не хватит на ОДНУ новую партию по рецепту
// («После списания» ингредиента меньше, чем нужно на партию). Ингредиенты без учёта
// на складе (ни одного движения) не считаем — по ним склад не ведётся.
function sfBatchShortNames(sf, ctx) {
    const need = {};
    (sf.ingredients || []).forEach(ri => { if (ri.ingredient_id) need[ri.ingredient_id] = (need[ri.ingredient_id] || 0) + Number(ri.quantity || 0); });
    const names = [];
    Object.keys(need).forEach(id => {
        const st = stockState('ing', Number(id), ctx);
        if (st.after === null || !(need[id] > 0)) return;
        if (st.after < need[id]) {
            const ing = (ingredients || []).find(i => i.id === Number(id));
            if (ing) names.push(ing.name || '');
        }
    });
    return names.sort((x, y) => x.localeCompare(y));
}

// Строки общего списка с состоянием; attention — красная/жёлтая зона или нехватка на партию.
function smartStockRows(ctx) {
    const ids = smartStockItemIds();
    const rows = [];
    (semiFinished || []).filter(x => ids.sf.has(x.id)).forEach(item => {
        const runout = stockRunout('sf', item.id, ctx);
        const st = runout.st;
        const batchShort = sfBatchShortNames(item, ctx);
        rows.push({ kind: 'sf', item, st, runout, batchShort, attention: st.zone !== 'ok' || batchShort.length > 0 });
    });
    (ingredients || []).filter(x => ids.ing.has(x.id)).forEach(item => {
        const runout = stockRunout('ing', item.id, ctx);
        const st = runout.st;
        rows.push({ kind: 'ing', item, st, runout, batchShort: [], attention: st.zone !== 'ok' });
    });
    const rank = r => r.st.zone === 'critical' ? 0 : r.st.zone === 'warning' ? 1 : r.attention ? 2 : 3;
    return rows.sort((a, b) => (rank(a) - rank(b)) || (a.item.name || '').localeCompare(b.item.name || ''));
}

function _invName(r) {
    return `${r.kind === 'sf' ? INV_SF_ICON : ''}<span class="inv-name-txt">${escapeHtml(r.item.name || t('semifinished_no_name_fallback'))}</span>`;
}

function renderInventoryPage() {
    const body = document.getElementById('inventoryPageBody');
    if (!body) return;
    const per = document.getElementById('invPagePeriod');
    if (per) per.innerHTML = [7, 30, 90].map(d =>
        `<button type="button" class="stock-tab${d === _invPage.period ? ' active' : ''}" onclick="setInventoryPagePeriod(${d});">${d} ${t('inv_days_short')}</button>`).join('');

    const ctx = stockStateContext(_invPage.period);
    const rows = smartStockRows(ctx);
    if (!rows.length) {
        body.innerHTML = `<p class="inv-empty">${t('inv_no_tracked')}</p>`;
        return;
    }
    const view = _invView();
    document.getElementById('invViewBtnCards')?.classList.toggle('active', view === 'cards');
    document.getElementById('invViewBtnTable')?.classList.toggle('active', view === 'table');
    if (view === 'table') { body.innerHTML = _invTableHtml(rows); return; }

    const attn = [], ok = [];
    const usedLbl = t('inv_used_for_days').replace('{n}', _invPage.period);
    rows.forEach(r => {
        const { item, st } = r;
        const unit = unitAbbrev(item.unit);
        const isCritical = st.zone === 'critical', isWarning = st.zone === 'warning';
        const accent = isCritical || (!isWarning && r.batchShort.length) ? '#c0685c' : isWarning ? '#d9a441' : '';
        const afterColor = isCritical ? '#c0685c' : isWarning ? '#96712a' : '#4f6349';
        const ro = r.runout;
        const thirdLabel = ro.firstShort ? t('inv_short_since_cell') : t('inv_stock_until');
        const thirdText = ro.firstShort ? _invDM(ro.firstShort.order.date) : ro.forecastDate ? `≈ ${_invDM(ro.forecastDate)}` : '—';
        const price = r.kind === 'sf' ? stockPriceText(semiFinishedUnitCost(item), item.unit) : stockPriceText(ingredientUnitPrice(item), item.unit);
        const warn = r.batchShort.length
            ? `<div class="inv-batch-warn">${INV_WARN_ICON}<span>${t('inv_sf_batch_short')} ${r.batchShort.map(escapeHtml).join(', ')}</span></div>` : '';
        const html = `
        <div class="order-card" style="cursor:pointer;" onclick="openStockItemFromSmart('${r.kind}', ${item.id})">
            ${accent ? `<div class="stripe" style="background:${accent};"></div>` : ''}
            <div class="order-card-body">
                <div class="oc-row">
                    <span class="oc-name inv-name">${_invName(r)}</span>
                    <span class="oc-price">${price}</span>
                </div>
                ${stockCardCellsHtml({
                    beforeText: st.now !== null ? `${_invFmt(st.now)} ${unit}` : '—',
                    afterText: st.after !== null ? `${_invFmt(st.after)} ${unit}` : '—',
                    afterColor, thirdLabel, thirdText, thirdColor: afterColor })}
                <div class="inv-an">
                    <span>${t('inv_reserved_chip')} ${_invFmt(st.reserved)} ${unit}</span>
                    <span>${usedLbl} ${_invFmt(st.usedInPeriod)} ${unit}</span>
                </div>
                ${stockShortLineHtml(ro, unit)}
                ${warn}
            </div>
        </div>`;
        (r.attention ? attn : ok).push(html);
    });
    body.innerHTML = stockGroupsHtml(attn, ok);
}

// Табличный вид: Название | Сейчас | После списания | Хватит на; точка — зона; значок «слои»
// у полуфабриката, треугольник — не хватит ингредиентов на новую партию.
function _invTableHtml(rows) {
    const dotColor = { critical: '#c0685c', warning: '#d9a441', ok: '#7c9473' };
    const txtColor = { critical: '#c0685c', warning: '#96712a', ok: '#4f6349' };
    const rowHtml = r => {
        const { item, st } = r;
        const unit = unitAbbrev(item.unit);
        const ro = r.runout;
        const days = ro.firstShort ? `${t('inv_since_prefix')} ${_invDM(ro.firstShort.order.date)}` : ro.forecastDate ? `≈${_invDM(ro.forecastDate)}` : '—';
        const dot = st.zone === 'ok' && r.batchShort.length ? '#c0685c' : dotColor[st.zone];
        return `<div class="st-row" onclick="openStockItemFromSmart('${r.kind}', ${item.id})">
            <span class="st-name inv-name"><span class="st-dot" style="background:${dot};"></span>${_invName(r)}${r.batchShort.length ? INV_WARN_ICON : ''}</span>
            <span class="st-num">${st.now !== null ? `${_invFmt(st.now)} ${unit}` : '—'}</span>
            <span class="st-num" style="color:${st.after !== null && st.after < 0 ? '#c0685c' : '#3c3a34'};">${st.after !== null ? `${_invFmt(st.after)} ${unit}` : '—'}</span>
            <span class="st-days" style="color:${txtColor[st.zone]};">${days}</span>
        </div>`;
    };
    const attn = rows.filter(r => r.attention).map(rowHtml);
    const ok = rows.filter(r => !r.attention).map(rowHtml);
    const island = arr => arr.length ? `<div class="ot-island">${arr.join('')}</div>` : '';
    const head = `<div class="st-head"><span>${t('inv_col_name')}</span><span>${t('ing_cell_now')}</span><span>${t('ing_cell_after')}</span><span>${t('inv_stock_until')}</span></div>`;
    return head + stockGroupsHtml(attn.length ? [island(attn)] : [], ok.length ? [island(ok)] : []);
}

// Блок «Умный склад» в карточке ингредиента / полуфабриката (только Full, 21.10):
// статус (нехватка с даты или «Запас до ≈»), у ПФ — нехватка на новую партию, расход
// за 30 дней, до 3 ближайших заказов с этой позицией (нажатие — открыть заказ).
function renderStockSmartInfo(kind, item, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!item || !hasPlanFeature('cost_analytics')) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const ctx = stockStateContext(30);
    const ro = stockRunout(kind, item.id, ctx);
    const st = ro.st;
    const unit = unitAbbrev(item.unit);
    let html = ''; // заголовок «Умный склад» с иконкой убран (владелец 21.10)
    if (ro.firstShort) html += stockShortLineHtml(ro, unit);
    if (kind === 'sf') {
        const bs = sfBatchShortNames(item, ctx);
        if (bs.length) html += `<div class="inv-batch-warn">${INV_WARN_ICON}<span>${t('inv_sf_batch_short')} ${bs.map(escapeHtml).join(', ')}</span></div>`;
    }
    const next = ro.orders.slice(0, 3);
    if (next.length) {
        html += `<div class="inv-info-sub">${t('inv_next_orders')}</div>`;
        html += next.map(x => `<div class="inv-info-ord${x.short ? ' short' : ''}" onclick="openOrderFromStockCard(${x.order.id})">
            <span>${_invDM(x.order.date)}</span><span class="inv-info-cust">${escapeHtml(x.order.customer || (typeof orderNumLabel === 'function' ? orderNumLabel(x.order) : ''))}</span><span>${_invFmt(x.need)} ${unit}</span></div>`).join('');
    }
    // Метки внизу блока (вариант А, владелец 22.10) — как в карточках «Умного склада»:
    // «Запас до ≈ …» (только если нехватки нет), «За 30 дн. X», «Y в день»
    const chips = [];
    if (!ro.firstShort && ro.forecastDate) chips.push(`${t('inv_stock_until')} ≈ ${_invDM(ro.forecastDate)}`);
    chips.push(`${t('inv_used_for_days').replace('{n}', 30)} ${_invFmt(st.usedInPeriod)} ${unit}`);
    chips.push(`${_invFmt(st.daily)} ${unit} ${t('inv_per_day_word')}`);
    html += `<div class="inv-an inv-info-chips">${chips.map(c => `<span>${escapeHtml(c)}</span>`).join('')}</div>`;
    el.innerHTML = html;
    el.classList.remove('hidden');
}

// Заказ из блока «Умный склад» в карточке позиции
function openOrderFromStockCard(orderId) {
    showTab('orders');
    if (typeof openOrderDetail === 'function') openOrderDetail(orderId);
}

// Нажатие на карточку/строку «Умного склада» → карточка позиции в разделе «Склад».
// Запоминаем, откуда пришли: «Назад» из карточки вернёт в «Умный склад» на то же место
// (вкладка, период, прокрутка), а потом «Назад» из него — в раздел, где он был открыт.
// Переход по нижнему меню/иконкам память сбрасывает (showTab → forgetSmartStockReturn).
let _smartStockReturn = null;   // { prevTab, period, scrollY }
let _smartNavInternal = false;  // наш собственный showTab — память не сбрасывать
function openStockItemFromSmart(kind, id) {
    const ret = { prevTab: (typeof currentTabId !== 'undefined' && currentTabId) || 'orders',
                  period: _invPage.period, scrollY: window.scrollY || 0 };
    _smartNavInternal = true;
    try { showTab(kind === 'sf' ? 'semiFinished' : 'ingredients'); } finally { _smartNavInternal = false; }
    _smartStockReturn = ret;
    if (kind === 'sf') openSemiFinishedDetail(id); else openIngredientDetail(id);
}
function smartStockReturnPending() { return !!_smartStockReturn; }
function forgetSmartStockReturn() { if (!_smartNavInternal) _smartStockReturn = null; }
// Вызывается из closeIngredientDetail / closeSemiFinishedDetail (кнопка «Назад» и системная «назад»).
async function returnToSmartStock() {
    const r = _smartStockReturn;
    _smartStockReturn = null;
    if (!r) return false;
    _smartNavInternal = true;
    try { if (r.prevTab !== currentTabId) showTab(r.prevTab); } finally { _smartNavInternal = false; }
    await openInventoryPage({ period: r.period, scrollY: r.scrollY });
    return true;
}

(window._appPageOnShow = window._appPageOnShow || {}).inventoryPage = () => renderInventoryPage();

// ── Инвентаризация ───────────────────────────────────────────────────────────

function openInventarizationModal(singleIngId) {
    const pendingMap = typeof computePendingWriteoffMap === 'function' ? computePendingWriteoffMap() : {};
    let list = ingredients.slice();
    if (singleIngId != null) list = list.filter(ing => ing.id === singleIngId);
    const sorted = list.sort((a, b) => (a.name||'').localeCompare(b.name||''));

    let html = '<table class="w-full text-xs table-clean">';
    html += '<thead><tr style="background-color:#e3e8df;"><th class="p-1 text-left">' + t('inv_col_ingredient') + '</th><th class="p-1 text-right">' + t('sf_current_balance') + '</th><th class="p-1 text-right">' + t('sf_actual') + '</th></tr></thead><tbody>';
    sorted.forEach(ing => {
        const unitLabel = unitAbbrev(ing.unit);
        const balance   = getIngredientBalanceBeforeWriteoff(ing.id, pendingMap);
        const balStr    = balance !== null ? `${Number(balance).toFixed(2)} ${unitLabel}` : '—';
        html += `<tr class="border-b">
            <td class="p-1">${escapeHtml(ing.name)}</td>
            <td class="p-1 text-right text-gray-500">${balStr}</td>
            <td class="p-1 text-right">
                <input type="number" inputmode="decimal" step="0.01" min="0"
                    data-ing-id="${ing.id}" data-unit="${unitLabel}"
                    class="inv-qty-input border p-0.5 rounded text-xs w-24 text-right"
                    placeholder="${unitLabel}">
            </td>
        </tr>`;
    });
    html += '</tbody></table>';

    document.getElementById('inventarizationHint').textContent = singleIngId != null ? t('ing_inventarization_desc') : t('inv_enter_actual_qty');
    document.getElementById('inventarizationContent').innerHTML = html;
    document.getElementById('inventarizationModal').style.display = 'flex';
}

async function saveInventarization() {
    const inputs = document.querySelectorAll('.inv-qty-input');
    const today  = getLocalDateStr(0);
    const rows   = [];
    const pendingMap = typeof computePendingWriteoffMap === 'function' ? computePendingWriteoffMap() : {};

    inputs.forEach(input => {
        const val = parseFloat(input.value);
        if (isNaN(val) || input.value === '') return; // пропускаем пустые
        const ingId   = Number(input.dataset.ingId);
        const balance = getIngredientBalanceBeforeWriteoff(ingId, pendingMap) || 0;
        const diff    = parseFloat((val - balance).toFixed(4));
        if (Math.abs(diff) < 0.0001) return; // разницы нет — пропускаем
        rows.push({
            ingredient_id: ingId,
            type:     diff > 0 ? 'приход' : 'расход',
            quantity: Math.abs(diff),
            notes:    `Инвентаризация ${today}`
        });
    });

    if (!rows.length) {
        await showInfo(t('inv_no_changes'));
        return;
    }

    const ok = await showConfirm(`Записать ${rows.length} корректировок по результатам инвентаризации?`);
    if (!ok) return;

    showLoading(t('inv_saving_inventarization'));
    try {
        // Инвентаризация всегда идёт по ТЕКУЩЕЙ цене (не по FIFO-партиям):
        // излишек — новая партия по текущей цене; недостача — списание по
        // текущей цене со старейших партий. Каждая строка — атомарная RPC.
        for (const r of rows) {
            const ing = ingredients.find(i => i.id === r.ingredient_id);
            if (!ing) continue;
            const price = ingredientUnitPrice(ing);
            if (r.type === 'приход') {
                const { error } = await db.rpc('rpc_receive_stock', {
                    p_org_id: currentOrgId, p_item_type: 'ingredient', p_item_id: r.ingredient_id,
                    p_unit_price: price, p_qty: r.quantity, p_source: 'инвентаризация', p_notes: r.notes
                });
                if (error) throw error;
            } else {
                const { error } = await db.rpc('rpc_write_off_stock', {
                    p_org_id: currentOrgId, p_item_type: 'ingredient', p_item_id: r.ingredient_id,
                    p_qty: r.quantity, p_shortage_price: price, p_notes: r.notes
                });
                if (error) throw error;
            }
        }

        await loadInventory();
        closeModal();
        displayIngredients();
        // Инвентаризация из карточки ингредиента (21.10, вариант Б): остаёмся в карточке
        // с новым остатком; «Назад» из неё ведёт туда, откуда карточку открыли.
        if (currentIngredientId != null && document.getElementById('ingredientDetail')?.classList.contains('active')) {
            const ingOpen = ingredients.find(i => i.id === currentIngredientId);
            if (ingOpen && typeof renderIngredientStockBlock === 'function') renderIngredientStockBlock(ingOpen);
        }
        logActivity('inventory', `${t('ing_inventarization_note')} ${today}: ${t('log_adjusted')} ${rows.length} ${t('common_positions_word')}`);
        await showInfo(`${t('inventory_saved_prefix')} ${t('common_adjusted')}: ${rows.length} ${t('common_positions_word')}.`);
    } catch(e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// ── Пополнение склада ────────────────────────────────────────────────────────

function openInventoryAddModal(ingId) {
    const ing = ingredients.find(i => i.id === ingId);
    if (!ing) return;
    document.getElementById('inventoryAddTitle').textContent = `Пополнить: ${ing.name}`;
    document.getElementById('inventoryAddIngId').value = ingId;
    document.getElementById('inventoryAddUnit').textContent = unitAbbrev(ing.unit);
    document.getElementById('inventoryAddQty').value = '';
    document.getElementById('inventoryAddNotes').value = '';
    document.getElementById('inventoryAddModal').style.display = 'flex';
}

async function saveInventoryAdd() {
    const ingId = Number(document.getElementById('inventoryAddIngId').value);
    const qty   = parseFloat(document.getElementById('inventoryAddQty').value);
    const notes = document.getElementById('inventoryAddNotes').value.trim();
    if (!ingId || isNaN(qty) || qty <= 0) { showInfo(t('inv_enter_valid_qty')); return; }
    showLoading();
    try {
        const ing = ingredients.find(i => i.id === ingId);
        const { error } = await db.rpc('rpc_receive_stock', {
            p_org_id: currentOrgId,
            p_item_type: 'ingredient',
            p_item_id: ingId,
            // Цена здесь не указывается отдельно — используем текущую цену ингредиента
            p_unit_price: ing ? ingredientUnitPrice(ing) : 0,
            p_qty: parseFloat(qty.toFixed(4)),
            p_source: 'приход',
            p_notes: notes || null
        });
        if (error) throw error;
        closeModal();
        logActivity('inventory', `${t('log_stock_replenished')}: «${ing ? ing.name : ingId}» +${qty}`);
        await loadInventory();
        // Обновляем «Умный склад», если он открыт (loadInventory перерисует сам)
    } catch (e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// ── Списание при создании заказа ─────────────────────────────────────────────

// Вызывается при добавлении позиции в заказ.
// Списывает ингредиенты/п/ф по FIFO (самая старая партия — первая) и возвращает
// фактическую себестоимость списания (не "текущую цену", а то, что реально списалось
// с учётом смешения старых и новых партий). Каждая строка "расход" хранит разбивку
// по партиям (batch_breakdown) — она нужна для точного возврата при сторно.
async function writeOffInventoryForItem(prod, itemQty, orderId, orderItemId = null) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return 0;
    if (!prod || !prod.ingredients || !prod.ingredients.length) return 0;
    const rows = [];
    const qtyFactor = 1 / Number(prod.batch_size || 1);

    prod.ingredients.forEach(ri => {
        if (ri.semi_finished_id) {
            // Списываем п/ф как единицу склада
            const totalQty = Number(ri.quantity) * itemQty * qtyFactor;
            const existing = rows.find(r => r.semi_finished_id === ri.semi_finished_id);
            if (existing) { existing.quantity += totalQty; }
            else { rows.push({ semi_finished_id: ri.semi_finished_id, quantity: totalQty }); }
        } else if (ri.ingredient_id) {
            // Списываем прямой ингредиент
            const totalQty = Number(ri.quantity) * itemQty * qtyFactor;
            const existing = rows.find(r => r.ingredient_id === ri.ingredient_id);
            if (existing) { existing.quantity += totalQty; }
            else { rows.push({ ingredient_id: ri.ingredient_id, quantity: totalQty }); }
        }
    });

    if (!rows.length) return 0;
    let actualCost = 0;
    try {
        // Ингредиенты разные → партии разные: списываем параллельно, а не по очереди
        const results = await Promise.all(rows.map(async r => {
            const itemType = r.semi_finished_id ? 'semi_finished' : 'ingredient';
            const id = r.semi_finished_id || r.ingredient_id;
            const shortagePrice = typeof currentUnitPriceFor === 'function' ? currentUnitPriceFor(itemType, id) : 0;
            const { data, error } = await db.rpc('rpc_write_off_stock', {
                p_org_id: currentOrgId,
                p_item_type: itemType,
                p_item_id: id,
                p_qty: parseFloat(r.quantity.toFixed(4)),
                p_shortage_price: shortagePrice,
                p_notes: `Заказ ${order.order_number ? '№' + order.order_number : '#' + order.id}`,
                p_order_id: orderId,
                p_order_item_id: orderItemId
            });
            if (error) throw error;
            return Number(data.totalCost) || 0;
        }));
        actualCost = results.reduce((a, b) => a + b, 0);
        scheduleLoadInventory();
    } catch (e) { console.error('Ошибка списания со склада:', e); scheduleLoadInventory(); }
    return parseFloat(actualCost.toFixed(4));
}

// Сторнирование при удалении/редактировании ОДНОЙ позиции заказа (в отличие от
// reverseInventoryForOrder — та сторнирует весь заказ). Находит все "расход"-записи,
// привязанные именно к этой позиции (order_item_id), и создаёт зеркальные "сторно" —
// точно по факту, что реально было списано, независимо от того, менялся ли рецепт
// изделия с тех пор.
async function reverseInventoryForOrderItem(orderItemId) {
    try {
        const { data, error } = await db.from('inventory')
            .select('id, ingredient_id, semi_finished_id, quantity, order_id, batch_breakdown')
            .eq('order_item_id', orderItemId)
            .eq('type', 'расход');
        if (error || !data || !data.length) return;

        await Promise.all(data.map(async r => {
            if (!r.batch_breakdown) return;
            const itemType = r.semi_finished_id ? 'semi_finished' : 'ingredient';
            const itemId = r.semi_finished_id || r.ingredient_id;
            const o = orders.find(x => x.id === r.order_id);
            const oLabel = o && o.order_number ? '№' + o.order_number : '#' + r.order_id;
            const { error: rpcError } = await db.rpc('rpc_restore_stock', {
                p_org_id: currentOrgId,
                p_item_type: itemType,
                p_item_id: itemId,
                p_breakdown: r.batch_breakdown,
                p_notes: `Сторно позиции заказа ${oLabel}`,
                p_order_id: r.order_id,
                p_order_item_id: orderItemId
            });
            if (rpcError) console.error('Ошибка сторнирования позиции (RPC):', rpcError);
        }));
        scheduleLoadInventory();
    } catch (e) { console.error('Ошибка сторнирования позиции:', e); }
}

// Сторнирование при удалении заказа
async function reverseInventoryForOrder(orderId) {
    try {
        const { data, error } = await db.from('inventory')
            .select('id, ingredient_id, semi_finished_id, quantity, batch_breakdown')
            .eq('order_id', orderId)
            .eq('type', 'расход');
        if (error || !data || !data.length) return;

        const o = orders.find(x => x.id === orderId);
        const oLabel = o && o.order_number ? '№' + o.order_number : '#' + orderId;

        for (const r of data) {
            if (!r.batch_breakdown) continue;
            const itemType = r.semi_finished_id ? 'semi_finished' : 'ingredient';
            const itemId = r.semi_finished_id || r.ingredient_id;
            const { error: rpcError } = await db.rpc('rpc_restore_stock', {
                p_org_id: currentOrgId,
                p_item_type: itemType,
                p_item_id: itemId,
                p_breakdown: r.batch_breakdown,
                p_notes: `Сторно заказа ${oLabel}`,
                p_order_id: orderId
            });
            if (rpcError) console.error('Ошибка сторнирования (RPC):', rpcError);
        }
        await loadInventory();
    } catch (e) { console.error('Ошибка сторнирования:', e); }
}

// Список покупок убран 21.10 (решение владельца; таблица shopping_list в базе осталась,
// возможно вернём подразделом «Умного склада» после продумывания).
