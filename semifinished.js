// ==================== ПОЛУФАБРИКАТЫ ====================
// Промежуточные составы (крем, конфитюр, тесто и т.п.), используемые в рецептах изделий.
// Состоят только из обычных ингредиентов (без вложенности других полуфабрикатов).
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), ingredients (ingredients.js), ingredientUnitPrice (money.js),
// showLoading/hideLoading, logActivity (employees.js), svgEdit/svgDelete (helpers.js),
// openDeleteModal, closeModal (modals.js), editIndex (главный скрипт).

let semiFinished = []; // [{id, name, batch_size, unit, other_costs, ingredients:[{id, ingredient_id, quantity}]}]

const SF_UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л' };

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

function displaySemiFinished() {
    semiFinished.sort((a, b) => (a.name||"").localeCompare(b.name||""));
    const tbody = document.getElementById('semiFinishedTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let warningCount = 0;

    // Считаем нехватку для принятых заказов
    const today = typeof getLocalDateStr === 'function' ? getLocalDateStr(0) : new Date().toISOString().slice(0, 10);
    const neededForOrders = {};
    (orders || []).filter(o => o.status !== 'выполнен' && o.date >= today).forEach(o => {
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                if (!ri.semi_finished_id) return;
                neededForOrders[ri.semi_finished_id] = (neededForOrders[ri.semi_finished_id] || 0) +
                    Number(ri.quantity) * Number(item.quantity) * factor;
            });
        });
    });

    semiFinished.forEach((sf, i) => {
        const unitLabel = SF_UNIT_LABELS[sf.unit] || sf.unit;
        const unitCost  = semiFinishedUnitCost(sf);
        const balance   = typeof getSemiFinishedBalance === 'function' ? getSemiFinishedBalance(sf.id) : null;
        const daily     = typeof avgDailySfUsage === 'function' ? avgDailySfUsage(sf.id) : 0;
        const daysLeft  = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const needed    = neededForOrders[sf.id] || 0;
        const shortage  = needed > 0 && (balance === null || balance < needed);

        if (!sf.recipe_confirmed) warningCount++;

        const balanceStr = balance !== null && balance > 0
            ? `${Number(balance).toFixed(1)} ${unitLabel}`
            : balance !== null && balance <= 0
                ? `<span class="text-red-600 font-semibold">${Number(balance).toFixed(1)} ${unitLabel}</span>`
                : '<span class="text-gray-400">—</span>';

        const colorClass = shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3)
            ? 'text-red-600' : daysLeft !== null && daysLeft < 7 ? 'text-yellow-600' : 'text-gray-600';

        const daysStr = daysLeft !== null
            ? `<span class="${colorClass} font-semibold">${daysLeft} дн.</span>`
            : shortage ? '<span class="text-red-600 font-semibold">нехватка</span>'
            : '<span class="text-gray-400">—</span>';

        const isCritical = shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3);
        const isWarning  = !isCritical && daysLeft !== null && daysLeft < 7;
        const accentColor = isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : '';
        const accentBar = accentColor
            ? `<span class="absolute left-0 top-1 bottom-1 w-0.5 rounded-full ${accentColor}"></span>`
            : '';
        const nameCellPad = accentColor ? 'pl-2.5' : '';

        const row = document.createElement('tr');
        row.className = 'order-row border-b';
        row.style.cursor = 'pointer';
        row.innerHTML = `
            <td class=" p-0.5 table-text relative ${nameCellPad}" onclick="openSemiFinishedDetail(${sf.id})">${accentBar}${escapeHtml(sf.name)}</td>
            <td class=" p-0.5 table-text text-center" onclick="openSemiFinishedDetail(${sf.id})">${formatMoney(unitCost, 4)}/${unitLabel}</td>
            <td class=" p-0.5 table-text text-center" onclick="openSemiFinishedDetail(${sf.id})">${balanceStr}</td>
            <td class=" p-0.5 table-text text-center" onclick="openSemiFinishedDetail(${sf.id})">${daysStr}</td>`;
        tbody.appendChild(row);
    });
    const warningEl = document.getElementById('semiFinishedRecipeWarning');
    if (warningEl) warningEl.classList.toggle('hidden', warningCount === 0);
    updateSemiFinishedSelects();
}

// Кнопка "+": сразу создаёт черновик полуфабриката и открывает его карточку
let _draftSemiFinishedIds = new Set();

async function createDraftSemiFinishedAndOpen() {
    showLoading();
    try {
        const { data, error } = await db.from('semi_finished').insert({ org_id: currentOrgId, name: '', batch_size: 1, unit: 'g', other_costs: 0 }).select().single();
        if (error) throw error;
        const newSf = { id: data.id, name: '', batch_size: 1, unit: 'g', other_costs: 0, recipe_confirmed: false, ingredients: [] };
        semiFinished.push(newSf);
        _draftSemiFinishedIds.add(newSf.id);
        displaySemiFinished();
        openSemiFinishedDetail(newSf.id);
        logActivity('semiFinished', `Создан черновик полуфабриката №${newSf.id}`);
    } catch (e) { console.error(e); showInfo('Ошибка создания полуфабриката. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function cleanupSemiFinishedDraftIfEmpty(sfId) {
    if (!_draftSemiFinishedIds.has(sfId)) return;
    _draftSemiFinishedIds.delete(sfId);
    const idx = semiFinished.findIndex(s => s.id === sfId);
    if (idx === -1) return;
    if (semiFinished[idx].name && semiFinished[idx].name.trim()) return; // название вписали — уже не пустой черновик
    try {
        await db.from('semi_finished').delete().eq('id', sfId);
        semiFinished.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик полуфабриката:', e); }
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

    document.getElementById('sfdName').value = sf.name;
    document.getElementById('sfdBatchSize').value = sf.batch_size;
    document.getElementById('sfdUnit').value = sf.unit;
    document.getElementById('sfdOtherCosts').value = (sf.other_costs || 0).toFixed(2);
    document.getElementById('sfdRecipeConfirmed').checked = !!sf.recipe_confirmed;
    document.getElementById('sfdTrackStock').checked = !!sf.track_stock;

    renderSemiFinishedRecipe(sf);
    fillNewSfRecipeIngredientSelect();
    setupCopySfRecipeControl(sf);
    renderSfStockBlock(sf);
    renderSfCostChart(sf);
    refreshFab();
}

async function closeSemiFinishedDetail() {
    const leavingId = currentSemiFinishedId;
    currentSemiFinishedId = null;
    document.getElementById('semiFinishedList').classList.remove('hidden');
    document.getElementById('semiFinishedDetail').classList.remove('active');
    if (leavingId !== null) await cleanupSemiFinishedDraftIfEmpty(leavingId);
    displaySemiFinished();
    refreshFab();
}

// Удаление полуфабриката прямо из его карточки (то же окно подтверждения, что и из списка)
function deleteCurrentSemiFinished() {
    const idx = semiFinished.findIndex(s => s.id === currentSemiFinishedId);
    if (idx === -1) return;
    const sf = semiFinished[idx];
    openDeleteModal(idx, 'semiFinished', `полуфабрикат «${sf.name || '(без названия)'}»`);
}

async function saveSfdHeader() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const name = document.getElementById('sfdName').value.trim();
    const batchSize = parseFloat(document.getElementById('sfdBatchSize').value);
    const unit = document.getElementById('sfdUnit').value;
    const otherCosts = parseFloat(document.getElementById('sfdOtherCosts').value) || 0;
    if (!name || isNaN(batchSize) || batchSize <= 0) { showInfo('Заполните название и размер партии корректно!'); return; }

    showLoading();
    try {
        const { error } = await db.from('semi_finished').update({
            name, batch_size: batchSize, unit, other_costs: parseFloat(otherCosts.toFixed(2))
        }).eq('id', sf.id);
        if (error) throw error;
        sf.name = name; sf.batch_size = batchSize; sf.unit = unit; sf.other_costs = parseFloat(otherCosts.toFixed(2));
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `Изменён полуфабрикат «${sf.name}»`);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
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
        row.innerHTML = `<td colspan="4" class="text-center text-xs text-gray-400 py-2">Нет ингредиентов. Добавьте ниже.</td>`;
        tbody.appendChild(row);
    } else {
        list.forEach((ri, i) => {
            const ing = ingredients.find(x => x.id === ri.ingredient_id);
            const unitPrice = ing ? ingredientUnitPrice(ing) : 0;
            const lineCost = unitPrice * ri.quantity;
            const isPrimary = !!ri.is_primary;
            const starBtn = `<button onclick="setSfPrimaryIngredient(${i})" title="Сделать основным" class="inline-flex ${isPrimary ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isPrimary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.98 21.539a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg></button>`;
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.innerHTML = `
                <td class="p-0.5 table-text">${starBtn} ${escapeHtml(ing ? ing.name : '(удалён)')}</td>
                <td class="p-0.5 table-text text-center">${ri.quantity} ${ing ? UNIT_LABELS[ing.unit] : ''}</td>
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
    const unitLabel = SF_UNIT_LABELS[sf.unit] || sf.unit;

    document.getElementById('sfdBatchCost').textContent = formatMoney(batchCost);
    document.getElementById('sfdUnitCost').textContent  = formatMoney(unitCost, 4) + `/${unitLabel}`;
}

async function addIngredientToSfRecipe() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const inputEl = document.getElementById('newSfRecipeIngredient');
    const quantity = parseFloat(document.getElementById('newSfRecipeQty').value);
    const ing = ingredients.find(i => i.name === inputEl.value.trim());
    if (!ing || isNaN(quantity) || quantity <= 0) {
        showInfo('Выберите ингредиент из списка и укажите количество!'); return;
    }
    const ingredientId = ing.id;

    showLoading();
    try {
        const { data, error } = await db.from('semi_finished_ingredients').insert({
            org_id: currentOrgId,
            semi_finished_id: sf.id, ingredient_id: ingredientId, quantity
        }).select().single();
        if (error) throw error;
        if (!sf.ingredients) sf.ingredients = [];
        sf.ingredients.push({ id: data.id, ingredient_id: ingredientId, quantity: Number(data.quantity) });
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `В рецепт «${sf.name}» добавлен ингредиент «${ing.name}» (${quantity})`);
        inputEl.value = '';
        document.getElementById('newSfRecipeQty').value = '';
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

let editSfRecipeItemIdx = null;

function openEditSfRecipeItemModal(i) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    editSfRecipeItemIdx = i;
    const ri = sf.ingredients[i];

    const sel = document.getElementById('editSfRecipeIngredient');
    sel.innerHTML = '<option value="">Выберите ингредиент</option>';
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
        showInfo('Заполните все поля корректно!'); return;
    }
    const ingredientId = Number(ingredientIdRaw);
    const ri = sf.ingredients[editSfRecipeItemIdx];

    showLoading();
    try {
        const { error } = await db.from('semi_finished_ingredients').update({
            ingredient_id: ingredientId, quantity
        }).eq('id', ri.id);
        if (error) throw error;
        sf.ingredients[editSfRecipeItemIdx] = { id: ri.id, ingredient_id: ingredientId, quantity };
        renderSemiFinishedRecipe(sf);
        closeModal();
        logActivity('semiFinished', `Изменён ингредиент в рецепте «${sf.name}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function deleteSfRecipeItem(i) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const ri = sf.ingredients[i];
    const ing = ingredients.find(x => x.id === ri.ingredient_id);
    openDeleteModal(i, 'sfRecipeItem', `ингредиент «${ing ? ing.name : ''}» из рецепта полуфабриката`);
}

// ==================== ПОДТВЕРЖДЕНИЕ "РЕЦЕПТ ЗАПОЛНЕН ПОЛНОСТЬЮ" ====================
async function toggleSfRecipeConfirmed() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const checked = document.getElementById('sfdRecipeConfirmed').checked;
    showLoading();
    try {
        const { error } = await db.from('semi_finished').update({ recipe_confirmed: checked }).eq('id', sf.id);
        if (error) throw error;
        sf.recipe_confirmed = checked;
        logActivity('semiFinished', `Рецепт «${sf.name}» отмечен как ${checked ? 'заполненный полностью' : 'неполный'}`);
    } catch (e) {
        console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.');
        document.getElementById('sfdRecipeConfirmed').checked = !checked;
    } finally { hideLoading(); }
}

async function toggleSfTrackStock() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const checked = document.getElementById('sfdTrackStock').checked;
    showLoading();
    try {
        const { error } = await db.from('semi_finished').update({ track_stock: checked }).eq('id', sf.id);
        if (error) throw error;
        sf.track_stock = checked;
        if (typeof updateInventoryAlertDot === 'function') updateInventoryAlertDot();
        logActivity('semiFinished', `«${sf.name}» — отслеживание склада ${checked ? 'включено' : 'отключено'}`);
    } catch (e) {
        console.error(e); showInfo('Ошибка сохранения.');
        document.getElementById('sfdTrackStock').checked = !checked;
    } finally { hideLoading(); }
}

async function resetSfRecipeConfirmed(sf) {
    if (!sf.recipe_confirmed) return;
    sf.recipe_confirmed = false;
    const checkbox = document.getElementById('sfdRecipeConfirmed');
    if (checkbox) checkbox.checked = false;
    try {
        await db.from('semi_finished').update({ recipe_confirmed: false }).eq('id', sf.id);
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
    if (!srcItems.length) { showInfo('У выбранного полуфабриката нет рецепта.'); return; }

    const existingIds = new Set((sf.ingredients || []).map(i => i.ingredient_id));
    const toCopy = srcItems.filter(ri => !existingIds.has(ri.ingredient_id));
    const skipped = srcItems.length - toCopy.length;

    if (!toCopy.length) { showInfo(`Все ингредиенты из рецепта «${sourceName}» уже есть в этом рецепте.`); return; }

    let msg = `Скопировать ${toCopy.length} ${toCopy.length === 1 ? 'позицию' : 'позиций'} из рецепта «${sourceName}» в «${sf.name}»?`;
    if (skipped) msg += `\n(${skipped} уже есть в текущем рецепте — будут пропущены)`;
    if (!(await showConfirm(msg))) return;

    showLoading();
    try {
        const rows = toCopy.map(ri => ({ semi_finished_id: sf.id, ingredient_id: ri.ingredient_id, quantity: ri.quantity }));
        const rowsWithOrg = rows.map(r => ({ org_id: currentOrgId, ...r }));
        const { data, error } = await db.from('semi_finished_ingredients').insert(rowsWithOrg).select();
        if (error) throw error;
        if (!sf.ingredients) sf.ingredients = [];
        data.forEach(d => sf.ingredients.push({ id: d.id, ingredient_id: d.ingredient_id, quantity: Number(d.quantity) }));
        renderSemiFinishedRecipe(sf);
        logActivity('semiFinished', `В рецепт «${sf.name}» скопировано ${toCopy.length} поз. из рецепта «${sourceName}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// Заполнение выпадающего списка полуфабрикатов (для использования в рецептах изделий)
function updateSemiFinishedSelects() {
    // Вызывается из displaySemiFinished; конкретное заполнение списка в рецепте изделия
    // происходит в products.js через fillNewRecipeIngredientSelect/openEditRecipeItemModal
}

// ==================== СКЛАД ПОЛУФАБРИКАТОВ ====================

async function renderSfStockBlock(sf) {
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const unitLabel = UNIT_LABELS[sf.unit] || sf.unit;
    const balance = typeof getSemiFinishedBalance === 'function' ? getSemiFinishedBalance(sf.id) : null;
    const daily   = avgDailySfUsage(sf.id);

    const balEl  = document.getElementById('sfBalanceValue');
    const unitEl = document.getElementById('sfBalanceUnit');
    const daysEl = document.getElementById('sfDaysLeft');

    if (balEl) {
        if (balance !== null && balance > 0) {
            const days = daily > 0 ? Math.floor(balance / daily) : null;
            balEl.textContent = Number(balance).toFixed(2);
            // Цвет: красный < 3 дней, жёлтый < 14 дней, зелёный — норма
            if (days !== null && days < 3)      balEl.className = 'text-lg font-bold text-red-600';
            else if (days !== null && days < 7) balEl.className = 'text-lg font-bold text-yellow-600';
            else                                balEl.className = 'text-lg font-bold text-green-700';
        } else {
            balEl.textContent = '0';
            balEl.className = 'text-lg font-bold text-red-600';
        }
    }
    if (unitEl) unitEl.textContent = unitLabel;
    if (daysEl) {
        if (balance !== null && balance > 0 && daily > 0) {
            const days = Math.floor(balance / daily);
            daysEl.textContent = `~${days} дн. запаса`;
            if (days < 3)      daysEl.className = 'table-text text-red-600 font-semibold';
            else if (days < 7) daysEl.className = 'table-text text-yellow-600 font-semibold';
            else               daysEl.className = 'table-text text-green-700';
        } else {
            daysEl.textContent = daily > 0 ? 'нет запаса' : 'недостаточно истории';
            daysEl.className = 'table-text text-gray-400';
        }
    }

    // История
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
            histEl.innerHTML = '<p class="table-text text-gray-400 mt-1">Движений ещё не было</p>';
            return;
        }
        const totalIn = data.filter(r => r.type === 'приход').reduce((s, r) => s + Number(r.quantity), 0);
        let html = `<p class="table-text text-gray-500 font-semibold mt-2 mb-1">История (произведено: ${totalIn.toFixed(2)} ${unitLabel})</p>`;
        html += '<div style="max-height:224px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">';
        html += '<table class="w-full table-text"><thead><tr class="bg-gray-100 text-xs"><th class="p-1 text-left">Дата</th><th class="p-1 text-right">Кол-во</th><th class="p-1 text-left">Заметка</th></tr></thead><tbody>';
        data.forEach(r => {
            const date = new Date(r.created_at).toLocaleDateString('ru-LT');
            const isIn = r.type === 'приход';
            const sign = isIn ? '+' : '−';
            const color = isIn ? 'text-green-700' : 'text-red-600';
            html += `<tr class="border-b cursor-pointer hover:bg-gray-50" onclick="editSfInventoryRecord(${r.id}, ${Number(r.quantity)}, '${escapeHtml(r.notes || '')}')">
                <td class="p-0.5">${date}</td>
                <td class="p-0.5 text-right ${color} font-semibold">${sign}${Number(r.quantity).toFixed(2)} ${unitLabel}</td>
                <td class="p-0.5 text-gray-500">${escapeHtml(r.notes || '')}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        histEl.innerHTML = html;
    } catch(e) { console.error(e); }
}

// Средний расход п/ф в день за последние 30 дней
function avgDailySfUsage(sfId) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let totalUsed = 0;
    orders.forEach(o => {
        if (o.date < cutoffStr) return;
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            prod.ingredients.forEach(ri => {
                if (ri.semi_finished_id === sfId) {
                    totalUsed += (Number(ri.quantity) / Number(prod.batch_size || 1)) * Number(item.quantity);
                }
            });
        });
    });
    return totalUsed / 30;
}

// Отметить основной ингредиент в рецепте п/ф
async function setSfPrimaryIngredient(idx) {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    showLoading();
    try {
        // Снимаем is_primary со всех
        for (const ri of sf.ingredients) {
            if (ri.is_primary) {
                await db.from('semi_finished_ingredients').update({ is_primary: false }).eq('id', ri.id);
                ri.is_primary = false;
            }
        }
        // Ставим на выбранный
        const ri = sf.ingredients[idx];
        await db.from('semi_finished_ingredients').update({ is_primary: true }).eq('id', ri.id);
        ri.is_primary = true;
        renderSemiFinishedRecipe(sf);
    } catch(e) { console.error(e); showInfo('Ошибка сохранения.'); }
    finally { hideLoading(); }
}

// Произвести партию — шаг 1: ввод количества основного ингредиента
async function produceSfBatch() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    if (!sf.ingredients || !sf.ingredients.length) {
        showInfo('Рецепт не заполнен — нельзя произвести партию.'); return;
    }
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const unitLabel = UNIT_LABELS[sf.unit] || sf.unit;

    const primaryRi = sf.ingredients.find(ri => ri.is_primary);
    if (!primaryRi) {
        showInfo('Укажите основной ингредиент рецепта (нажмите на звёздочку у нужного ингредиента).'); return;
    }
    const primaryIng = ingredients.find(i => i.id === primaryRi.ingredient_id);
    const primaryUnitLabel = primaryIng ? (UNIT_LABELS[primaryIng.unit] || primaryIng.unit) : '';

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
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const unitLabel = UNIT_LABELS[sf.unit] || sf.unit;

    const primaryRi = sf.ingredients.find(ri => ri.is_primary);
    if (!primaryRi) return;

    const inputQty = parseFloat(document.getElementById('sfProduceIngQty').value);
    if (isNaN(inputQty) || inputQty <= 0) { showInfo('Введите корректное количество!'); return; }

    const factor = inputQty / Number(primaryRi.quantity);
    const sfResultCalc = parseFloat((Number(sf.batch_size) * factor).toFixed(4));

    // Проверяем наличие всех ингредиентов
    const UNIT_L = UNIT_LABELS;
    const shortages = [];
    sf.ingredients.forEach(ri => {
        if (!ri.ingredient_id) return;
        const needed = parseFloat((Number(ri.quantity) * factor).toFixed(4));
        const balance = getIngredientBalance(ri.ingredient_id) || 0;
        if (balance < needed) {
            const ing = ingredients.find(i => i.id === ri.ingredient_id);
            const ingUnit = ing ? (UNIT_L[ing.unit] || ing.unit) : '';
            shortages.push(`«${ing ? ing.name : '?'}»: нужно ${needed.toFixed(1)} ${ingUnit}, есть ${balance.toFixed(1)} ${ingUnit}`);
        }
    });

    if (shortages.length) {
        closeModal();
        await showInfo('Не хватает ингредиентов:\n' + shortages.join('\n'));
        return;
    }

    // Переходим к шагу подтверждения
    const primaryIng = ingredients.find(i => i.id === primaryRi.ingredient_id);
    const primaryUnitLabel = primaryIng ? (UNIT_LABELS[primaryIng.unit] || primaryIng.unit) : '';

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

    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const unitLabel = UNIT_LABELS[sf.unit] || sf.unit;

    const actualResult = parseFloat(document.getElementById('sfConfirmResultQty').value);
    if (isNaN(actualResult) || actualResult <= 0) { showInfo('Введите корректный выход!'); return; }

    closeModal();
    showLoading('Записываю производство...');
    try {
        const today = getLocalDateStr(0);
        const rows = [];

        sf.ingredients.forEach(ri => {
            if (ri.ingredient_id) {
                rows.push({
                    ingredient_id: ri.ingredient_id,
                    semi_finished_id: null,
                    type: 'расход',
                    quantity: parseFloat((Number(ri.quantity) * factor).toFixed(4)),
                    notes: `Производство п/ф «${sf.name}»`
                });
            }
        });

        rows.push({
            ingredient_id: null,
            semi_finished_id: sf.id,
            type: 'приход',
            quantity: actualResult,
            notes: `Произведена партия ${today}`
        });

        const rowsWithOrg = rows.map(r => ({ org_id: currentOrgId, ...r }));
        await db.from('inventory').insert(rowsWithOrg);
        await loadInventory();
        await renderSfStockBlock(sf);
        logActivity('inventory', `Произведена партия п/ф «${sf.name}» ${actualResult} ${unitLabel}`);
        await showInfo(`Партия произведена! +${actualResult} ${unitLabel} на складе.`);
    } catch(e) { console.error(e); showInfo('Ошибка сохранения.'); }
    finally { hideLoading(); }
}

// Списание п/ф вручную
function openSfWriteOffModal() {
    const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    document.getElementById('sfWriteOffName').textContent = `Полуфабрикат: ${sf.name}`;
    document.getElementById('sfWriteOffUnit').textContent = UNIT_LABELS[sf.unit] || sf.unit;
    document.getElementById('sfWriteOffQty').value = '';
    document.getElementById('sfWriteOffNote').value = '';
    document.getElementById('sfWriteOffModal').style.display = 'flex';
}

async function saveSfWriteOff() {
    const sf  = semiFinished.find(s => s.id === currentSemiFinishedId);
    if (!sf) return;
    const qty  = parseFloat(document.getElementById('sfWriteOffQty').value);
    const note = document.getElementById('sfWriteOffNote').value.trim();
    if (isNaN(qty) || qty <= 0) { showInfo('Введите корректное количество!'); return; }
    showLoading();
    try {
        await db.from('inventory').insert({
            org_id: currentOrgId,
            semi_finished_id: sf.id,
            ingredient_id: null,
            type: 'расход',
            quantity: parseFloat(qty.toFixed(4)),
            notes: `Корректировка: ${note || 'без причины'}`
        });
        await loadInventory();
        closeModal();
        await renderSfStockBlock(sf);
    } catch(e) { console.error(e); showInfo('Ошибка.'); }
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
function openSfInventarizationModal() {
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const sorted = semiFinished.slice().sort((a, b) => (a.name||'').localeCompare(b.name||''));
    let html = '<table class="w-full text-xs">';
    html += '<thead><tr class="bg-gray-100"><th class="p-1 text-left">Полуфабрикат</th><th class="p-1 text-right">Текущий остаток</th><th class="p-1 text-right">Фактически</th></tr></thead><tbody>';
    sorted.forEach(sf => {
        const unitLabel = UNIT_LABELS[sf.unit] || sf.unit;
        const balance   = getSemiFinishedBalance(sf.id);
        const balStr    = balance !== null ? `${Number(balance).toFixed(2)} ${unitLabel}` : '—';
        html += `<tr class="border-b">
            <td class="p-0.5">${escapeHtml(sf.name)}</td>
            <td class="p-0.5 text-right text-gray-500">${balStr}</td>
            <td class="p-0.5 text-right">
                <input type="number" inputmode="decimal" step="0.01" min="0"
                    data-sf-id="${sf.id}" data-unit="${unitLabel}"
                    class="sf-inv-qty-input border p-0.5 rounded text-xs w-24 text-right"
                    placeholder="${unitLabel}">
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('sfInventarizationContent').innerHTML = html;
    document.getElementById('sfInventarizationModal').style.display = 'flex';
}

async function saveSfInventarization() {
    const inputs = document.querySelectorAll('.sf-inv-qty-input');
    const today  = getLocalDateStr(0);
    const rows   = [];
    inputs.forEach(input => {
        const val = parseFloat(input.value);
        if (isNaN(val) || input.value === '') return;
        const sfId    = Number(input.dataset.sfId);
        const balance = getSemiFinishedBalance(sfId) || 0;
        const diff    = parseFloat((val - balance).toFixed(4));
        if (Math.abs(diff) < 0.0001) return;
        rows.push({
            semi_finished_id: sfId,
            ingredient_id: null,
            type:     diff > 0 ? 'приход' : 'расход',
            quantity: Math.abs(diff),
            notes:    `Инвентаризация ${today}`
        });
    });
    if (!rows.length) { await showInfo('Нет изменений.'); return; }
    const ok = await showConfirm(`Записать ${rows.length} корректировок?`);
    if (!ok) return;
    showLoading();
    try {
        const inventoryRows = rows.map(r => ({ org_id: currentOrgId, ...r }));
        await db.from('inventory').insert(inventoryRows);
        await loadInventory();
        closeModal();
        logActivity('inventory', `Инвентаризация п/ф ${today}: ${rows.length} позиций`);
        await showInfo(`Сохранено: ${rows.length} позиций.`);
    } catch(e) { console.error(e); showInfo('Ошибка.'); }
    finally { hideLoading(); }
}

// ==================== ГРАФИК СЕБЕСТОИМОСТИ П/Ф ====================
let _sfCostChartInstance = null;

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
    }

    if (costs.length < 2) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    if (_sfCostChartInstance) { _sfCostChartInstance.destroy(); _sfCostChartInstance = null; }

    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const ctx = canvas.getContext('2d');
    _sfCostChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `Себестоимость партии (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency})`,
                data: costs,
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.08)',
                pointBackgroundColor: '#4f46e5',
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
