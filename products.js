// ==================== ИЗДЕЛИЯ ====================
// Список изделий: отображение, добавление, редактирование, копирование.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), products/orders (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// svgEdit/svgDelete/svgCopy, updateProductSelects, openDeleteModal, closeModal (главный скрипт).

const UNIT_PRODUCT_LABELS = { pcs: 'шт', kg: 'кг' };

function displayProducts() {
    products.sort((a, b) => (a.name||"").localeCompare(b.name||""));
    const tbody = document.getElementById('productTableBody');
    tbody.innerHTML = '';
    let warningCount = 0;
    products.forEach((p, i) => {
        const hasUnit = !!p.unit;
        const recipeOk = !!p.recipe_confirmed;
        const needsAttention = !hasUnit || !recipeOk;
        if (needsAttention) warningCount++;
        const unitLabel = hasUnit ? UNIT_PRODUCT_LABELS[p.unit] : icon('warning', 'w-3.5 h-3.5 text-red-500 inline-block');
        const row = document.createElement('tr');
        row.className = 'order-row border-b' + (needsAttention ? ' bg-red-50' : '');
        row.innerHTML = `
            <td class=" p-0.5 table-text" onclick="openProductDetail(${p.id})">${escapeHtml(p.name)}</td>
            <td class=" p-0.5 table-text text-center ${hasUnit ? '' : 'text-red-600 font-semibold'}" onclick="openProductDetail(${p.id})">${unitLabel}</td>
            <td class=" p-0.5 table-text" onclick="openProductDetail(${p.id})">${p.price.toFixed(2)}</td>
            <td class=" p-0.5 text-center">
                ${hasPermission('can_delete') ? svgDelete(`openDeleteModal(${i},'product','изделие «${p.name}»')`) : ''}
                ${svgCopy(`copyProduct(${i})`)}
            </td>`;
        tbody.appendChild(row);
    });
    const warningEl = document.getElementById('productsUnitWarning');
    if (warningEl) warningEl.classList.toggle('hidden', warningCount === 0);
    updateProductSelects();
}

// Кнопка "+": попап для создания нового изделия
// Кнопка "+": сразу создаёт черновик изделия и открывает его карточку
let _draftProductIds = new Set();

let _isNewProduct = false;

async function createDraftProductAndOpen() {
    // Открываем пустую карточку локально — без записи в БД
    _isNewProduct = true;
    currentProductId = null;

    document.getElementById('productsList').classList.add('hidden');
    document.getElementById('productDetail').classList.add('active');

    document.getElementById('pdName').value = '';
    document.getElementById('pdUnit').value = 'pcs';
    document.getElementById('pdPrice').value = '0.00';
    document.getElementById('pdBatchSize').value = '1';
    document.getElementById('pdOtherCosts').value = '0.00';
    document.getElementById('pdRecipeConfirmed').checked = false;
    document.getElementById('pdTrackStock').checked = false;

    // Показываем кнопку Сохранить, скрываем удаление и рецепт
    const saveBtn = document.getElementById('pdSaveNewBtn');
    if (saveBtn) saveBtn.classList.remove('hidden');
    const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
    if (delBtn) delBtn.classList.add('hidden');
    const recipeBlock = document.getElementById('pdRecipeBlock');
    if (recipeBlock) recipeBlock.classList.add('hidden');

    updatePdUnitUI('pcs');
    refreshFab();
}

async function saveNewProduct() {
    const name  = (document.getElementById('pdName')?.value || '').trim();
    const unit  = document.getElementById('pdUnit')?.value || 'pcs';
    const price = parseFloat(document.getElementById('pdPrice')?.value) || 0;
    if (!name) { showInfo('Введите название изделия!'); return; }

    showLoading();
    try {
        const { data, error } = await db.from('products').insert({
            org_id: currentOrgId, name, price, unit, batch_size: 1, other_costs: 0
        }).select().single();
        if (error) throw error;

        const newProd = { id: data.id, name, price, batch_size: 1, other_costs: 0, unit, recipe_confirmed: false, track_stock: false, ingredients: [] };
        products.push(newProd);
        _isNewProduct = false;

        // Восстанавливаем UI
        const saveBtn = document.getElementById('pdSaveNewBtn');
        if (saveBtn) saveBtn.classList.add('hidden');
        const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
        if (delBtn) delBtn.classList.remove('hidden');
        const recipeBlock = document.getElementById('pdRecipeBlock');
        if (recipeBlock) recipeBlock.classList.remove('hidden');

        displayProducts();
        openProductDetail(newProd.id);
        logActivity('product', `Создано изделие: «${name}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function cleanupProductDraftIfEmpty(prodId) {
    if (!_draftProductIds.has(prodId)) return;
    _draftProductIds.delete(prodId);
    const idx = products.findIndex(p => p.id === prodId);
    if (idx === -1) return;
    if (products[idx].name && products[idx].name.trim()) return; // название вписали — уже не пустой черновик
    try {
        await db.from('products').delete().eq('id', prodId);
        products.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик изделия:', e); }
}

function openEditProductModal(i) {
    editIndex = i;
    document.getElementById('editProductName').value  = products[i].name;
    document.getElementById('editProductPrice').value = products[i].price.toFixed(2);
    document.getElementById('editProductModal').style.display = 'flex';
}

async function saveProductEdit() {
    const name  = document.getElementById('editProductName').value.trim();
    const price = parseFloat(document.getElementById('editProductPrice').value);
    if (!name || isNaN(price)) { showInfo('Заполните все поля корректно!'); return; }
    const prod = products[editIndex];
    const oldName = prod.name, oldPrice = prod.price;
    showLoading();
    try {
        const { error } = await db.from('products').update({ name, price: parseFloat(price.toFixed(2)) }).eq('id', prod.id);
        if (error) throw error;
        prod.name = name; prod.price = parseFloat(price.toFixed(2));
        // Обновить название изделия в позициях заказов (в кэше)
        orders.forEach(o => o.items.forEach(it => { if (it.product_id === prod.id) it.product = name; }));
        displayProducts(); closeModal();
        logActivity('product', `Изменено изделие «${oldName}» (${oldPrice.toFixed(2)} €) → «${name}» (${price.toFixed(2)} €)`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// Копирует изделие (название/цена/единица/партия/доп.расходы — без рецепта,
// для рецепта есть отдельная функция "Скопировать рецепт" внутри карточки)
// и сразу открывает карточку копии для донастройки.
async function copyProduct(i) {
    const src = products[i];
    showLoading();
    try {
        const { data, error } = await db.from('products').insert({
            org_id: currentOrgId, name: src.name + ' (копия)', price: src.price, unit: src.unit || 'pcs',
            batch_size: src.batch_size || 1, other_costs: src.other_costs || 0
        }).select().single();
        if (error) throw error;
        const newProd = {
            id: data.id, name: data.name, price: Number(data.price),
            batch_size: Number(data.batch_size || 1), other_costs: Number(data.other_costs || 0),
            unit: data.unit || '', recipe_confirmed: false, ingredients: []
        };
        products.push(newProd);
        displayProducts();
        openProductDetail(newProd.id);
        logActivity('product', `Скопировано изделие «${src.name}» → «${newProd.name}»`);
    } catch (e) { console.error(e); showInfo('Ошибка копирования. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// ==================== ДЕТАЛЬНЫЙ ВИД ИЗДЕЛИЯ / РЕЦЕПТУРА ====================

let _productCostChartInstance = null;

// Строит график динамики себестоимости изделия.
// Алгоритм: собирает все уникальные даты из истории цен ингредиентов рецепта,
// для каждой даты находит актуальную цену каждого ингредиента (последняя запись
// в истории с valid_from <= этой дате) и считает полную себестоимость.
async function renderProductCostChart(prod) {
    const canvas  = document.getElementById('productCostChart');
    const emptyEl = document.getElementById('productCostChartEmpty');
    if (!canvas || !emptyEl) return;

    // Собираем id всех прямых ингредиентов рецепта
    const recipeItems = (prod.ingredients || []).filter(ri => ri.ingredient_id && !ri.semi_finished_id);
    if (!recipeItems.length) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }
    const ingIds = [...new Set(recipeItems.map(ri => ri.ingredient_id))];

    // Загружаем историю цен всех ингредиентов рецепта
    const { data: histData, error } = await db
        .from('ingredient_price_history')
        .select('ingredient_id, package_price, package_size, valid_from')
        .in('ingredient_id', ingIds)
        .order('valid_from', { ascending: true });
    if (error || !histData || !histData.length) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    // Группируем историю по ингредиенту
    const histByIng = {};
    histData.forEach(h => {
        if (!histByIng[h.ingredient_id]) histByIng[h.ingredient_id] = [];
        histByIng[h.ingredient_id].push(h);
    });

    // Функция: цена за единицу ингредиента на конкретную дату
    function unitPriceAtDate(ingId, dateStr) {
        const hist = histByIng[ingId] || [];
        // Берём последнюю запись с valid_from <= dateStr
        const applicable = hist.filter(h => h.valid_from <= dateStr);
        if (!applicable.length) return null;
        const last = applicable[applicable.length - 1];
        return last.package_size ? last.package_price / last.package_size : 0;
    }

    // Функция: себестоимость единицы изделия на конкретную дату
    function costAtDate(dateStr) {
        let batchCost = 0;
        for (const ri of recipeItems) {
            const up = unitPriceAtDate(ri.ingredient_id, dateStr);
            if (up === null) return null; // нет данных для этого ингредиента на эту дату
            batchCost += up * Number(ri.quantity);
        }
        batchCost += Number(prod.other_costs || 0);
        return batchCost / Number(prod.batch_size || 1);
    }

    // Собираем все уникальные даты из истории
    const allDates = [...new Set(histData.map(h => h.valid_from))].sort();

    // Считаем себестоимость на каждую дату
    const points = [];
    allDates.forEach(d => {
        const cost = costAtDate(d);
        if (cost !== null) points.push({ date: d, cost });
    });

    if (points.length < 2) {
        canvas.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }

    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const labels = points.map(p => formatDateDMY(p.date));
    const data   = points.map(p => parseFloat(p.cost.toFixed(4)));

    if (_productCostChartInstance) { _productCostChartInstance.destroy(); _productCostChartInstance = null; }

    const ctx = canvas.getContext('2d');
    _productCostChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Себестоимость 1 шт (€)',
                data,
                borderColor: '#059669',
                backgroundColor: 'rgba(5,150,105,0.08)',
                pointBackgroundColor: '#059669',
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
                        label: ctx => `Себест.: ${ctx.parsed.y.toFixed(4)} €`
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 10 } } },
                y: {
                    ticks: { font: { size: 10 }, callback: v => v.toFixed(2) + ' €' },
                    beginAtZero: false
                }
            }
        }
    });
}
// Зависит дополнительно от: ingredients (ingredients.js), ingredientUnitPrice (money.js),
// productBatchCost/productUnitCost/productProfit (money.js).
// currentProductId объявлен в index.html (общее состояние).

let editRecipeItemIdx = null;

function openProductDetail(productId) {
    currentProductId = productId;
    const prod = products.find(p => p.id === productId);
    if (!prod) return;

    document.getElementById('productsList').classList.add('hidden');
    document.getElementById('productDetail').classList.add('active');
    document.getElementById('productDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('productDetail').classList.remove('fade-in'), 300);

    document.getElementById('pdName').value = prod.name;
    document.getElementById('pdUnit').value = prod.unit || '';
    document.getElementById('pdPrice').value = prod.price.toFixed(2);
    document.getElementById('pdBatchSize').value = prod.batch_size || 1;
    document.getElementById('pdOtherCosts').value = (prod.other_costs || 0).toFixed(2);
    document.getElementById('pdRecipeConfirmed').checked = !!prod.recipe_confirmed;
    document.getElementById('pdTrackStock').checked = !!prod.track_stock;

    updatePdUnitUI(prod.unit);
    renderProductRecipe(prod);
    fillNewRecipeIngredientSelect();
    setupCopyRecipeControl(prod);
    renderProductCostChart(prod);
    refreshFab();
}

function updatePdUnitUI(unit) {
    const warning = document.getElementById('pdUnitWarning');
    const hint = document.getElementById('pdPriceUnitHint');
    if (warning) warning.classList.toggle('hidden', !!unit);
    if (hint) hint.textContent = unit ? `(за ${UNIT_PRODUCT_LABELS[unit]})` : '';
}

async function closeProductDetail() {
    const leavingId = currentProductId;
    currentProductId = null;
    _isNewProduct = false;
    document.getElementById('productsList').classList.remove('hidden');
    document.getElementById('productDetail').classList.remove('active');
    // Восстанавливаем UI на случай если был новый
    const saveBtn = document.getElementById('pdSaveNewBtn');
    if (saveBtn) saveBtn.classList.add('hidden');
    const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
    if (delBtn) delBtn.classList.remove('hidden');
    const recipeBlock = document.getElementById('pdRecipeBlock');
    if (recipeBlock) recipeBlock.classList.remove('hidden');
    if (leavingId !== null) await cleanupProductDraftIfEmpty(leavingId);
    displayProducts();
    refreshFab();
}

// Удаление изделия прямо из его карточки
function deleteCurrentProduct() {
    const idx = products.findIndex(p => p.id === currentProductId);
    if (idx === -1) return;
    const prod = products[idx];
    openDeleteModal(idx, 'product', `изделие «${prod.name}»`);
}

async function savePdHeader() {
    if (_isNewProduct) return;
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const name = document.getElementById('pdName').value.trim();
    const unit = document.getElementById('pdUnit').value;
    const price = parseFloat(document.getElementById('pdPrice').value);
    const batchSize = parseFloat(document.getElementById('pdBatchSize').value) || 1;
    const otherCosts = parseFloat(document.getElementById('pdOtherCosts').value) || 0;
    if (!name || isNaN(price)) { showInfo('Заполните название и цену корректно!'); return; }

    showLoading();
    try {
        const { error } = await db.from('products').update({
            name, price: parseFloat(price.toFixed(2)), batch_size: batchSize, other_costs: parseFloat(otherCosts.toFixed(2)), unit
        }).eq('id', prod.id);
        if (error) throw error;
        const unitChanged = prod.unit !== unit;
        prod.name = name; prod.price = parseFloat(price.toFixed(2));
        prod.batch_size = batchSize; prod.other_costs = parseFloat(otherCosts.toFixed(2));
        prod.unit = unit;
        orders.forEach(o => o.items.forEach(it => { if (it.product_id === prod.id) it.product = name; }));
        updatePdUnitUI(unit);
        renderProductRecipe(prod);
        logActivity('product', `Изменено изделие «${prod.name}»${unitChanged ? ` (единица: ${UNIT_PRODUCT_LABELS[unit] || '—'})` : ''}`);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function fillNewRecipeIngredientSelect() {
    setupSearchDropdown('newRecipeIngredient', 'newRecipeIngredientDropdown', () => {
        const names = ingredients.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(i => i.name);
        const sfNames = (typeof semiFinished !== 'undefined')
            ? semiFinished.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(s => s.name + ' (п/ф)')
            : [];
        return names.concat(sfNames);
    }, null, (text) => openQuickAddIngredientModal(text, 'product'));
}

// Находит ингредиент/полуфабрикат по тексту, введённому в поле поиска.
// Возвращает { type: 'ing'|'sf', id } или null, если совпадения нет.
function resolveRecipeIngredientInput(text) {
    const raw = text.trim();
    if (!raw) return null;
    if (raw.endsWith(' (п/ф)')) {
        const name = raw.slice(0, -' (п/ф)'.length);
        const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.name === name) : null;
        return sf ? { type: 'sf', id: sf.id } : null;
    }
    const ing = ingredients.find(i => i.name === raw);
    if (ing) return { type: 'ing', id: ing.id };
    // На случай если ввели название п/ф без суффикса
    const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.name === raw) : null;
    return sf ? { type: 'sf', id: sf.id } : null;
}

function renderProductRecipe(prod) {
    const tbody = document.getElementById('recipeItemsBody');
    tbody.innerHTML = '';
    const list = prod.ingredients || [];
    if (!list.length) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="4" class="text-center text-xs text-gray-400 py-2">Нет ингредиентов. Добавьте ниже.</td>`;
        tbody.appendChild(row);
    } else {
        list.forEach((ri, i) => {
            let displayName, unitLabel, unitPrice;
            if (ri.semi_finished_id) {
                const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === ri.semi_finished_id) : null;
                displayName = sf ? sf.name + ' (п/ф)' : '(удалён п/ф)';
                unitLabel = sf ? (SF_UNIT_LABELS[sf.unit] || sf.unit) : '';
                unitPrice = sf ? semiFinishedUnitCost(sf) : 0;
            } else {
                const ing = ingredients.find(x => x.id === ri.ingredient_id);
                displayName = ing ? ing.name : '(удалён)';
                unitLabel = ing ? (UNIT_LABELS[ing.unit] || ing.unit) : '';
                unitPrice = ing ? ingredientUnitPrice(ing) : 0;
            }
            const lineCost = unitPrice * ri.quantity;
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.innerHTML = `
                <td class="p-0.5 text-xs">${escapeHtml(displayName)}</td>
                <td class="p-0.5 text-xs text-center">${ri.quantity} ${unitLabel}</td>
                <td class="p-0.5 text-xs text-center font-medium">${lineCost.toFixed(2)} €</td>
                <td class="p-0.5 text-center">
                    ${svgEdit(`openEditRecipeItemModal(${i})`)}
                    ${hasPermission('can_delete') ? svgDelete(`deleteRecipeItem(${i})`) : ''}
                </td>`;
            tbody.appendChild(row);
        });
    }

    const batchCost = productBatchCost(prod);
    const unitCost  = productUnitCost(prod);
    const profit    = productProfit(prod);
    const profitPct = prod.price > 0 ? (profit / prod.price * 100) : 0;

    document.getElementById('pdBatchCost').textContent = batchCost.toFixed(2) + ' €';
    document.getElementById('pdUnitCost').textContent  = unitCost.toFixed(2) + ' €';
    document.getElementById('pdProfit').textContent    = profit.toFixed(2) + ' €';
    document.getElementById('pdProfitPct').textContent = profitPct.toFixed(1) + '%';
}

async function addIngredientToRecipe() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const inputEl = document.getElementById('newRecipeIngredient');
    const quantity = parseFloat(document.getElementById('newRecipeQty').value);
    const resolved = resolveRecipeIngredientInput(inputEl.value);
    if (!resolved || isNaN(quantity) || quantity <= 0) {
        showInfo('Выберите ингредиент/полуфабрикат из списка и укажите количество!'); return;
    }
    const type = resolved.type, selectedId = resolved.id;
    const insertRow = type === 'sf'
        ? { product_id: prod.id, semi_finished_id: selectedId, ingredient_id: null, quantity }
        : { product_id: prod.id, ingredient_id: selectedId, semi_finished_id: null, quantity };

    showLoading();
    try {
        const { data, error } = await db.from('product_ingredients').insert({ org_id: currentOrgId, ...insertRow }).select().single();
        if (error) throw error;
        if (!prod.ingredients) prod.ingredients = [];
        prod.ingredients.push({ id: data.id, ingredient_id: data.ingredient_id, semi_finished_id: data.semi_finished_id, quantity: Number(data.quantity) });
        renderProductRecipe(prod);
        let itemName = '';
        if (type === 'sf') {
            const sf = semiFinished.find(s => s.id === selectedId);
            itemName = sf ? sf.name + ' (п/ф)' : '';
        } else {
            const ing = ingredients.find(i => i.id === selectedId);
            itemName = ing ? ing.name : '';
        }
        logActivity('product', `В рецепт «${prod.name}» добавлен «${itemName}» (${quantity})`);
        inputEl.value = '';
        document.getElementById('newRecipeQty').value = '';
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function openEditRecipeItemModal(i) {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    editRecipeItemIdx = i;
    const ri = prod.ingredients[i];
    const currentValue = ri.semi_finished_id ? ('sf-' + ri.semi_finished_id) : ('ing-' + ri.ingredient_id);

    const sel = document.getElementById('editRecipeIngredient');
    sel.innerHTML = '<option value="">Выберите ингредиент / полуфабрикат</option>';
    if (ingredients.length) {
        const grpIng = document.createElement('optgroup');
        grpIng.label = 'Ингредиенты';
        ingredients.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(ing => {
            const opt = document.createElement('option');
            opt.value = 'ing-' + ing.id; opt.textContent = ing.name;
            if (opt.value === currentValue) opt.selected = true;
            grpIng.appendChild(opt);
        });
        sel.appendChild(grpIng);
    }
    if (typeof semiFinished !== 'undefined' && semiFinished.length) {
        const grpSf = document.createElement('optgroup');
        grpSf.label = 'Полуфабрикаты';
        semiFinished.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(sf => {
            const opt = document.createElement('option');
            opt.value = 'sf-' + sf.id; opt.textContent = sf.name;
            if (opt.value === currentValue) opt.selected = true;
            grpSf.appendChild(opt);
        });
        sel.appendChild(grpSf);
    }
    document.getElementById('editRecipeQty').value = ri.quantity;
    document.getElementById('editRecipeItemModal').style.display = 'flex';
}

async function saveRecipeItemEdit() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod || editRecipeItemIdx === null) return;
    const selectedRaw = document.getElementById('editRecipeIngredient').value;
    const quantity = parseFloat(document.getElementById('editRecipeQty').value);
    if (!selectedRaw || isNaN(quantity) || quantity <= 0) {
        showInfo('Заполните все поля корректно!'); return;
    }
    const [type, idStr] = selectedRaw.split('-');
    const selectedId = Number(idStr);
    const ri = prod.ingredients[editRecipeItemIdx];
    const updateRow = type === 'sf'
        ? { ingredient_id: null, semi_finished_id: selectedId, quantity }
        : { ingredient_id: selectedId, semi_finished_id: null, quantity };

    showLoading();
    try {
        const { error } = await db.from('product_ingredients').update(updateRow).eq('id', ri.id);
        if (error) throw error;
        prod.ingredients[editRecipeItemIdx] = {
            id: ri.id,
            ingredient_id: type === 'sf' ? null : selectedId,
            semi_finished_id: type === 'sf' ? selectedId : null,
            quantity
        };
        renderProductRecipe(prod);
        closeModal();
        logActivity('product', `Изменён ингредиент в рецепте «${prod.name}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function deleteRecipeItem(i) {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const ri = prod.ingredients[i];
    let itemName = '';
    if (ri.semi_finished_id) {
        const sf = semiFinished.find(x => x.id === ri.semi_finished_id);
        itemName = sf ? sf.name + ' (п/ф)' : '';
    } else {
        const ing = ingredients.find(x => x.id === ri.ingredient_id);
        itemName = ing ? ing.name : '';
    }
    openDeleteModal(i, 'recipeItem', `«${itemName}» из рецепта`);
}

// ==================== ПОДТВЕРЖДЕНИЕ "РЕЦЕПТ ЗАПОЛНЕН ПОЛНОСТЬЮ" ====================
// Ручная галочка (не выводится автоматически). Сбрасывается сама при любом
// изменении состава рецепта (добавление/правка/удаление позиции, копирование),
// чтобы не вводить в заблуждение — рецепт нужно подтвердить заново.

async function toggleRecipeConfirmed() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const checked = document.getElementById('pdRecipeConfirmed').checked;
    showLoading();
    try {
        const { error } = await db.from('products').update({ recipe_confirmed: checked }).eq('id', prod.id);
        if (error) throw error;
        prod.recipe_confirmed = checked;
        logActivity('product', `Рецепт «${prod.name}» отмечен как ${checked ? 'заполненный полностью' : 'неполный'}`);
    } catch (e) {
        console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.');
        document.getElementById('pdRecipeConfirmed').checked = !checked;
    } finally { hideLoading(); }
}

async function toggleTrackStock() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const checked = document.getElementById('pdTrackStock').checked;
    showLoading();
    try {
        const { error } = await db.from('products').update({ track_stock: checked }).eq('id', prod.id);
        if (error) throw error;
        prod.track_stock = checked;
        // Обновляем пульсацию корзинки
        if (typeof updateInventoryAlertDot === 'function') updateInventoryAlertDot();
        logActivity('product', `«${prod.name}» — отслеживание склада ${checked ? 'включено' : 'отключено'}`);
    } catch (e) {
        console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.');
        document.getElementById('pdTrackStock').checked = !checked;
    } finally { hideLoading(); }
}

// Сбрасывает подтверждение при любом изменении состава рецепта (без отдельного
// индикатора загрузки — это "побочный эффект" основного действия, не должно его тормозить).
async function resetProductRecipeConfirmed(prod) {
    if (!prod.recipe_confirmed) return; // уже не подтверждён — нечего сбрасывать
    prod.recipe_confirmed = false;
    const checkbox = document.getElementById('pdRecipeConfirmed');
    if (checkbox) checkbox.checked = false;
    try {
        await db.from('products').update({ recipe_confirmed: false }).eq('id', prod.id);
    } catch (e) { console.error('Не удалось сбросить recipe_confirmed:', e); }
}

// ==================== КОПИРОВАНИЕ РЕЦЕПТА ИЗ ДРУГОГО ИЗДЕЛИЯ ====================
// Позволяет быстро перенести список ингредиентов/полуфабрикатов из похожего
// изделия, не вводя их заново. Позиции, которые уже есть в текущем рецепте
// (тот же ингредиент/п-ф), пропускаются, чтобы не задваивать строки.
// Перед записью в базу — подтверждение (аналог кнопки "Сохранить"), т.к. это
// массовое действие, в отличие от добавления одной позиции.
function setupCopyRecipeControl(prod) {
    setupSearchDropdown('copyRecipeFromInput', 'copyRecipeFromDropdown',
        () => products
            .filter(p => p.id !== currentProductId && (p.ingredients || []).length)
            .sort((a,b) => (a.name||"").localeCompare(b.name||""))
            .map(p => p.name),
        (name) => {
            document.getElementById('copyRecipeFromInput').value = '';
            copyRecipeFromProductByName(name);
        });
}

async function copyRecipeFromProductByName(sourceName) {
    const prod = products.find(p => p.id === currentProductId);
    const src = products.find(p => p.name === sourceName);
    if (!prod || !src) return;
    const srcItems = src.ingredients || [];
    if (!srcItems.length) { showInfo('У выбранного изделия нет рецепта.'); return; }

    const existingIngIds = new Set((prod.ingredients || []).filter(i => i.ingredient_id).map(i => i.ingredient_id));
    const existingSfIds  = new Set((prod.ingredients || []).filter(i => i.semi_finished_id).map(i => i.semi_finished_id));
    const toCopy = srcItems.filter(ri => ri.semi_finished_id ? !existingSfIds.has(ri.semi_finished_id) : !existingIngIds.has(ri.ingredient_id));
    const skipped = srcItems.length - toCopy.length;

    if (!toCopy.length) { showInfo(`Все позиции из рецепта «${sourceName}» уже есть в этом рецепте.`); return; }

    let msg = `Скопировать ${toCopy.length} ${toCopy.length === 1 ? 'позицию' : 'позиций'} из рецепта «${sourceName}» в «${prod.name}»?`;
    if (skipped) msg += `\n(${skipped} уже есть в текущем рецепте — будут пропущены)`;
    if (!(await showConfirm(msg))) return;

    showLoading();
    try {
        const rows = toCopy.map(ri => ri.semi_finished_id
            ? { org_id: currentOrgId, product_id: prod.id, semi_finished_id: ri.semi_finished_id, ingredient_id: null, quantity: ri.quantity }
            : { org_id: currentOrgId, product_id: prod.id, ingredient_id: ri.ingredient_id, semi_finished_id: null, quantity: ri.quantity });
        const { data, error } = await db.from('product_ingredients').insert(rows).select();
        if (error) throw error;
        if (!prod.ingredients) prod.ingredients = [];
        data.forEach(d => prod.ingredients.push({ id: d.id, ingredient_id: d.ingredient_id, semi_finished_id: d.semi_finished_id, quantity: Number(d.quantity) }));
        renderProductRecipe(prod);
        logActivity('product', `В рецепт «${prod.name}» скопировано ${toCopy.length} поз. из рецепта «${sourceName}»`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}
