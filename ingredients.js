// ==================== ИНГРЕДИЕНТЫ ====================
// Справочник ингредиентов: название, цена за упаковку, размер упаковки, единица измерения.
// Цена за единицу считается автоматически.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), showLoading/hideLoading,
// logActivity (employees.js), svgEdit/svgDelete (helpers.js),
// openDeleteModal, closeModal (modals.js).

let ingredients = []; // [{id, name, package_price, package_size, unit}]

// UNIT_LABELS заменён общей функцией unitAbbrev(code) из inventory.js — единицы
// измерения переводятся под текущий язык через i18n.js вместо жёсткой русской карты.

function ingredientUnitPrice(ing) {
    if (!ing.package_size) return 0;
    return ing.package_price / ing.package_size;
}

// Возвращает CSS-класс цвета по количеству дней запаса
// Красный < 3 дней, жёлтый 3-7 дней, серый > 7 дней
function stockColorClass(daysLeft, prefix) {
    if (daysLeft === null) return 'text-gray-400';
    if (daysLeft < 3)  return 'stock-critical';
    if (daysLeft < 7)  return 'stock-low';
    return 'stock-ok';
}

// Уровень критичности ингредиента: 0 — критично (терракота), 1 — заканчивается
// (охра), 2 — норма. Та же логика, что и раскраска полоски/цифры "Хватит" в
// таблице/карточках — вынесена отдельно, чтобы сортировка списка (см. ниже)
// использовала ровно те же условия, а не рисковала разойтись с окраской.
// «Склад» — справочник (21.10): прогноза нет, наверх — только минус или ноль.
function ingredientSeverity(ing, ctx) {
    const f = stockFullInfo('ing', ing, ctx, stockTrackedIds());
    if (f.on) return f.zone === 'critical' ? 0 : (f.attention ? 1 : 2);
    const after = stockState('ing', ing.id, ctx).after;
    return after !== null && after <= 0 ? 0 : 2;
}

function displayIngredients() {
    // Общий расчёт склада (inventory.js stockState, 21.10)
    const ctx = stockStateContext(stockUi.period);

    // Сортировка: сначала критичные (терракота), потом заканчивающиеся (охра),
    // потом остальные — внутри каждой группы по алфавиту.
    ingredients.sort((a, b) => {
        const sevDiff = ingredientSeverity(a, ctx) - ingredientSeverity(b, ctx);
        return sevDiff !== 0 ? sevDiff : (a.name||"").localeCompare(b.name||"");
    });

    renderIngredientCards();
    filterIngredientsList();
}

// Прогноз «хватит на N дней» — только на тарифе с аналитикой (Full).
// На бесплатном тарифе прогноз не считается вовсе: не влияет ни на цвет
// полосы и значения «После списания», ни на сортировку. Остаются только
// факты: нехватка под заказы, нулевой/минусовой остаток (и рецепт у ПФ).
function stockForecastOn() {
    return typeof hasPlanFeature === 'function' && hasPlanFeature('cost_analytics');
}

// Разделители групп на Складе (16.10): «Требует внимания» (красные/жёлтые карточки,
// у полуфабрикатов — и неподтверждённый рецепт) и «Всё в порядке». Показываются для каждой непустой группы (даже если группа одна);
// при поиске прячутся (filter*List). Стиль — как в «Заказах».
function stockGroupsHtml(attn, ok) {
    // Заголовок группы показываем всегда, когда в ней есть карточки (28.10: даже если группа одна); пустую группу — нет.
    if (!attn.length && !ok.length) return '';
    const div = (label, svg) => `<div class="oc-section-divider stock-divider"><span class="label">${svg}${label}</span></div>`;
    return (attn.length ? div(t('stock_group_attention'), '<svg viewBox="0 0 24 24" fill="none" stroke="#c0685c" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>') + attn.join('') : '')
        + (ok.length ? div(t('stock_group_ok'), '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>') + ok.join('') : '');
}

// Скрыть/показать разделители групп (при поиске — скрыты)
function toggleStockDividers(bodyId, hide) {
    document.querySelectorAll('#' + bodyId + ' .stock-divider').forEach(d => { d.style.display = hide ? 'none' : ''; });
}

// Цена на карточке склада: 2 знака после запятой. Для г и мл пересчитываем
// в цену за кг / л (цена за 1 г вроде 0.0040 € при 2 знаках стала бы 0.00).
function stockPriceText(unitPrice, unit) {
    let price = Number(unitPrice) || 0, u = unit;
    if (unit === 'g')  { price *= 1000; u = 'kg'; }
    if (unit === 'ml') { price *= 1000; u = 'l'; }
    return `${formatMoney(price, 2)}/${unitAbbrev(u)}`;
}

// Общая разметка серой плашки с ячейками "Сейчас / После списания / Хватит на"
// (используется и в ингредиентах, и в полуфабрикатах). Третья ячейка
// показывается только если для неё есть текст (на бесплатном тарифе — только
// при нехватке).
function stockCardCellsHtml(o) {
    const cell = (label, val, color, first) =>
        `<div class="oc-cell${first ? '' : ' oc-cell-sep'}"><div class="oc-cell-lbl">${label}</div><div class="oc-cell-val" style="color:${color};">${val}</div></div>`;
    // o.priceText — ячейка цены первой (карточки «Склада», 22.10); в «Умном складе» не передаётся
    return `<div class="oc-cells">`
        + (o.priceText ? cell(o.priceLabel, o.priceText, '#3c3a34', true) : '')
        + cell(t('ing_cell_now'), o.beforeText, '#3c3a34', !o.priceText)
        + cell(t('ing_cell_after'), o.afterText, o.afterColor, false)
        + (o.thirdText ? cell(o.thirdLabel, o.thirdText, o.thirdColor, false) : '')
        + `</div>`;
}

// ---- Вид списка Склада: карточки / плитки (запоминается на устройстве, отдельно для ингредиентов и полуфабрикатов) ----
function stockViewMode(kind) {
    try { return localStorage.getItem('sb_' + kind + '_view') === 'cards' ? 'cards' : 'tiles'; } catch (e) { return 'tiles'; }
}
function setStockViewMode(kind, mode) {
    try { localStorage.setItem('sb_' + kind + '_view', mode === 'tiles' ? 'tiles' : 'cards'); } catch (e) {}
    if (kind === 'ing') { renderIngredientCards(); filterIngredientsList(); }
    else { renderSemiFinishedCards(); filterSemiFinishedList(); }
}
function stockViewSync(kind) {
    const m = stockViewMode(kind);
    const pre = kind === 'ing' ? 'ingredientsViewBtn' : 'semiFinishedViewBtn';
    document.getElementById(pre + 'Cards')?.classList.toggle('active', m === 'cards');
    document.getElementById(pre + 'Tiles')?.classList.toggle('active', m === 'tiles');
}
// Плитка: остаток «после списания» крупно, название, цена мелко внизу; красный уголок «!» — требует внимания
// Full: «хватит на N дн.» меткой в углу плитки (цвет — зона «Умного склада»); без прогноза или на Light — метки нет
function stockDaysChip(st) {
    if (typeof hasPlanFeature === 'function' && !hasPlanFeature('cost_analytics')) return null;
    if (!st || st.daysLeft === null || st.daysLeft === undefined) return null;
    return { cls: st.zone === 'critical' ? 'bad' : st.zone === 'warning' ? 'warn' : 'ok', text: `${st.daysLeft} ${t('inv_days_short')}` };
}
// Карточка Склада (Full): развёрнутая капсула «Хватит на N дн.» справа в строке названия
function stockCardChipHtml(st) {
    const c = stockDaysChip(st);
    return c ? `<span class="stk-chip ${c.cls}">${t('ing_cell_lasts')} ${st.daysLeft} ${t('inv_days_short')}</span>` : '';
}
function stockTileHtml(o) {
    const num = o.numText;
    const full = (typeof hasPlanFeature !== 'function') || hasPlanFeature('cost_analytics');
    const cls = 'pt-tile stt-tile' + (full ? ' stt-full' : '') + (num.length > 8 ? ' stt-sm' : '');
    return `<div class="${cls}" data-name="${escapeHtml((o.name || '').toLowerCase())}" data-critical="${o.attn ? '1' : '0'}" data-low="${o.red ? '1' : '0'}" onclick="${o.openCall}">
        ${full ? `<div class="stt-row">${o.chip ? `<span class="stt-chip ${o.chip.cls}">${o.chip.text}</span>` : ''}</div>` : ''}
        <div class="stt-name">${escapeHtml(o.name || t('semifinished_no_name_fallback'))}</div>
        <div class="stt-big" style="color:${o.red ? '#c0685c' : '#322f28'};">${num}${o.unit ? `<small>${escapeHtml(o.unit)}</small>` : ''}</div>
        ${o.priceText ? `<div class="stt-price">${o.priceText}</div>` : ''}
        ${o.attn ? '<span class="pt-flag"></span>' : ''}
    </div>`;
}

// ---- «Склад» Full: аналитика «Умного склада» для ОТСЛЕЖИВАЕМЫХ позиций (30.10) ----
// Фильтр «Все | Требует внимания» и период 7/30/90 — для вкладок «Ингредиенты» и «Полуфабрикаты».
const stockUi = { ing: 'all', sf: 'all', period: 30 };
function stockTrackedIds() {
    return (typeof smartStockItemIds === 'function') ? smartStockItemIds() : { sf: new Set(), ing: new Set() };
}
// Сводка по позиции для Full: on — аналитика включена (Full + позиция отслеживается).
function stockFullInfo(kind, item, ctx, tracked) {
    const off = { on: false };
    if (!stockForecastOn() || !tracked || !(kind === 'sf' ? tracked.sf : tracked.ing).has(item.id)) return off;
    const ro = stockRunout(kind, item.id, ctx);
    const st = ro.st;
    const batchShort = kind === 'sf' ? sfBatchShortNames(item, ctx) : [];
    const zone = st.zone;
    const attention = zone !== 'ok' || batchShort.length > 0;
    let chip = null;
    if (ro.firstShort) chip = { cls: 'bad', text: `${t('inv_short_since_cell')} ${_invDM(ro.firstShort.order.date)}` };
    else if (ro.forecastDate) chip = { cls: zone === 'critical' ? 'bad' : zone === 'warning' ? 'warn' : 'ok', text: `${t('inv_stock_until')} ≈ ${_invDM(ro.forecastDate)}`, tile: `≈ ${_invDM(ro.forecastDate)}` };
    if (chip && !chip.tile) chip.tile = `${t('inv_since_prefix')} ${_invDM(ro.firstShort.order.date)}`;
    return { on: true, ro, st, batchShort, zone, attention, chip };
}
// Строки под ячейками карточки: «Под заказы X · За N дн. Y», красная «Не хватит с …», «На новую партию не хватит: …»
function stockFullExtraHtml(f, unit) {
    if (!f.on) return '';
    const usedLbl = t('inv_used_for_days').replace('{n}', stockUi.period);
    let h = `<div class="inv-an"><span>${t('inv_reserved_chip')} ${_invFmt(f.st.reserved)} ${unit}</span><span>${usedLbl} ${_invFmt(f.st.usedInPeriod)} ${unit}</span></div>`;
    h += stockShortLineHtml(f.ro, unit);
    if (f.batchShort.length) h += `<div class="inv-batch-warn">${INV_WARN_ICON}<span>${t('inv_sf_batch_short')} ${f.batchShort.map(escapeHtml).join(', ')}</span></div>`;
    return h;
}
function stockFullChipHtml(f) {
    return f.on && f.chip ? `<span class="stk-chip ${f.chip.cls}">${f.chip.text}</span>` : '';
}
// Панель «Все | Требует внимания» + «7 | 30 | 90» (только Full)
function renderStockFilterBar(kind) {
    const el = document.getElementById(kind === 'ing' ? 'ingredientsFilterBar' : 'semiFinishedFilterBar');
    if (!el) return;
    if (!stockForecastOn()) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    const f = stockUi[kind];
    el.classList.remove('hidden');
    el.innerHTML = `<div class="fp"><button type="button" class="${f === 'all' ? 'active' : ''}" onclick="setStockFilter('${kind}','all')">${t('common_all')}</button><button type="button" class="${f === 'attn' ? 'active' : ''}" onclick="setStockFilter('${kind}','attn')">${t('stock_group_attention')}</button></div>`
        + `<div class="fp">${[7, 30, 90].map(d => `<button type="button" class="${d === stockUi.period ? 'active' : ''}" onclick="setStockPeriod(${d})">${d}</button>`).join('')}</div>`;
}
function setStockFilter(kind, v) {
    stockUi[kind] = v === 'attn' ? 'attn' : 'all';
    if (kind === 'ing') { renderIngredientCards(); filterIngredientsList(); } else { renderSemiFinishedCards(); filterSemiFinishedList(); }
}
function setStockPeriod(d) {
    stockUi.period = [7, 30, 90].includes(Number(d)) ? Number(d) : 30;
    if (typeof displayIngredients === 'function') displayIngredients();
    if (typeof displaySemiFinished === 'function') displaySemiFinished();
}

// ---- Карточный вид (тот же принцип, что у изделий/клиентов) ----
function renderIngredientCards() {
    const body = document.getElementById('ingredientCardsBody');
    if (!body) return;

    const ctx = stockStateContext(stockUi.period); // общий расчёт склада (inventory.js stockState, 21.10)
    const tracked = stockTrackedIds();
    renderStockFilterBar('ing');
    const attnOnly = stockForecastOn() && stockUi.ing === 'attn';
    const tiles = stockViewMode('ing') === 'tiles';
    stockViewSync('ing');
    body.classList.toggle('stock-grid', tiles);

    const htmlAttn = [], htmlOk = [];
    ingredients.forEach((ing, realIdx) => {
        const unitPrice = ingredientUnitPrice(ing);
        const unitLabel = unitAbbrev(ing.unit);
        const st        = stockState('ing', ing.id, ctx);
        const balanceBefore = st.now;
        const balance   = st.after;
        const daysLeft  = st.daysLeft;
        const shortfall = st.shortage;

        // «Склад» — справочник (21.10): без прогноза; наверх и красным — только минус или ноль.
        const fi = stockFullInfo('ing', ing, ctx, tracked); // Full + отслеживается: аналитика «Умного склада»
        const isCritical = fi.on ? fi.zone === 'critical' : (balance !== null && balance <= 0);
        const isWarning = fi.on && fi.zone === 'warning';
        const accentColor = isCritical ? '#c0685c' : fi.on && fi.attention ? (isWarning ? '#d9a441' : '#c0685c') : (!fi.on && balance !== null && balance <= 0 ? '#c0685c' : '');
        const isAttn = fi.on ? fi.attention : !!accentColor;
        const afterColor = isCritical ? '#c0685c' : isWarning ? '#96712a' : '#4f6349';
        const thirdLabel = '';
        const thirdText = '';
        const beforeText = balanceBefore !== null ? `${Number(balanceBefore).toFixed(1)} ${unitLabel}` : '—';
        const afterText = balance !== null ? `${Number(balance).toFixed(1)} ${unitLabel}` : '—';
        const priceText = stockPriceText(unitPrice, ing.unit);
        const stripe = accentColor ? `<div class="stripe" style="background:${accentColor};"></div>` : '';
        if (attnOnly && !isAttn) return;

        if (tiles) {
            const tChip = fi.on ? (fi.chip ? { cls: fi.chip.cls, text: fi.chip.tile } : null) : null;
            (isAttn ? htmlAttn : htmlOk).push(stockTileHtml({ name: ing.name, attn: isAttn, red: isCritical, numText: balance !== null ? Number(balance).toFixed(1) : '—', unit: balance !== null ? unitLabel : '', priceText, chip: tChip, openCall: `openIngredientDetail(${ing.id})` }));
            return;
        }
        (isAttn ? htmlAttn : htmlOk).push(`
        <div class="oc-swipe-wrap" data-name="${escapeHtml((ing.name || '').toLowerCase())}" data-critical="${isAttn ? '1' : '0'}" data-low="${isCritical ? '1' : '0'}" style="--oc-swipe-x:-72px;">
            ${refCopySwipeBtnHtml(`quickCopyIngredientFromSwipe(${realIdx})`)}
            <div class="order-card" style="cursor:pointer;" onclick="openIngredientDetail(${ing.id})">
                ${stripe}
                <div class="order-card-body">
                    <div class="oc-row">
                        <span class="oc-name">${escapeHtml(ing.name || t('semifinished_no_name_fallback'))}</span>
                        ${stockFullChipHtml(fi)}
                    </div>
                    ${stockCardCellsHtml({ priceLabel: t('ing_price_per_unit'), priceText, beforeText, afterText, afterColor, thirdLabel: thirdLabel, thirdText: thirdText, thirdColor: afterColor })}
                    ${stockFullExtraHtml(fi, unitLabel)}
                </div>
            </div>
        </div>`);
    });
    body.innerHTML = stockGroupsHtml(htmlAttn, htmlOk);
    initCopySwipeDelegation('ingredientCardsBody');
    if (typeof updateStockDots === 'function') updateStockDots();
}

function quickCopyIngredientFromSwipe(realIdx) {
    if (typeof closeAllCardSwipes === 'function') closeAllCardSwipes();
    copyIngredient(realIdx);
}

// ---- Поиск по названию — работает одинаково в обоих видах ----
// Фильтр «критичный остаток» ставит только Dashboard (dashboard.js); сбрасывается крестиком или обычным заходом на вкладку
let stockLowOnlyIng = false;
function clearIngredientsDashFilter() { stockLowOnlyIng = false; filterIngredientsList(); }
function filterIngredientsList() {
    const input = document.getElementById('ingredientSearchInput');
    const q = input ? input.value.trim().toLowerCase() : '';
    document.getElementById('ingredientSearchClear')?.classList.toggle('hidden', !q);
    document.getElementById('ingredientSearchIcon')?.classList.toggle('hidden', !!q);

    let visibleCards = 0;
    document.querySelectorAll('#ingredientCardsBody .oc-swipe-wrap, #ingredientCardsBody .stt-tile').forEach(wrap => {
        const match = (!q || wrap.dataset.name.includes(q)) && (!stockLowOnlyIng || wrap.dataset.low === '1');
        wrap.style.display = match ? '' : 'none';
        if (match) visibleCards++;
    });
    document.getElementById('ingredientCardsEmpty')?.classList.toggle('hidden', visibleCards !== 0);
    document.getElementById('ingredientsDashFilter')?.classList.toggle('hidden', !stockLowOnlyIng);
    toggleStockDividers('ingredientCardsBody', !!q || stockLowOnlyIng);

}

function clearIngredientSearch() {
    const input = document.getElementById('ingredientSearchInput');
    if (input) input.value = '';
    filterIngredientsList();
}

// Кнопка "+": попап для создания нового ингредиента
// Кнопка "+": сразу создаёт черновик ингредиента и открывает его карточку
let _draftIngredientIds = new Set();

// Флаг: карточка открыта для нового ингредиента (ещё не сохранён в БД)
let _isNewIngredient = false;

async function createDraftIngredientAndOpen() {
    // Если карточка уже открыта — закрываем без сохранения черновика
    if (currentIngredientId !== null) {
        const leavingId = currentIngredientId;
        currentIngredientId = null;
        await cleanupIngredientDraftIfEmpty(leavingId);
    }

    // Открываем пустую карточку локально — без записи в БД
    _isNewIngredient = true;

    document.getElementById('ingredientsList').classList.add('hidden');
    document.getElementById('ingredientDetail').classList.add('active');
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('ingredientsSearchBar', 'ingredientsList', 'ingredientDetail');

    const nameInput = document.getElementById('idNameInput');
    const unitInput = document.getElementById('idUnitInput');
    if (nameInput) nameInput.value = '';
    if (unitInput) unitInput.value = 'g';
    const titleEl = document.getElementById('idTitle');
    if (titleEl) titleEl.textContent = t('ing_new_title');

    // Сбрасываем поля склада
    calSetFieldValue('idNewPriceDate', 'idNewPriceDateBtnLabel', getLocalDateStr(0));
    document.getElementById('idPackagePrice').value = '0.00';
    document.getElementById('idPackageSize').value = '1';
    document.getElementById('idStockQty').value = '';

    // Показываем кнопку Сохранить, скрываем кнопку удаления
    const saveBtn = document.getElementById('idSaveNewBtn');
    if (saveBtn) saveBtn.classList.remove('hidden');
    const delBtn = document.querySelector('#ingredientDetail button[onclick="deleteCurrentIngredient()"]');
    if (delBtn) delBtn.classList.add('hidden');

    // Скрываем блок склада — нечего показывать до сохранения
    const stockBlock = document.getElementById('ingStockBlock');
    if (stockBlock) stockBlock.classList.add('hidden');

    // Скрываем графики/историю — тоже нечего показывать до первого сохранения
    const chartBlock = document.getElementById('ingPriceChartBlock');
    if (chartBlock) chartBlock.classList.add('hidden');
    const histBlock = document.getElementById('ingPriceHistoryBlock');
    if (histBlock) histBlock.classList.add('hidden');

    // Очищаем историю движений
    const histEl = document.getElementById('ingStockHistory');
    if (histEl) histEl.innerHTML = '';

    currentIngredientId = null;
    refreshFab();
}

async function saveNewIngredient() {
    const name = (document.getElementById('idNameInput')?.value || '').trim();
    const unit = document.getElementById('idUnitInput')?.value || 'g';
    if (!name) { showInfo(t('ing_name_required')); return; }

    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('ingredients').insert({
            org_id: currentOrgId, name, package_price: 0, package_size: 1, unit
        }).select().single();
        if (error) throw error;

        const newIng = { id: data.id, name, package_price: 0, package_size: 1, unit, priceHistory: [] };
        ingredients.push(newIng);
        _isNewIngredient = false;

        // Скрываем кнопку Сохранить, показываем удаление
        const saveBtn = document.getElementById('idSaveNewBtn');
        if (saveBtn) saveBtn.classList.add('hidden');
        const delBtn = document.querySelector('#ingredientDetail button[onclick="deleteCurrentIngredient()"]');
        if (delBtn) delBtn.classList.toggle('hidden', !hasPermission('can_delete'));
        const stockBlock = document.getElementById('ingStockBlock');
        if (stockBlock) stockBlock.classList.remove('hidden');

        displayIngredients();
        openIngredientDetail(newIng.id);
        logActivity('ingredient', `${t('log_ingredient_created')}: «${name}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// Копирует ингредиент (название/цена упаковки/размер упаковки/единица измерения —
// без истории цен, она начинается заново для копии) и сразу открывает карточку
// копии для донастройки. По тому же принципу, что и copyProduct() в products.js.
async function copyIngredient(i) {
    const src = ingredients[i];
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('ingredients').insert({
            org_id: currentOrgId, name: src.name + t('common_copy_suffix'),
            package_price: src.package_price || 0, package_size: src.package_size || 1, unit: src.unit || 'g'
        }).select().single();
        if (error) throw error;
        const newIng = {
            id: data.id, name: data.name,
            package_price: Number(data.package_price || 0), package_size: Number(data.package_size || 1),
            unit: data.unit || 'g', priceHistory: []
        };
        ingredients.push(newIng);
        displayIngredients();
        openIngredientDetail(newIng.id);
        logActivity('ingredient', `${t('log_ingredient_copied')} «${src.name}» → «${newIng.name}»`);
    } catch (e) { console.error(e); showInfo(t('ing_copy_error')); }
    finally { hideLoading(); }
}

async function cleanupIngredientDraftIfEmpty(ingId) {
    if (!_draftIngredientIds.has(ingId)) return;
    _draftIngredientIds.delete(ingId);
    const idx = ingredients.findIndex(i => i.id === ingId);
    if (idx === -1) return;
    if (ingredients[idx].name && ingredients[idx].name.trim()) return; // название вписали — уже не пустой черновик
    try {
        suppressRealtimeFor3s();
        await dbMust(db.from('ingredients').delete().eq('id', ingId));
        ingredients.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик ингредиента:', e); }
}

// ==================== КАРТОЧКА ИНГРЕДИЕНТА ====================
async function openIngredientDetail(ingId) {
    currentIngredientId = ingId;
    const ing = ingredients.find(i => i.id === ingId);
    if (!ing) return;

    document.getElementById('ingredientsList').classList.add('hidden');
    document.getElementById('ingredientDetail').classList.add('active');
    document.getElementById('ingredientDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('ingredientDetail').classList.remove('fade-in'), 300);
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('ingredientsSearchBar', 'ingredientsList', 'ingredientDetail');

    // Сворачиваем блок партий (мог остаться развёрнут от предыдущей карточки)
    const batchesList = document.getElementById('ingBatchesList');
    if (batchesList) batchesList.classList.add('hidden');
    const batchesChevron = document.getElementById('ingBatchesChevron');
    if (batchesChevron) batchesChevron.style.transform = '';
    const batchesLabel = document.getElementById('ingBatchesToggleLabel');
    if (batchesLabel) batchesLabel.textContent = t('ing_batches');

    // Сворачиваем блок динамики цены (мог остаться развёрнут от предыдущей карточки)
    const priceContent = document.getElementById('ingPriceContent');
    if (priceContent) priceContent.classList.add('hidden');
    const priceChevron = document.getElementById('ingPriceChevron');
    if (priceChevron) priceChevron.style.transform = '';


    // Заголовок карточки — inline поля
    const nameInput = document.getElementById('idNameInput');
    const unitInput = document.getElementById('idUnitInput');
    if (nameInput) { nameInput.value = ing.name; }
    if (unitInput) { unitInput.value = ing.unit || 'g'; }
    const titleEl = document.getElementById('idTitle');
    if (titleEl) titleEl.textContent = ing.name || '';
    document.getElementById('ingHistSection')?.classList.remove('open'); // история свёрнута
    // Фокус на поле названия если это новый черновик
    calSetFieldValue('idNewPriceDate', 'idNewPriceDateBtnLabel', getLocalDateStr(0));
    document.getElementById('idPackagePrice').value = ing.package_price.toFixed(2);
    document.getElementById('idPackageSize').value = ing.package_size;
    document.getElementById('idStockQty').value = '';
    const qtyUnitEl = document.getElementById('ingQtyUnit');
    if (qtyUnitEl) qtyUnitEl.textContent = unitAbbrev(ing.unit);
    renderIngredientUnitPrice(ing);
    // Загружаем историю цен для расчёта стоимости в истории движений
    const { data: ph } = await db.from('ingredient_price_history')
        .select('valid_from, package_price, package_size')
        .eq('ingredient_id', ing.id)
        .order('valid_from', { ascending: true });
    ing.priceHistory = ph || [];
    renderIngredientStockBlock(ing);
    refreshFab();
}

// Обновляет превью цены за единицу при изменении полей новой цены
function renderIngredientUnitPricePreview() {
    const price = parseFloat(document.getElementById('idPackagePrice').value) || 0;
    const size = parseFloat(document.getElementById('idPackageSize').value) || 0;
    const ing = ingredients.find(i => i.id === currentIngredientId);
    const unit = ing ? ing.unit : 'g';
    const unitLabel = unitAbbrev(unit);
    const unitPrice = size > 0 ? (price / size).toFixed(4) : '0.0000';
    const el = document.getElementById('idUnitPricePreview');
    if (el) el.textContent = `${formatMoney(unitPrice, 4)}/${unitLabel}`;
}

// Сохраняет пополнение склада и при необходимости обновляет цену.
// Вызывается из объединённого блока «Склад» в карточке ингредиента.
async function saveStockAndPrice() {
    suppressRealtimeFor3s();
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const packagePrice = parseFloat(document.getElementById('idPackagePrice').value);
    const packageSize  = parseFloat(document.getElementById('idPackageSize').value);
    const validFrom    = document.getElementById('idNewPriceDate').value;
    const stockQty     = parseFloat(document.getElementById('idStockQty').value) || 0;

    if (!validFrom || isNaN(packagePrice) || isNaN(packageSize) || packageSize <= 0) {
        showInfo(t('ing_fill_date_price_size')); return;
    }

    showLoading();
    try {
        // Обновляем текущую цену в таблице ingredients
        const { error } = await db.from('ingredients').update({
            package_price: parseFloat(packagePrice.toFixed(2)),
            package_size: packageSize
        }).eq('id', ing.id);
        if (error) throw error;
        ing.package_price = parseFloat(packagePrice.toFixed(2));
        ing.package_size  = packageSize;

        // Добавляем или обновляем запись в истории цен
        const { data: existingArr } = await db.from('ingredient_price_history')
            .select('id').eq('ingredient_id', ing.id).eq('valid_from', validFrom).limit(1);
        const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null;
        if (existing) {
            await dbMust(db.from('ingredient_price_history')
                .update({ package_price: parseFloat(packagePrice.toFixed(2)), package_size: packageSize })
                .eq('id', existing.id));
        } else {
            await dbMust(db.from('ingredient_price_history').insert({
                org_id: currentOrgId,
                ingredient_id: ing.id,
                package_price: parseFloat(packagePrice.toFixed(2)),
                package_size:  packageSize,
                valid_from:    validFrom
            }));
        }

        // Если указано количество — добавляем приход на склад и создаём партию (FIFO)
        // атомарно (rpc_receive_stock) — раньше это были два отдельных запроса,
        // которые теоретически могли разойтись при сбое между ними.
        if (stockQty > 0) {
            const unitPrice = packageSize > 0 ? packagePrice / packageSize : 0;
            const { error: rpcError } = await db.rpc('rpc_receive_stock', {
                p_org_id: currentOrgId,
                p_item_type: 'ingredient',
                p_item_id: ing.id,
                p_unit_price: unitPrice,
                p_qty: parseFloat(stockQty.toFixed(4)),
                p_source: 'приход',
                p_notes: `${t('ing_purchase_note')} ${validFrom}`
            });
            if (rpcError) throw rpcError;
            await loadInventory();
        }

        renderIngredientUnitPrice(ing);
        await refreshIngredientPriceIfExpanded(ing.id);
        await renderIngredientStockBlock(ing);
        displayIngredients();
        logActivity('ingredient', `${t('log_stock_price_updated')}: «${ing.name}»${stockQty > 0 ? ` +${stockQty}` : ''}`);
        document.getElementById('idStockQty').value = '';
        closeModal(); // окно «Приход» (21.10); карточка остаётся открытой
    } catch (e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// ── Редактирование названия и единицы ингредиента ───────────────────────────

function openEditIngredientHeaderModal() {
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    document.getElementById('editIngName').value = ing.name;
    document.getElementById('editIngUnit').value = ing.unit;
    document.getElementById('editIngredientHeaderModal').style.display = 'flex';
}

async function saveIngredientHeader() {
    if (_isNewIngredient) return; // новый ингредиент — сохраняем только через кнопку
    suppressRealtimeFor3s();
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const nameInput = document.getElementById('idNameInput');
    const unitInput = document.getElementById('idUnitInput');
    const name = nameInput ? nameInput.value.trim() : ing.name;
    const unit = unitInput ? unitInput.value : ing.unit;
    if (!name) return; // Пустое название — не сохраняем (пользователь ещё печатает)
    if (name === ing.name && unit === ing.unit) return; // Ничего не изменилось
    try {
        const { error } = await db.from('ingredients').update({ name, unit }).eq('id', ing.id);
        if (error) throw error;
        ing.name = name;
        ing.unit = unit;
        displayIngredients();
        logActivity('ingredient', `${t('log_ingredient_updated')}: «${name}»`);
    } catch(e) { console.error(e); showInfo(t('error_save_generic')); }
}



// ── Ручное списание ──────────────────────────────────────────────────────────

function openWriteOffModal() {
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const unitLabel = unitAbbrev(ing.unit);
    document.getElementById('writeOffIngName').textContent = `${t('ing_ingredient_word')}: ${ing.name}`;
    document.getElementById('writeOffUnit').textContent = unitLabel;
    document.getElementById('writeOffQty').value = '';
    document.getElementById('writeOffReason').value = '';
    document.getElementById('writeOffNote').value = '';
    document.getElementById('writeOffNote').classList.add('hidden');
    document.getElementById('writeOffModal').style.display = 'flex';
}

// Показываем поле «Другое» если выбрано
document.addEventListener('change', e => {
    if (e.target.id === 'writeOffReason') {
        const noteEl = document.getElementById('writeOffNote');
        if (noteEl) noteEl.classList.toggle('hidden', e.target.value !== 'Другое');
    }
});

async function saveWriteOff() {
    suppressRealtimeFor3s();
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const qty    = parseFloat(document.getElementById('writeOffQty').value);
    const reason = document.getElementById('writeOffReason').value;
    const note   = document.getElementById('writeOffNote').value.trim();
    if (isNaN(qty) || qty <= 0) { showInfo(t('inv_enter_valid_qty')); return; }

    // Причина хранится в базе на русском (значение <option>), но пользователю
    // показываем переведённую подпись — та же карта ключей, что и в самой форме.
    const reasonLabelKeys = { 'Испортилось': 'ing_reason_spoiled', 'Личное использование': 'ing_reason_personal', 'Пересчёт остатков': 'ing_reason_recount', 'Другое': 'ing_reason_other' };
    const reasonDisplay = reasonLabelKeys[reason] ? t(reasonLabelKeys[reason]) : reason;
    const notes = reason === 'Другое' ? `${t('ing_adjustment_note')}: ${note || t('ing_other_lowercase')}` : `${t('ing_adjustment_note')}: ${reasonDisplay || t('ing_no_reason')}`;

    showLoading();
    try {
        const shortagePrice = ingredientUnitPrice(ing);
        const { error: rpcError } = await db.rpc('rpc_write_off_stock', {
            p_org_id: currentOrgId,
            p_item_type: 'ingredient',
            p_item_id: ing.id,
            p_qty: qty,
            p_shortage_price: shortagePrice,
            p_notes: notes
        });
        if (rpcError) throw rpcError;
        await loadInventory();
        closeModal();
        await renderIngredientStockBlock(ing);
        displayIngredients();
        logActivity('inventory', `${t('log_writeoff')}: «${ing.name}» -${qty} (${notes})`);
    } catch (e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}
async function saveIdNewPrice() {
    suppressRealtimeFor3s();
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const packagePrice = parseFloat(document.getElementById('idPackagePrice').value);
    const packageSize  = parseFloat(document.getElementById('idPackageSize').value);
    const validFrom    = document.getElementById('idNewPriceDate').value;
    if (!validFrom || isNaN(packagePrice) || isNaN(packageSize) || packageSize <= 0) {
        showInfo(t('common_fill_correctly')); return;
    }
    showLoading();
    try {
        // Обновляем текущую цену в таблице ingredients
        const { error } = await db.from('ingredients').update({
            package_price: parseFloat(packagePrice.toFixed(2)),
            package_size: packageSize
        }).eq('id', ing.id);
        if (error) throw error;
        ing.package_price = parseFloat(packagePrice.toFixed(2));
        ing.package_size = packageSize;

        // Добавляем или обновляем запись в истории цен
        const { data: existingArr } = await db.from('ingredient_price_history')
            .select('id').eq('ingredient_id', ing.id).eq('valid_from', validFrom).limit(1);
        const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null;
        if (existing) {
            await dbMust(db.from('ingredient_price_history')
                .update({ package_price: parseFloat(packagePrice.toFixed(2)), package_size: packageSize })
                .eq('id', existing.id));
        } else {
            await dbMust(db.from('ingredient_price_history').insert({
                org_id: currentOrgId,
                ingredient_id: ing.id,
                package_price: parseFloat(packagePrice.toFixed(2)),
                package_size: packageSize,
                valid_from: validFrom
            }));
        }
        // Обновляем локальный объект — чтобы список сразу показывал новую цену
        ing.package_price = parseFloat(packagePrice.toFixed(2));
        ing.package_size  = packageSize;
        renderIngredientUnitPrice(ing);
        await refreshIngredientPriceIfExpanded(ing.id);
        displayIngredients(); // обновляем список
        logActivity('ingredient', `${t('log_price_updated')} «${ing.name}» ${t('log_from_date')} ${validFrom}`);
        await showInfo(t('ingredient_price_saved'));
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

async function closeIngredientDetail() {
    const leavingId = currentIngredientId;
    currentIngredientId = null;
    _isNewIngredient = false;
    document.getElementById('ingredientsList').classList.remove('hidden');
    document.getElementById('ingredientDetail').classList.remove('active');
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('ingredientsSearchBar', 'ingredientsList', 'ingredientDetail');
    // Показываем кнопку удаления на случай если была скрыта — но только если есть право
    const delBtn = document.querySelector('#ingredientDetail button[onclick="deleteCurrentIngredient()"]');
    if (delBtn) delBtn.classList.toggle('hidden', !hasPermission('can_delete'));
    const saveBtn = document.getElementById('idSaveNewBtn');
    if (saveBtn) saveBtn.classList.add('hidden');
    const stockBlock = document.getElementById('ingStockBlock');
    if (stockBlock) stockBlock.classList.remove('hidden');
    const chartBlock = document.getElementById('ingPriceChartBlock');
    if (chartBlock) chartBlock.classList.remove('hidden');
    const histBlock = document.getElementById('ingPriceHistoryBlock');
    if (histBlock) histBlock.classList.remove('hidden');
    if (leavingId !== null) await cleanupIngredientDraftIfEmpty(leavingId);
    displayIngredients();
    refreshFab();
    // Карточку открыли из «Умного склада» — возвращаемся туда (inventory.js, 21.10)
    if (typeof smartStockReturnPending === 'function' && smartStockReturnPending()) await returnToSmartStock();
}

function renderIngredientUnitPrice(ing) {
    // Ячейка «Цена за ед.» в сводке карточки (21.10): как на карточке «Склада» — г→кг, мл→л, 2 знака
    const el = document.getElementById('idUnitPrice');
    if (el) el.textContent = stockPriceText(ingredientUnitPrice(ing), ing.unit);
}

function _invFmtSafe(x) { return typeof _invFmt === 'function' ? _invFmt(x) : String(Math.round(Number(x) * 100) / 100); }

// Окно «Приход» (21.10; бывшая постоянная форма в карточке). Без количества — только новая цена.
function openIngredientReceiveModal() {
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    calSetFieldValue('idNewPriceDate', 'idNewPriceDateBtnLabel', getLocalDateStr(0));
    document.getElementById('idPackagePrice').value = Number(ing.package_price || 0).toFixed(2);
    document.getElementById('idPackageSize').value = ing.package_size;
    document.getElementById('idStockQty').value = '';
    const qtyUnitEl = document.getElementById('ingQtyUnit');
    if (qtyUnitEl) qtyUnitEl.textContent = unitAbbrev(ing.unit);
    const nameEl = document.getElementById('ingReceiveName');
    if (nameEl) nameEl.textContent = ing.name || '';
    renderIngredientUnitPricePreview();
    document.getElementById('ingReceiveModal').style.display = 'flex';
}

// Сворачиваемый раздел карточки позиции (класс .itm-sec, открытие — класс open)
function toggleItemSection(id) {
    document.getElementById(id)?.classList.toggle('open');
}

async function saveIdHeader() {
    suppressRealtimeFor3s();
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const name = document.getElementById('idName').value.trim();
    const unit = document.getElementById('idUnit').value;
    if (!name) return;
    try {
        const { error } = await db.from('ingredients').update({ name, unit }).eq('id', ing.id);
        if (error) throw error;
        ing.name = name;
        ing.unit = unit;
        renderIngredientUnitPrice(ing);
        logActivity('ingredient', `${t('log_ingredient_changed')} «${name}»`);
        showAutosaveToast();
    } catch (e) { console.error(e); }
}

// Удаление ингредиента прямо из его карточки
function deleteCurrentIngredient() {
    const idx = ingredients.findIndex(i => i.id === currentIngredientId);
    if (idx === -1) return;
    const ing = ingredients[idx];
    openDeleteModal(idx, 'ingredient', `${t('delete_label_ingredient')} «${ing.name}»`);
}

// ==================== ИСТОРИЯ ЦЕН ИНГРЕДИЕНТА ====================
let _ingredientPriceHistory = {}; // { ingredient_id: [{package_price, package_size, valid_from}] }

// Разворачивает/сворачивает объединённый блок "Динамика цены" — график и
// история строятся лениво, только при первом раскрытии (не при каждом
// открытии карточки).
function toggleIngredientPriceBlock() {
    const content = document.getElementById('ingPriceContent');
    const chevron = document.getElementById('ingPriceChevron');
    if (!content) return;
    const willShow = content.classList.contains('hidden');
    content.classList.toggle('hidden');
    if (chevron) chevron.style.transform = willShow ? 'rotate(180deg)' : '';
    if (willShow && currentIngredientId != null) {
        loadIngredientPriceHistory(currentIngredientId);
    }
}

// Обновляет график/историю цены ПОСЛЕ редактирования — но только если блок
// сейчас раскрыт (иначе нет смысла считать и рисовать то, что не видно;
// свежие данные подтянутся сами при следующем раскрытии).
function refreshIngredientPriceIfExpanded(ingredientId) {
    const content = document.getElementById('ingPriceContent');
    if (content && !content.classList.contains('hidden')) {
        return loadIngredientPriceHistory(ingredientId);
    }
}

async function loadIngredientPriceHistory(ingredientId) {
    try {
        const { data, error } = await db.from('ingredient_price_history')
            .select('id, package_price, package_size, valid_from')
            .eq('ingredient_id', ingredientId)
            .order('valid_from', { ascending: false });
        if (error) throw error;
        _ingredientPriceHistory[ingredientId] = data || [];
        renderIngredientPriceChart(ingredientId);
        renderIngredientPriceHistory(ingredientId);
    } catch (e) { console.error('Ошибка загрузки истории цен:', e); }
}

let _ingredientPriceChartInstance = null;

// Обновляет блок «Остаток на складе» в карточке ингредиента
async function renderIngredientStockBlock(ing) {
    const unitLabel = unitAbbrev(ing.unit);
    // Общий расчёт склада (inventory.js stockState, 21.10)
    const st = stockState('ing', ing.id, stockStateContext(30));
    const balance  = st.after;
    const balanceBefore = st.now;
    const daily   = st.daily;

    const balEl   = document.getElementById('ingBalanceValue');
    const unitEl  = document.getElementById('ingBalanceUnit');
    const daysEl  = document.getElementById('ingDaysLeft');
    const balBeforeEl = document.getElementById('ingBalanceBeforeValue');
    const unitBeforeEl = document.getElementById('ingBalanceBeforeUnit');

    if (balBeforeEl) balBeforeEl.textContent = balanceBefore !== null ? Number(balanceBefore).toFixed(1) : '—'; // 1 знак — как на карточке «Склада»
    if (unitBeforeEl) unitBeforeEl.textContent = unitLabel;

    if (balEl) {
        // Показываем реальное число, включая отрицательное (реальная нехватка) —
        // раньше отрицательный баланс подменялся на "0", скрывая проблему.
        if (balance !== null) {
            balEl.textContent = Number(balance).toFixed(1);
            const colorClass = balance <= 0 ? 'text-[#c0685c]' : 'text-[#4f6349]';
            balEl.className = colorClass + ' font-bold';
        } else {
            balEl.textContent = '0';
            balEl.className = 'font-bold text-gray-400';
        }
    }
    if (unitEl) unitEl.textContent = unitLabel;
    // Прогноз из «Склада» убран (21.10) — на Full вместо него блок «Умный склад»
    if (daysEl) { daysEl.textContent = ''; daysEl.className = 'table-text'; }
    if (typeof renderStockSmartInfo === 'function') renderStockSmartInfo('ing', ing, 'ingSmartInfo');
    if (typeof updateBatchesBlockVisibility === 'function') updateBatchesBlockVisibility('ingredient', ing.id, 'ingBatchesBlock', balanceBefore);

    // История пополнений и списаний
    const histEl = document.getElementById('ingStockHistory');
    if (!histEl) return;
    try {
        const [{ data }, { data: batchRows }] = await Promise.all([
            db.from('inventory')
                .select('id, type, quantity, created_at, notes, order_id, order_item_id, batch_breakdown')
                .eq('ingredient_id', ing.id)
                .in('type', ['приход', 'расход', 'сторно'])
                .order('created_at', { ascending: false })
                .limit(200),
            db.from('stock_batches')
                .select('id, unit_price, qty_original, created_at')
                .eq('item_type', 'ingredient').eq('ingredient_id', ing.id)
        ]);
        if (!data || !data.length) {
            histEl.innerHTML = `<p class="table-text text-gray-400 mt-1">${t('ing_no_movements_yet')}</p>`;
            const se = document.getElementById('ingHistShort'); if (se) se.textContent = '';
            return;
        }

        // Определяем категорию каждой записи
        function getCategory(r) {
            if (r.type === 'приход') return 'in';
            if (r.type === 'сторно') return 'storno';
            const n = r.notes || '';
            if (n.startsWith('Заказ ') || n.startsWith('Сторно заказа')) return 'order';
            return 'personal';
        }

        // Стоимость единицы на дату записи — ЗАПАСНОЙ способ (≈), когда точных данных нет
        function unitCostAtDate(dateStr) {
            if (!ing.priceHistory || !ing.priceHistory.length) return ing.package_price / ing.package_size;
            const applicable = ing.priceHistory.filter(h => h.valid_from <= dateStr);
            if (!applicable.length) return ing.package_price / ing.package_size;
            const last = applicable[applicable.length - 1];
            return last.package_size ? last.package_price / last.package_size : 0;
        }

        // Реальные суммы (21.10): приход — по цене своей партии, расход — по фактическому
        // списанию из партий (batch_breakdown), сторно — по исходному расходу той же позиции.
        const costs = typeof realStockMovementCosts === 'function'
            ? realStockMovementCosts(data, batchRows || [], r => {
                const od = r.order_id ? (orders || []).find(o => o.id === r.order_id)?.date : null;
                return Number(r.quantity) * unitCostAtDate(od || r.created_at.slice(0, 10));
            })
            : new Map();
        const showMoney = typeof hasPermission !== 'function' || hasPermission('can_view_costs');

        // Итоги по категориям
        const totals = { in: { qty: 0, cost: 0 }, order: { qty: 0, cost: 0 }, personal: { qty: 0, cost: 0 } };
        let anyApprox = false;
        data.forEach(r => {
            const cat = getCategory(r);
            const qty = Number(r.quantity);
            const c = costs.get(r.id) || { cost: qty * unitCostAtDate(r.created_at.slice(0, 10)), exact: false };
            if (!c.exact) anyApprox = true;
            if (cat === 'storno') {
                // Сторно уменьшает итог по заказам
                totals.order.qty  -= qty;
                totals.order.cost -= c.cost;
            } else {
                totals[cat].qty  += qty;
                totals[cat].cost += c.cost;
            }
        });
        const money = (v) => showMoney ? ` · ${anyApprox ? '≈ ' : ''}${formatMoney(v)}` : '';

        // Итоговая строка
        let summary = `<div class="table-text text-gray-600 mt-2 mb-2 space-y-0.5">`;
        summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#7c9473;"></span>${t('ing_bought_label')}: <span class="font-semibold" style="color:#4f6349;">${totals.in.qty.toFixed(2)} ${unitLabel}</span>${money(totals.in.cost)}</div>`;
        if (totals.order.qty > 0) summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#d9a441;"></span>${t('ing_for_orders_label')}: <span class="font-semibold" style="color:#96712a;">${totals.order.qty.toFixed(2)} ${unitLabel}</span>${money(totals.order.cost)}</div>`;
        if (totals.personal.qty > 0) summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#c0685c;"></span>${t('ing_personal_losses_label')}: <span class="font-semibold" style="color:#c0685c;">${totals.personal.qty.toFixed(2)} ${unitLabel}</span>${money(totals.personal.cost)}</div>`;
        summary += `</div>`;

        // Фильтр-табы
        const tabs = `<div class="flex gap-1 mb-2 flex-wrap">
            <button onclick="filterIngHistory('all')" id="histTab_all" class="hist-tab hist-tab-active table-text px-2 py-0.5 rounded-full border border-gray-300 bg-[#7c9473] text-white">${t('common_all')}</button>
            <button onclick="filterIngHistory('in')" id="histTab_in" class="hist-tab table-text px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">+ ${t('ing_tab_purchases')}</button>
            <button onclick="filterIngHistory('order')" id="histTab_order" class="hist-tab table-text px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">− ${t('ing_tab_orders')}</button>
            <button onclick="filterIngHistory('personal')" id="histTab_personal" class="hist-tab table-text px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">− ${t('ing_tab_personal')}</button>
        </div>`;

        // Строки таблицы
        let rows = '';
        data.forEach(r => {
            const cat = getCategory(r);
            // Для расходов/сторно по заказу берём дату самого заказа, а не created_at
            const orderDate = r.order_id ? (orders || []).find(o => o.id === r.order_id)?.date : null;
            const dateStr = orderDate || r.created_at.slice(0, 10);
            const date = formatDateDMY(dateStr);
            const qty = Number(r.quantity);
            const c = costs.get(r.id) || { cost: qty * unitCostAtDate(dateStr), exact: false };
            const costCell = `${c.exact ? '' : '≈ '}${formatMoney(c.cost.toFixed(2))}`;
            const isIn = r.type === 'приход';
            const isStorno = r.type === 'сторно';
            const sign = isIn || isStorno ? '+' : '−';
            const color = isIn ? 'color:#4f6349;' : isStorno ? 'color:#7c9473;' : (cat === 'order' ? 'color:#96712a;' : 'color:#c0685c;');
            const notes = escapeHtml(r.notes || '')
                .replace('Корректировка: ', '').replace('Закупка ', '')
                .replace(t('ing_adjustment_note') + ': ', '').replace(t('ing_purchase_note') + ' ', '');
            const rowCat = isStorno ? 'order' : cat; // сторно фильтруется вместе с заказами
            rows += `<tr class="border-b ing-hist-row" data-cat="${rowCat}">
                <td class="p-1 whitespace-nowrap">${date}</td>
                <td class="p-1 text-right font-semibold whitespace-nowrap" style="${color}">${sign}${qty.toFixed(2)} ${unitLabel}</td>
                ${showMoney ? `<td class="p-1 text-right text-gray-500 whitespace-nowrap">${costCell}</td>` : ''}
                <td class="p-1 text-gray-400">${notes}</td>
            </tr>`;
        });

        const table = `<div id="ingHistTableWrap" style="max-height:260px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">
            <table class="w-full table-text table-clean">
                <thead><tr style="background-color:#e3e8df;" class="sticky top-0 table-text">
                    <th class="p-1 text-left">${t('history_col_date')}</th>
                    <th class="p-1 text-right">${t('inv_col_quantity')}</th>
                    ${showMoney ? `<th class="p-1 text-right">${t('stats_col_sum')}</th>` : ''}
                    <th class="p-1 text-left">${t('ing_note_label')}</th>
                </tr><tr class="tbl-gap"><th colspan="${showMoney ? 4 : 3}"></th></tr></thead>
                <tbody id="ingHistTableBody">${rows}</tbody>
            </table>
        </div>`;

        histEl.innerHTML = summary + tabs + table;
        // Итог в заголовке свёрнутого раздела «История склада» (21.10)
        const shortEl = document.getElementById('ingHistShort');
        if (shortEl) shortEl.textContent = `${t('ing_bought_label').toLowerCase()} ${_invFmtSafe(totals.in.qty)} ${unitLabel}${showMoney ? ` · ${anyApprox ? '≈ ' : ''}${formatMoney(totals.in.cost)}` : ''}`;
    } catch(e) { console.error(e); }
}

// ── Редактирование и удаление записей склада ────────────────────────────────

function editInventoryRecord(id, qty, notes) {
    document.getElementById('editInventoryId').value = id;
    document.getElementById('editInventoryQty').value = qty;
    document.getElementById('editInventoryNotes').value = notes;
    document.getElementById('editInventoryModal').style.display = 'flex';
}

async function saveInventoryEdit() {
    suppressRealtimeFor3s();
    const id  = Number(document.getElementById('editInventoryId').value);
    const qty = parseFloat(document.getElementById('editInventoryQty').value);
    const notes = document.getElementById('editInventoryNotes').value.trim();
    if (isNaN(qty) || qty <= 0) { showInfo(t('inv_enter_valid_qty')); return; }
    showLoading();
    try {
        const { error } = await db.from('inventory')
            .update({ quantity: parseFloat(qty.toFixed(4)), notes: notes || null })
            .eq('id', id);
        if (error) throw error;
        await loadInventory();
        closeModal();
        const ing = ingredients.find(i => i.id === currentIngredientId);
        if (ing) await renderIngredientStockBlock(ing);
        displayIngredients();
    } catch(e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

async function deleteInventoryRecord(id) {
    const ok = await showConfirm(t('ing_delete_stock_record_confirm'));
    if (!ok) return;
    closeModal();
    showLoading();
    try {
        const { error } = await db.from('inventory').delete().eq('id', id);
        if (error) throw error;
        await loadInventory();
        const ing = ingredients.find(i => i.id === currentIngredientId);
        if (ing) await renderIngredientStockBlock(ing);
        displayIngredients();
    } catch(e) { console.error(e); showInfo(t('error_delete_generic')); }
    finally { hideLoading(); }
}

let _ingPricePts = [];
let _ingPricePeriod = 'all';
// Общий помощник выбора периода (используется и в карточке полуфабриката): точки {date, cost}
function sbPeriodPoints(pts, period) {
    if (!pts || period === 'all') return pts || [];
    const d = new Date(); d.setDate(d.getDate() - parseInt(period, 10));
    const cutoff = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const inWin = pts.filter(p => p.date >= cutoff);
    const before = pts.filter(p => p.date < cutoff);
    return before.length ? [before[before.length - 1], ...inWin] : inWin; // последняя цена до периода — точка отсчёта
}
function sbSetPeriodButtons(prefix, period) {
    [['30','30'],['90','90'],['all','All']].forEach(([k, suf]) => {
        const b = document.getElementById(prefix + 'Per' + suf);
        if (b) b.classList.toggle('active', k === period);
    });
}
function setIngPricePeriod(period) { _ingPricePeriod = period; drawIngredientPriceChart(); }

async function renderIngredientPriceChart(ingredientId) {
    const history = (_ingredientPriceHistory[ingredientId] || []).slice().reverse(); // от старых к новым
    _ingPricePts = history.map(h => ({ date: h.valid_from, cost: h.package_size ? h.package_price / h.package_size : 0 }));
    _ingPricePeriod = 'all';
    await drawIngredientPriceChart();
}

async function drawIngredientPriceChart() {
    const canvas = document.getElementById('ingredientPriceChart');
    const emptyEl = document.getElementById('ingredientPriceChartEmpty');
    if (!canvas || !emptyEl) return;
    sbSetPeriodButtons('ing', _ingPricePeriod);
    const ing = ingredients.find(i => i.id === currentIngredientId);
    const unitLabel = ing ? (unitAbbrev(ing.unit)) : '';
    const points = sbPeriodPoints(_ingPricePts, _ingPricePeriod);

    if (points.length < 2) {
        if (_ingredientPriceChartInstance) { _ingredientPriceChartInstance.destroy(); _ingredientPriceChartInstance = null; }
        canvas.style.display = 'none';
        emptyEl.textContent = (_ingPricePeriod === 'all' || _ingPricePts.length < 2) ? t('ing_not_enough_data_2') : t('prod_cost_no_changes_period');
        emptyEl.classList.remove('hidden');
        return;
    }

    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const labels = points.map(p => formatDateDMY(p.date));
    const data   = points.map(p => parseFloat(p.cost.toFixed(6)));

    try { await ensureChartJs(); } catch (e) { console.error(e); return; }
    if (!canvas.isConnected) return;
    // Уничтожаем предыдущий экземпляр чтобы не накапливались
    if (_ingredientPriceChartInstance) { _ingredientPriceChartInstance.destroy(); _ingredientPriceChartInstance = null; }

    const ctx = canvas.getContext('2d');
    _ingredientPriceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `${t('ing_price_word')} (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency}/${unitLabel})`,
                data,
                borderColor: '#7c9473',
                backgroundColor: 'rgba(124,148,115,0.14)',
                pointBackgroundColor: '#7c9473',
                pointRadius: 5,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${formatMoney(ctx.parsed.y, 6)}/${unitLabel}`
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 10 } } },
                y: {
                    ticks: { font: { size: 10 }, callback: v => v.toFixed(4) },
                    beginAtZero: false
                }
            }
        }
    });
}

function renderIngredientPriceHistory(ingredientId) {
    const container = document.getElementById('idPriceHistory');
    if (!container) return;
    const history = _ingredientPriceHistory[ingredientId] || [];
    if (!history.length) { container.innerHTML = `<p class="table-text text-gray-400">${t('ing_price_history_empty')}</p>`; return; }
    const ing = ingredients.find(i => i.id === ingredientId);
    const unitLabel = ing ? (unitAbbrev(ing.unit)) : '';
    let html = '<table class="w-full table-text table-clean"><thead><tr style="background-color:#e3e8df;" class="table-text"><th class="p-0.5 text-left">' + t('ing_from_date') + '</th><th class="p-0.5 text-right">' + t('ing_package_price_short') + '</th><th class="p-0.5 text-right">' + t('ing_price_per_unit') + '</th><th class="p-0.5 w-12"></th></tr><tr class="tbl-gap"><th colspan="4"></th></tr></thead><tbody>';
    history.forEach((h, i) => {
        const unitPrice = h.package_size ? (h.package_price / h.package_size).toFixed(4) : '—';
        const isCurrent = i === 0;
        html += `<tr style="${isCurrent ? 'background:#e3e8df;' : ''}" class="${isCurrent ? 'font-semibold' : 'border-b'}">
            <td class="p-0.5">${formatDateDMY(h.valid_from)}${isCurrent ? ` <span style="color:#4f6349;">(${t('ing_current_word')})</span>` : ''}</td>
            <td class="p-0.5 text-right">${formatMoney(h.package_price)}</td>
            <td class="p-0.5 text-right">${unitPrice === '—' ? '—' : formatMoney(unitPrice, 4) + '/' + unitLabel}</td>
            <td class="p-0.5 text-center whitespace-nowrap">
                <button onclick="openEditPriceHistoryModal(${h.id},'${h.valid_from}',${h.package_price},${h.package_size})" class="text-gray-400 price-hist-edit-btn mr-1">${icon('edit', 'w-3.5 h-3.5')}</button>
                ${hasPermission('can_delete') ? `<button onclick="deletePriceHistoryRecord(${h.id})" class="text-gray-400 price-hist-del-btn">${icon('trash', 'w-3.5 h-3.5')}</button>` : ''}
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Открыть модалку для добавления новой записи истории цен
function openAddPriceHistoryModal() {
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    document.getElementById('priceHistoryModalTitle').textContent = t('ing_add_price_record');
    document.getElementById('priceHistoryRecordId').value = '';
    calSetFieldValue('priceHistoryDate', 'priceHistoryDateBtnLabel', getLocalDateStr(0));
    document.getElementById('priceHistoryPrice').value = ing.package_price.toFixed(2);
    document.getElementById('priceHistorySize').value = ing.package_size;
    document.getElementById('priceHistoryModal').style.display = 'flex';
}

// Открыть модалку для редактирования существующей записи
function openEditPriceHistoryModal(id, validFrom, price, size) {
    document.getElementById('priceHistoryModalTitle').textContent = t('ing_edit_price_record');
    document.getElementById('priceHistoryRecordId').value = id;
    calSetFieldValue('priceHistoryDate', 'priceHistoryDateBtnLabel', validFrom);
    document.getElementById('priceHistoryPrice').value = Number(price).toFixed(2);
    document.getElementById('priceHistorySize').value = size;
    document.getElementById('priceHistoryModal').style.display = 'flex';
}

// Сохранить запись (создать новую или обновить существующую)
async function savePriceHistoryRecord() {
    suppressRealtimeFor3s();
    const recordId = document.getElementById('priceHistoryRecordId').value;
    const validFrom = document.getElementById('priceHistoryDate').value;
    const price = parseFloat(document.getElementById('priceHistoryPrice').value);
    const size = parseFloat(document.getElementById('priceHistorySize').value);
    if (!validFrom || isNaN(price) || isNaN(size) || size <= 0) {
        showInfo(t('common_fill_correctly')); return;
    }
    showLoading();
    try {
        if (recordId) {
            // Обновляем существующую запись
            const { error } = await db.from('ingredient_price_history').update({
                valid_from: validFrom,
                package_price: parseFloat(price.toFixed(2)),
                package_size: size
            }).eq('id', Number(recordId));
            if (error) throw error;
        } else {
            // Создаём новую запись
            const { error } = await db.from('ingredient_price_history').insert({
                org_id: currentOrgId,
                ingredient_id: currentIngredientId,
                valid_from: validFrom,
                package_price: parseFloat(price.toFixed(2)),
                package_size: size
            });
            if (error) throw error;
        }
        closeModal();
        await refreshIngredientPriceIfExpanded(currentIngredientId);
    } catch (e) { console.error(e); showInfo(t('error_save_generic') + (e.message ? ' ' + e.message : '')); }
    finally { hideLoading(); }
}

// Удалить запись из истории цен
async function deletePriceHistoryRecord(id) {
    if (!hasPermission('can_delete')) {
        showInfo(t('ing_no_delete_permission'));
        return;
    }
    const ok = await showConfirm(t('ing_delete_price_record_confirm'));
    if (!ok) return;
    showLoading();
    try {
        const { error } = await db.from('ingredient_price_history').delete().eq('id', id);
        if (error) throw error;
        await refreshIngredientPriceIfExpanded(currentIngredientId);
    } catch (e) { console.error(e); showInfo(t('error_delete_generic')); }
    finally { hideLoading(); }
}

// ==================== БЫСТРОЕ СОЗДАНИЕ ИЗ КАРТОЧКИ РЕЦЕПТА ====================
// Если при вводе в поле "Добавить в рецепт" нужного ингредиента ещё нет в базе,
// в выпадающем списке показывается пункт "+ Создать «...»" (см. setupSearchDropdown
// в helpers.js). Этот модал спрашивает только цену/размер упаковки/единицу — название
// уже известно (введено пользователем) — и после создания возвращает в то же поле рецепта.
let _quickAddIngredientContext = null; // 'product' | 'semiFinished' — куда вернуться после создания

function openQuickAddIngredientModal(name, context) {
    _quickAddIngredientContext = context;
    document.getElementById('qaiName').value = name;
    document.getElementById('qaiPrice').value = '';
    document.getElementById('qaiSize').value = '';
    document.getElementById('qaiUnit').value = 'g';
    document.getElementById('quickAddIngredientModal').style.display = 'flex';
}

async function confirmQuickAddIngredient() {
    const name = document.getElementById('qaiName').value.trim();
    const packagePrice = parseFloat(document.getElementById('qaiPrice').value);
    const packageSize  = parseFloat(document.getElementById('qaiSize').value);
    const unit = document.getElementById('qaiUnit').value;
    if (!name || isNaN(packagePrice) || isNaN(packageSize) || packageSize <= 0) {
        showInfo(t('common_fill_correctly')); return;
    }
    showLoading();
    try {
        const { data, error } = await db.from('ingredients').insert({
            org_id: currentOrgId, name, package_price: parseFloat(packagePrice.toFixed(2)), package_size: packageSize, unit
        }).select().single();
        if (error) throw error;
        const newIng = { id: data.id, name: data.name, package_price: Number(data.package_price), package_size: Number(data.package_size), unit: data.unit };
        ingredients.push(newIng);
        displayIngredients();
        logActivity('ingredient', `${t('log_ingredient_added')} «${name}» (${t('log_from_recipe_card')})`);
        closeModal();

        // Подставляем созданный ингредиент обратно в поле поиска того рецепта,
        // откуда вызвали создание — остаётся только нажать "Добавить".
        const inputId = _quickAddIngredientContext === 'semiFinished' ? 'newSfRecipeIngredient' : 'newRecipeIngredient';
        const input = document.getElementById(inputId);
        if (input) input.value = newIng.name;
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// ── Фильтр истории движений ──────────────────────────────────────────────────

function filterIngHistory(cat) {
    // Переключаем табы
    document.querySelectorAll('.hist-tab').forEach(btn => {
        btn.classList.remove('bg-[#7c9473]', 'text-white', 'hist-tab-active');
        btn.classList.add('bg-[#f4f1ea]', 'text-gray-600');
    });
    const activeBtn = document.getElementById(`histTab_${cat}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-[#7c9473]', 'text-white', 'hist-tab-active');
        activeBtn.classList.remove('bg-[#f4f1ea]', 'text-gray-600');
    }
    // Фильтруем строки
    const rows = document.querySelectorAll('#ingHistTableBody tr');
    rows.forEach(row => {
        row.style.display = (cat === 'all' || row.dataset.cat === cat) ? '' : 'none';
    });
}
