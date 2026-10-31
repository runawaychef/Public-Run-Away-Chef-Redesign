// ==================== ПОЛУФАБРИКАТЫ ====================
// Промежуточные составы (крем, конфитюр, тесто и т.п.), используемые в рецептах изделий.
// Состоят только из обычных ингредиентов (без вложенности других полуфабрикатов).
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), ingredients (ingredients.js), ingredientUnitPrice (money.js),
// showLoading/hideLoading, logActivity (employees.js), svgEdit/svgDelete (helpers.js),
// openDeleteModal, closeModal (modals.js), editIndex (главный скрипт).

let semiFinished = []; // [{id, name, batch_size, unit, other_costs, ingredients:[{id, ingredient_id, quantity}]}]

// SF_UNIT_LABELS заменён общей функцией unitAbbrev(code) из inventory.js.

// Себестоимость партии полуфабриката
function semiFinishedBatchCost(sf) {
    const ingredientsCost = (sf.ingredients || []).reduce((sum, ri) => {
        const ing = ingredients.find(i => i.id === ri.ingredient_id);
        if (!ing) return sum;
        return sum + ingredientUnitPrice(ing) * ri.quantity;
    }, 0);
    return ingredientsCost + (sf.other_costs || 0);
}

// Себестоимость за единицу полуфабриката (€/г, €/кг, €/мл, €/л — в зависимости от sf.unit)
function semiFinishedUnitCost(sf) {
    const batchSize = sf.batch_size || 1;
    if (batchSize <= 0) return 0;
    return semiFinishedBatchCost(sf) / batchSize;
}

// Уровень критичности полуфабриката: 0 — критично (терракота, включая
// неподтверждённый рецепт), 1 — заканчивается (охра), 2 — норма.
// «Склад» — справочник (21.10): прогноза нет, наверх — минус/ноль или неподтверждённый рецепт.
function semiFinishedSeverity(sf, ctx) {
    const f = stockFullInfo('sf', sf, ctx, stockTrackedIds());
    if (f.on && (f.attention || !sf.recipe_confirmed)) return f.zone === 'critical' || !sf.recipe_confirmed ? 0 : 1;
    const after = stockState('sf', sf.id, ctx).after;
    return (after !== null && after <= 0) || !sf.recipe_confirmed ? 0 : 2;
}

function displaySemiFinished() {

    // Общий расчёт склада (inventory.js stockState, 21.10)
    const ctx = stockStateContext(stockUi.period);

    // Сортировка: сначала критичные, потом заканчивающиеся, потом остальные —
    // внутри каждой группы по алфавиту.
    semiFinished.sort((a, b) => {
        const sevDiff = semiFinishedSeverity(a, ctx) - semiFinishedSeverity(b, ctx);
        return sevDiff !== 0 ? sevDiff : (a.name||"").localeCompare(b.name||"");
    });

    // Красная плашка «не подтверждён рецепт» над списком убрана 16.10 — такие ПФ теперь в группе «Требует внимания».
    updateSemiFinishedSelects();
    renderSemiFinishedCards();
    filterSemiFinishedList();
}

// ---- Карточный вид (тот же принцип, что у ингредиентов) ----
function renderSemiFinishedCards() {
    const body = document.getElementById('semiFinishedCardsBody');
    if (!body) return;

    const ctx = stockStateContext(stockUi.period); // общий расчёт склада (inventory.js stockState, 21.10)
    const tracked = stockTrackedIds();
    renderStockFilterBar('sf');
    const attnOnly = stockForecastOn() && stockUi.sf === 'attn';
    const tiles = stockViewMode('sf') === 'tiles';
    stockViewSync('sf');
    body.classList.toggle('stock-grid', tiles);

    const htmlAttn = [], htmlOk = [];
    semiFinished.forEach((sf, realIdx) => {
        const unitLabel = unitAbbrev(sf.unit);
        const unitCost  = semiFinishedUnitCost(sf);
        const st        = stockState('sf', sf.id, ctx);
        const balanceBefore = st.now;
        const balance   = st.after;
        const daysLeft  = st.daysLeft;
        const shortage  = st.shortage;

        // «Склад» — справочник (21.10): без прогноза; красным — минус/ноль, наверх — и неподтверждённый рецепт.
        const fi = stockFullInfo('sf', sf, ctx, tracked); // Full + отслеживается: аналитика «Умного склада»
        const isCritical = fi.on ? fi.zone === 'critical' : (balance !== null && balance <= 0);
        const isWarning = fi.on && fi.zone === 'warning';
        const notConfirmed = !sf.recipe_confirmed;
        const batchRed = fi.on && fi.batchShort.length > 0;
        const accentColor = (isCritical || notConfirmed || batchRed) ? '#c0685c' : isWarning ? '#d9a441' : '';
        const isAttn = !!accentColor;
        const afterColor = isCritical ? '#c0685c' : isWarning ? '#96712a' : '#4f6349';
        const thirdLabel = '';
        const thirdText = '';
        const beforeText = balanceBefore !== null ? `${Number(balanceBefore).toFixed(1)} ${unitLabel}` : '—';
        const afterText = balance !== null ? `${Number(balance).toFixed(1)} ${unitLabel}` : '—';
        const priceText = stockPriceText(unitCost, sf.unit);
        const stripe = accentColor ? `<div class="stripe" style="background:${accentColor};"></div>` : '';
        if (attnOnly && !isAttn) return;

        if (tiles) {
            const showPrice = (typeof hasPermission !== 'function' || hasPermission('can_view_costs'));
            (isAttn ? htmlAttn : htmlOk).push(stockTileHtml({ name: sf.name, attn: isAttn, red: isCritical, numText: balance !== null ? Number(balance).toFixed(1) : '—', unit: balance !== null ? unitLabel : '', priceText: showPrice ? priceText : '', chip: (fi.on && fi.chip) ? { cls: fi.chip.cls, text: fi.chip.tile } : null, openCall: `openSemiFinishedDetail(${sf.id})` }));
            return;
        }
        (isAttn ? htmlAttn : htmlOk).push(`
        <div class="oc-swipe-wrap" data-name="${escapeHtml((sf.name || '').toLowerCase())}" data-critical="${isAttn ? '1' : '0'}" data-low="${isCritical ? '1' : '0'}" style="--oc-swipe-x:-72px;">
            ${refCopySwipeBtnHtml(`quickCopySemiFinishedFromSwipe(${realIdx})`)}
            <div class="order-card" style="cursor:pointer;" onclick="openSemiFinishedDetail(${sf.id})">
                ${stripe}
                <div class="order-card-body">
                    <div class="oc-row">
                        <span class="oc-name">${escapeHtml(sf.name || t('semifinished_no_name_fallback'))}</span>
                        ${stockFullChipHtml(fi)}
                    </div>
                    ${stockCardCellsHtml({ priceLabel: t('sf_unit_cost_short'), priceText: (typeof hasPermission !== 'function' || hasPermission('can_view_costs')) ? priceText : '', beforeText, afterText, afterColor, thirdLabel: thirdLabel, thirdText: thirdText, thirdColor: afterColor })}
                    ${stockFullExtraHtml(fi, unitLabel)}
                </div>
            </div>
        </div>`);
    });
    body.innerHTML = stockGroupsHtml(htmlAttn, htmlOk);
    initCopySwipeDelegation('semiFinishedCardsBody');
}

function quickCopySemiFinishedFromSwipe(realIdx) {
    if (typeof closeAllCardSwipes === 'function') closeAllCardSwipes();
    copySemiFinished(realIdx);
}

// ---- Поиск по названию — работает одинаково в обоих видах ----
// Фильтр «критичный остаток» ставит только Dashboard (dashboard.js)
let stockLowOnlySf = false;
function clearSemiFinishedDashFilter() { stockLowOnlySf = false; filterSemiFinishedList(); }
function filterSemiFinishedList() {
    const input = document.getElementById('semiFinishedSearchInput');
    const q = input ? input.value.trim().toLowerCase() : '';
    document.getElementById('semiFinishedSearchClear')?.classList.toggle('hidden', !q);
    document.getElementById('semiFinishedSearchIcon')?.classList.toggle('hidden', !!q);

    let visibleCards = 0;
    document.querySelectorAll('#semiFinishedCardsBody .oc-swipe-wrap, #semiFinishedCardsBody .stt-tile').forEach(wrap => {
        const match = (!q || wrap.dataset.name.includes(q)) && (!stockLowOnlySf || wrap.dataset.low === '1');
        wrap.style.display = match ? '' : 'none';
        if (match) visibleCards++;
    });
    document.getElementById('semiFinishedCardsEmpty')?.classList.toggle('hidden', visibleCards !== 0);
    document.getElementById('semiFinishedDashFilter')?.classList.toggle('hidden', !stockLowOnlySf);
    toggleStockDividers('semiFinishedCardsBody', !!q || stockLowOnlySf);

}

function clearSemiFinishedSearch() {
    const input = document.getElementById('semiFinishedSearchInput');
    if (input) input.value = '';
    filterSemiFinishedList();
}

// Кнопка "+": сразу создаёт черновик полуфабриката и открывает его карточку
let _draftSemiFinishedIds = new Set();

async function createDraftSemiFinishedAndOpen() {
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('semi_finished').insert({ org_id: currentOrgId, name: '', batch_size: 1, unit: 'g', other_costs: 0 }).select().single();
        if (error) throw error;
        const newSf = { id: data.id, name: '', batch_size: 1, unit: 'g', other_costs: 0, recipe_confirmed: false, ingredients: [] };
        semiFinished.push(newSf);
        _draftSemiFinishedIds.add(newSf.id);
        displaySemiFinished();
        openSemiFinishedDetail(newSf.id);
        logActivity('semiFinished', `${t('log_sf_draft_created')} №${newSf.id}`);
    } catch (e) { console.error(e); showInfo(t('sf_create_error')); }
    finally { hideLoading(); }
}

async function cleanupSemiFinishedDraftIfEmpty(sfId) {
    if (!_draftSemiFinishedIds.has(sfId)) return;
    _draftSemiFinishedIds.delete(sfId);
    const idx = semiFinished.findIndex(s => s.id === sfId);
    if (idx === -1) return;
    if (semiFinished[idx].name && semiFinished[idx].name.trim()) return; // название вписали — уже не пустой черновик
    // Убираем из локального списка сразу; ошибку удаления проверяем (supabase-js её не бросает)
    semiFinished.splice(idx, 1);
    suppressRealtimeFor3s();
    try {
        const { error } = await db.from('semi_finished').delete().eq('id', sfId);
        if (error) throw error;
    } catch (e) { console.error('Не удалось удалить пустой черновик полуфабриката (будет убран при следующем запуске):', e); }
}

// Страховка на случай, когда приложение убили на карточке нового полуфабриката:
// список _draftSemiFinishedIds живёт только в памяти. Вызывается один раз после первой
// загрузки данных. Удаляем только полностью пустые: без названия, без рецепта и не
// используемые ни в одном изделии.
async function cleanupAbandonedSemiFinishedDrafts() {
    try {
        const usedIds = new Set();
        (products || []).forEach(p => (p.ingredients || []).forEach(ri => { if (ri.semi_finished_id != null) usedIds.add(ri.semi_finished_id); }));
        const stale = semiFinished.filter(sf =>
            !(sf.name && sf.name.trim()) && !(sf.ingredients && sf.ingredients.length) &&
            !usedIds.has(sf.id) && sf.id !== currentSemiFinishedId && !_draftSemiFinishedIds.has(sf.id));
        for (const sf of stale) {
            const { error } = await db.from('semi_finished').delete().eq('id', sf.id);
            if (error) { console.error('Не удалось удалить брошенный черновик полуфабриката:', error); continue; }
            const idx = semiFinished.findIndex(x => x.id === sf.id);
            if (idx !== -1) semiFinished.splice(idx, 1);
        }
        if (stale.length) displaySemiFinished();
    } catch (e) { console.error('cleanupAbandonedSemiFinishedDrafts:', e); }
}

// Копирует полуфабрикат (название/размер партии/единица/доп.расходы — без рецепта,
// для рецепта уже есть отдельная функция "Скопировать рецепт" внутри карточки)
// и сразу открывает карточку копии для донастройки. По тому же принципу,
// что и copyProduct() в products.js.
async function copySemiFinished(i) {
    const src = semiFinished[i];
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('semi_finished').insert({
            org_id: currentOrgId, name: src.name + t('common_copy_suffix'), batch_size: src.batch_size || 1,
            unit: src.unit || 'g', other_costs: src.other_costs || 0
        }).select().single();
        if (error) throw error;
        const newSf = {
            id: data.id, name: data.name, batch_size: Number(data.batch_size || 1),
            unit: data.unit || 'g', other_costs: Number(data.other_costs || 0),
            recipe_confirmed: false, ingredients: []
        };
        semiFinished.push(newSf);
        displaySemiFinished();
        openSemiFinishedDetail(newSf.id);
        logActivity('semiFinished', `${t('log_sf_copied')} «${src.name}» → «${newSf.name}»`);
    } catch (e) { console.error(e); showInfo(t('ing_copy_error')); }
    finally { hideLoading(); }
}

// ==================== ДЕТАЛЬНЫЙ ВИД ПОЛУФАБРИКАТА / РЕЦЕПТУРА ====================
// currentSemiFinishedId объявлен в index.html (общее состояние)

function openSemiFinishedDetail(sfId) {
    currentSemiFinishedId = sfId;
    const sf = semiFinished.find(s => s.id === sfId);
    if (!sf) return;

    document.getElementById('semiFinishedList').classList.add('hidden');
    document.getElementById('semiFinishedDetail').classList.add('active');
    document.getElementById('semiFinishedDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('semiFinishedDetail').classList.remove('fade-in'), 300);
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('semiFinishedSearchBar', 'semiFinishedList', 'semiFinishedDetail');

    // Сворачиваем блок партий (мог остаться развёрнут от предыдущей карточки)
    const sfBatchesList = document.getElementById('sfBatchesList');
    if (sfBatchesList) sfBatchesList.classList.add('hidden');
    const sfBatchesChevron = document.getElementById('sfBatchesChevron');
    if (sfBatchesChevron) sfBatchesChevron.style.transform = '';
    const sfBatchesLabel = document.getElementById('sfBatchesToggleLabel');
    if (sfBatchesLabel) sfBatchesLabel.textContent = t('ing_batches');

    // Сворачиваем блок динамики себестоимости (мог остаться развёрнут от предыдущей карточки)
    const sfPriceContent = document.getElementById('sfPriceContent');
    if (sfPriceContent) sfPriceContent.classList.add('hidden');
    const sfPriceChevron = document.getElementById('sfPriceChevron');
    if (sfPriceChevron) sfPriceChevron.style.transform = '';

    document.getElementById('sfdName').value = sf.name;
    const sfTitle = document.getElementById('sfdTitle');
    if (sfTitle) sfTitle.textContent = sf.name || '';
    document.getElementById('sfRecipeSection')?.classList.add('open');   // рецепт — открыт (21.10)
    document.getElementById('sfHistSection')?.classList.remove('open');  // история — свёрнута
    document.getElementById('sfdBatchSize').value = sf.batch_size;
    document.getElementById('sfdUnit').value = sf.unit;
    document.getElementById('sfdOtherCosts').value = (sf.other_costs || 0).toFixed(2);
    document.getElementById('sfdRecipeConfirmed').checked = !!sf.recipe_confirmed;
    document.getElementById('sfdTrackStock').checked = !!sf.track_stock;

    renderSemiFinishedRecipe(sf);
    fillNewSfRecipeIngredientSelect();
    setupCopySfRecipeControl(sf);
    renderSfStockBlock(sf);
    loadSfPriceHistory(sf); // раздел «История склада» (итог в заголовке) — 21.10
    refreshFab();
}

async function closeSemiFinishedDetail() {
    const leavingId = currentSemiFinishedId;
    currentSemiFinishedId = null;
    document.getElementById('semiFinishedList').classList.remove('hidden');
    document.getElementById('semiFinishedDetail').classList.remove('active');
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('semiFinishedSearchBar', 'semiFinishedList', 'semiFinishedDetail');
    if (leavingId !== null) await cleanupSemiFinishedDraftIfEmpty(leavingId);
    displaySemiFinished();
    refreshFab();
    // Карточку открыли из «Умного склада» — возвращаемся туда (inventory.js, 21.10)
    if (typeof smartStockReturnPending === 'function' && smartStockReturnPending()) await returnToSmartStock();
}

// Удаление полуфабриката прямо из его карточки (то же окно подтверждения, что и из списка)
function deleteCurrentSemiFinished() {
    const idx = semiFinished.findIndex(s => s.id === currentSemiFinishedId);
    if (idx === -1) return;
    const sf = semiFinished[idx];
    openDeleteModal(idx, 'semiFinished', `${t('delete_label_semifinished')} «${sf.name || t('semifinished_no_name_fallback')}»`);
}

async function saveSfdHeader() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const name = document.getElementById('sfdName').value.trim();
    const batchSize = parseFloat(document.getElementById('sfdBatchSize').value);
    const unit = document.getElementById('sfdUnit').value;
    const otherCosts = parseFloat(document.getElementById('sfdOtherCosts').value) || 0;
    if (!name || isNaN(batchSize) || batchSize <= 0) { showInfo(t('sf_fill_name_batch_size')); return; }

    showLoading();
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('semi_finished').update({
            name, batch_size: batchSize, unit, other_costs: parseFloat(otherCosts.toFixed(2))
        }).eq('id', sf.id);
        if (error) throw error;
        sf.name = name; sf.batch_size = batchSize; sf.unit = unit; sf.other_costs = parseFloat(otherCosts.toFixed(2));
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `${t('log_sf_changed')} «${sf.name}»`);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

function fillNewSfRecipeIngredientSelect() {
    setupSearchDropdown('newSfRecipeIngredient', 'newSfRecipeIngredientDropdown',
        () => ingredients.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(i => i.name),
        null, (text) => openQuickAddIngredientModal(text, 'semiFinished'));
}

function renderSemiFinishedRecipe(sf) {
    const tbody = document.getElementById('sfRecipeItemsBody');
    tbody.innerHTML = '';
    const list = sf.ingredients || [];
    if (!list.length) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="4" class="text-center text-xs text-gray-400 py-2">${t('sf_no_ingredients_hint')}</td>`;
        tbody.appendChild(row);
    } else {
        list.forEach((ri, i) => {
            const ing = ingredients.find(x => x.id === ri.ingredient_id);
            const unitPrice = ing ? ingredientUnitPrice(ing) : 0;
            const lineCost = unitPrice * ri.quantity;
            const isPrimary = !!ri.is_primary;
            const starBtn = `<button onclick="setSfPrimaryIngredient(${i})" title="${t('sf_make_primary')}" class="inline-flex sf-star-btn${isPrimary ? ' active' : ''}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isPrimary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.98 21.539a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg></button>`;
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.innerHTML = `
                <td class="p-0.5 table-text">${starBtn} ${escapeHtml(ing ? ing.name : t('sf_ingredient_deleted'))}</td>
                <td class="p-0.5 table-text text-center">${ri.quantity} ${ing ? unitAbbrev(ing.unit) : ''}</td>
                <td class="p-0.5 table-text text-center font-medium">${formatMoney(lineCost)}</td>
                <td class="p-0.5 text-center">
                    ${svgEdit(`openEditSfRecipeItemModal(${i})`)}
                    ${hasPermission('can_delete') ? svgDelete(`deleteSfRecipeItem(${i})`) : ''}
                </td>`;
            tbody.appendChild(row);
        });
    }

    const batchCost = semiFinishedBatchCost(sf);
    const unitCost  = semiFinishedUnitCost(sf);
    const unitLabel = unitAbbrev(sf.unit);

    document.getElementById('sfdBatchCost').textContent = formatMoney(batchCost);
    document.getElementById('sfdUnitCost').textContent  = formatMoney(unitCost, 4) + `/${unitLabel}`;
    // Сводка карточки (21.10): «Себест. за ед.» как на карточке «Склада»; итог в заголовке «Рецепта»
    const cell = document.getElementById('sfdUnitCostCell');
    if (cell) cell.textContent = stockPriceText(unitCost, sf.unit);
    const rs = document.getElementById('sfRecipeShort');
    if (rs) rs.textContent = list.length ? `${list.length} ${typeof nWord === 'function' ? nWord(list.length, 'word_ingredients') : ''}` : '';
}

async function addIngredientToSfRecipe() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const inputEl = document.getElementById('newSfRecipeIngredient');
    const quantity = parseFloat(document.getElementById('newSfRecipeQty').value);
    const ing = ingredients.find(i => i.name === inputEl.value.trim());
    if (!ing || isNaN(quantity) || quantity <= 0) {
        showInfo(t('sf_choose_ingredient_and_qty')); return;
    }
    const ingredientId = ing.id;

    showLoading();
    try {
        suppressRealtimeFor3s();
        const { data, error } = await db.from('semi_finished_ingredients').insert({
            org_id: currentOrgId,
            semi_finished_id: sf.id, ingredient_id: ingredientId, quantity
        }).select().single();
        if (error) throw error;
        if (!sf.ingredients) sf.ingredients = [];
        sf.ingredients.push({ id: data.id, ingredient_id: ingredientId, quantity: Number(data.quantity) });
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `${t('log_added_to_recipe')} «${sf.name}»: «${ing.name}» (${quantity})`);
        inputEl.value = '';
        document.getElementById('newSfRecipeQty').value = '';
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

let editSfRecipeItemIdx = null;

function openEditSfRecipeItemModal(i) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    editSfRecipeItemIdx = i;
    const ri = sf.ingredients[i];

    const sel = document.getElementById('editSfRecipeIngredient');
    sel.innerHTML = `<option value="">${t('sf_choose_ingredient')}</option>`;
    ingredients.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(ing => {
        const opt = document.createElement('option');
        opt.value = ing.id; opt.textContent = ing.name;
        if (ing.id === ri.ingredient_id) opt.selected = true;
        sel.appendChild(opt);
    });
    document.getElementById('editSfRecipeQty').value = ri.quantity;
    document.getElementById('editSfRecipeItemModal').style.display = 'flex';
}

async function saveSfRecipeItemEdit() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf || editSfRecipeItemIdx === null) return;
    const ingredientIdRaw = document.getElementById('editSfRecipeIngredient').value;
    const quantity = parseFloat(document.getElementById('editSfRecipeQty').value);
    if (!ingredientIdRaw || isNaN(quantity) || quantity <= 0) {
        showInfo(t('common_fill_correctly')); return;
    }
    const ingredientId = Number(ingredientIdRaw);
    const ri = sf.ingredients[editSfRecipeItemIdx];

    showLoading();
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('semi_finished_ingredients').update({
            ingredient_id: ingredientId, quantity
        }).eq('id', ri.id);
        if (error) throw error;
        sf.ingredients[editSfRecipeItemIdx] = { id: ri.id, ingredient_id: ingredientId, quantity };
        renderSemiFinishedRecipe(sf);
        closeModal();
        logActivity('semiFinished', `${t('log_ingredient_changed_in_recipe')} «${sf.name}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

function deleteSfRecipeItem(i) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const ri = sf.ingredients[i];
    const ing = ingredients.find(x => x.id === ri.ingredient_id);
    openDeleteModal(i, 'sfRecipeItem', `${t('delete_label_ingredient')} «${ing ? ing.name : ''}» ${t('delete_label_from_sf_recipe')}`);
}

// ==================== ПОДТВЕРЖДЕНИЕ "РЕЦЕПТ ЗАПОЛНЕН ПОЛНОСТЬЮ" ====================
async function toggleSfRecipeConfirmed() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const checked = document.getElementById('sfdRecipeConfirmed').checked;
    showLoading();
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('semi_finished').update({ recipe_confirmed: checked }).eq('id', sf.id);
        if (error) throw error;
        sf.recipe_confirmed = checked;
        logActivity('semiFinished', `${t('log_recipe_word')} «${sf.name}» ${t('log_marked_as')} ${checked ? t('log_fully_filled') : t('log_incomplete')}`);
    } catch (e) {
        console.error(e); showInfo(t('error_save_check_connection'));
        document.getElementById('sfdRecipeConfirmed').checked = !checked;
    } finally { hideLoading(); }
}

async function toggleSfTrackStock() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const checked = document.getElementById('sfdTrackStock').checked;
    showLoading();
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('semi_finished').update({ track_stock: checked }).eq('id', sf.id);
        if (error) throw error;
        sf.track_stock = checked;
        if (typeof updateInventoryAlertDot === 'function') updateInventoryAlertDot();
        logActivity('semiFinished', `«${sf.name}» — ${t('log_stock_tracking')} ${checked ? t('log_enabled') : t('log_disabled')}`);
    } catch (e) {
        console.error(e); showInfo(t('error_save_generic'));
        document.getElementById('sfdTrackStock').checked = !checked;
    } finally { hideLoading(); }
}

async function resetSfRecipeConfirmed(sf) {
    if (!sf.recipe_confirmed) return;
    sf.recipe_confirmed = false;
    const checkbox = document.getElementById('sfdRecipeConfirmed');
    if (checkbox) checkbox.checked = false;
    try {
        suppressRealtimeFor3s();
        await dbMust(db.from('semi_finished').update({ recipe_confirmed: false }).eq('id', sf.id));
    } catch (e) { console.error('Не удалось сбросить recipe_confirmed:', e); }
}

// ==================== КОПИРОВАНИЕ РЕЦЕПТА ИЗ ДРУГОГО ПОЛУФАБРИКАТА ====================
function setupCopySfRecipeControl(sf) {
    setupSearchDropdown('copySfRecipeFromInput', 'copySfRecipeFromDropdown',
        () => semiFinished
            .filter(s => s.id !== currentSemiFinishedId && (s.ingredients || []).length)
            .sort((a,b) => (a.name||"").localeCompare(b.name||""))
            .map(s => s.name),
        (name) => {
            document.getElementById('copySfRecipeFromInput').value = '';
            copySfRecipeFromByName(name);
        });
}

async function copySfRecipeFromByName(sourceName) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    const src = semiFinished.find(s => s.name === sourceName);
    if (!sf || !src) return;
    const srcItems = src.ingredients || [];
    if (!srcItems.length) { showInfo(t('sf_no_recipe_to_copy')); return; }

    const existingIds = new Set((sf.ingredients || []).map(i => i.ingredient_id));
    const toCopy = srcItems.filter(ri => !existingIds.has(ri.ingredient_id));
    const skipped = srcItems.length - toCopy.length;

    if (!toCopy.length) { showInfo(t('sf_all_ingredients_already_in_recipe').replace('{name}', sourceName)); return; }

    const posWord = toCopy.length === 1 ? t('sf_position_one') : t('sf_position_many');
    let msg = `${t('sf_copy_positions_confirm_prefix')} ${toCopy.length} ${posWord} ${t('sf_copy_positions_confirm_from')} «${sourceName}» ${t('common_into')} «${sf.name}»?`;
    if (skipped) msg += `\n(${skipped} ${t('sf_already_in_recipe_skip')})`;
    if (!(await showConfirm(msg))) return;

    showLoading();
    try {
        suppressRealtimeFor3s();
        const rows = toCopy.map(ri => ({ semi_finished_id: sf.id, ingredient_id: ri.ingredient_id, quantity: ri.quantity }));
        const rowsWithOrg = rows.map(r => ({ org_id: currentOrgId, ...r }));
        const { data, error } = await db.from('semi_finished_ingredients').insert(rowsWithOrg).select();
        if (error) throw error;
        if (!sf.ingredients) sf.ingredients = [];
        data.forEach(d => sf.ingredients.push({ id: d.id, ingredient_id: d.ingredient_id, quantity: Number(d.quantity) }));
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `${t('log_copied_to_recipe')} «${sf.name}»: ${toCopy.length} ${t('sf_position_many')} ${t('sf_copy_positions_confirm_from')} «${sourceName}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// Заполнение выпадающего списка полуфабрикатов (для использования в рецептах изделий)
function updateSemiFinishedSelects() {
    // Вызывается из displaySemiFinished; конкретное заполнение списка в рецепте изделия
    // происходит в products.js через fillNewRecipeIngredientSelect/openEditRecipeItemModal
}

// ==================== СКЛАД ПОЛУФАБРИКАТОВ ====================

async function renderSfStockBlock(sf) {
    const unitLabel = unitAbbrev(sf.unit);
    // Общий расчёт склада (inventory.js stockState, 21.10)
    const st = stockState('sf', sf.id, stockStateContext(30));
    const balance = st.after;
    const balanceBefore = st.now;
    const daily   = st.daily;

    const balEl  = document.getElementById('sfBalanceValue');
    const unitEl = document.getElementById('sfBalanceUnit');
    const daysEl = document.getElementById('sfDaysLeft');
    const balBeforeEl = document.getElementById('sfBalanceBeforeValue');
    const unitBeforeEl = document.getElementById('sfBalanceBeforeUnit');

    if (balBeforeEl) balBeforeEl.textContent = balanceBefore !== null ? Number(balanceBefore).toFixed(1) : '—';
    if (unitBeforeEl) unitBeforeEl.textContent = unitLabel;

    if (balEl) {
        // Показываем реальное число, включая отрицательное (реальная нехватка) —
        // раньше отрицательный баланс подменялся на "0", скрывая проблему.
        if (balance !== null) {
            balEl.textContent = Number(balance).toFixed(1);
            // Цвет (21.10, без прогноза): терракота — минус/ноль, шалфей — есть запас
            balEl.className = 'text-lg font-bold';
            balEl.style.color = balance <= 0 ? '#c0685c' : '#4f6349';
        } else {
            balEl.textContent = '0';
            balEl.className = 'text-lg font-bold';
            balEl.style.color = '#c0685c';
        }
    }
    if (unitEl) unitEl.textContent = unitLabel;
    // Прогноз из «Склада» убран (21.10) — на Full вместо него блок «Умный склад»
    if (daysEl) { daysEl.textContent = ''; daysEl.style.color = ''; }
    if (typeof renderStockSmartInfo === 'function') renderStockSmartInfo('sf', sf, 'sfSmartInfo');
    if (typeof updateBatchesBlockVisibility === 'function') updateBatchesBlockVisibility('semi_finished', sf.id, 'sfBatchesBlock', balanceBefore);
}

// История движений п/ф — вынесена отдельно от renderSfStockBlock, т.к. теперь
// грузится лениво, только при раскрытии блока "Динамика себестоимости" (см.
// toggleSfPriceBlock), а не всегда при открытии карточки.
async function loadSfPriceHistory(sf) {
    const unitLabel = unitAbbrev(sf.unit);
    const histEl = document.getElementById('sfStockHistory');
    if (!histEl) return;
    try {
        const { data } = await db.from('inventory')
            .select('id, type, quantity, created_at, notes')
            .eq('semi_finished_id', sf.id)
            .in('type', ['приход', 'расход'])
            .order('created_at', { ascending: false })
            .limit(50);
        if (!data || !data.length) {
            histEl.innerHTML = `<p class="table-text text-gray-400 mt-1">${t('ing_no_movements_yet')}</p>`;
            const hs0 = document.getElementById('sfHistShort'); if (hs0) hs0.textContent = '';
            return;
        }
        const totalIn = data.filter(r => r.type === 'приход').reduce((s, r) => s + Number(r.quantity), 0);
        const hs = document.getElementById('sfHistShort');
        if (hs) hs.textContent = `${t('sf_produced_short')} ${String(Math.round(totalIn * 10) / 10).replace('.', ',')} ${unitLabel}`;
        let html = `<p class="table-text text-gray-500 font-semibold mt-2 mb-1">${t('sf_history_produced_prefix')}: ${totalIn.toFixed(2)} ${unitLabel})</p>`;
        html += '<div style="max-height:224px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">';
        html += '<table class="w-full table-text table-clean"><thead><tr style="background-color:#e3e8df;" class="text-xs"><th class="p-1 text-left">' + t('history_col_date') + '</th><th class="p-1 text-right">' + t('inv_col_quantity') + '</th><th class="p-1 text-left">' + t('ing_note_label') + '</th></tr><tr class="tbl-gap"><th colspan="3"></th></tr></thead><tbody>';
        data.forEach(r => {
            const date = new Date(r.created_at).toLocaleDateString('ru-LT');
            const isIn = r.type === 'приход';
            const sign = isIn ? '+' : '−';
            const color = isIn ? '#4f6349' : '#c0685c';
            html += `<tr class="border-b ing-hist-row" ${dataAction('editSfInventoryRecord', [r.id, Number(r.quantity), r.notes || ''])}>
                <td class="p-0.5">${date}</td>
                <td class="p-0.5 text-right font-semibold" style="color:${color};">${sign}${Number(r.quantity).toFixed(2)} ${unitLabel}</td>
                <td class="p-0.5 text-gray-500">${escapeHtml(r.notes || '')}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        histEl.innerHTML = html;
    } catch(e) { console.error(e); }
}

// Разворачивает/сворачивает объединённый блок "Динамика себестоимости" —
// график и история движений строятся лениво, только при первом раскрытии.
async function toggleSfPriceBlock() {
    const content = document.getElementById('sfPriceContent');
    const chevron = document.getElementById('sfPriceChevron');
    if (!content) return;
    const willShow = content.classList.contains('hidden');
    content.classList.toggle('hidden');
    if (chevron) chevron.style.transform = willShow ? 'rotate(180deg)' : '';
    if (willShow) {
        const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
        if (!sf) return;
        renderSfCostChart(sf); // история склада — в своём разделе (21.10)
    }
}

// Средний расход п/ф в день — по реальным движениям склада (21.10, inventory.js stockState).
function avgDailySfUsage(sfId, periodDays) {
    return stockState('sf', sfId, stockStateContext(periodDays || 30)).daily;
}

// Отметить основной ингредиент в рецепте п/ф
async function setSfPrimaryIngredient(idx) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    showLoading();
    try {
        suppressRealtimeFor3s();
        // Снимаем is_primary со всех
        for (const ri of sf.ingredients) {
            if (ri.is_primary) {
                await dbMust(db.from('semi_finished_ingredients').update({ is_primary: false }).eq('id', ri.id));
                ri.is_primary = false;
            }
        }
        // Ставим на выбранный
        const ri = sf.ingredients[idx];
        await dbMust(db.from('semi_finished_ingredients').update({ is_primary: true }).eq('id', ri.id));
        ri.is_primary = true;
        renderSemiFinishedRecipe(sf);
    } catch(e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// Произвести партию — шаг 1: ввод количества основного ингредиента
async function produceSfBatch() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    if (!sf.ingredients || !sf.ingredients.length) {
        showInfo(t('sf_recipe_not_filled')); return;
    }
    const unitLabel = unitAbbrev(sf.unit);

    const primaryRi = sf.ingredients.find(ri => ri.is_primary);
    if (!primaryRi) {
        showInfo(t('sf_specify_primary_ingredient')); return;
    }
    const primaryIng = ingredients.find(i => i.id === primaryRi.ingredient_id);
    const primaryUnitLabel = primaryIng ? (unitAbbrev(primaryIng.unit)) : '';

    // Шаг 1: ввод количества основного ингредиента
    document.getElementById('sfProduceIngName').textContent = primaryIng ? primaryIng.name : '';
    document.getElementById('sfProduceIngUnit').textContent = primaryUnitLabel;
    document.getElementById('sfProduceIngQty').value = primaryRi.quantity;
    document.getElementById('sfProduceModal').style.display = 'flex';
}

// Шаг 2: рассчитать выход и открыть окно подтверждения
async function sfProduceCalc() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const unitLabel = unitAbbrev(sf.unit);

    const primaryRi = sf.ingredients.find(ri => ri.is_primary);
    if (!primaryRi) return;

    const inputQty = parseFloat(document.getElementById('sfProduceIngQty').value);
    if (isNaN(inputQty) || inputQty <= 0) { showInfo(t('inv_enter_valid_qty')); return; }

    const factor = inputQty / Number(primaryRi.quantity);
    const sfResultCalc = parseFloat((Number(sf.batch_size) * factor).toFixed(4));

    // Проверяем наличие всех ингредиентов
    const shortages = [];
    sf.ingredients.forEach(ri => {
        if (!ri.ingredient_id) return;
        const needed = parseFloat((Number(ri.quantity) * factor).toFixed(4));
        const balance = getIngredientBalance(ri.ingredient_id) || 0;
        if (balance < needed) {
            const ing = ingredients.find(i => i.id === ri.ingredient_id);
            const ingUnit = ing ? unitAbbrev(ing.unit) : '';
            shortages.push(`«${ing ? ing.name : '?'}»: ${t('sf_needed')} ${needed.toFixed(1)} ${ingUnit}, ${t('sf_have')} ${balance.toFixed(1)} ${ingUnit}`);
        }
    });

    if (shortages.length) {
        closeModal();
        await showInfo(t('sf_not_enough_ingredients') + '\n' + shortages.join('\n'));
        return;
    }

    // Переходим к шагу подтверждения
    const primaryIng = ingredients.find(i => i.id === primaryRi.ingredient_id);
    const primaryUnitLabel = primaryIng ? (unitAbbrev(primaryIng.unit)) : '';

    document.getElementById('sfConfirmIngLine').textContent =
        `${primaryIng ? primaryIng.name : ''}: ${inputQty} ${primaryUnitLabel}`;
    document.getElementById('sfConfirmResultQty').value = sfResultCalc;
    document.getElementById('sfConfirmResultUnit').textContent = unitLabel;

    // Сохраняем factor для финального шага
    document.getElementById('sfConfirmModal').dataset.factor = factor;
    document.getElementById('sfConfirmModal').dataset.sfId = sf.id;

    closeModal();
    document.getElementById('sfConfirmModal').style.display = 'flex';
}

// Шаг 3: финальное подтверждение и запись
async function confirmSfProduce() {
    const modal = document.getElementById('sfConfirmModal');
    const sfId = Number(modal.dataset.sfId);
    const factor = Number(modal.dataset.factor);
    const sf = semiFinished.find(s => s.id === sfId);
    if (!sf) return;

    const unitLabel = unitAbbrev(sf.unit);

    const actualResult = parseFloat(document.getElementById('sfConfirmResultQty').value);
    if (isNaN(actualResult) || actualResult <= 0) { showInfo(t('sf_enter_valid_output')); return; }

    closeModal();
    showLoading(t('sf_recording_production'));
    try {
        const today = getLocalDateStr(0);
        let actualIngredientsCost = 0;

        for (const ri of sf.ingredients) {
            if (!ri.ingredient_id) continue;
            const qty = parseFloat((Number(ri.quantity) * factor).toFixed(4));
            const ing = ingredients.find(i => i.id === ri.ingredient_id);
            const shortagePrice = ing ? ingredientUnitPrice(ing) : 0;
            const { data, error } = await db.rpc('rpc_write_off_stock', {
                p_org_id: currentOrgId,
                p_item_type: 'ingredient',
                p_item_id: ri.ingredient_id,
                p_qty: qty,
                p_shortage_price: shortagePrice,
                p_notes: `${t('sf_production_note')} «${sf.name}»`
            });
            if (error) throw error;
            actualIngredientsCost += Number(data.totalCost) || 0;
        }

        // Фактическая себестоимость партии = фактически списанные ингредиенты (по FIFO)
        // + прочие расходы (масштабированы тем же коэффициентом, что и рецепт)
        const totalBatchCost = actualIngredientsCost + (sf.other_costs || 0) * factor;
        const unitPrice = actualResult > 0 ? totalBatchCost / actualResult : 0;
        const { error: receiveError } = await db.rpc('rpc_receive_stock', {
            p_org_id: currentOrgId,
            p_item_type: 'semi_finished',
            p_item_id: sf.id,
            p_unit_price: unitPrice,
            p_qty: actualResult,
            p_source: 'производство',
            p_notes: `${t('sf_batch_produced_note')} ${today}`
        });
        if (receiveError) throw receiveError;

        await loadInventory();
        await renderSfStockBlock(sf);
        logActivity('inventory', `${t('log_batch_produced')} «${sf.name}» ${actualResult} ${unitLabel}`);
        await showInfo(`${t('sf_batch_produced_success')} +${actualResult} ${unitLabel} ${t('sf_in_stock')}.`);
    } catch(e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// Списание п/ф вручную
function openSfWriteOffModal() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    document.getElementById('sfWriteOffName').textContent = `${t('sf_semifinished_word')}: ${sf.name}`;
    document.getElementById('sfWriteOffUnit').textContent = unitAbbrev(sf.unit);
    document.getElementById('sfWriteOffQty').value = '';
    document.getElementById('sfWriteOffNote').value = '';
    document.getElementById('sfWriteOffModal').style.display = 'flex';
}

async function saveSfWriteOff() {
    const sf  = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const qty  = parseFloat(document.getElementById('sfWriteOffQty').value);
    const note = document.getElementById('sfWriteOffNote').value.trim();
    if (isNaN(qty) || qty <= 0) { showInfo(t('inv_enter_valid_qty')); return; }
    showLoading();
    try {
        const shortagePrice = semiFinishedUnitCost(sf);
        const { error } = await db.rpc('rpc_write_off_stock', {
            p_org_id: currentOrgId,
            p_item_type: 'semi_finished',
            p_item_id: sf.id,
            p_qty: qty,
            p_shortage_price: shortagePrice,
            p_notes: `${t('ing_adjustment_note')}: ${note || t('ing_no_reason')}`
        });
        if (error) throw error;
        await loadInventory();
        closeModal();
        await renderSfStockBlock(sf);
    } catch(e) { console.error(e); showInfo(t('common_error_generic')); }
    finally { hideLoading(); }
}

// Редактирование записи истории п/ф
function editSfInventoryRecord(id, qty, notes) {
    document.getElementById('editInventoryId').value = id;
    document.getElementById('editInventoryQty').value = qty;
    document.getElementById('editInventoryNotes').value = notes;
    document.getElementById('editInventoryModal').style.display = 'flex';
}

// Инвентаризация полуфабрикатов
function openSfInventarizationModal(singleSfId) {
    // Весь список — страница (22.10, inventory.js openStockCountPage); одна позиция — окно
    if (singleSfId == null && typeof openStockCountPage === 'function') { openStockCountPage('sf'); return; }
    const pendingMap = typeof computePendingWriteoffMap === 'function' ? computePendingWriteoffMap() : {};
    let list = semiFinished.slice();
    if (singleSfId != null) list = list.filter(sf => sf.id === singleSfId);
    const sorted = list.sort((a, b) => (a.name||'').localeCompare(b.name||''));
    let html = '<table class="w-full table-text table-clean">';
    html += '<thead><tr style="background-color:#e3e8df;"><th class="p-1 text-left">' + t('delete_label_semifinished') + '</th><th class="p-1 text-right">' + t('sf_current_balance') + '</th><th class="p-1 text-right">' + t('sf_actual') + '</th></tr><tr class="tbl-gap"><th colspan="3"></th></tr></thead><tbody>';
    sorted.forEach(sf => {
        const unitLabel = unitAbbrev(sf.unit);
        const balance   = getSemiFinishedBalanceBeforeWriteoff(sf.id, pendingMap);
        const balStr    = balance !== null ? `${Number(balance).toFixed(2)} ${unitLabel}` : '—';
        html += `<tr class="border-b">
            <td class="p-0.5">${escapeHtml(sf.name)}</td>
            <td class="p-0.5 text-right text-gray-500">${balStr}</td>
            <td class="p-0.5 text-right">
                <input type="number" inputmode="decimal" step="0.01" min="0"
                    data-sf-id="${sf.id}" data-unit="${unitLabel}"
                    class="sf-inv-qty-input border p-0.5 rounded table-text w-24 text-right"
                    placeholder="${unitLabel}">
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('sfInventarizationHint').textContent = singleSfId != null ? t('ing_inventarization_desc') : t('inv_enter_actual_qty');
    document.getElementById('sfInventarizationContent').innerHTML = html;
    document.getElementById('sfInventarizationModal').style.display = 'flex';
}

async function saveSfInventarization() {
    const inputs = document.querySelectorAll('.sf-inv-qty-input');
    const today  = getLocalDateStr(0);
    const rows   = [];
    const pendingMap = typeof computePendingWriteoffMap === 'function' ? computePendingWriteoffMap() : {};
    inputs.forEach(input => {
        const val = parseFloat(input.value);
        if (isNaN(val) || input.value === '') return;
        const sfId    = Number(input.dataset.sfId);
        const balance = getSemiFinishedBalanceBeforeWriteoff(sfId, pendingMap) || 0;
        const diff    = parseFloat((val - balance).toFixed(4));
        if (Math.abs(diff) < 0.0001) return;
        rows.push({
            semi_finished_id: sfId,
            ingredient_id: null,
            type:     diff > 0 ? 'приход' : 'расход',
            quantity: Math.abs(diff),
            notes:    `${t('ing_inventarization_note')} ${today}`
        });
    });
    if (!rows.length) { await showInfo(t('sf_no_changes')); return; }
    const ok = await showConfirm(`${t('sf_record_adjustments_confirm')} ${rows.length}?`);
    if (!ok) return;
    showLoading();
    try {
        // Как и у ингредиентов: излишек — новая партия по текущей расчётной
        // себестоимости, недостача — списание по FIFO со старейших партий.
        // Каждая строка — атомарная RPC (приход или списание + запись в inventory).
        for (const r of rows) {
            const sf = semiFinished.find(s => s.id === r.semi_finished_id);
            if (!sf) continue;
            const price = semiFinishedUnitCost(sf);
            if (r.type === 'приход') {
                const { error } = await db.rpc('rpc_receive_stock', {
                    p_org_id: currentOrgId, p_item_type: 'semi_finished', p_item_id: r.semi_finished_id,
                    p_unit_price: price, p_qty: r.quantity, p_source: 'инвентаризация', p_notes: r.notes
                });
                if (error) throw error;
            } else {
                const { error } = await db.rpc('rpc_write_off_stock', {
                    p_org_id: currentOrgId, p_item_type: 'semi_finished', p_item_id: r.semi_finished_id,
                    p_qty: r.quantity, p_shortage_price: price, p_notes: r.notes
                });
                if (error) throw error;
            }
        }

        await loadInventory();
        closeModal();
        displaySemiFinished();
        // Инвентаризация из карточки полуфабриката (21.10, вариант Б): остаёмся в карточке
        // с новым остатком; «Назад» из неё ведёт туда, откуда карточку открыли.
        if (currentSemiFinishedId != null && document.getElementById('semiFinishedDetail')?.classList.contains('active')) {
            const sfOpen = semiFinished.find(x => x.id === currentSemiFinishedId);
            if (sfOpen && typeof renderSfStockBlock === 'function') renderSfStockBlock(sfOpen);
        }
        logActivity('inventory', `${t('sf_inventarization_title')} ${today}: ${rows.length} ${t('common_positions_word')}`);
        await showInfo(`${t('toast_saved')}: ${rows.length} ${t('common_positions_word')}.`);
    } catch(e) { console.error(e); showInfo(t('common_error_generic')); }
    finally { hideLoading(); }
}

// ==================== ГРАФИК СЕБЕСТОИМОСТИ П/Ф ====================
let _sfCostChartInstance = null;
let _sfCostPts = [];
let _sfCostPeriod = 'all';
function setSfCostPeriod(period) { _sfCostPeriod = period; drawSfCostChart(); }

async function renderSfCostChart(sf) {
    const canvas  = document.getElementById('sfCostChart');
    const emptyEl = document.getElementById('sfCostChartEmpty');
    if (!canvas || !emptyEl) return;

    const ingIds = (sf.ingredients || []).map(ri => ri.ingredient_id).filter(Boolean);
    if (!ingIds.length) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    // Загружаем производства п/ф (приходы на склад)
    const { data: productions } = await db.from('inventory')
        .select('quantity, created_at')
        .eq('semi_finished_id', sf.id)
        .eq('type', 'приход')
        .order('created_at', { ascending: true });

    if (!productions || productions.length < 2) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    // Загружаем историю цен ингредиентов состава
    const { data: ph } = await db.from('ingredient_price_history')
        .select('ingredient_id, valid_from, package_price, package_size')
        .in('ingredient_id', ingIds)
        .order('valid_from', { ascending: true });

    if (!ph || !ph.length) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    // Группируем историю цен по ингредиенту
    const histByIng = {};
    ph.forEach(r => {
        if (!histByIng[r.ingredient_id]) histByIng[r.ingredient_id] = [];
        histByIng[r.ingredient_id].push(r);
    });

    // Цена ингредиента на конкретную дату
    function getUnitPriceOnDate(ingId, dateStr) {
        const hist = histByIng[ingId] || [];
        const valid = hist.filter(r => r.valid_from <= dateStr);
        if (!valid.length) return null;
        const last = valid[valid.length - 1];
        return last.package_price / last.package_size;
    }

    // Для каждой партии считаем себестоимость на дату её производства
    const labels = [];
    const costs  = [];
    _sfCostPts = [];

    for (const prod of productions) {
        const dateStr = prod.created_at.slice(0, 10); // YYYY-MM-DD
        const factor  = Number(prod.quantity) / Number(sf.batch_size || 1);
        let cost = Number(sf.other_costs || 0) * factor;
        let hasAllPrices = true;

        for (const ri of sf.ingredients || []) {
            if (!ri.ingredient_id) continue;
            const unitPrice = getUnitPriceOnDate(ri.ingredient_id, dateStr);
            if (unitPrice === null) { hasAllPrices = false; break; }
            cost += unitPrice * Number(ri.quantity) * factor;
        }

        if (!hasAllPrices) continue;
        labels.push(formatDateDMY(dateStr));
        costs.push(parseFloat(cost.toFixed(4)));
        _sfCostPts.push({ date: dateStr, cost: parseFloat(cost.toFixed(4)) });
    }

    if (costs.length < 2) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }
    _sfCostPeriod = 'all';
    await drawSfCostChart();
}

async function drawSfCostChart() {
    const canvas  = document.getElementById('sfCostChart');
    const emptyEl = document.getElementById('sfCostChartEmpty');
    if (!canvas || !emptyEl) return;
    sbSetPeriodButtons('sf', _sfCostPeriod);
    const points = sbPeriodPoints(_sfCostPts, _sfCostPeriod);
    if (points.length < 2) {
        if (_sfCostChartInstance) { _sfCostChartInstance.destroy(); _sfCostChartInstance = null; }
        canvas.style.display = 'none';
        emptyEl.textContent = t('prod_cost_no_changes_period');
        emptyEl.classList.remove('hidden');
        return;
    }
    const labels = points.map(p => formatDateDMY(p.date));
    const costs  = points.map(p => p.cost);

    try { await ensureChartJs(); } catch (e) { console.error(e); return; }
    if (!canvas.isConnected) return;
    if (_sfCostChartInstance) { _sfCostChartInstance.destroy(); _sfCostChartInstance = null; }

    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const ctx = canvas.getContext('2d');
    _sfCostChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `${t('sf_batch_cost')} (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency})`,
                data: costs,
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
                        label: ctx => formatMoney(ctx.parsed.y, 4)
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 10 } } },
                y: {
                    ticks: { font: { size: 10 }, callback: v => formatMoney(v) },
                    beginAtZero: false
                }
            }
        }
    });
}
