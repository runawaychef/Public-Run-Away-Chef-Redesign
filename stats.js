// ==================== СТАТИСТИКА ====================
// Раздел «Статистика» — вкладка (showTab('stats')): главный экран из плиток и страницы раскрытия
// (Клиенты, Выручка и прибыль, Топ изделий, Рентабельность, Ингредиенты); ниже в файле.
// Здесь же: roundQty, подписи «с НДС», экспорт резервной копии.
// Обычный скрипт (без модулей) — функции доступны глобально.
// Зависит от: orders/customers/products/ingredients (главный скрипт), money.js, dates.js.

// Суммирование дробных количеств (кг-товары вроде 5.1, 1.3) через reduce/+=
// накапливает погрешность плавающей точки (напр. 5070.400000001 вместо
// 5070.4) — округляем перед выводом в таблицах "Сумма по клиентам"/"по
// изделиям". Math.round убирает шум ДО деления, а не просто форматирует
// строку — итог остаётся обычным числом (13, не "13.00").
function roundQty(n) {
    return Math.round(n * 100) / 100;
}

// Переключает подписи "(с НДС)"/"incl. VAT" на нейтральные версии и скрывает
// строку "в т.ч. НДС" целиком, если у организации НДС не включён (ставка 0).
// Вызывается после загрузки организации (когда известен currentOrgVatRate)
// и при смене языка (см. setLang() в i18n.js), т.к. лейблы зависят от языка.
function refreshVatLabels() {
    const vat = hasVat();
    // Заголовок колонки "Итого с НДС" в таблице заказов
    const ordersTotalCol = document.getElementById('ordersColTotalVat');
    if (ordersTotalCol) ordersTotalCol.textContent = t(vat ? 'orders_col_total_vat' : 'orders_col_total_novat');
}

function downloadBackup() {
    // Экспорт текущих данных (из кэша) в JSON для резервной копии
    const exportOrders = orders.map(o => ({
        id: o.id,
        customer: o.customer,
        date: o.date,
        status: o.status,
        discount: o.discount,
        vat_exempt: o.vat_exempt,
        notes: o.notes,
        items: o.items.map(it => ({ product: it.product, quantity: it.quantity, price: it.price }))
    }));
    const data = {
        products: products.map(p => ({ name: p.name, price: p.price })),
        customers: customers.map(c => ({ name: c.name, contact: c.contact, discount: c.discount })),
        orders: exportOrders
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = getLocalDateStr(0);
    a.href     = url;
    a.download = `runwaychef_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== ГЛАВНЫЙ ЭКРАН «СТАТИСТИКИ» — 6 плиток (31.10.2026) ====================
// Плитки в стиле Dashboard; период каждой — текущий месяц (при каждом входе сбрасывается).
// Нажатие на плитку открывает страницу раскрытия (claude/stats-redesign-2026-10-31.md).
const STATS_TILE_ICONS = {
    rev: '<path d="M5 20v-6M10 20V8M15 20v-9M20 20V4"/>',
    share: '<path d="M12 3v9h9"/><path d="M20.5 15A9 9 0 1 1 9 3.5"/>',
    cust: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.9.8 3 2.7 3 5.7"/>',
    top: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
    margin: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
    ing: '<path d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M9 8a3 3 0 0 1 6 0M8.5 12.5h7"/>'
};
let _statsHomeSeq = 0;

function _stNum(v) {
    const n = Math.round(Number(v) || 0);
    try { return n.toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined); } catch (e) { return String(n); }
}
function _stCur() {
    return (typeof CURRENCY_SYMBOLS !== 'undefined' && CURRENCY_SYMBOLS[typeof currentOrgCurrency !== 'undefined' ? currentOrgCurrency : 'EUR']) || '';
}
function _stMoneyVal(v) { return `${escapeHtml(_stNum(v))}<small>&nbsp;${escapeHtml(_stCur())}</small>`; }
function _stYm(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function _stMonthShort(year, month) {
    try {
        const w = new Date(year, month, 15).toLocaleDateString(typeof currentLang !== 'undefined' ? currentLang : undefined, { month: 'short' }).replace('.', '');
        return w.charAt(0).toUpperCase() + w.slice(1);
    } catch (e) { return ''; }
}
function _stRows(list) {
    return list.map(([a, b]) => `<div class="dc-row dc-row--plain"><span>${escapeHtml(a)}</span><span class="dashboard-card__value">${escapeHtml(b)}</span></div>`).join('');
}
function _stNoData() { return `<div class="dc-small" style="text-align:center">${escapeHtml(t('stats_tile_nodata'))}</div>`; }
function _stSet(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function statsTileHtml(key, id, icon, labelKey, onclickCall, extraCls) {
    return `<div class="dashboard-card dc2${extraCls ? ' ' + extraCls : ''}" role="button" tabindex="0" onclick="${onclickCall}">
        <div class="dashboard-card__hd dash-c-${key}"><svg class="dashboard-card__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span class="dashboard-card__label" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span></div>
        <div class="dc-val"><span class="dashboard-card__value" id="${id}Val">—</span><span class="dc-cap" id="${id}Cap"></span></div>
        <div class="dc-mid" id="${id}Mid"></div>
        <div class="dc-foot" id="${id}Foot">&nbsp;</div>
    </div>`;
}

function statsBuildHome() {
    const box = document.getElementById('statsHomeGrid');
    if (!box || box.dataset.built) return;
    box.dataset.built = '1';
    box.innerHTML =
        `<div class="dashboard-card dc2 sth-wide" role="button" tabindex="0" onclick="statsOpenCustomers()">
            <div class="dashboard-card__hd dash-c-day"><svg class="dashboard-card__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATS_TILE_ICONS.cust}</svg><span class="dashboard-card__label" data-i18n="stats_h_clients">${escapeHtml(t('stats_h_clients'))}</span></div>
            <div class="sth-wbody"><div class="sth-wdon" id="stHWDon"></div><div class="sth-wr"><div class="dc-val"><span class="dashboard-card__value" id="stHWVal">—</span><span class="dc-cap" id="stHWCap"></span></div><div class="dc-mid" id="stHWMid"></div></div></div>
            <div class="dc-foot" id="stHWFoot">&nbsp;</div>
        </div>`
        + statsTileHtml('rev', 'stH1', STATS_TILE_ICONS.rev, 'stats_h_rev', "statsOpenRevenue()")
        + statsTileHtml('stock', 'stH4', STATS_TILE_ICONS.top, 'stats_h_top', "statsOpenTop()")
        + statsTileHtml('pay', 'stH5', STATS_TILE_ICONS.margin, 'stats_h_margin', "statsOpenMargin()", 'perm-view-costs')
        + statsTileHtml('acc', 'stH6', STATS_TILE_ICONS.ing, 'stats_h_ing', "statsOpenIng()", 'perm-view-costs')
        + `<div class="sth-info"><i>i</i><ul><li data-i18n="stats_info_1">${escapeHtml(t('stats_info_1'))}</li></ul></div>`;
}

function statsShowHome() {
    document.getElementById('statsHome')?.classList.remove('hidden');
    statsBuildHome();
    if (typeof applyCostVisibility === 'function') applyCostVisibility();
    statsRenderHome();
    window.scrollTo(0, 0);
}

function statsRenderHome() {
    const mySeq = ++_statsHomeSeq;
    const saved = (typeof orders !== 'undefined' ? orders : []).filter(o => typeof isOrderSaved === 'function' ? isOrderSaved(o) : true);
    const now = orgNowDate();
    const ym = _stYm(now);
    const month = saved.filter(o => o.date && String(o.date).slice(0, 7) === ym);
    const mLbl = t('stats_foot_month');
    const canCost = (typeof hasPermission !== 'function' || hasPermission('can_view_costs'));
    const cur = month.length;

    // 1. Выручка и прибыль: число — выручка месяца, столбики — последние 6 месяцев
    {
        const revenue = month.reduce((s, o) => s + orderGrandTotal(o), 0);
        const profit = month.reduce((s, o) => s + orderProfit(o), 0);
        const base = month.reduce((s, o) => s + orderAfterDiscount(o), 0);
        const keys = [];
        for (let i = 5; i >= 0; i--) keys.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
        const sums = keys.map(d => saved.filter(o => o.date && String(o.date).slice(0, 7) === _stYm(d)).reduce((s, o) => s + orderGrandTotal(o), 0));
        const mx = Math.max(...sums, 0);
        _stSet('stH1Val', _stMoneyVal(revenue));
        _stSet('stH1Cap', escapeHtml(t('stats_cap_rev')));
        _stSet('stH1Mid', mx > 0
            ? `<div class="dc-bars">${sums.map((v, i) => `<i style="height:${Math.max(6, Math.round(v / mx * 100))}%" class="${i === sums.length - 1 ? 't' : (v <= 0 ? 'z' : '')}"></i>`).join('')}</div><div class="dc-bl">${keys.map(d => `<span>${escapeHtml(_stMonthShort(d.getFullYear(), d.getMonth()))}</span>`).join('')}</div>`
            : _stNoData());
        // слева всегда период, справа: есть данные и право на себестоимость — прибыль; есть данные без права — число заказов; данных нет — пусто
        const rightFoot = !cur ? '' : (canCost ? `<em>${escapeHtml(_stNum(profit))}&nbsp;${escapeHtml(_stCur())}</em>` : `<em>${cur}&nbsp;${escapeHtml(t('cust_tile_orders'))}</em>`);
        _stSet('stH1Foot', `<span>${escapeHtml(mLbl)}</span>${rightFoot}`);
    }

    // Суммы по клиентам за ГОД (плитка «Клиенты» — за год, как и её страница; решение владельца 31.10)
    const yearOrders = saved.filter(o => o.date && String(o.date).slice(0, 4) === String(now.getFullYear()));
    const byCust = {};
    yearOrders.forEach(o => { const k = o.customer || ''; byCust[k] = (byCust[k] || 0) + orderGrandTotal(o); });
    const custSorted = Object.entries(byCust).sort((a, b) => b[1] - a[1]);
    const custTotal = custSorted.reduce((s, [, v]) => s + v, 0);

    // 2. Клиенты (широкая плитка): кольцо долей + сумма месяца + топ-3 и «Прочие»
    {
        _stSet('stHWVal', _stMoneyVal(custTotal));
        _stSet('stHWCap', hasVat() ? escapeHtml(t('stats_cap_vat')) : '');
        if (custSorted.length && custTotal > 0) {
            const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a'];
            const top = custSorted.slice(0, 3);
            const rest = custTotal - top.reduce((s, [, v]) => s + v, 0);
            const parts = top.map(([n, v]) => [n || t('stats_noname'), v]);
            if (rest > 0.005) parts.push([t('stats_others'), rest]);
            const r = 15, c = 2 * Math.PI * r;
            let off = 0, circles = '', rows = '';
            parts.forEach(([n, v], i) => {
                const l = c * v / custTotal;
                circles += `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${COLS[i]}" stroke-width="8" stroke-dasharray="${l.toFixed(2)} ${(c - l).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 21 21)"/>`;
                off += l;
                rows += `<div class="sth-wrow"><i style="background:${COLS[i]}"></i><span>${escapeHtml(n)}</span><b>${escapeHtml(_stNum(v))}</b><u>${Math.round(v / custTotal * 100)}%</u></div>`;
            });
            _stSet('stHWDon', `<svg viewBox="0 0 42 42" width="92" height="92">${circles}</svg>`);
            _stSet('stHWMid', rows);
        } else { _stSet('stHWDon', ''); _stSet('stHWMid', _stNoData()); }
        _stSet('stHWFoot', `<span>${escapeHtml(t('stats_foot_year'))}${custSorted.length ? ' · ' + escapeHtml(t('stats_foot_customers').replace('{n}', custSorted.length)) : ''}</span>`);
    }

    // 4. Топ изделий по сумме
    {
        const tot = {};
        month.forEach(o => (o.items || []).forEach(it => { tot[it.product] = (tot[it.product] || 0) + it.quantity * it.price; }));
        const sorted = Object.entries(tot).sort((a, b) => b[1] - a[1]);
        if (sorted.length) {
            const mx = sorted[0][1];
            _stSet('stH4Val', _stMoneyVal(mx));
            _stSet('stH4Cap', escapeHtml(t('stats_cap_first')));
            _stSet('stH4Mid', sorted.slice(0, 3).map(([n, v]) => `<div class="sth-br"><div class="sth-bt"><span>${escapeHtml(n)}</span><b>${escapeHtml(_stNum(v))}</b></div><div class="dc-prog"><i style="width:${mx > 0 ? Math.round(v / mx * 100) : 0}%;background:#7c9473"></i></div></div>`).join(''));
        } else { _stSet('stH4Val', '—'); _stSet('stH4Cap', ''); _stSet('stH4Mid', _stNoData()); }
        _stSet('stH4Foot', `<span>${escapeHtml(mLbl)}</span>`);
    }

    // 5. Рентабельность: маржа месяца и лучшие изделия (по рецепту, как в прежнем списке)
    if (canCost) {
        const profit = month.reduce((s, o) => s + orderProfit(o), 0);
        const base = month.reduce((s, o) => s + orderAfterDiscount(o), 0);
        // только изделия, проданные в этом месяце (нет заказов — нет и списка)
        const soldIds = new Set(), soldNames = new Set();
        month.forEach(o => (o.items || []).forEach(it => { if (it.product_id != null) soldIds.add(it.product_id); if (it.product) soldNames.add(it.product); }));
        const withRecipe = products.filter(p => (p.ingredients || []).length > 0 && p.price && (soldIds.has(p.id) || soldNames.has(p.name)))
            .sort((a, b) => productProfitPct(b) - productProfitPct(a)).slice(0, 3);
        _stSet('stH5Val', base > 0 ? `${Math.round(profit / base * 100)}<small>%</small>` : '—');
        _stSet('stH5Cap', escapeHtml(t('stats_cap_margin')));
        _stSet('stH5Mid', withRecipe.length ? _stRows(withRecipe.map(p => [p.name, Math.round(productProfitPct(p)) + '%'])) : _stNoData());
        _stSet('stH5Foot', `<span>${escapeHtml(mLbl)}</span>`);
    }

    // 6. Расход ингредиентов за месяц (запрос к снимкам рецептов, как в прежнем отчёте)
    if (canCost) {
        _stSet('stH6Val', '…'); _stSet('stH6Cap', escapeHtml(t('stats_cap_use'))); _stSet('stH6Mid', ''); _stSet('stH6Foot', `<span>${escapeHtml(mLbl)}</span>`);
        const itemIds = month.flatMap(o => (o.items || []).map(it => it.id)).filter(Boolean);
        if (!itemIds.length) { _stSet('stH6Val', _stMoneyVal(0)); _stSet('stH6Mid', _stNoData()); }
        else {
            db.from('order_item_ingredients').select('ingredient_id, ingredient_name, unit, quantity, total_cost').in('order_item_id', itemIds).then(({ data, error }) => {
                if (mySeq !== _statsHomeSeq) return;
                if (error || !data) { _stSet('stH6Val', '—'); _stSet('stH6Mid', _stNoData()); return; }
                const map = {};
                data.forEach(r => {
                    const curIng = r.ingredient_id != null ? ingredients.find(i => i.id === r.ingredient_id) : null;
                    const key = r.ingredient_id != null ? 'id:' + r.ingredient_id : 'n:' + r.ingredient_name + '|' + r.unit;
                    if (!map[key]) map[key] = { name: curIng ? curIng.name : r.ingredient_name, cost: 0 };
                    map[key].cost += Number(r.total_cost) || 0;
                });
                const rows = Object.values(map).sort((a, b) => b.cost - a.cost);
                _stSet('stH6Val', _stMoneyVal(rows.reduce((s, r) => s + r.cost, 0)));
                _stSet('stH6Mid', rows.length ? _stRows(rows.slice(0, 3).map(r => [r.name, _stNum(r.cost)])) : _stNoData());
                _stSet('stH6Foot', `<span>${escapeHtml(mLbl)} · ${escapeHtml(t('stats_foot_items').replace('{n}', rows.length))}</span>`);
            });
        }
    }
}

// ==================== СТРАНИЦА «КЛИЕНТЫ» (раскрытие широкой плитки, 31.10.2026) ====================
// Страница в общей цепочке app-page: «Назад» (и системная «Назад» Android — см. _backHandledDetailScreens) возвращает в «Статистику».
let _stcl = { range: 'year', from: '', to: '' };
function _stclIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Границы периода; shift 0 — выбранный, -1 — предыдущий такой же. null — «Всё»
function _stclBounds(range, from, to, shift) {
    const now = orgNowDate();
    let a, b;
    if (range === 'week') {
        const m = new Date(getMondayOf(now));
        a = new Date(m); a.setDate(a.getDate() + 7 * shift);
        b = new Date(a); b.setDate(b.getDate() + 6);
    } else if (range === 'month') {
        a = new Date(now.getFullYear(), now.getMonth() + shift, 1);
        b = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    } else if (range === 'quarter') {
        const q = Math.floor(now.getMonth() / 3) * 3 + 3 * shift;
        a = new Date(now.getFullYear(), q, 1);
        b = new Date(now.getFullYear(), q + 3, 0);
    } else if (range === 'year') {
        a = new Date(now.getFullYear() + shift, 0, 1);
        b = new Date(now.getFullYear() + shift, 11, 31);
    } else if (range === 'custom' && from && to) {
        const A = new Date(from + 'T00:00:00'), B = new Date(to + 'T00:00:00');
        const days = Math.round((B - A) / 86400000) + 1;
        a = new Date(A); a.setDate(a.getDate() + days * shift);
        b = new Date(B); b.setDate(b.getDate() + days * shift);
    } else return null;
    return { from: _stclIso(a), to: _stclIso(b) };
}
function _stclOrders(bd) {
    return (typeof orders !== 'undefined' ? orders : []).filter(o => {
        if (typeof isOrderSaved === 'function' && !isOrderSaved(o)) return false;
        if (!o.date) return false;
        if (!bd) return true;
        const d = String(o.date).slice(0, 10);
        return d >= bd.from && d <= bd.to;
    });
}
function statsOpenCustomers() {
    _stcl = { range: 'year', from: '', to: '' };   // каждый вход — «Год» (решение владельца 31.10; на остальных страницах — «Месяц»)
    openAppPage('statsCustPage');
    stclRender();
}
function stclSetRange(r) {
    _stcl.range = r;
    stclRender();
}
function stclPickRange(ev) {
    if (ev) ev.stopPropagation();
    toggleCustomCalendarRange('globalCalendarPopup', 'stclFrom', 'stclTo', null, null, {
        onApply: function (f, to) { _stcl.range = 'custom'; _stcl.from = f; _stcl.to = to; stclRender(); }
    });
}
function stclRender() {
    const body = document.getElementById('stclBody');
    if (!body) return;
    const rg = _stcl.range;
    const bd = _stclBounds(rg, _stcl.from, _stcl.to, 0);
    const list = _stclOrders(bd);
    const total = list.reduce((s, o) => s + orderGrandTotal(o), 0);
    const vat = list.reduce((s, o) => s + orderVatAmount(o), 0);
    const byC = {};
    list.forEach(o => { const k = o.customer || ''; byC[k] = (byC[k] || 0) + orderGrandTotal(o); });
    const rows = Object.entries(byC).sort((a, b) => b[1] - a[1]);

    // сравнение с предыдущим таким же периодом (для «Всё» нет)
    let deltaHtml = '';
    const pb = _stclBounds(rg, _stcl.from, _stcl.to, -1);
    if (pb) {
        const prev = _stclOrders(pb).reduce((s, o) => s + orderGrandTotal(o), 0);
        if (prev > 0) {
            const pct = Math.round((total - prev) / prev * 100);
            const up = pct >= 0;
            deltaHtml = `<div class="stcl-delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%<span>${escapeHtml(t('stcl_cmp_' + (rg === 'custom' ? 'custom' : rg)))}</span></div>`;
        }
    }

    const chips = ['week', 'month', 'quarter', 'year', 'all'].map(k =>
        `<button class="stcl-chip${rg === k ? ' on' : ''}" onclick="stclSetRange('${k}')">${escapeHtml(t('stcl_' + k))}</button>`).join('')
        + `<button class="stcl-chip cal${rg === 'custom' ? ' on' : ''}" onclick="stclPickRange(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></button>`;
    const cap = bd ? `${formatDateDMY(bd.from)} – ${formatDateDMY(bd.to)}` : t('stcl_all_cap');

    let html = `<div class="stcl-chips">${chips}</div><div class="stcl-cap">${escapeHtml(cap)}</div>`;
    html += `<div class="stcl-card"><div class="stcl-sum"><div><div class="stcl-big">${_stMoneyVal(total)}</div>`
        + (hasVat() ? `<div class="stcl-lbl">${escapeHtml(t('stats_cap_vat'))} · ${escapeHtml(t('stats_incl_vat'))} ${escapeHtml(_stNum(vat))} ${escapeHtml(_stCur())}</div>` : '')
        + `</div>${deltaHtml}</div>`
        + `<div class="stcl-meta"><span>${escapeHtml(t('stats_customers_count'))} <b>${rows.length}</b></span><span>${escapeHtml(t('stats_orders_count'))} <b>${list.length}</b></span></div></div>`;

    if (!rows.length || total <= 0) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t('stcl_empty'))}</div></div>`;
    } else {
        const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a', '#8a7fa8'], REST = '#a29c8c';
        const top = rows.slice(0, 5);
        const rest = total - top.reduce((s, [, v]) => s + v, 0);
        const parts = top.map(([, v], i) => [v, COLS[i]]);
        if (rest > 0.005) parts.push([rest, REST]);
        const r = 15, c = 2 * Math.PI * r;
        let off = 0, circles = '';
        parts.forEach(([v, col]) => {
            const l = c * v / total;
            circles += `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-dasharray="${l.toFixed(2)} ${(c - l).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 21 21)"/>`;
            off += l;
        });
        const lines = rows.map(([n, v], i) =>
            `<div class="stcl-r"><i style="background:${i < 5 ? COLS[i] : REST}"></i><span class="stcl-n">${escapeHtml(n || t('stats_noname'))}</span><b>${escapeHtml(_stNum(v))}</b><u>${Math.round(v / total * 100)}%</u></div>`).join('');
        html += `<div class="stcl-card"><div class="stcl-chart"><svg viewBox="0 0 42 42" width="168" height="168">${circles}</svg><div class="stcl-hole"><b>${rows.length}</b><small>${escapeHtml(t('stats_customers_count').replace(':', ''))}</small></div></div>`
            + lines + `<div class="stcl-r tot"><i style="background:transparent"></i><span class="stcl-n">${escapeHtml(t('stcl_total'))}</span><b>${escapeHtml(_stNum(total))}</b><u>100%</u></div></div>`;
    }
    body.innerHTML = html;
}

// ==================== СТРАНИЦА «ВЫРУЧКА И ПРИБЫЛЬ» (раскрытие плитки, 31.10.2026) ====================
// Страница в общей цепочке app-page: «Назад» (и системная Android) возвращает в «Статистику».
let _srv = { range: '6m', sel: null };
function _srvCanCost() { return typeof hasPermission !== 'function' || hasPermission('can_view_costs'); }
// список месяцев [{y, m}] периода; shift -1 — предыдущий такой же (для «Всё» нет)
function _srvMonths(range, shift) {
    const now = orgNowDate();
    const cy = now.getFullYear(), cm = now.getMonth();
    let start, count;
    if (range === '6m' || range === '12m') {
        count = range === '6m' ? 6 : 12;
        start = cy * 12 + cm - (count - 1) + shift * count;
    } else if (range === 'year') {
        count = cm + 1;                       // с января по текущий месяц; прошлый год — те же месяцы
        start = (cy + shift) * 12;
    } else {
        if (shift) return null;
        const all = (typeof orders !== 'undefined' ? orders : []).filter(o => o.date && (typeof isOrderSaved !== 'function' || isOrderSaved(o)));
        if (!all.length) { start = cy * 12 + cm; count = 1; }
        else {
            const first = all.map(o => String(o.date).slice(0, 7)).sort()[0];
            start = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1;
            count = cy * 12 + cm - start + 1;
        }
    }
    const res = [];
    for (let i = 0; i < count; i++) { const k = start + i; res.push({ y: Math.floor(k / 12), m: k % 12 }); }
    return res;
}
function _srvAgg(months) {
    const keys = {};
    months.forEach((mm, i) => { keys[mm.y + '-' + String(mm.m + 1).padStart(2, '0')] = i; });
    const rows = months.map(() => ({ rev: 0, prof: 0, base: 0 }));
    (typeof orders !== 'undefined' ? orders : []).forEach(o => {
        if (!o.date || (typeof isOrderSaved === 'function' && !isOrderSaved(o))) return;
        const i = keys[String(o.date).slice(0, 7)];
        if (i === undefined) return;
        rows[i].rev += orderGrandTotal(o);
        rows[i].prof += orderProfit(o);
        rows[i].base += orderAfterDiscount(o);
    });
    return rows;
}
function statsOpenRevenue() {
    _srv = { range: '6m', sel: null };   // каждый вход — снова «6 мес.»
    openAppPage('statsRevPage');
    srvRender();
}
function srvSetRange(r) { _srv.range = r; _srv.sel = null; srvRender(); }
function srvSel(i) { _srv.sel = i; srvRender(); }
function srvRender() {
    const body = document.getElementById('srvBody');
    if (!body) return;
    const canCost = _srvCanCost();
    const rg = _srv.range;
    const months = _srvMonths(rg, 0);
    const rows = _srvAgg(months);
    const n = months.length;
    // по умолчанию выделен последний месяц периода (текущий; 1-го числа он может быть пустым — это честно, решение владельца 31.10)
    const sel = (_srv.sel != null && _srv.sel < n) ? _srv.sel : n - 1;
    const totRev = rows.reduce((s, r) => s + r.rev, 0);
    const totProf = rows.reduce((s, r) => s + r.prof, 0);
    const totBase = rows.reduce((s, r) => s + r.base, 0);
    const pct = (p, b) => b > 0 ? Math.round(p / b * 100) + '%' : '—';
    const multiYear = months[0].y !== months[n - 1].y;
    const lbl = mm => _stMonthShort(mm.y, mm.m) + (multiYear ? ' ' + String(mm.y).slice(2) : '');

    let deltaHtml = '';
    const pm = _srvMonths(rg, -1);
    if (pm) {
        const prev = _srvAgg(pm).reduce((s, r) => s + r.rev, 0);
        if (prev > 0) {
            const d = Math.round((totRev - prev) / prev * 100), up = d >= 0;
            deltaHtml = `<div class="stcl-delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(d)}%<span>${escapeHtml(t('srv_cmp_' + rg))}</span></div>`;
        }
    }
    const chips = [['6m', 'srv_6m'], ['12m', 'srv_12m'], ['year', 'stcl_year'], ['all', 'stcl_all']].map(([k, key]) =>
        `<button class="stcl-chip${rg === k ? ' on' : ''}" onclick="srvSetRange('${k}')">${escapeHtml(t(key))}</button>`).join('');
    const cap = `${_stMonthShort(months[0].y, months[0].m)}${multiYear ? ' ' + months[0].y : ''} – ${_stMonthShort(months[n - 1].y, months[n - 1].m)} ${months[n - 1].y}`;

    let html = `<div class="stcl-chips">${chips}</div><div class="stcl-cap">${escapeHtml(cap)}</div>`;
    html += `<div class="stcl-card"><div class="stcl-sum"><div><div class="stcl-big">${_stMoneyVal(totRev)}</div><div class="stcl-lbl">${escapeHtml(t('srv_rev'))}</div></div>${deltaHtml}</div>`
        + (canCost ? `<div class="stcl-meta"><span>${escapeHtml(t('srv_profit'))} <b>${escapeHtml(_stNum(totProf))} ${escapeHtml(_stCur())}</b></span><span>${escapeHtml(t('srv_margin'))} <b>${pct(totProf, totBase)}</b></span></div>` : '')
        + `</div>`;

    if (totRev <= 0) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t('stcl_empty'))}</div></div>`;
    } else {
        // график: два столбика на месяц (выручка и прибыль), выбранный месяц выделен
        const W = 340, H = 170, padl = 34, padr = 6, padt = 26, padb = 22;
        const rawMax = Math.max(...rows.map(r => canCost ? Math.max(r.rev, r.prof, 0) : r.rev), 0.01);
        // «красивая» шкала: шаг 1/2/2.5/5 × 10^k, 3–4 деления, верх шкалы = верхняя отметка
        const mag = Math.pow(10, Math.floor(Math.log10(rawMax / 3)));
        const stepV = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => rawMax / s <= 4) || 10 * mag;
        const mx = Math.ceil(rawMax / stepV - 1e-9) * stepV;
        const fmtAx = v => v >= 1000 ? (v / 1000).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined, { maximumFractionDigits: 1 }) + 'k' : String(Math.round(v));
        const slot = (W - padl - padr) / n, ch = H - padt - padb;
        const bw = canCost ? Math.min(slot * 0.30, 22) : Math.min(slot * 0.5, 30);
        const step = n > 9 ? Math.ceil(n / 9) : 1;   // подписи месяцев не слипаются
        let svg = '';
        for (let v = 0; v <= mx + 1e-9; v += stepV) {
            const y = padt + ch - ch * v / mx;
            svg += `<line x1="${padl}" x2="${W - padr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ece7da" stroke-width="1"/><text x="${padl - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#a29c8c">${fmtAx(v)}</text>`;
        }
        rows.forEach((r, i) => {
            const x0 = padl + i * slot + slot / 2, on = i === sel;
            const hr = Math.max(ch * r.rev / mx, r.rev > 0 ? 1.5 : 0), hp = Math.max(ch * Math.max(r.prof, 0) / mx, r.prof > 0 ? 1.5 : 0);
            if (on) svg += `<rect x="${(x0 - slot / 2 + 1).toFixed(1)}" y="${padt - 20}" width="${(slot - 2).toFixed(1)}" height="${ch + padb + 14}" rx="8" fill="#f1efe6"/>`;
            if (canCost) {
                svg += `<rect x="${(x0 - bw - 1).toFixed(1)}" y="${(padt + ch - hr).toFixed(1)}" width="${bw.toFixed(1)}" height="${hr.toFixed(1)}" rx="3" fill="${on ? '#7c9473' : '#b9c8b2'}"/>`
                    + `<rect x="${(x0 + 1).toFixed(1)}" y="${(padt + ch - hp).toFixed(1)}" width="${bw.toFixed(1)}" height="${hp.toFixed(1)}" rx="3" fill="${on ? '#c9973a' : '#e3cf9f'}"/>`;
            } else {
                svg += `<rect x="${(x0 - bw / 2).toFixed(1)}" y="${(padt + ch - hr).toFixed(1)}" width="${bw.toFixed(1)}" height="${hr.toFixed(1)}" rx="3" fill="${on ? '#7c9473' : '#b9c8b2'}"/>`;
            }
            if (on || (i % step === 0 && (step === 1 || Math.abs(i - sel) >= 2))) svg += `<text x="${x0.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="${on ? '#322f28' : '#a29c8c'}" font-weight="${on ? 800 : 600}">${escapeHtml(_stMonthShort(months[i].y, months[i].m))}</text>`;
            svg += `<rect x="${(x0 - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" fill="transparent" onclick="srvSel(${i})"/>`;
        });
        const sr = rows[sel];
        const pick = `${escapeHtml(lbl(months[sel]))}: <b>${escapeHtml(_stNum(sr.rev))}</b>${canCost ? ` · <b style="color:#a07a22">${escapeHtml(_stNum(sr.prof))}</b>` : ''}`;
        html += `<div class="stcl-card"><div class="srv-leg"><span><i style="background:#7c9473"></i>${escapeHtml(t('srv_rev'))}</span>${canCost ? `<span><i style="background:#c9973a"></i>${escapeHtml(t('srv_profit'))}</span>` : ''}<span class="srv-pick">${pick}</span></div>`
            + `<svg viewBox="0 0 ${W} ${H}" width="100%" style="cursor:pointer">${svg}</svg>`
            + `<div class="srv-hd"><span class="srv-m">${escapeHtml(t('srv_month'))}</span><span>${escapeHtml(t('srv_rev'))}</span>${canCost ? `<span>${escapeHtml(t('srv_profit'))}</span><span class="srv-pc">${escapeHtml(t('srv_margin'))}</span>` : ''}</div>`
            + rows.map((r, i) => `<div class="srv-r${i === sel ? ' sel' : ''}" onclick="srvSel(${i})"><span class="srv-m">${escapeHtml(lbl(months[i]))}</span><b>${escapeHtml(_stNum(r.rev))}</b>${canCost ? `<em>${escapeHtml(_stNum(r.prof))}</em><u>${pct(r.prof, r.base)}</u>` : ''}</div>`).join('')
            + `<div class="srv-r tot"><span class="srv-m">${escapeHtml(t('stcl_total'))}</span><b>${escapeHtml(_stNum(totRev))}</b>${canCost ? `<em>${escapeHtml(_stNum(totProf))}</em><u>${pct(totProf, totBase)}</u>` : ''}</div></div>`;
    }
    body.innerHTML = html;
}

// ==================== СТРАНИЦА «ТОП ИЗДЕЛИЙ» (раскрытие плитки, 31.10.2026) ====================
// Период — тот же набор, что у «Клиентов» (_stclBounds/_stclOrders). Кольцо долей + список (вариант В). «Назад» — в «Статистику».
let _stp = { range: 'month', from: '', to: '', all: false, open: null, q: '', view: [] };
function _stpFq(v) { try { return roundQty(v).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined, { maximumFractionDigits: 2 }); } catch (e) { return String(roundQty(v)); } }
function _stpTotals(bd) {
    const tot = {}, qty = {};
    _stclOrders(bd).forEach(o => (o.items || []).forEach(it => {
        const k = it.product || '';
        tot[k] = (tot[k] || 0) + it.quantity * it.price;
        qty[k] = (qty[k] || 0) + Number(it.quantity || 0);
    }));
    return { tot, qty };
}
function statsOpenTop() {
    _stp = { range: 'month', from: '', to: '', all: false, open: null, q: '', view: [] };   // каждый вход — «Месяц»
    openAppPage('statsTopPage');
    stpRender();
}
function stpSetRange(r) { _stp.range = r; _stp.all = false; _stp.open = null; _stp.q = ''; stpRender(); }
function stpOpen(i) { const n = _stp.view[i]; _stp.open = (_stp.open === n) ? null : n; stpRows(); }
function stpToggleAll() { _stp.all = !_stp.all; stpRows(); }
function stpFilter(v) { _stp.q = v || ''; _stp.open = null; stpRows(); }
function stpPickRange(ev) {
    if (ev) ev.stopPropagation();
    toggleCustomCalendarRange('globalCalendarPopup', 'stpFrom', 'stpTo', null, null, {
        onApply: function (f, to) { _stp.range = 'custom'; _stp.from = f; _stp.to = to; _stp.all = false; _stp.open = null; _stp.q = ''; stpRender(); }
    });
}
function stpRender() {
    const body = document.getElementById('stpBody');
    if (!body) return;
    const rg = _stp.range;
    const bd = _stclBounds(rg, _stp.from, _stp.to, 0);
    const { tot, qty } = _stpTotals(bd);
    const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, [, v]) => s + v, 0);
    const qtyAll = Object.values(qty).reduce((s, v) => s + v, 0);

    let deltaHtml = '';
    const pb = _stclBounds(rg, _stp.from, _stp.to, -1);
    if (pb) {
        const prev = Object.values(_stpTotals(pb).tot).reduce((s, v) => s + v, 0);
        if (prev > 0) {
            const d = Math.round((total - prev) / prev * 100), up = d >= 0;
            deltaHtml = `<div class="stcl-delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(d)}%<span>${escapeHtml(t('stcl_cmp_' + (rg === 'custom' ? 'custom' : rg)))}</span></div>`;
        }
    }
    const chips = ['week', 'month', 'quarter', 'year', 'all'].map(k =>
        `<button class="stcl-chip${rg === k ? ' on' : ''}" onclick="stpSetRange('${k}')">${escapeHtml(t('stcl_' + k))}</button>`).join('')
        + `<button class="stcl-chip cal${rg === 'custom' ? ' on' : ''}" onclick="stpPickRange(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></button>`;
    const cap = bd ? `${formatDateDMY(bd.from)} – ${formatDateDMY(bd.to)}` : t('stcl_all_cap');
    let html = `<div class="stcl-chips">${chips}</div><div class="stcl-cap">${escapeHtml(cap)}</div>`;
    html += `<div class="stcl-card"><div class="stcl-sum"><div><div class="stcl-big">${_stMoneyVal(total)}</div><div class="stcl-lbl">${escapeHtml(t('stp_summary').replace('{n}', rows.length).replace('{q}', _stpFq(qtyAll)))}</div></div>${deltaHtml}</div></div>`;

    if (!rows.length || total <= 0) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t('stcl_empty'))}</div></div>`;
        body.innerHTML = html;
        return;
    }
    // кольцо долей (топ-5 + «Прочие») и список изделий: точка · название · сумма · %
    const LIM = 8;
    const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a', '#8a7fa8'], REST = '#a29c8c';
    const top5 = rows.slice(0, 5);
    const restV = total - top5.reduce((s, [, v]) => s + v, 0);
    const parts = top5.map(([, v], i) => [v, COLS[i]]);
    if (restV > 0.005) parts.push([restV, REST]);
    const r = 15, c = 2 * Math.PI * r;
    let off = 0, circles = '';
    parts.forEach(([v, col]) => {
        const l = c * v / total;
        circles += `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-dasharray="${l.toFixed(2)} ${(c - l).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 21 21)"/>`;
        off += l;
    });
    const nm = n => n || t('stats_noname');
    const legend = parts.map(([v, col], i) => `<div class="stn-lr"><i style="background:${col}"></i><span>${escapeHtml(i < top5.length ? nm(top5[i][0]) : t('stats_others'))}</span><u>${Math.round(v / total * 100)}%</u></div>`).join('');
    html += `<div class="stcl-card"><div class="stn-h"><div class="stn-d"><svg viewBox="0 0 42 42" width="128" height="128">${circles}</svg><div class="stcl-hole"><b>${rows.length}</b><small>${escapeHtml(t('stats_products_count').replace(':', ''))}</small></div></div><div class="stn-lg">${legend}</div></div>`
        + `<input id="stpQ" class="sti-q-in" type="text" value="${escapeHtml(_stp.q || '')}" placeholder="${escapeHtml(t('stats_filter_by_name'))}" oninput="stpFilter(this.value)">`
        + `<div class="stn-hd"><span class="stn-n">${escapeHtml(t('stp_h_item'))}</span><em>${escapeHtml(t('stp_h_qty'))}</em><b>${escapeHtml(t('stp_h_sum'))}</b></div><div id="stpRows"></div></div>`;
    body.innerHTML = html;
    stpRows();
}

function stpRows() {
    const box = document.getElementById('stpRows');
    if (!box) return;
    const { tot, qty } = _stpTotals(_stclBounds(_stp.range, _stp.from, _stp.to, 0));
    const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, [, v]) => s + v, 0);
    const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a', '#8a7fa8'], REST = '#a29c8c';
    const rank = {}; rows.forEach(([n], i) => { rank[n] = i; });
    const q = (_stp.q || '').trim().toLowerCase();
    const list = q ? rows.filter(([n]) => (n || '').toLowerCase().indexOf(q) !== -1) : rows;
    const LIM = 8, shown = (_stp.all || q) ? list : list.slice(0, LIM);
    _stp.view = shown.map(([n]) => n);
    const fq = _stpFq;
    const nm = n => n || t('stats_noname');
    box.innerHTML = shown.map(([n, v], i) => {
        const on = _stp.open === n, ri = rank[n];
        return `<div class="stn-it${on ? ' open' : ''}" onclick="stpOpen(${i})"><div class="stn-row"><i style="background:${ri < 5 ? COLS[ri] : REST}"></i><span class="stn-n">${escapeHtml(nm(n))}</span><em>${escapeHtml(fq(qty[n] || 0))}</em><b>${escapeHtml(_stNum(v))}</b></div>`
            + (on ? `<div class="stn-dt"><div class="stn-full">${escapeHtml(nm(n))}</div><div class="stn-m"><span>${escapeHtml(t('stp_h_qty'))} <b>${escapeHtml(fq(qty[n] || 0))}</b></span><span>${escapeHtml(t('stp_h_sum'))} <b>${escapeHtml(_stNum(v))} ${escapeHtml(_stCur())}</b></span><span>${escapeHtml(t('stp_share'))} <b>${total > 0 ? Math.round(v / total * 100) : 0}%</b></span></div></div>` : '')
            + '</div>';
    }).join('')
        + (!q && list.length > LIM ? `<div class="stp-more" onclick="stpToggleAll()">${escapeHtml(_stp.all ? t('stp_less') : t('stp_all').replace('{n}', list.length))}</div>` : '');
}

// ==================== СТРАНИЦА «РЕНТАБЕЛЬНОСТЬ» (раскрытие плитки, 31.10.2026) ====================
// Сводка (маржа, прибыль, себестоимость) — за выбранный период (_stclBounds/_stclOrders); список изделий — по рецептам
// (текущие цена и себестоимость, от периода не зависит). Только при праве can_view_costs. «Назад» — в «Статистику».
let _sm = { range: 'month', from: '', to: '', sort: 'best', all: false, open: null };
function _smTotals(bd) {
    const list = _stclOrders(bd);
    return {
        cost: list.reduce((s, o) => s + orderCost(o), 0),
        profit: list.reduce((s, o) => s + orderProfit(o), 0),
        base: list.reduce((s, o) => s + orderAfterDiscount(o), 0)
    };
}
function _smFmt2(v) { try { return Number(v).toLocaleString(typeof currentLang !== 'undefined' ? currentLang : undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (e) { return Number(v).toFixed(2); } }
function _smColor(p) { return p >= 50 ? '#4f6349' : (p >= 25 ? '#a07a22' : '#c0685c'); }
function _smRows() {
    const list = (typeof products !== 'undefined' ? products : []).filter(p => (p.ingredients || []).length > 0 && p.price);
    list.sort((a, b) => _sm.sort === 'worst' ? productProfitPct(a) - productProfitPct(b) : productProfitPct(b) - productProfitPct(a));
    return list;
}
function statsOpenMargin() {
    if (typeof hasPermission === 'function' && !hasPermission('can_view_costs')) return;
    _sm = { range: 'month', from: '', to: '', sort: 'best', all: false, open: null };   // каждый вход — «Месяц», «Лучшие»
    openAppPage('statsMarginPage');
    smRender();
}
function smSetRange(r) { _sm.range = r; smRender(); }
function smSetSort(s) { _sm.sort = s; _sm.all = false; _sm.open = null; smRender(); }
function smToggleAll() { _sm.all = !_sm.all; smRender(); }
function smOpen(i) { const p = _smRows()[i]; const id = p ? p.id : null; _sm.open = (_sm.open === id) ? null : id; smRender(); }
function smPickRange(ev) {
    if (ev) ev.stopPropagation();
    toggleCustomCalendarRange('globalCalendarPopup', 'smFrom', 'smTo', null, null, {
        onApply: function (f, to) { _sm.range = 'custom'; _sm.from = f; _sm.to = to; smRender(); }
    });
}
function smRender() {
    const body = document.getElementById('smBody');
    if (!body) return;
    const rg = _sm.range;
    const bd = _stclBounds(rg, _sm.from, _sm.to, 0);
    const cur = _smTotals(bd);
    const mPct = cur.base > 0 ? cur.profit / cur.base * 100 : null;

    let deltaHtml = '';
    const pb = _stclBounds(rg, _sm.from, _sm.to, -1);
    if (pb && mPct != null) {
        const pt = _smTotals(pb);
        if (pt.base > 0) {
            const d = Math.round((mPct - pt.profit / pt.base * 100) * 10) / 10, up = d >= 0;
            const dTxt = (Math.abs(d) % 1 === 0 ? String(Math.abs(d)) : Math.abs(d).toFixed(1));
            deltaHtml = `<div class="stcl-delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${escapeHtml(dTxt)} ${escapeHtml(t('sm_pp'))}<span>${escapeHtml(t('stcl_cmp_' + (rg === 'custom' ? 'custom' : rg)))}</span></div>`;
        }
    }
    const chips = ['week', 'month', 'quarter', 'year', 'all'].map(k =>
        `<button class="stcl-chip${rg === k ? ' on' : ''}" onclick="smSetRange('${k}')">${escapeHtml(t('stcl_' + k))}</button>`).join('')
        + `<button class="stcl-chip cal${rg === 'custom' ? ' on' : ''}" onclick="smPickRange(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></button>`;
    const cap = bd ? `${formatDateDMY(bd.from)} – ${formatDateDMY(bd.to)}` : t('stcl_all_cap');
    let html = `<div class="stcl-chips">${chips}</div><div class="stcl-cap">${escapeHtml(cap)}</div>`;
    html += `<div class="stcl-card"><div class="stcl-sum"><div><div class="stcl-big">${mPct == null ? '—' : Math.round(mPct) + '<small>&nbsp;%</small>'}</div><div class="stcl-lbl">${escapeHtml(t('sm_cap'))}</div></div>${deltaHtml}</div>`
        + `<div class="stcl-meta"><span>${escapeHtml(t('srv_profit'))} <b>${escapeHtml(_stNum(cur.profit))} ${escapeHtml(_stCur())}</b></span><span>${escapeHtml(t('sm_cost'))} <b>${escapeHtml(_stNum(cur.cost))} ${escapeHtml(_stCur())}</b></span></div></div>`;

    const rows = _smRows();
    if (!rows.length) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t('sm_empty'))}</div></div>`;
        body.innerHTML = html;
        return;
    }
    const LIM = 8, shown = _sm.all ? rows : rows.slice(0, LIM), worst = _sm.sort === 'worst';
    html += `<div class="stcl-card"><div class="stp-seg"><button class="${worst ? '' : 'on'}" onclick="smSetSort('best')">${escapeHtml(t('sm_best'))}</button><button class="${worst ? 'on' : ''}" onclick="smSetSort('worst')">${escapeHtml(t('sm_worst'))}</button></div>`
        + `<div class="smg-hd"><span class="stn-n">${escapeHtml(t('stp_h_item'))}</span><em>${escapeHtml(t('sm_h_cost'))}</em><em>${escapeHtml(t('sm_h_price'))}</em><b>${escapeHtml(t('srv_margin'))}</b></div>`
        + shown.map((p, i) => {
            const cost = productUnitCost(p), pct = productProfitPct(p), on = _sm.open === p.id, cl = _smColor(pct), cu = _stCur();
            return `<div class="stn-it${on ? ' open' : ''}" onclick="smOpen(${i})"><div class="smg-row"><span class="stn-n">${escapeHtml(p.name)}</span><em>${escapeHtml(_smFmt2(cost))}</em><em>${escapeHtml(_smFmt2(p.price))}</em><b style="color:${cl}">${Math.round(pct)}%</b></div>`
                + (on ? `<div class="stn-dt" style="padding-left:0"><div class="stn-full">${escapeHtml(p.name)}</div><div class="stn-m"><span>${escapeHtml(t('sm_cost'))} <b>${escapeHtml(_smFmt2(cost))} ${escapeHtml(cu)}</b></span><span>${escapeHtml(t('sm_price'))} <b>${escapeHtml(_smFmt2(p.price))} ${escapeHtml(cu)}</b></span><span>${escapeHtml(t('sm_unit_profit'))} <b>${escapeHtml(_smFmt2(p.price - cost))} ${escapeHtml(cu)}</b></span></div></div>` : '')
                + '</div>';
        }).join('')
        + (rows.length > LIM ? `<div class="stp-more" onclick="smToggleAll()">${escapeHtml(_sm.all ? t('stp_less') : t('stp_all').replace('{n}', rows.length))}</div>` : '')
        + `<div class="smg-note">${escapeHtml(t('sm_note'))}</div></div>`;
    body.innerHTML = html;
}

// ==================== СТРАНИЦА «ИНГРЕДИЕНТЫ» (раскрытие плитки, 31.10.2026) ====================
// Расход ингредиентов за период (order_item_ingredients по сохранённым заказам, _stclBounds/_stclOrders). Кольцо долей по стоимости,
// поиск, сортировка «по стоимости / по количеству», строка раскрывается. Только при праве can_view_costs. «Назад» — в «Статистику».
let _sti = { range: 'month', from: '', to: '', sort: 'cost', all: false, open: null, q: '', rows: null, seq: 0 };
function _stiAgg(bd) {
    const ids = _stclOrders(bd).flatMap(o => (o.items || []).map(it => it.id)).filter(Boolean);
    if (!ids.length) return Promise.resolve([]);
    return db.from('order_item_ingredients').select('ingredient_id, ingredient_name, unit, quantity, total_cost').in('order_item_id', ids).then(({ data, error }) => {
        if (error || !data) return null;
        const map = {};
        data.forEach(r => {
            const cur = r.ingredient_id != null && typeof ingredients !== 'undefined' ? ingredients.find(i => i.id === r.ingredient_id) : null;
            const key = r.ingredient_id != null ? 'id:' + r.ingredient_id : 'n:' + r.ingredient_name + '|' + r.unit;
            if (!map[key]) map[key] = { key: key, name: cur ? cur.name : (r.ingredient_name || ''), unit: r.unit || '', qty: 0, cost: 0 };
            map[key].qty += Number(r.quantity) || 0;
            map[key].cost += Number(r.total_cost) || 0;
        });
        return Object.values(map);
    });
}
function statsOpenIng() {
    if (typeof hasPermission === 'function' && !hasPermission('can_view_costs')) return;
    _sti = { range: 'month', from: '', to: '', sort: 'cost', all: false, open: null, q: '', rows: null, seq: 0 };   // каждый вход — «Месяц», «По стоимости»
    openAppPage('statsIngPage');
    stiLoad();
}
function stiLoad() {
    const my = ++_sti.seq;
    _sti.rows = null; _sti.prev = undefined;
    stiRender();
    const bd = _stclBounds(_sti.range, _sti.from, _sti.to, 0), pb = _stclBounds(_sti.range, _sti.from, _sti.to, -1);
    Promise.all([_stiAgg(bd), pb ? _stiAgg(pb) : Promise.resolve(undefined)]).then(([cur, prev]) => {
        if (my !== _sti.seq) return;
        _sti.rows = cur || [];
        _sti.err = !cur;
        _sti.prev = prev ? prev.reduce((s, r) => s + r.cost, 0) : undefined;
        stiRender();
    }).catch(() => { if (my !== _sti.seq) return; _sti.rows = []; _sti.err = true; stiRender(); });
}
function stiSetRange(r) { _sti.range = r; _sti.all = false; _sti.open = null; stiLoad(); }
function stiPickRange(ev) {
    if (ev) ev.stopPropagation();
    toggleCustomCalendarRange('globalCalendarPopup', 'stiFrom', 'stiTo', null, null, {
        onApply: function (f, to) { _sti.range = 'custom'; _sti.from = f; _sti.to = to; _sti.all = false; _sti.open = null; stiLoad(); }
    });
}
function stiSetSort(s) {
    _sti.sort = s; _sti.all = false; _sti.open = null;
    const seg = document.getElementById('stiSeg');
    if (seg) { const bs = seg.querySelectorAll('button'); if (bs.length > 1) { bs[0].classList.toggle('on', s !== 'qty'); bs[1].classList.toggle('on', s === 'qty'); } }
    stiRows();
}
function stiToggleAll() { _sti.all = !_sti.all; stiRows(); }
function stiFilter(v) { _sti.q = v || ''; _sti.open = null; stiRows(); }
function stiOpen(i) { const k = (_sti.view || [])[i]; _sti.open = (_sti.open === k) ? null : k; stiRows(); }
function stiRows() {
    const box = document.getElementById('stiRows');
    if (!box || !_sti.rows) return;
    const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a', '#8a7fa8'], REST = '#a29c8c';
    const byCost = _sti.rows.slice().sort((a, b) => b.cost - a.cost);
    const total = byCost.reduce((s, r) => s + r.cost, 0);
    const rank = {}; byCost.forEach((r, i) => { rank[r.key] = i; });
    const q = (_sti.q || '').trim().toLowerCase();
    let list = _sti.sort === 'qty' ? _sti.rows.slice().sort((a, b) => b.qty - a.qty) : byCost.slice();
    if (q) list = list.filter(r => (r.name || '').toLowerCase().indexOf(q) !== -1);
    const LIM = 8, shown = (_sti.all || q) ? list : list.slice(0, LIM);
    _sti.view = shown.map(r => r.key);
    const cur = _stCur(), fq = _stpFq;
    const nm = n => n || t('stats_noname');
    box.innerHTML = shown.map((r, i) => {
        const on = _sti.open === r.key, ri = rank[r.key], ua = r.unit ? (typeof unitAbbrev === 'function' ? unitAbbrev(r.unit) : r.unit) : '', u = ua ? ' ' + ua : '';
        return `<div class="stn-it${on ? ' open' : ''}" onclick="stiOpen(${i})"><div class="stn-row"><i style="background:${ri < 5 ? COLS[ri] : REST}"></i><span class="stn-n">${escapeHtml(nm(r.name))}</span><em class="sti-q">${escapeHtml(fq(r.qty) + u)}</em><b>${escapeHtml(_stNum(r.cost))}</b></div>`
            + (on ? `<div class="stn-dt"><div class="stn-full">${escapeHtml(nm(r.name))}</div><div class="stn-m"><span>${escapeHtml(t('stp_h_qty'))} <b>${escapeHtml(fq(r.qty) + u)}</b></span><span>${escapeHtml(t('stp_h_sum'))} <b>${escapeHtml(_stNum(r.cost))} ${escapeHtml(cur)}</b></span><span>${escapeHtml(t('stp_share'))} <b>${total > 0 ? Math.round(r.cost / total * 100) : 0}%</b></span>${r.qty > 0 ? `<span>${escapeHtml(t('ing_avg'))} <b>${escapeHtml(_smFmt2(r.cost / r.qty))} ${escapeHtml(cur)}${ua ? '/' + escapeHtml(ua) : ''}</b></span>` : ''}</div></div>` : '')
            + '</div>';
    }).join('')
        + (!q && list.length > LIM ? `<div class="stp-more" onclick="stiToggleAll()">${escapeHtml(_sti.all ? t('stp_less') : t('stp_all').replace('{n}', list.length))}</div>` : '');
}
function stiRender() {
    const body = document.getElementById('stiBody');
    if (!body) return;
    const rg = _sti.range;
    const bd = _stclBounds(rg, _sti.from, _sti.to, 0);
    const chips = ['week', 'month', 'quarter', 'year', 'all'].map(k =>
        `<button class="stcl-chip${rg === k ? ' on' : ''}" onclick="stiSetRange('${k}')">${escapeHtml(t('stcl_' + k))}</button>`).join('')
        + `<button class="stcl-chip cal${rg === 'custom' ? ' on' : ''}" onclick="stiPickRange(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></button>`;
    const cap = bd ? `${formatDateDMY(bd.from)} – ${formatDateDMY(bd.to)}` : t('stcl_all_cap');
    let html = `<div class="stcl-chips">${chips}</div><div class="stcl-cap">${escapeHtml(cap)}</div>`;
    if (!_sti.rows) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t('stats_loading'))}</div></div>`;
        body.innerHTML = html;
        return;
    }
    const rows = _sti.rows.slice().sort((a, b) => b.cost - a.cost);
    const total = rows.reduce((s, r) => s + r.cost, 0);
    let deltaHtml = '';
    if (_sti.prev > 0) {
        const d = Math.round((total - _sti.prev) / _sti.prev * 100), up = d >= 0;
        deltaHtml = `<div class="stcl-delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(d)}%<span>${escapeHtml(t('stcl_cmp_' + (rg === 'custom' ? 'custom' : rg)))}</span></div>`;
    }
    html += `<div class="stcl-card"><div class="stcl-sum"><div><div class="stcl-big">${_stMoneyVal(total)}</div><div class="stcl-lbl">${escapeHtml(t('ing_summary').replace('{n}', rows.length))}</div></div>${deltaHtml}</div></div>`;
    if (!rows.length) {
        html += `<div class="stcl-card"><div class="stcl-empty">${escapeHtml(t(_sti.err ? 'stats_load_error' : 'stcl_empty'))}</div></div>`;
        body.innerHTML = html;
        return;
    }
    const COLS = ['#5f7857', '#c9973a', '#4f7a88', '#b5574a', '#8a7fa8'], REST = '#a29c8c';
    const top5 = rows.slice(0, 5);
    const restV = total - top5.reduce((s, r) => s + r.cost, 0);
    const parts = top5.map((r, i) => [r.cost, COLS[i], r.name]);
    if (restV > 0.005) parts.push([restV, REST, null]);
    const rr = 15, c = 2 * Math.PI * rr;
    let off = 0, circles = '';
    if (total > 0) parts.forEach(([v, col]) => {
        const l = c * v / total;
        circles += `<circle cx="21" cy="21" r="${rr}" fill="none" stroke="${col}" stroke-width="7" stroke-dasharray="${l.toFixed(2)} ${(c - l).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 21 21)"/>`;
        off += l;
    });
    const legend = parts.map(([v, col, n]) => `<div class="stn-lr"><i style="background:${col}"></i><span>${escapeHtml(n === null ? t('stats_others') : (n || t('stats_noname')))}</span><u>${total > 0 ? Math.round(v / total * 100) : 0}%</u></div>`).join('');
    const qs = _sti.sort === 'qty';
    html += `<div class="stcl-card"><div class="stn-h"><div class="stn-d"><svg viewBox="0 0 42 42" width="128" height="128">${circles}</svg><div class="stcl-hole"><b>${rows.length}</b><small>${escapeHtml(t('ing_hole'))}</small></div></div><div class="stn-lg">${legend}</div></div>`
        + `<input id="stiQ" class="sti-q-in" type="text" value="${escapeHtml(_sti.q || '')}" placeholder="${escapeHtml(t('stats_filter_by_name'))}" oninput="stiFilter(this.value)">`
        + `<div class="stp-seg" id="stiSeg"><button class="${qs ? '' : 'on'}" onclick="stiSetSort('cost')">${escapeHtml(t('ing_by_cost'))}</button><button class="${qs ? 'on' : ''}" onclick="stiSetSort('qty')">${escapeHtml(t('ing_by_qty'))}</button></div>`
        + `<div class="stn-hd"><span class="stn-n">${escapeHtml(t('ing_h_item'))}</span><em class="sti-q">${escapeHtml(t('stp_h_qty'))}</em><b>${escapeHtml(t('stp_h_sum'))}</b></div><div id="stiRows"></div></div>`;
    body.innerHTML = html;
    stiRows();
}
