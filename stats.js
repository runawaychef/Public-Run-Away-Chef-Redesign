// ==================== СТАТИСТИКА ====================
// Окно статистики: фильтры, итоги, таблицы по клиентам/изделиям,
// круговая диаграмма и график по месяцам, экспорт резервной копии.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: orders/customers/products (главный скрипт),
// orderGrandTotal/orderVatAmount (money.js), closeModal (главный скрипт).
// updateTotals используется также из orders.js (для сумм недели/месяца под списком заказов).

// Раздел "Статистика" теперь обычная вкладка (см. showTab в index.html),
// а не всплывающее окно. Функция оставлена как алиас — на случай,
// если где-то ещё остался старый вызов openStatsModal().
function openStatsModal() {
    showTab('stats');
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
    const date = new Date().toISOString().slice(0,10);
    a.href     = url;
    a.download = `runwaychef_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getFilteredOrders() {
    const dateRange = document.getElementById('statsDateRange').value;
    const dateFrom  = document.getElementById('statsDateFrom') ? document.getElementById('statsDateFrom').value : '';
    const dateTo    = document.getElementById('statsDateTo')   ? document.getElementById('statsDateTo').value   : '';
    let filtered = [...orders];
    if (selectedStatsCustomers.length > 0) filtered = filtered.filter(o => selectedStatsCustomers.includes(o.customer));
    if (dateRange === 'week' || dateRange === 'month' || dateRange === 'year') {
        const today = new Date();
        let start;
        if (dateRange === 'week') {
            // Неделя Пн–Вс
            const mon = getMondayOf(today);
            const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
            const monStr = mon.getFullYear() + '-' + String(mon.getMonth()+1).padStart(2,'0') + '-' + String(mon.getDate()).padStart(2,'0');
            const sunStr = sun.getFullYear() + '-' + String(sun.getMonth()+1).padStart(2,'0') + '-' + String(sun.getDate()).padStart(2,'0');
            filtered = filtered.filter(o => o.date >= monStr && o.date <= sunStr);
        } else {
            if (dateRange === 'year') {
                start = new Date(today.getFullYear(), 0, 1);
            } else {
                start = new Date(today.getFullYear(), today.getMonth(), 1);
            }
            filtered = filtered.filter(o => new Date(o.date) >= start);
        }
    } else if (dateRange === 'custom' && dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to   = new Date(dateTo); to.setDate(to.getDate() + 1);
        filtered = filtered.filter(o => { const d = new Date(o.date); return d >= from && d < to; });
    }
    return filtered;
}

function calculateStats(filteredOrders) {
    const today = new Date();
    const weekStart  = getCurrentWeekStart();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const sum    = list => list.reduce((s, o) => s + orderGrandTotal(o), 0).toFixed(2);
    const sumVat = list => list.reduce((s, o) => s + orderVatAmount(o), 0).toFixed(2);
    return {
        totalPrice: sum(filteredOrders),
        totalVat:   sumVat(filteredOrders),
        weekTotal:  sum(filteredOrders.filter(o => new Date(o.date) >= weekStart)),
        monthTotal: sum(filteredOrders.filter(o => new Date(o.date) >= monthStart)),
    };
}

// ==================== МНОЖЕСТВЕННЫЙ ФИЛЬТР КЛИЕНТОВ ====================
let selectedStatsCustomers = []; // пусто = все клиенты

function updateStatsCustomerFilter() {
    const list = document.getElementById('customerFilterList');
    list.innerHTML = '';
    customers.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(c => {
        const checked = selectedStatsCustomers.includes(c.name) ? 'checked' : '';
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 px-1 py-1 text-xs hover:bg-gray-50 rounded';
        label.innerHTML = `<input type="checkbox" value="${c.name}" onchange="onCustomerFilterChange(this)" ${checked}> ${c.name}`;
        list.appendChild(label);
    });
    updateCustomerFilterLabel();
}

function toggleCustomerFilterDropdown() {
    document.getElementById('customerFilterDropdown').classList.toggle('hidden');
}

function toggleAllCustomersFilter(checkbox) {
    if (checkbox.checked) {
        selectedStatsCustomers = [];
        document.querySelectorAll('#customerFilterList input[type=checkbox]').forEach(cb => cb.checked = false);
    }
    updateCustomerFilterLabel();
    applyFilter();
}

function onCustomerFilterChange(checkbox) {
    if (checkbox.checked) {
        if (!selectedStatsCustomers.includes(checkbox.value)) selectedStatsCustomers.push(checkbox.value);
    } else {
        selectedStatsCustomers = selectedStatsCustomers.filter(n => n !== checkbox.value);
    }
    document.getElementById('customerFilterAll').checked = selectedStatsCustomers.length === 0;
    updateCustomerFilterLabel();
    applyFilter();
}

function updateCustomerFilterLabel() {
    const label = document.getElementById('customerFilterLabel');
    if (selectedStatsCustomers.length === 0) {
        label.textContent = 'Все клиенты';
    } else if (selectedStatsCustomers.length === 1) {
        label.textContent = selectedStatsCustomers[0];
    } else {
        label.textContent = `Выбрано клиентов: ${selectedStatsCustomers.length}`;
    }
}

// Закрытие выпадающего списка по клику снаружи
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('customerFilterDropdown');
    const btn = document.getElementById('customerFilterBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function toggleDateRange() {
    const range = document.getElementById('statsDateRange').value;
    document.getElementById('customDateRange').classList.toggle('hidden', range !== 'custom');
}

function applyFilter() {
    const filtered = getFilteredOrders();
    updateDisplay(filtered);
    drawPieChart(filtered);
    drawMonthlyChart(filtered);
    drawCustomerTable(filtered);
    drawProductTable(filtered);
    drawProfitabilitySummary(filtered);
    drawProductProfitabilityTable();

    // Подписываемся на фильтр каждый раз при открытии статистики
    const filterEl = document.getElementById('productProfitFilter');
    if (filterEl) {
        filterEl.value = '';
        filterEl.oninput = () => drawProductProfitabilityTable();
    }
}

function updateDisplay(filteredOrders = orders) {
    const stats = calculateStats(filteredOrders);
    document.getElementById('totalPrice').textContent      = stats.totalPrice + ' €';
    document.getElementById('totalVatModal').textContent   = stats.totalVat   + ' €';
    document.getElementById('weekTotalModal').textContent  = stats.weekTotal  + ' €';
    document.getElementById('monthTotalModal').textContent = stats.monthTotal + ' €';
    updateInfoCounts();
}

function updateInfoCounts() {
    document.getElementById('customerCount').textContent = customers.length;
    document.getElementById('productCount').textContent  = products.length;
    document.getElementById('orderCount').textContent    = orders.length;
}

function updateTotals(filteredOrders) {
    // Функция оставлена как точка расширения; основные итоги обновляет updateDisplay()
}

// --- Таблица по клиентам ---
// (кэш lastCustomerTableData больше не нужен — теперь весь список всегда виден через прокрутку)

function buildCustomerRowsHtml(sorted, totals, vats, qtys, grandTotal) {
    let html = '';
    sorted.forEach(([name, val], i) => {
        const pct = grandTotal > 0 ? (val/grandTotal*100).toFixed(1) : '0.0';
        const color = `hsl(${i * 360 / sorted.length}, 60%, 50%)`;
        html += `<tr class="border-b"><td class="p-0.5 flex items-center gap-1"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>${escapeHtml(name)}</td><td class="p-0.5 text-right">${qtys[name] || 0}</td><td class="p-0.5 text-right stats-num">${val.toFixed(2)}</td><td class="p-0.5 text-right text-blue-700">${(vats[name]||0).toFixed(2)}</td><td class="p-0.5 text-right stats-pct">${pct}%</td></tr>`;
    });
    return html;
}

function drawCustomerTable(filtered) {
    const totals = {};
    const vats    = {};
    const qtys   = {};
    filtered.forEach(o => {
        totals[o.customer] = (totals[o.customer] || 0) + orderGrandTotal(o);
        vats[o.customer]   = (vats[o.customer]   || 0) + orderVatAmount(o);
        const q = (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
        qtys[o.customer] = (qtys[o.customer] || 0) + q;
    });
    const sorted = Object.entries(totals).sort((a,b) => b[1] - a[1]);
    const grandTotal = sorted.reduce((s,[,v]) => s+v, 0);
    const grandVat   = Object.values(vats).reduce((s,v) => s+v, 0);
    const grandQty   = Object.values(qtys).reduce((s,v) => s+v, 0);

    const container = document.getElementById('statsCustomerTableScroll');
    const totalContainer = document.getElementById('statsCustomerTableTotal');

    if (!sorted.length) {
        container.innerHTML = '<p class="text-xs text-gray-400">Нет данных</p>';
        totalContainer.innerHTML = '';
        return;
    }

    let html = '<table class="w-full stats-table" style="table-layout:fixed;"><thead><tr class="bg-gray-100" style="position:sticky;top:0;"><th class="p-0.5 text-left" style="width:40%;">Клиент</th><th class="p-0.5 text-right" style="width:15%;">Кол-во</th><th class="p-0.5 text-right" style="width:20%;">Сумма (€)</th><th class="p-0.5 text-right" style="width:15%;">НДС (€)</th><th class="p-0.5 text-right" style="width:10%;">Доля</th></tr></thead><tbody>';
    html += buildCustomerRowsHtml(sorted, totals, vats, qtys, grandTotal);
    html += '</tbody></table>';
    container.innerHTML = html;
    totalContainer.innerHTML =
        `<table class="w-full stats-table" style="table-layout:fixed;"><tr class="bg-gray-50 font-semibold"><td class="p-0.5" style="width:40%">Итого</td><td class="p-0.5 text-right" style="width:15%">${grandQty}</td><td class="p-0.5 text-right" style="width:20%">${grandTotal.toFixed(2)}</td><td class="p-0.5 text-right text-blue-700" style="width:15%">${grandVat.toFixed(2)}</td><td class="p-0.5" style="width:10%"></td></tr></table>`;
}

// --- Топ изделий ---
function drawProductTable(filtered) {
    const totals = {};
    const qtys   = {};
    filtered.forEach(o => {
        (o.items || []).forEach(it => {
            totals[it.product] = (totals[it.product] || 0) + it.quantity * it.price;
            qtys[it.product]   = (qtys[it.product] || 0) + Number(it.quantity || 0);
        });
    });
    const sorted = Object.entries(totals).sort((a,b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) {
        document.getElementById('statsProductTable').innerHTML = '<p class="text-xs text-gray-400">Нет данных</p>';
        return;
    }
    const max = sorted[0][1];
    let html = '<table class="w-full stats-table"><thead><tr class="bg-gray-100"><th class="p-0.5 text-left">Изделие</th><th class="p-0.5 text-right">Кол-во</th><th class="p-0.5 text-right">Сумма (€)</th></tr></thead><tbody>';
    sorted.forEach(([name, val]) => {
        const barW = max > 0 ? Math.round(val/max*100) : 0;
        html += `<tr class="border-b"><td class="p-0.5">
            <div>${escapeHtml(name)}</div>
            <div style="background:#e5e7eb;border-radius:2px;height:4px;margin-top:2px;">
                <div style="background:#6b7280;width:${barW}%;height:4px;border-radius:2px;"></div>
            </div>
        </td><td class="p-0.5 text-right align-top">${qtys[name] || 0}</td><td class="p-0.5 text-right stats-num align-top">${val.toFixed(2)}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('statsProductTable').innerHTML = html;
}

// --- Общая рентабельность за период ---
function drawProfitabilitySummary(filtered) {
    const totalCost   = filtered.reduce((s, o) => s + orderCost(o), 0);
    const totalProfit = filtered.reduce((s, o) => s + orderProfit(o), 0);
    const totalBase   = filtered.reduce((s, o) => s + orderAfterDiscount(o), 0);
    const profitPct   = totalBase > 0 ? (totalProfit / totalBase * 100) : 0;

    const costEl = document.getElementById('statsTotalCost');
    const profitEl = document.getElementById('statsTotalProfit');
    const profitPctEl = document.getElementById('statsProfitPct');
    if (costEl) costEl.textContent = totalCost.toFixed(2) + ' €';
    if (profitEl) {
        profitEl.textContent = totalProfit.toFixed(2) + ' €';
        profitEl.className = totalProfit >= 0 ? 'text-sm font-bold text-green-700' : 'text-sm font-bold text-red-600';
    }
    if (profitPctEl) profitPctEl.textContent = profitPct.toFixed(1) + '%';
}

// --- Топ изделий по рентабельности с фильтром по названию ---
function drawProductProfitabilityTable() {
    const container = document.getElementById('statsProductProfitability');
    if (!container) return;
    const filterEl = document.getElementById('productProfitFilter');
    const filter = filterEl ? filterEl.value.trim().toLowerCase() : '';

    let withRecipe = products.filter(p => (p.ingredients || []).length > 0);
    if (filter) {
        withRecipe = withRecipe.filter(p => p.name.toLowerCase().includes(filter));
    }

    if (!withRecipe.length) {
        container.innerHTML = `<p class="text-xs text-gray-400">${filter ? 'Нет изделий по фильтру «' + filter + '»' : 'Нет изделий с заполненной рецептурой'}</p>`;
        return;
    }

    // Без фильтра — топ-10, с фильтром — все найденные
    const sorted = [...withRecipe]
        .sort((a, b) => productProfitPct(b) - productProfitPct(a))
        .slice(0, filter ? 100 : 10);

    const title = filter
        ? `Найдено: ${sorted.length} изделий по «${filter}»`
        : `Топ-${sorted.length} по рентабельности`;

    let html = `<p class="text-xs text-gray-500 mb-1">${title}</p>`;
    html += '<table class="w-full stats-table" style="table-layout:fixed;"><thead><tr class="bg-gray-100"><th class="p-0.5 text-left" style="width:46%;">Изделие</th><th class="p-0.5 text-right" style="width:18%;">Себест. (€)</th><th class="p-0.5 text-right" style="width:18%;">Цена (€)</th><th class="p-0.5 text-right" style="width:18%;">Рент.</th></tr></thead><tbody>';
    sorted.forEach(p => {
        const cost = productUnitCost(p);
        const pct  = productProfitPct(p);
        const pctClass = pct >= 0 ? 'text-green-700' : 'text-red-600';
        html += `<tr class="border-b"><td class="p-0.5" style="word-break:break-word;">${escapeHtml(p.name)}</td><td class="p-0.5 text-right whitespace-nowrap">${cost.toFixed(2)}</td><td class="p-0.5 text-right whitespace-nowrap">${p.price.toFixed(2)}</td><td class="p-0.5 text-right font-semibold whitespace-nowrap ${pctClass}">${pct.toFixed(1)}%</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// --- Столбчатый график по месяцам (выручка + линия прибыли) ---
function drawMonthlyChart(filtered) {
    const canvas = document.getElementById('monthlyCanvas');
    const W = canvas.offsetWidth || 360;
    const H = 140;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Группируем по ГГГГ-ММ — выручка (столбики) и прибыль (линия)
    const monthlyRevenue = {};
    const monthlyProfit  = {};
    filtered.forEach(o => {
        const key = o.date ? o.date.slice(0,7) : 'unknown';
        monthlyRevenue[key] = (monthlyRevenue[key] || 0) + orderGrandTotal(o);
        monthlyProfit[key]  = (monthlyProfit[key]  || 0) + orderProfit(o);
    });
    const keys = Object.keys(monthlyRevenue).sort();
    if (!keys.length) {
        ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif';
        ctx.fillText('Нет данных', W/2 - 30, H/2);
        return;
    }
    const revenueVals = keys.map(k => monthlyRevenue[k]);
    const profitVals  = keys.map(k => monthlyProfit[k] || 0);
    // Общий максимум по обеим сериям, чтобы прибыль не выходила за пределы графика
    const maxV  = Math.max(...revenueVals, ...profitVals, 0.01);
    const pad   = { top: 10, bottom: 30, left: 42, right: 8 };
    const bW    = Math.max(4, Math.floor((W - pad.left - pad.right) / keys.length) - 4);
    const chartH = H - pad.top - pad.bottom;

    // Сетка
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
        const y = pad.top + chartH * (1 - f);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#9ca3af'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText((maxV * f).toFixed(0), pad.left - 3, y + 3);
    });

    // Столбики выручки
    const points = [];
    keys.forEach((key, i) => {
        const x   = pad.left + i * ((W - pad.left - pad.right) / keys.length) + 2;
        const h   = maxV > 0 ? (revenueVals[i] / maxV) * chartH : 0;
        const y   = pad.top + chartH - h;
        ctx.fillStyle = `hsl(${210 + i*15}, 55%, 55%)`;
        ctx.fillRect(x, y, bW, h);
        points.push({ x: x + bW / 2, y: pad.top + chartH - (maxV > 0 ? (profitVals[i] / maxV) * chartH : 0) });
        // Подпись месяца
        ctx.fillStyle = '#6b7280'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
        const label = key.slice(5); // MM
        const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
        ctx.fillText(months[parseInt(label)-1] || label, x + bW/2, H - 4);
    });

    // Линия прибыли поверх столбиков
    if (points.length) {
        ctx.beginPath();
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 2;
        points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        // Точки на линии
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
            ctx.fillStyle = '#16a34a';
            ctx.fill();
        });
    }

    // Легенда графика
    ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = `hsl(210, 55%, 55%)`;
    ctx.fillRect(pad.left, 2, 8, 8);
    ctx.fillStyle = '#374151';
    ctx.fillText('Выручка', pad.left + 11, 9);
    ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad.left + 65, 6); ctx.lineTo(pad.left + 80, 6); ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.fillText('Прибыль', pad.left + 84, 9);
}

// --- Круговая диаграмма (без легенды на canvas) ---
function drawPieChart(filtered) {
    const canvas = document.getElementById('chartCanvas');
    const SIZE = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width  = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const totals = {};
    filtered.forEach(o => { totals[o.customer] = (totals[o.customer] || 0) + orderGrandTotal(o); });
    // Сортируем от большего к меньшему
    const sorted  = Object.entries(totals).sort((a,b) => b[1] - a[1]);
    const grandTotal = sorted.reduce((s,[,v]) => s+v, 0);
    if (!sorted.length || grandTotal === 0) {
        ctx.fillStyle = '#e5e7eb';
        ctx.beginPath(); ctx.arc(SIZE/2, SIZE/2, SIZE/2 - 10, 0, 2*Math.PI); ctx.fill();
        ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Нет данных', SIZE/2, SIZE/2 + 4);
        document.getElementById('chartLegend').innerHTML = '';
        return;
    }

    const colors = sorted.map((_,i) => `hsl(${i * 360 / sorted.length}, 60%, 52%)`);
    let startAngle = -Math.PI / 2;
    const cx = SIZE/2, cy = SIZE/2, r = SIZE/2 - 8;

    sorted.forEach(([,val], i) => {
        const angle = (val / grandTotal) * 2 * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + angle);
        ctx.fillStyle = colors[i]; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        startAngle += angle;
    });

    // Легенда отдельно под диаграммой, отсортирована от большего к меньшему
    let legend = '';
    sorted.forEach(([name, val], i) => {
        const pct = (val / grandTotal * 100).toFixed(1);
        legend += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f3f4f6;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[i]};flex-shrink:0;"></span>
            <span style="flex:1;font-size:11px;color:#374151;">${name}</span>
            <span style="font-size:11px;font-weight:600;color:#111827;">${val.toFixed(2)} €</span>
            <span style="font-size:10px;color:#6b7280;min-width:35px;text-align:right;">${pct}%</span>
        </div>`;
    });
    document.getElementById('chartLegend').innerHTML = legend;
}

// Оставляем drawChart как алиас для совместимости
function drawChart() { applyFilter(); }

// ==================== ВЫРУЧКА ПО ДНЯМ (свайп) ====================
// Линейный график на N дней (окно ~6 недель), не зависит от общих фильтров
// статистики наверху — у него своя независимая навигация по календарю.
// Свайп влево/вправо двигает окно на неделю; тап по точке — подсказка
// с датой/днём недели/суммой. Выходные (Сб/Вс) подсвечены фоном.

const DAILY_CHART_WINDOW_DAYS = 21; // 3 недели
const WEEKDAY_NAMES_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const WEEKDAY_NAMES_FULL  = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

let _dailyChartWindowEnd = null; // Date — последний (самый поздний) день видимого окна
let _dailyChartInitialized = false;
let _dailyChartCrosshairX = null; // canvas-локальная X координата текущей подсказки/линии (null — не показывать)

function isoDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
}

function initDailyRevenueChart() {
    if (!_dailyChartWindowEnd) {
        _dailyChartWindowEnd = new Date();
        _dailyChartWindowEnd.setHours(0,0,0,0);
    }
    drawDailyRevenueChart();

    if (_dailyChartInitialized) return; // обработчики свайпа/тапа вешаем один раз
    _dailyChartInitialized = true;

    const canvas = document.getElementById('dailyRevenueCanvas');
    if (!canvas) return;
    let dragStartX = null, dragStartY = null, dragStartWindowEnd = null;

    function localX(e) {
        const rect = canvas.getBoundingClientRect();
        return e.clientX - rect.left;
    }

    canvas.addEventListener('pointerdown', (e) => {
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartWindowEnd = new Date(_dailyChartWindowEnd);
        canvas.setPointerCapture(e.pointerId);
        _dailyChartCrosshairX = localX(e); // сразу показываем линию/подсказку в точке касания
        drawDailyRevenueChart();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (dragStartX === null) return;
        const dx = e.clientX - dragStartX;
        const dayWidthPx = canvas._dayStepX || 16;
        const deltaDays = Math.round(-dx / dayWidthPx); // тащим влево -> более поздние даты
        const today = new Date(); today.setHours(0,0,0,0);
        let candidate = new Date(dragStartWindowEnd);
        candidate.setDate(candidate.getDate() + deltaDays);
        if (candidate > today) candidate = today;
        if (candidate.getTime() !== _dailyChartWindowEnd.getTime()) {
            _dailyChartWindowEnd = candidate;
        }
        _dailyChartCrosshairX = localX(e); // линия/подсказка следуют за пальцем в реальном времени
        drawDailyRevenueChart();
    });
    canvas.addEventListener('pointerup', () => {
        dragStartX = null; dragStartY = null;
        // Линия и подсказка остаются на месте последнего касания — как в биржевых графиках
    });
    canvas.addEventListener('pointercancel', () => { dragStartX = null; dragStartY = null; });
}

function drawDailyRevenueChart() {
    const canvas = document.getElementById('dailyRevenueCanvas');
    if (!canvas || !_dailyChartWindowEnd) return;
    const W = canvas.offsetWidth || 360;
    const H = 140;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Собираем N дней, оканчивающихся на _dailyChartWindowEnd
    const days = [];
    for (let i = DAILY_CHART_WINDOW_DAYS - 1; i >= 0; i--) {
        const d = new Date(_dailyChartWindowEnd);
        d.setDate(d.getDate() - i);
        days.push(d);
    }
    const revenueByDate = {};
    orders.forEach(o => {
        if (!o.date) return;
        revenueByDate[o.date] = (revenueByDate[o.date] || 0) + orderGrandTotal(o);
    });
    const values = days.map(d => revenueByDate[isoDate(d)] || 0);
    const maxV = Math.max(...values, 0.01);

    const pad = { top: 10, bottom: 24, left: 38, right: 8 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const stepX = chartW / (days.length - 1);
    canvas._dayStepX = stepX;

    // Подпись диапазона дат над графиком
    const rangeLabel = `${formatDateDMY(isoDate(days[0]))} – ${formatDateDMY(isoDate(days[days.length-1]))}`;
    const rangeEl = document.getElementById('dailyChartRange');
    if (rangeEl) rangeEl.textContent = rangeLabel;

    // Фон выходных (Сб/Вс) — вертикальные полосы (более заметные) + цветная полоска снизу
    days.forEach((d, i) => {
        const dow = d.getDay(); // 0=Вс, 6=Сб
        if (dow === 0 || dow === 6) {
            const x = pad.left + i * stepX - stepX/2;
            ctx.fillStyle = 'rgba(99,102,241,0.13)';
            ctx.fillRect(x, pad.top, stepX, chartH);
            ctx.fillStyle = '#6366f1';
            ctx.fillRect(x, pad.top + chartH - 2, stepX, 2);
        }
    });

    // Сетка по Y
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(f => {
        const y = pad.top + chartH * (1 - f);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#9ca3af'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText((maxV * f).toFixed(0), pad.left - 4, y + 3);
    });

    // Буква дня недели под КАЖДОЙ точкой (Пн/Вт/.../Вс), выходные выделены цветом
    days.forEach((d, i) => {
        const x = pad.left + i * stepX;
        const dow = d.getDay();
        ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = (dow === 0 || dow === 6) ? '#6366f1' : '#9ca3af';
        ctx.fillText(WEEKDAY_NAMES_SHORT[dow], x, H - 3);
    });
    // Дата — только по понедельникам (опорные точки для ориентира по неделям)
    days.forEach((d, i) => {
        if (d.getDay() === 1) {
            const x = pad.left + i * stepX;
            ctx.fillStyle = '#6b7280'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(`${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`, x, H - 12);
        }
    });

    // Линия выручки
    const points = days.map((d, i) => ({
        x: pad.left + i * stepX,
        y: pad.top + chartH - (values[i] / maxV) * chartH,
        date: isoDate(d), value: values[i], dow: d.getDay()
    }));
    ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    ctx.stroke();

    // Точки
    points.forEach(p => {
        ctx.fillStyle = p.value > 0 ? '#4f46e5' : '#d1d5db';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2); ctx.fill();
    });

    canvas._dailyChartPoints = points; // сохраняем для определения ближайшей точки

    // Вертикальная линия-курсор + подсветка точки + подсказка — следуют за пальцем live
    const tooltip = document.getElementById('dailyChartTooltip');
    if (_dailyChartCrosshairX !== null && points.length) {
        let nearest = points[0], minDist = Infinity;
        points.forEach(p => {
            const dist = Math.abs(p.x - _dailyChartCrosshairX);
            if (dist < minDist) { minDist = dist; nearest = p; }
        });

        // Вертикальная пунктирная линия через всю высоту графика
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(nearest.x, pad.top);
        ctx.lineTo(nearest.x, pad.top + chartH);
        ctx.stroke();
        ctx.restore();

        // Увеличенная точка поверх линии — видно, какой день выбран
        ctx.fillStyle = '#4f46e5';
        ctx.beginPath(); ctx.arc(nearest.x, nearest.y, 4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'white';
        ctx.beginPath(); ctx.arc(nearest.x, nearest.y, 1.5, 0, Math.PI*2); ctx.fill();

        if (tooltip) {
            tooltip.textContent = `${WEEKDAY_NAMES_FULL[nearest.dow]}, ${formatDateDMY(nearest.date)} — ${nearest.value.toFixed(2)} €`;
            // Не даём подсказке вылезти за левый/правый край канваса
            const clampedX = Math.min(Math.max(nearest.x, 30), W - 30);
            tooltip.style.left = clampedX + 'px';
            tooltip.style.top = Math.max(0, nearest.y - 6) + 'px';
            tooltip.classList.remove('hidden');
        }
    } else if (tooltip) {
        tooltip.classList.add('hidden');
    }
}
