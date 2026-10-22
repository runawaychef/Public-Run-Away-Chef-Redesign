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
            return;
        }
        if (!isNaN(ms) && ms >= cutoffMs) usage[key] = (usage[key] || 0) + sign * q;
    });
    // Делитель — дни периода, но не больше, чем ведётся склад (у новой пекарни история
    // короче 30 дней — иначе расход в день вышел бы заниженным, а прогноз — завышенным).
    const histDays = firstMs === null ? 0 : Math.max(1, Math.ceil((nowMs - firstMs) / 86400000));
    const divisor = Math.max(1, Math.min(periodDays, histDays || periodDays));
    const ctx = { periodDays, pending, deferred: _deferredNeedMap(), usage, divisor, forecast: stockForecastEnabled() };
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
    // Тот же расчёт, что в «Складе» (stockState): точка горит, если отслеживаемая позиция
    // в красной зоне или по любой позиции нехватка под заказы.
    const ctx = stockStateContext(30);
    const tracked = trackedStockIds();
    const bad = (kind, id) => {
        const st = stockState(kind, id, ctx);
        if (st.shortage) return true;
        const isTracked = kind === 'sf' ? tracked.sf.has(id) : tracked.ing.has(id);
        return isTracked && st.zone === 'critical' && st.after !== null;
    };
    const on = (ingredients || []).some(i => bad('ing', i.id)) || (semiFinished || []).some(sf => bad('sf', sf.id));
    dot.classList.toggle('hidden', !on);
}

// Отслеживаемые позиции (галочка «Отслеживать остатки» у изделий и п/ф, с каскадом):
// изделие → его ингредиенты и п/ф; п/ф (отмеченный или из такого изделия) → его ингредиенты.
function trackedStockIds() {
    const sf = new Set(), ing = new Set();
    (semiFinished || []).forEach(s => { if (s.track_stock) sf.add(s.id); });
    (products || []).filter(p => p.track_stock).forEach(prod => {
        (prod.ingredients || []).forEach(ri => {
            if (ri.semi_finished_id) sf.add(ri.semi_finished_id);
            if (ri.ingredient_id) ing.add(ri.ingredient_id);
        });
    });
    (semiFinished || []).filter(s => sf.has(s.id)).forEach(s => {
        (s.ingredients || []).forEach(ri => { if (ri.ingredient_id) ing.add(ri.ingredient_id); });
    });
    return { sf, ing, any: sf.size > 0 || ing.size > 0 };
}

// ── «Умный склад» — страница (21.10) ─────────────────────────────────────────
// Срез склада по ОТСЛЕЖИВАЕМЫМ позициям + анализ расхода за период 7/30/90 дней.
// Считает тем же stockState, что и «Склад». Список покупок и «Плановые списания»
// убраны (решение владельца 21.10). Только тариф Full и право can_manage_inventory.
let _invPage = { tab: 'ing', period: 30 };

// Старое имя — кнопка-тележка в шапке и прежние вызовы.
async function openInventoryModal() { return openInventoryPage(); }

async function openInventoryPage() {
    if (!hasPermission('can_manage_inventory')) { showInfo(t('inv_no_access')); return; }
    if (!hasPlanFeature('cost_analytics')) { showInfo(t('inv_full_only')); return; }
    _invPage = { tab: 'ing', period: 30 };
    openAppPage('inventoryPage');
    renderInventoryPage();
    showLoading(t('inv_loading_stock'));
    try { await loadInventory(); } finally { hideLoading(); }
}

function closeInventoryPage() {
    if (appPageTop() === 'inventoryPage') closeAppPage();
}

function setInventoryPageTab(tab) {
    _invPage.tab = tab === 'sf' ? 'sf' : 'ing';
    renderInventoryPage();
}

function setInventoryPagePeriod(days) {
    _invPage.period = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    renderInventoryPage();
}

function _invFmt(x) { return x === null || x === undefined ? '—' : String(Math.round(Number(x) * 10) / 10).replace('.', ','); }

function renderInventoryPage() {
    const body = document.getElementById('inventoryPageBody');
    if (!body) return;
    document.getElementById('invPageTabIng')?.classList.toggle('active', _invPage.tab === 'ing');
    document.getElementById('invPageTabSf')?.classList.toggle('active', _invPage.tab === 'sf');
    const per = document.getElementById('invPagePeriod');
    if (per) per.innerHTML = [7, 30, 90].map(d =>
        `<button type="button" class="stock-tab${d === _invPage.period ? ' active' : ''}" onclick="setInventoryPagePeriod(${d});">${d} ${t('inv_days_short')}</button>`).join('');

    const ctx = stockStateContext(_invPage.period);
    const tracked = trackedStockIds();
    const isSf = _invPage.tab === 'sf';
    const list = isSf
        ? (semiFinished || []).filter(sf => tracked.sf.has(sf.id))
        : (ingredients || []).filter(ing => tracked.ing.has(ing.id));
    if (!list.length) {
        body.innerHTML = `<p class="inv-empty">${t('inv_no_tracked')}</p>`;
        return;
    }
    const rank = { critical: 0, warning: 1, ok: 2 };
    const rows = list.map(item => ({ item, st: stockState(isSf ? 'sf' : 'ing', item.id, ctx) }))
        .sort((a, b) => (rank[a.st.zone] - rank[b.st.zone]) || (a.item.name || '').localeCompare(b.item.name || ''));

    const attn = [], ok = [];
    rows.forEach(({ item, st }) => {
        const unit = unitAbbrev(item.unit);
        const isCritical = st.zone === 'critical', isWarning = st.zone === 'warning';
        const accent = isCritical ? '#c0685c' : isWarning ? '#d9a441' : '';
        const afterColor = isCritical ? '#c0685c' : isWarning ? '#96712a' : '#4f6349';
        const thirdText = st.daysLeft !== null ? `${st.daysLeft} ${t('inv_days_short')}` : st.shortage ? t('inv_shortage') : '—';
        const price = isSf ? stockPriceText(semiFinishedUnitCost(item), item.unit) : stockPriceText(ingredientUnitPrice(item), item.unit);
        const usedLbl = t('inv_used_for_days').replace('{n}', _invPage.period);
        const html = `
        <div class="order-card" style="cursor:pointer;" onclick="openStockItemFromSmart('${isSf ? 'sf' : 'ing'}', ${item.id})">
            ${accent ? `<div class="stripe" style="background:${accent};"></div>` : ''}
            <div class="order-card-body">
                <div class="oc-row">
                    <span class="oc-name">${escapeHtml(item.name || t('semifinished_no_name_fallback'))}</span>
                    <span class="oc-price">${price}</span>
                </div>
                ${stockCardCellsHtml({
                    beforeText: st.now !== null ? `${_invFmt(st.now)} ${unit}` : '—',
                    afterText: st.after !== null ? `${_invFmt(st.after)} ${unit}` : '—',
                    afterColor, thirdLabel: t('ing_cell_lasts'), thirdText, thirdColor: afterColor })}
                <div class="inv-an">
                    <span>${t('inv_reserved_chip')} ${_invFmt(st.reserved)} ${unit}</span>
                    <span>${usedLbl} ${_invFmt(st.usedInPeriod)} ${unit}</span>
                </div>
            </div>
        </div>`;
        (accent ? attn : ok).push(html);
    });
    body.innerHTML = stockGroupsHtml(attn, ok);
}

// Нажатие на карточку «Умного склада» → карточка позиции (возврат — шаг 4).
function openStockItemFromSmart(kind, id) {
    if (kind === 'sf') { showTab('semiFinished'); openSemiFinishedDetail(id); }
    else { showTab('ingredients'); openIngredientDetail(id); }
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
