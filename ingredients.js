// ==================== ИНГРЕДИЕНТЫ ====================
// Справочник ингредиентов: название, цена за упаковку, размер упаковки, единица измерения.
// Цена за единицу считается автоматически.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), showLoading/hideLoading,
// logActivity (employees.js), svgEdit/svgDelete (helpers.js),
// openDeleteModal, closeModal (modals.js).

let ingredients = []; // [{id, name, package_price, package_size, unit}]

const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

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

function displayIngredients() {
    ingredients.sort((a, b) => (a.name||"").localeCompare(b.name||""));
    const tbody = document.getElementById('ingredientTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Считаем сколько нужно для принятых заказов
    const today = typeof getLocalDateStr === 'function' ? getLocalDateStr(0) : new Date().toISOString().slice(0, 10);
    const neededForOrders = {};
    (orders || []).filter(o => o.status !== 'выполнен' && o.date >= today).forEach(o => {
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                if (!ri.ingredient_id) return;
                const qty = Number(ri.quantity) * Number(item.quantity) * factor;
                neededForOrders[ri.ingredient_id] = (neededForOrders[ri.ingredient_id] || 0) + qty;
            });
        });
    });

    ingredients.forEach((ing) => {
        const unitPrice = ingredientUnitPrice(ing);
        const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
        const balance  = typeof getIngredientBalance === 'function' ? getIngredientBalance(ing.id) : null;
        const daily    = typeof avgDailyUsage === 'function' ? avgDailyUsage(ing.id) : 0;
        const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const needed   = neededForOrders[ing.id] || 0;
        const shortfall = needed > 0 && (balance === null || balance < needed); // не хватает для заказа

        const balanceStr = balance !== null && balance > 0
            ? `${Number(balance).toFixed(1)} ${unitLabel}`
            : balance !== null && balance <= 0
                ? `<span style="color:#c0685c;" class="font-semibold">${Number(balance).toFixed(1)} ${unitLabel}</span>`
                : '<span class="text-gray-400">—</span>';

        const colorStyle = shortfall || (balance !== null && balance <= 0) || daysLeft !== null && daysLeft < 3
            ? 'color:#c0685c;'
            : daysLeft !== null && daysLeft < 7 ? 'color:#96712a;' : 'color:#4b5563;';

        const daysStr = daysLeft !== null
            ? `<span style="${colorStyle}" class="font-semibold">${daysLeft} дн.</span>`
            : shortfall ? '<span style="color:#c0685c;" class="font-semibold">нехватка</span>'
            : '<span class="text-gray-400">—</span>';

        // Полоска-акцент вместо сплошного фона строки
        const isCritical = shortfall || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3);
        const isWarning  = !isCritical && daysLeft !== null && daysLeft < 7;
        const accentColor = isCritical ? '#c0685c' : isWarning ? '#d9a441' : '';
        const accentBar = accentColor
            ? `<span class="absolute left-0 top-1 bottom-1 w-0.5 rounded-full" style="background:${accentColor};"></span>`
            : '';
        const nameCellPad = accentColor ? 'pl-2.5' : '';

        const row = document.createElement('tr');
        row.className = 'order-row';
        row.innerHTML = `
            <td class="border p-0.5 table-text relative ${nameCellPad}" onclick="openIngredientDetail(${ing.id})">${accentBar}${escapeHtml(ing.name)}</td>
            <td class="border p-0.5 table-text text-center" onclick="openIngredientDetail(${ing.id})">${formatMoney(unitPrice, 4)}/${unitLabel}</td>
            <td class="border p-0.5 table-text text-center" onclick="openIngredientDetail(${ing.id})">${balanceStr}</td>
            <td class="border p-0.5 table-text text-center" onclick="openIngredientDetail(${ing.id})">${daysStr}</td>`;
        tbody.appendChild(row);
    });
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

    const nameInput = document.getElementById('idNameInput');
    const unitInput = document.getElementById('idUnitInput');
    if (nameInput) nameInput.value = '';
    if (unitInput) unitInput.value = 'g';

    // Сбрасываем поля склада
    document.getElementById('idNewPriceDate').value = new Date().toISOString().slice(0, 10);
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

    // Очищаем историю движений
    const histEl = document.getElementById('ingStockHistory');
    if (histEl) histEl.innerHTML = '';

    currentIngredientId = null;
    refreshFab();
}

async function saveNewIngredient() {
    const name = (document.getElementById('idNameInput')?.value || '').trim();
    const unit = document.getElementById('idUnitInput')?.value || 'g';
    if (!name) { showInfo('Введите название ингредиента!'); return; }

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
        logActivity('ingredient', `Создан ингредиент: «${name}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function cleanupIngredientDraftIfEmpty(ingId) {
    if (!_draftIngredientIds.has(ingId)) return;
    _draftIngredientIds.delete(ingId);
    const idx = ingredients.findIndex(i => i.id === ingId);
    if (idx === -1) return;
    if (ingredients[idx].name && ingredients[idx].name.trim()) return; // название вписали — уже не пустой черновик
    try {
        await db.from('ingredients').delete().eq('id', ingId);
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


    // Заголовок карточки — inline поля
    const nameInput = document.getElementById('idNameInput');
    const unitInput = document.getElementById('idUnitInput');
    if (nameInput) { nameInput.value = ing.name; }
    if (unitInput) { unitInput.value = ing.unit || 'g'; }
    // Фокус на поле названия если это новый черновик
    document.getElementById('idNewPriceDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('idPackagePrice').value = ing.package_price.toFixed(2);
    document.getElementById('idPackageSize').value = ing.package_size;
    document.getElementById('idStockQty').value = '';
    const qtyUnitEl = document.getElementById('ingQtyUnit');
    if (qtyUnitEl) qtyUnitEl.textContent = UNIT_LABELS[ing.unit] || ing.unit;
    renderIngredientUnitPrice(ing);
    // Загружаем историю цен для расчёта стоимости в истории движений
    const { data: ph } = await db.from('ingredient_price_history')
        .select('valid_from, package_price, package_size')
        .eq('ingredient_id', ing.id)
        .order('valid_from', { ascending: true });
    ing.priceHistory = ph || [];
    loadIngredientPriceHistory(ingId);
    renderIngredientStockBlock(ing);
    refreshFab();
}

// Обновляет превью цены за единицу при изменении полей новой цены
function renderIngredientUnitPricePreview() {
    const price = parseFloat(document.getElementById('idPackagePrice').value) || 0;
    const size = parseFloat(document.getElementById('idPackageSize').value) || 0;
    const ing = ingredients.find(i => i.id === currentIngredientId);
    const unit = ing ? ing.unit : 'g';
    const unitLabel = UNIT_LABELS[unit] || unit;
    const unitPrice = size > 0 ? (price / size).toFixed(4) : '0.0000';
    const el = document.getElementById('idUnitPrice');
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
        showInfo('Заполните дату, цену и размер упаковки!'); return;
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
            await db.from('ingredient_price_history')
                .update({ package_price: parseFloat(packagePrice.toFixed(2)), package_size: packageSize })
                .eq('id', existing.id);
        } else {
            await db.from('ingredient_price_history').insert({
                org_id: currentOrgId,
                ingredient_id: ing.id,
                package_price: parseFloat(packagePrice.toFixed(2)),
                package_size:  packageSize,
                valid_from:    validFrom
            });
        }

        // Если указано количество — добавляем приход на склад
        if (stockQty > 0) {
            await db.from('inventory').insert({
                org_id: currentOrgId,
                ingredient_id: ing.id,
                type:          'приход',
                quantity:      parseFloat(stockQty.toFixed(4)),
                notes:         `Закупка ${validFrom}`
            });
            await loadInventory();
        }

        renderIngredientUnitPrice(ing);
        await loadIngredientPriceHistory(ing.id);
        await renderIngredientStockBlock(ing);
        displayIngredients();
        logActivity('ingredient', `Обновлён склад/цена: «${ing.name}»${stockQty > 0 ? ` +${stockQty}` : ''}`);
        document.getElementById('idStockQty').value = '';
    } catch (e) { console.error(e); showInfo('Ошибка сохранения.'); }
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
        logActivity('ingredient', `Ингредиент обновлён: «${name}»`);
    } catch(e) { console.error(e); showInfo('Ошибка сохранения.'); }
}



// ── Ручное списание ──────────────────────────────────────────────────────────

function openWriteOffModal() {
    const ing = ingredients.find(i => i.id === currentIngredientId);
    if (!ing) return;
    const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
    document.getElementById('writeOffIngName').textContent = `Ингредиент: ${ing.name}`;
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
    if (isNaN(qty) || qty <= 0) { showInfo('Введите корректное количество!'); return; }

    const notes = reason === 'Другое' ? `Корректировка: ${note || 'другое'}` : `Корректировка: ${reason || 'без причины'}`;

    showLoading();
    try {
        await db.from('inventory').insert({
            org_id: currentOrgId,
            ingredient_id: ing.id,
            type:          'расход',
            quantity:      parseFloat(qty.toFixed(4)),
            notes
        });
        await loadInventory();
        closeModal();
        await renderIngredientStockBlock(ing);
        displayIngredients();
        logActivity('inventory', `Списание: «${ing.name}» -${qty} (${notes})`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения.'); }
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
        showInfo('Заполните все поля корректно!'); return;
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
            await db.from('ingredient_price_history')
                .update({ package_price: parseFloat(packagePrice.toFixed(2)), package_size: packageSize })
                .eq('id', existing.id);
        } else {
            await db.from('ingredient_price_history').insert({
                org_id: currentOrgId,
                ingredient_id: ing.id,
                package_price: parseFloat(packagePrice.toFixed(2)),
                package_size: packageSize,
                valid_from: validFrom
            });
        }
        // Обновляем локальный объект — чтобы список сразу показывал новую цену
        ing.package_price = parseFloat(packagePrice.toFixed(2));
        ing.package_size  = packageSize;
        renderIngredientUnitPrice(ing);
        await loadIngredientPriceHistory(ing.id);
        displayIngredients(); // обновляем список
        logActivity('ingredient', `Обновлена цена ингредиента «${ing.name}» с ${validFrom}`);
        await showInfo('Цена сохранена.');
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function closeIngredientDetail() {
    const leavingId = currentIngredientId;
    currentIngredientId = null;
    _isNewIngredient = false;
    document.getElementById('ingredientsList').classList.remove('hidden');
    document.getElementById('ingredientDetail').classList.remove('active');
    // Показываем кнопку удаления на случай если была скрыта — но только если есть право
    const delBtn = document.querySelector('#ingredientDetail button[onclick="deleteCurrentIngredient()"]');
    if (delBtn) delBtn.classList.toggle('hidden', !hasPermission('can_delete'));
    const saveBtn = document.getElementById('idSaveNewBtn');
    if (saveBtn) saveBtn.classList.add('hidden');
    const stockBlock = document.getElementById('ingStockBlock');
    if (stockBlock) stockBlock.classList.remove('hidden');
    if (leavingId !== null) await cleanupIngredientDraftIfEmpty(leavingId);
    displayIngredients();
    refreshFab();
}

function renderIngredientUnitPrice(ing) {
    const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
    document.getElementById('idUnitPrice').textContent = `${formatMoney(ingredientUnitPrice(ing), 4)}/${unitLabel}`;
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
        logActivity('ingredient', `Изменён ингредиент «${name}»`);
        showAutosaveToast();
    } catch (e) { console.error(e); }
}

// Удаление ингредиента прямо из его карточки
function deleteCurrentIngredient() {
    const idx = ingredients.findIndex(i => i.id === currentIngredientId);
    if (idx === -1) return;
    const ing = ingredients[idx];
    openDeleteModal(idx, 'ingredient', `ингредиент «${ing.name}»`);
}

// ==================== ИСТОРИЯ ЦЕН ИНГРЕДИЕНТА ====================
let _ingredientPriceHistory = {}; // { ingredient_id: [{package_price, package_size, valid_from}] }

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
    const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
    const balance = typeof getIngredientBalance === 'function' ? getIngredientBalance(ing.id) : null;
    const daily   = typeof avgDailyUsage === 'function' ? avgDailyUsage(ing.id) : 0;

    const balEl   = document.getElementById('ingBalanceValue');
    const unitEl  = document.getElementById('ingBalanceUnit');
    const daysEl  = document.getElementById('ingDaysLeft');

    if (balEl) {
        if (balance !== null && balance > 0) {
            balEl.textContent = Number(balance).toFixed(2);
            const days = (daily > 0) ? Math.floor(balance / daily) : null;
            const colorClass = stockColorClass(days, 'text-') + ' font-bold';
            balEl.className = colorClass;
        } else {
            balEl.textContent = '0';
            balEl.className = 'font-bold text-gray-400';
        }
    }
    if (unitEl) unitEl.textContent = unitLabel;
    if (daysEl) {
        if (balance !== null && balance > 0 && daily > 0) {
            const days = Math.floor(balance / daily);
            daysEl.textContent = `~${days} дн. запаса`;
            daysEl.className = `table-text font-semibold ${stockColorClass(days, 'text-')}`;
        } else {
            daysEl.textContent = daily > 0 ? 'нет данных о запасе' : 'недостаточно истории';
            daysEl.className = 'table-text text-gray-400';
        }
    }

    // История пополнений и списаний
    const histEl = document.getElementById('ingStockHistory');
    if (!histEl) return;
    try {
        const { data } = await db.from('inventory')
            .select('id, type, quantity, created_at, notes, order_id')
            .eq('ingredient_id', ing.id)
            .in('type', ['приход', 'расход', 'сторно'])
            .order('created_at', { ascending: false })
            .limit(200);
        if (!data || !data.length) {
            histEl.innerHTML = '<p class="table-text text-gray-400 mt-1">Движений ещё не было</p>';
            return;
        }

        // Определяем категорию каждой записи
        function getCategory(r) {
            if (r.type === 'приход') return 'in';
            if (r.type === 'сторно') return 'storno';
            const n = r.notes || '';
            if (n.startsWith('Заказ #') || n.startsWith('Сторно заказа')) return 'order';
            return 'personal';
        }

        // Стоимость единицы на дату записи
        function unitCostAtDate(dateStr) {
            if (!ing.priceHistory || !ing.priceHistory.length) return ing.package_price / ing.package_size;
            const applicable = ing.priceHistory.filter(h => h.valid_from <= dateStr);
            if (!applicable.length) return ing.package_price / ing.package_size;
            const last = applicable[applicable.length - 1];
            return last.package_size ? last.package_price / last.package_size : 0;
        }

        // Итоги по категориям
        const totals = { in: { qty: 0, cost: 0 }, order: { qty: 0, cost: 0 }, personal: { qty: 0, cost: 0 } };
        data.forEach(r => {
            const cat = getCategory(r);
            const qty = Number(r.quantity);
            const dateStr = r.created_at.slice(0, 10);
            const cost = qty * unitCostAtDate(dateStr);
            if (cat === 'storno') {
                // Сторно уменьшает итог по заказам
                totals.order.qty  -= qty;
                totals.order.cost -= cost;
            } else {
                totals[cat].qty  += qty;
                totals[cat].cost += cost;
            }
        });

        // Итоговая строка
        let summary = `<div class="table-text text-gray-600 mt-2 mb-2 space-y-0.5">`;
        summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#7c9473;"></span>Куплено: <span class="font-semibold" style="color:#4f6349;">${totals.in.qty.toFixed(2)} ${unitLabel}</span> · ${formatMoney(totals.in.cost)}</div>`;
        if (totals.order.qty > 0) summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#d9a441;"></span>На заказы: <span class="font-semibold" style="color:#96712a;">${totals.order.qty.toFixed(2)} ${unitLabel}</span> · ${formatMoney(totals.order.cost)}</div>`;
        if (totals.personal.qty > 0) summary += `<div><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:#c0685c;"></span>Личное/потери: <span class="font-semibold" style="color:#c0685c;">${totals.personal.qty.toFixed(2)} ${unitLabel}</span> · ${formatMoney(totals.personal.cost)}</div>`;
        summary += `</div>`;

        // Фильтр-табы
        const tabs = `<div class="flex gap-1 mb-2 flex-wrap">
            <button onclick="filterIngHistory('all')" id="histTab_all" class="hist-tab hist-tab-active text-xs px-2 py-0.5 rounded-full border border-gray-300 bg-[#7c9473] text-white">Все</button>
            <button onclick="filterIngHistory('in')" id="histTab_in" class="hist-tab text-xs px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">+ Приходы</button>
            <button onclick="filterIngHistory('order')" id="histTab_order" class="hist-tab text-xs px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">− Заказы</button>
            <button onclick="filterIngHistory('personal')" id="histTab_personal" class="hist-tab text-xs px-2 py-0.5 rounded-full border border-gray-300 bg-[#f4f1ea] text-gray-600">− Личное</button>
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
            const unitCost = unitCostAtDate(dateStr);
            const cost = (qty * unitCost).toFixed(2);
            const isIn = r.type === 'приход';
            const isStorno = r.type === 'сторно';
            const sign = isIn || isStorno ? '+' : '−';
            const color = isIn ? 'color:#4f6349;' : isStorno ? 'color:#7c9473;' : (cat === 'order' ? 'color:#96712a;' : 'color:#c0685c;');
            const notes = escapeHtml(r.notes || '').replace('Корректировка: ', '').replace('Закупка ', '');
            const rowCat = isStorno ? 'order' : cat; // сторно фильтруется вместе с заказами
            rows += `<tr class="border-b ing-hist-row" data-cat="${rowCat}">
                <td class="p-1 whitespace-nowrap">${date}</td>
                <td class="p-1 text-right font-semibold whitespace-nowrap" style="${color}">${sign}${qty.toFixed(2)} ${unitLabel}</td>
                <td class="p-1 text-right text-gray-500 whitespace-nowrap">${formatMoney(cost)}</td>
                <td class="p-1 text-gray-400">${notes}</td>
            </tr>`;
        });

        const table = `<div id="ingHistTableWrap" style="max-height:260px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">
            <table class="w-full table-text table-clean">
                <thead><tr style="background-color:#e3e8df;" class="sticky top-0 text-xs">
                    <th class="p-1 text-left">Дата</th>
                    <th class="p-1 text-right">Кол-во</th>
                    <th class="p-1 text-right">Сумма</th>
                    <th class="p-1 text-left">Заметка</th>
                </tr></thead>
                <tbody id="ingHistTableBody">${rows}</tbody>
            </table>
        </div>`;

        histEl.innerHTML = summary + tabs + table;
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
    if (isNaN(qty) || qty <= 0) { showInfo('Введите корректное количество!'); return; }
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
    } catch(e) { console.error(e); showInfo('Ошибка сохранения.'); }
    finally { hideLoading(); }
}

async function deleteInventoryRecord(id) {
    const ok = await showConfirm('Удалить эту запись из истории склада?');
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
    } catch(e) { console.error(e); showInfo('Ошибка удаления.'); }
    finally { hideLoading(); }
}

function renderIngredientPriceChart(ingredientId) {
    const canvas = document.getElementById('ingredientPriceChart');
    const emptyEl = document.getElementById('ingredientPriceChartEmpty');
    if (!canvas || !emptyEl) return;

    const history = (_ingredientPriceHistory[ingredientId] || []).slice().reverse(); // от старых к новым
    const ing = ingredients.find(i => i.id === ingredientId);
    const unitLabel = ing ? (UNIT_LABELS[ing.unit] || ing.unit) : '';

    if (history.length < 2) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const labels = history.map(h => formatDateDMY(h.valid_from));
    const data   = history.map(h => parseFloat((h.package_price / h.package_size).toFixed(6)));

    // Уничтожаем предыдущий экземпляр чтобы не накапливались
    if (_ingredientPriceChartInstance) { _ingredientPriceChartInstance.destroy(); _ingredientPriceChartInstance = null; }

    const ctx = canvas.getContext('2d');
    _ingredientPriceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `Цена (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency}/${unitLabel})`,
                data,
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
    if (!history.length) { container.innerHTML = '<p class="table-text text-gray-400">История цен пуста</p>'; return; }
    const ing = ingredients.find(i => i.id === ingredientId);
    const unitLabel = ing ? (UNIT_LABELS[ing.unit] || ing.unit) : '';
    let html = '<table class="w-full table-text table-clean"><thead><tr style="background-color:#e3e8df;" class="text-xs"><th class="p-0.5 text-left">С даты</th><th class="p-0.5 text-right">Цена упак.</th><th class="p-0.5 text-right">Цена за ед.</th><th class="p-0.5 w-12"></th></tr></thead><tbody>';
    history.forEach((h, i) => {
        const unitPrice = h.package_size ? (h.package_price / h.package_size).toFixed(4) : '—';
        const isCurrent = i === 0;
        html += `<tr style="${isCurrent ? 'background:#e3e8df;' : ''}" class="${isCurrent ? 'font-semibold' : 'border-b'}">
            <td class="p-0.5">${formatDateDMY(h.valid_from)}${isCurrent ? ' <span style="color:#4f6349;">(текущая)</span>' : ''}</td>
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
    document.getElementById('priceHistoryModalTitle').textContent = 'Добавить запись цены';
    document.getElementById('priceHistoryRecordId').value = '';
    document.getElementById('priceHistoryDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('priceHistoryPrice').value = ing.package_price.toFixed(2);
    document.getElementById('priceHistorySize').value = ing.package_size;
    document.getElementById('priceHistoryModal').style.display = 'flex';
}

// Открыть модалку для редактирования существующей записи
function openEditPriceHistoryModal(id, validFrom, price, size) {
    document.getElementById('priceHistoryModalTitle').textContent = 'Редактировать запись цены';
    document.getElementById('priceHistoryRecordId').value = id;
    document.getElementById('priceHistoryDate').value = validFrom;
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
        showInfo('Заполните все поля корректно!'); return;
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
        await loadIngredientPriceHistory(currentIngredientId);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения: ' + (e.message || '')); }
    finally { hideLoading(); }
}

// Удалить запись из истории цен
async function deletePriceHistoryRecord(id) {
    if (!hasPermission('can_delete')) {
        showInfo('У вас нет права на удаление. Обратитесь к владельцу пекарни.');
        return;
    }
    const ok = await showConfirm('Удалить эту запись из истории цен?');
    if (!ok) return;
    showLoading();
    try {
        const { error } = await db.from('ingredient_price_history').delete().eq('id', id);
        if (error) throw error;
        await loadIngredientPriceHistory(currentIngredientId);
    } catch (e) { console.error(e); showInfo('Ошибка удаления.'); }
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
        showInfo('Заполните все поля корректно!'); return;
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
        logActivity('ingredient', `Добавлен ингредиент «${name}» (из карточки рецепта)`);
        closeModal();

        // Подставляем созданный ингредиент обратно в поле поиска того рецепта,
        // откуда вызвали создание — остаётся только нажать "Добавить".
        const inputId = _quickAddIngredientContext === 'semiFinished' ? 'newSfRecipeIngredient' : 'newRecipeIngredient';
        const input = document.getElementById(inputId);
        if (input) input.value = newIng.name;
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
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
