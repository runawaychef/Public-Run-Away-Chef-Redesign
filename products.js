// Заглушка фото изделия (16.10): бежевый квадрат с рисунком, встроен прямо в код (~4 КБ),
// чтобы не зависеть от отдельного файла-картинки (их неудобно скачивать с телефона).
const PRODUCT_PLACEHOLDER_SRC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYGBgYHBgcICAcKCwoLCg8ODAwODxYQERAREBYiFRkVFRkVIh4kHhweJB42KiYmKjY+NDI0PkxERExfWl98fKcBBgYGBgcGBwgIBwoLCgsKDw4MDA4PFhAREBEQFiIVGRUVGRUiHiQeHB4kHjYqJiYqNj40MjQ+TERETF9aX3x8p//CABEIAKgAqAMBIgACEQEDEQH/xAAuAAEBAQEBAQEAAAAAAAAAAAAAAQMCBAUGAQEBAQAAAAAAAAAAAAAAAAAAAQL/2gAMAwEAAhADEAAAAv0gxQACwAAFIsAAAABSAAAAAALAAACoAHPA5egeduMNusDZnocPF3HtWUAAAy185poC59gApnl6fANcPoRRUAABlpj6BnMDbL1ZG083pC8F+X6uJNvRZaAAABjvhueLpvln1zK9GEp3xj3ZplvmemWKKQAAEz2wMNublUE7nJt5tPNXrcb2dBVgAAAWDx968Ry6krviwvNs9ENCwAAAWCwAKgmWwx06AAAAAAAAAAApFgAAAAAAAAAAAAAB/8QAAv/aAAwDAQACAAMAAAAh99919951999959999991999N9gAMAxS199989h95kqB999oQcc1q19999A7R+9NV5999gTvvwJ9t999tVwTnd1999td9N9N99999999995199999999999999//EAAL/2gAMAwEAAgADAAAAEP8A/wD3/wD+9/8A/wD/AO//AP8A/wD/APf/AP8Az/8ANP8AD2s3/wD/AP8A+i/7AMD/AP8A8sIJvIN7/wD/AP1mwO6ZVu//AP8AjiHvub/v/wD/AP5Ta6d/f/8A/vf/AD/jP/8A/wD/AP8A/wD/AP8Avf8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/xAAiEQABAgYCAwEAAAAAAAAAAAABAAIDERIwMUEQIRMgQFL/2gAIAQIBAT8A+uXNXdpxkEwbtHtY9RleQhCI3YVbDtTsVjBapwzpUMOHJraTYMNypd+eIWTbAA19f//EACoRAQABAgQEBAcAAAAAAAAAAAEAAhESICFRAxAxQRMiQHEwQlJhgaHB/9oACAEDAQE/APU32mHdZhJqfeXJicrtAtLnOrbeGr7ZfmY1bRIN+VSsCxl7sp4d6TXtPDq2GI9xl4/zM6IymhwiW6e0txDeY6jr+y0rru0toa5xADD+SYqfqSCvRpZV1PKHwrG0t6v/xAA3EAACAAMEBggEBgMAAAAAAAABAgADERITITEQMDJBUXEEIiNSYYGRsSAzQqEUU2BygtFAksH/2gAIAQEAAT8C/TbuqCrGkXk1tiXhxaLucc53oIuT+dMi7nDKd6iL2YnzE81hWVhVTXS8xE2jCTEfZOqeYa2EFW9oSSAbTdZuPxNJxtIbLfYxLmWqgijDMQTSF6xLnM+0J89eRrqZr2QANo5RLl2B47zqGQFlbeI6SeqE7x+2joy5zOOXLUyuu7TPJeWmZMCUrvMAgio+JjbmseGAgi0Qg3+0Zaie1mU3p6wq2VC8Bod7IyqTkIVHLBnOWQG6FcS2cU6lrPh8LMFFScItMpNBhXKJEtgWZhifbUzs5Q4voebQ2QLTcICzXdqvRlpThocIkpuFISY6Kt4MKbX96XcIKmHtmhO0dheHiYdAKjuKPUnVTduT+/RJcqvyyak4iGeQ1KkqeOUAMcukV9IEkVqxLHx0XbJjL/1/qFmoVJ4Z+EIK9q/l4CJQtEzDvy5QcZE5u8dV0jYtd0g6JJF2MeOgypZ+gRdU2XcecduPrB5iLyaM5deRiaZb5hlbjT3gvepLHez5CJrWZZpnkImLZkBOQ1RFQRxiQerZOa4GJX4crRrNcc4uR9MxqRYmjJ6/ujt+4vrF8o2qqfGFmI2TaOi4s54YRtzfBPeD15qjcmJ56tgVmBxvwYf9iUAZeW8+8XMru05YRdndMcedY7cfWDzEXk0Zy/Qw0yQ22tOYgSpB2T6GEZkDKK4sevnCk2bMpT+4wiBBT1OslykZTUY2jFhxlMPnjHbDeG+0W3/KPrF9L3mnPCAynIgwZUs5oI6P8v8Akdc0lGNcjxGEXT7pp88Y7cblP2i8I2pbD7xeyj9Q84MuW24RdDczDzjo/wAv+R/wiAcxFxK7tOWEXJ3TW94RLC0/Tn//xAAqEAEAAQMCBAYCAwEAAAAAAAABEQAhMUFRMGFxgRCRobHB8CDhYNHxQP/aAAgBAQABPyH+NwwitmdF6VqI5EV/vVqJ5E+1cg9Y8qhQHLxh7M4MtArLGdzhGvD5DdqRHNfH5fZg3K+sI3OVAFcBLSeQnloK0+vacFSMvB+e1FHMq+88C7gXJts1ZmYuzNYKkG5ehwbpx6bXv4hsOC16BII4fy2X/eps+d+QzQAALFjgIkykOtlEdoHhFQkRuNAGnkUvdqc6Fow3T8U8YZa6TdZJvUCa0Gw4N+zfS/gEy2fztUDSUQ1FEwTmguAmtvNAkcFmCgiCMnhJXoarsVIKTcn+pUTYuN5S8LN+pPB6s4N5b606j+LnWdx0VBJZheOh4KXHq8PwakXGm56qZ4LWv2mkB3tO3711Gp0GDhWH9FaNKjsJmyedPOsv5Ee1fsUetRg7c9q0T9etETvo4eUNKhm0/mUzcnmNiiI5fnwjdwIe9O6z8qoXL7DmjSOwZpx47C/mVZq8iuENoP6pKCXbWiaElrT3Zax/7/rVq/JMHDL9SBPTsqIoe7R0u4fZUH3DrWx277VvP7a1YW6s9a3u3eaOwGEeTTWoQ42YOvNqIr3lMrvwymjCVlHNYhjYFI0VtE6jz2w0bj2vV6bjNI+YiKIQMHu8ZJFTKSqD05KR7TVeteqYIelFu9Cz3q5zcz9VFnu73qxEzr9/+LDj1JpfE3M+yocXrHuogKt1V1X+Of/EACgQAQACAQIGAgICAwAAAAAAAAEAETEhQTBRYXGBkRChILFg0UDh8f/aAAgBAQABPxD+N8joXl6BvDe1hfqdYa/prfbO+dsz+ms9w5S72q6uRC7Tuvk2m8AU7BDpXUNTuDwiQjXT5zLL2zt9DsflrRb9eiXKM22/Yol9ITkEDXVv6BLi5j6hi/PBOl3r7rpCWx9nL78C1+jMzu6THtauOmpGmwAegikdfF/ueCMns9BNfJ8r2mDsaLaQxLCDYj+VYt/Vav3HkTVe4UO8AByDgYK53Skx6+p+DeLT6KfoN2KVk7yFKrrBhFRwpFRsX+IzC2kui3Zm2KyaIyPRe03Xg9HLexfgHaCzZObwJrHyeGZR1TaVWBoWmLi9qV5nflWaD8S10MHI9YKBCxGxPhOyroC0YDdg03nnbfnIhD1v3kdHVCOXg6NkM9sNpaWN41WGZocTYL0tKSDeKPjCHu4FzCgiCIljmVQrbdXWULUalHVWQRQdruNz+7KxsANrxecmP+pNv1cIImfHakQ2HRpJiHA0XnKJWo5Mau7zLPdID0AfqvDBrle9uGB3MP0SLy4AUAbsuMAW1VTbDOi6EEzQBO2E3i3rlBHg6mqewKg1f9GPkjLqyaGTuxgG3zk7KLFfHp4RXWetA/ZLFMZb9IRirqYr0ZQmYuBeQslqGrKuymPGLKtR6FeLPDdawS1LqA8bqRAZRTYrmh9oerTR6LAwFyue3DDTzN+qwgXbLB2Mr2nZVPtmv12EAbUDWa3YZR3mjrK3qlZB5XDyO80IkEAjzTDpnUp2WW7ObPQSyZVTrUWoI5JD3A05oBF+S9x7Ij0ww6Dl8V6Z0ad6j9eE96Mc0/8AxViPnsD3SgWPJt6kQbDGmnZkcOzEf0tCpJAqy8/+DcIo/kH7Ryw5zEbPeVX6TmQUJFr/ABz/2Q==';

// ==================== ИЗДЕЛИЯ ====================
// Список изделий: отображение, добавление, редактирование, копирование.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), products/orders (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// svgEdit/svgDelete/svgCopy, updateProductSelects, openDeleteModal, closeModal (главный скрипт).

// UNIT_PRODUCT_LABELS заменён общей функцией unitAbbrev(code) из inventory.js.

function displayProducts() {
    products.sort((a, b) => (a.name||"").localeCompare(b.name||""));
    updateProductSelects();
    renderProductCards();
    filterProductsList();
}

// ---- Карточный вид (по тому же принципу, что и карточки заказов) ----
let productsViewMode = 'tiles';
try { if (localStorage.getItem('sb_products_view') === 'cards') productsViewMode = 'cards'; } catch (e) {}
try { if (localStorage.getItem('sb_products_view') === 'tiles') productsViewMode = 'tiles'; } catch (e) {}

function setProductsViewMode(mode) {
    productsViewMode = mode === 'tiles' ? 'tiles' : 'cards';
    try { localStorage.setItem('sb_products_view', productsViewMode); } catch (e) {}
    renderProductCards();
    filterProductsList();
}

function productsViewToggleSync() {
    document.getElementById('productsViewBtnCards')?.classList.toggle('active', productsViewMode === 'cards');
    document.getElementById('productsViewBtnTiles')?.classList.toggle('active', productsViewMode === 'tiles');
}

function renderProductTiles() {
    const body = document.getElementById('productCardsBody');
    body.classList.add('pc-grid');
    body.innerHTML = products.map(p => {
        const photoSrc = p.photo_url ? escapeHtml(p.photo_url) : PRODUCT_PLACEHOLDER_SRC;
        const warn = p.recipe_confirmed ? '' : '<span class="pt-flag"></span>';
        const ps = formatMoney(p.price);
        const nm = (ps.match(/\d[\d\s.,]*/) || [ps])[0].trim(); // число без символа валюты
        const cu = escapeHtml((ps.replace(/\d[\d\s.,]*/, '').trim()) || '€');
        // Плитка 2 в ряд, размер как у плиток «Настроек» (31.10.2026, вариант B): название сверху на всю ширину, внизу цена с валютой и мини-фото
        return `<div class="pt-tile ptm" data-name="${escapeHtml((p.name || '').toLowerCase())}" onclick="openProductDetail(${p.id})">
            <div class="ptm-name"><span class="ptm-sp"></span>${escapeHtml(p.name || t('semifinished_no_name_fallback'))}</div>
            <div class="ptm-price${nm.length > 7 ? ' sm' : ''}"><span>${escapeHtml(nm)}</span><i>${cu}</i></div>
            <img class="ptm-photo" src="${photoSrc}" loading="lazy">
            ${warn}
        </div>`;
    }).join('');
}

function renderProductCards() {
    const body = document.getElementById('productCardsBody');
    if (!body) return;
    productsViewToggleSync();
    if (productsViewMode === 'tiles') { renderProductTiles(); return; }
    body.classList.remove('pc-grid');
    let html = '';
    products.forEach((p, realIdx) => {
        const hasUnit = !!p.unit;
        const recipeOk = !!p.recipe_confirmed;
        const unitLabel = hasUnit ? unitAbbrev(p.unit) : '';
        // Таблетки (единый стиль): единица · партия, рецепт
        const subParts = [];
        if (hasUnit) {
            subParts.push(`<span class="pc-tag">${escapeHtml(unitLabel)} · ${t('prod_batch_short').replace('{n}', Number(p.batch_size) || 1)}</span>`);
        } else {
            subParts.push(`<span class="pc-tag pc-tag-bad">${t('prod_unit_missing')}</span>`);
        }
        subParts.push(recipeOk
            ? `<span class="pc-tag pc-tag-ok">${t('prod_recipe_ok')}</span>`
            : `<span class="pc-tag pc-tag-bad">${t('prod_recipe_missing')}</span>`);
        // Себестоимость/прибыль/маржа: без единицы изделия посчитать нельзя — прочерки
        let costVal = '—', profitVal = '—', marginVal = '—', profitColor = '#a29c8c';
        if (hasUnit) {
            const unitCost = productUnitCost(p);
            const profit = (p.price || 0) - unitCost;
            costVal = formatMoney(unitCost);
            profitVal = formatMoney(profit);
            marginVal = (p.price ? productProfitPct(p).toFixed(0) : '0') + '%';
            profitColor = profit >= 0 ? '#4f6349' : '#c0685c';
        }
        const photoSrc = p.photo_url ? escapeHtml(p.photo_url) : PRODUCT_PLACEHOLDER_SRC;
        html += `
        <div class="oc-swipe-wrap" data-name="${escapeHtml((p.name || '').toLowerCase())}" style="--oc-swipe-x:-72px;">
            ${refCopySwipeBtnHtml(`quickCopyProductFromSwipe(${realIdx})`)}
            <div class="order-card" style="cursor:pointer;" onclick="openProductDetail(${p.id})">
                <div class="order-card-body">
                    <div style="display:flex; gap:12px; align-items:center;">
                        <img class="oc-photo" src="${photoSrc}" loading="lazy">
                        <div style="flex:1; min-width:0;">
                            <div class="oc-row" style="align-items:baseline;">
                                <span class="oc-name">${escapeHtml(p.name || t('semifinished_no_name_fallback'))}</span>
                                <span class="oc-price">${formatMoney(p.price)}</span>
                            </div>
                            <div class="pc-tags">${subParts.join('')}</div>
                        </div>
                    </div>
                    ${stockCardCellsHtml3(
                        [t('prod_cell_cost'), costVal, hasUnit ? '#3c3a34' : '#a29c8c'],
                        [t('prod_cell_profit'), profitVal, profitColor],
                        [t('prod_cell_margin'), marginVal, profitColor])}
                </div>
            </div>
        </div>`;
    });
    body.innerHTML = html;
    initCopySwipeDelegation('productCardsBody');
}

function quickCopyProductFromSwipe(realIdx) {
    if (typeof closeAllCardSwipes === 'function') closeAllCardSwipes();
    copyProduct(realIdx);
}

// ---- Поиск по названию ----
function filterProductsList() {
    const input = document.getElementById('productSearchInput');
    const q = input ? input.value.trim().toLowerCase() : '';
    document.getElementById('productSearchClear')?.classList.toggle('hidden', !q);
    document.getElementById('productSearchIcon')?.classList.toggle('hidden', !!q);

    let visibleCards = 0;
    document.querySelectorAll('#productCardsBody .oc-swipe-wrap, #productCardsBody .pt-tile').forEach(wrap => {
        const match = !q || wrap.dataset.name.includes(q);
        wrap.style.display = match ? '' : 'none';
        if (match) visibleCards++;
    });
    document.getElementById('productCardsEmpty')?.classList.toggle('hidden', visibleCards !== 0);

}

function clearProductSearch() {
    const input = document.getElementById('productSearchInput');
    if (input) input.value = '';
    filterProductsList();
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
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('productsSearchBar', 'productsList', 'productDetail');

    document.getElementById('pdName').value = '';
    document.getElementById('pdUnit').value = 'pcs';
    document.getElementById('pdPrice').value = '0.00';
    document.getElementById('pdBatchSize').value = '1';
    document.getElementById('pdRecipeConfirmed').checked = false;
    document.getElementById('pdTrackStock').checked = false;

    // Показываем кнопку Сохранить, скрываем удаление и рецепт
    const saveBtn = document.getElementById('pdSaveNewBtn');
    if (saveBtn) saveBtn.classList.remove('hidden');
    const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
    if (delBtn) delBtn.classList.add('hidden');
    const recipeBlock = document.getElementById('pdRecipeBlock');
    if (recipeBlock) recipeBlock.classList.add('hidden');
    const costChartBlock = document.getElementById('pdCostChartBlock');
    if (costChartBlock) costChartBlock.classList.add('hidden');

    updatePdUnitUI('pcs');
    pdTitleSync();
    pdCurSync();
    refreshFab();
}

async function saveNewProduct() {
    const name  = (document.getElementById('pdName')?.value || '').trim();
    const unit  = document.getElementById('pdUnit')?.value || 'pcs';
    const price = parseFloat(document.getElementById('pdPrice')?.value) || 0;
    if (!name) { showInfo(t('prod_name_required')); return; }

    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('products').insert({
            org_id: currentOrgId, name, price, unit, batch_size: 1
        }).select().single();
        if (error) throw error;

        const newProd = { id: data.id, name, price, batch_size: 1, cost_items: [], unit, recipe_confirmed: false, track_stock: false, ingredients: [] };
        products.push(newProd);
        _isNewProduct = false;

        // Предустановка: материалы с галочкой «Добавлять в новые изделия автоматически»
        try {
            const presets = ingredients.filter(g => isMaterial(g) && Number(g.auto_add_qty) > 0);
            if (presets.length) {
                const { data: pr, error: pe } = await db.from('product_ingredients').insert(presets.map(g => ({
                    org_id: currentOrgId, product_id: data.id, ingredient_id: g.id, semi_finished_id: null, quantity: Number(g.auto_add_qty)
                }))).select();
                if (pe) throw pe;
                pr.forEach(d => newProd.ingredients.push({ id: d.id, ingredient_id: d.ingredient_id, semi_finished_id: null, quantity: Number(d.quantity) }));
            }
        } catch (pe) { console.error('Предустановка материалов не добавлена:', pe); }

        // Восстанавливаем UI
        const saveBtn = document.getElementById('pdSaveNewBtn');
        if (saveBtn) saveBtn.classList.add('hidden');
        const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
        if (delBtn) delBtn.classList.remove('hidden');
        const recipeBlock = document.getElementById('pdRecipeBlock');
        if (recipeBlock) recipeBlock.classList.remove('hidden');

        displayProducts();
        openProductDetail(newProd.id);
        logActivity('product', `${t('log_product_created')}: «${name}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

async function cleanupProductDraftIfEmpty(prodId) {
    if (!_draftProductIds.has(prodId)) return;
    _draftProductIds.delete(prodId);
    const idx = products.findIndex(p => p.id === prodId);
    if (idx === -1) return;
    if (products[idx].name && products[idx].name.trim()) return; // название вписали — уже не пустой черновик
    try {
        suppressRealtimeFor3s();
        await db.from('products').delete().eq('id', prodId);
        products.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик изделия:', e); }
}

// Копирует изделие (название/цена/единица/партия/доп.расходы — без рецепта,
// для рецепта есть отдельная функция "Скопировать рецепт" внутри карточки)
// и сразу открывает карточку копии для донастройки.
async function copyProduct(i) {
    const src = products[i];
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('products').insert({
            org_id: currentOrgId, name: src.name + t('common_copy_suffix'), price: src.price, unit: src.unit || 'pcs',
            batch_size: src.batch_size || 1, cost_items: costItemsOf(src)
        }).select().single();
        if (error) throw error;
        const newProd = {
            id: data.id, name: data.name, price: Number(data.price),
            batch_size: Number(data.batch_size || 1), cost_items: costItemsOf(data),
            unit: data.unit || '', recipe_confirmed: false, ingredients: []
        };
        products.push(newProd);
        displayProducts();
        openProductDetail(newProd.id);
        logActivity('product', `${t('log_product_copied')} «${src.name}» → «${newProd.name}»`);
    } catch (e) { console.error(e); showInfo(t('ing_copy_error')); }
    finally { hideLoading(); }
}

// ==================== ДЕТАЛЬНЫЙ ВИД ИЗДЕЛИЯ / РЕЦЕПТУРА ====================

let _productCostChartInstance = null;

// Строит график динамики себестоимости изделия.
// Алгоритм: собирает все уникальные даты из истории цен ингредиентов рецепта,
// для каждой даты находит актуальную цену каждого ингредиента (последняя запись
// в истории с valid_from <= этой дате) и считает полную себестоимость.
async function renderProductCostChart(prod) {
    _pdCostPoints = [];
    const sumReset = document.getElementById('pdCostSum'); if (sumReset) sumReset.textContent = '';
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
        batchCost += costItemsBatchTotal(prod);
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

    _pdCostPoints = points;
    drawProductCostChart();
}

// Период графика: '30' | '90' | 'all'
let _pdCostPoints = [];
let _pdCostPeriod = 'all';
function setPdCostPeriod(period) {
    _pdCostPeriod = period;
    drawProductCostChart();
}
function _pdPeriodPoints() {
    const pts = _pdCostPoints || [];
    if (_pdCostPeriod === 'all') return pts;
    const days = parseInt(_pdCostPeriod, 10);
    const d = new Date(); d.setDate(d.getDate() - days);
    const cutoff = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const inWin = pts.filter(p => p.date >= cutoff);
    const before = pts.filter(p => p.date < cutoff);
    // Последняя цена до начала периода — как точка отсчёта
    return before.length ? [before[before.length - 1], ...inWin] : inWin;
}
async function drawProductCostChart() {
    const canvas  = document.getElementById('productCostChart');
    const emptyEl = document.getElementById('productCostChartEmpty');
    if (!canvas || !emptyEl) return;
    ['30', '90', 'all'].forEach(k => {
        const b = document.getElementById('pdPer' + (k === 'all' ? 'All' : k));
        if (b) b.classList.toggle('active', k === _pdCostPeriod);
    });
    const sumEl = document.getElementById('pdCostSum');
    const points = _pdPeriodPoints();
    if (sumEl) {
        const first = points.length ? points[0].cost : 0;
        const last = points.length ? points[points.length - 1].cost : 0;
        if (points.length >= 2 && first > 0) {
            const pct = (last - first) / first * 100;
            sumEl.textContent = (pct > 0 ? '+' : '') + pct.toFixed(1).replace(/\.0$/, '') + '%';
        } else sumEl.textContent = '';
    }
    if (_productCostChartInstance) { _productCostChartInstance.destroy(); _productCostChartInstance = null; }
    if (points.length < 2) {
        canvas.style.display = 'none';
        emptyEl.textContent = _pdCostPeriod === 'all' ? t('prod_not_enough_price_points') : t('prod_cost_no_changes_period');
        emptyEl.classList.remove('hidden');
        return;
    }
    canvas.style.display = 'block';
    emptyEl.classList.add('hidden');

    const labels = points.map(p => formatDateDMY(p.date));
    const data   = points.map(p => parseFloat(p.cost.toFixed(4)));

    try { await ensureChartJs(); } catch (e) { console.error(e); return; }
    if (!canvas.isConnected) return;
    if (_productCostChartInstance) { _productCostChartInstance.destroy(); _productCostChartInstance = null; }

    const ctx = canvas.getContext('2d');
    _productCostChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `${t('prod_unit_cost_1pc')} (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency})`,
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
                        label: ctx => `${t('prod_cost_short')}: ${formatMoney(ctx.parsed.y, 4)}`
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
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('productsSearchBar', 'productsList', 'productDetail');

    document.getElementById('pdName').value = prod.name;
    document.getElementById('pdUnit').value = prod.unit || '';
    document.getElementById('pdPrice').value = prod.price.toFixed(2);
    document.getElementById('pdBatchSize').value = prod.batch_size || 1;
    renderCostItemsEditor('pdCostItemsBox', 'p');
    document.getElementById('pdRecipeConfirmed').checked = !!prod.recipe_confirmed;
    document.getElementById('pdTrackStock').checked = !!prod.track_stock;
    renderPdPhotoUI(prod.photo_url);

    updatePdUnitUI(prod.unit);
    renderProductRecipe(prod);
    fillNewRecipeIngredientSelect();
    setupCopyRecipeControl(prod);
    _pdCostPeriod = 'all';
    pdTitleSync();
    pdCurSync();
    requestAnimationFrame(pdSyncPhotoSize);
    document.getElementById('pdCopyBox')?.classList.add('hidden');
    renderProductCostChart(prod);
    refreshFab();
}

// Фото в карточке изделия — квадрат со стороной, равной высоте трёх полей справа
function pdSyncPhotoSize() {
    const f = document.querySelector('#productDetail .pd-fields');
    const row = document.querySelector('#productDetail .pd-main-row');
    if (!f || !row) return;
    const hgt = Math.round(f.getBoundingClientRect().height);
    if (hgt > 40) row.style.setProperty('--pd-ph', hgt + 'px');
}
(function () {
    const init = () => {
        const f = document.querySelector('#productDetail .pd-fields');
        if (!f) return;
        if (window.ResizeObserver) new ResizeObserver(pdSyncPhotoSize).observe(f);
        window.addEventListener('resize', pdSyncPhotoSize);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// Крупное название в карточке повторяет поле «Название»
function pdCurSync() {
    const c = (typeof CURRENCY_SYMBOLS !== 'undefined' && CURRENCY_SYMBOLS[currentOrgCurrency]) || currentOrgCurrency || '';
    document.querySelectorAll('#productDetail .pd-cur').forEach(el => { el.textContent = c; });
}
function pdTitleSync() {
    const el = document.getElementById('pdTitle');
    if (el) el.textContent = (document.getElementById('pdName')?.value || '').trim();
}
function togglePdCopyBox() {
    const box = document.getElementById('pdCopyBox');
    if (!box) return;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) document.getElementById('copyRecipeFromInput')?.focus();
}

function updatePdUnitUI(unit) {
    const warning = document.getElementById('pdUnitWarning');
    const hint = document.getElementById('pdPriceUnitHint');
    if (warning) warning.classList.toggle('hidden', !!unit);
    if (hint) hint.textContent = unit ? t('prod_price_per_unit_hint').replace('{u}', unitAbbrev(unit)) : '';
}

// Новая несохранённая карточка изделия (для вопроса при выходе, helpers.js guardLeaveNew)
function productNewInfo() {
    if (!_isNewProduct || !document.getElementById('productDetail')?.classList.contains('active')) return null;
    const name = (document.getElementById('pdName')?.value || '').trim();
    const price = parseFloat(document.getElementById('pdPrice')?.value) || 0;
    return { hasData: !!name || price > 0, save: async () => { await saveNewProduct(); return !_isNewProduct; }, discard: async () => { _isNewProduct = false; } };
}

async function closeProductDetail() {
    if (typeof guardLeaveNew === 'function' && await guardLeaveNew(productNewInfo())) return;
    const leavingId = currentProductId;
    currentProductId = null;
    _isNewProduct = false;
    document.getElementById('productsList').classList.remove('hidden');
    document.getElementById('productDetail').classList.remove('active');
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('productsSearchBar', 'productsList', 'productDetail');
    // Восстанавливаем UI на случай если был новый
    const saveBtn = document.getElementById('pdSaveNewBtn');
    if (saveBtn) saveBtn.classList.add('hidden');
    const delBtn = document.querySelector('#productDetail button[onclick="deleteCurrentProduct()"]');
    if (delBtn) delBtn.classList.remove('hidden');
    const recipeBlock = document.getElementById('pdRecipeBlock');
    if (recipeBlock) recipeBlock.classList.remove('hidden');
    const costChartBlock = document.getElementById('pdCostChartBlock');
    if (costChartBlock) costChartBlock.classList.remove('hidden');
    if (leavingId !== null) await cleanupProductDraftIfEmpty(leavingId);
    displayProducts();
    refreshFab();
}

// Удаление изделия прямо из его карточки
function deleteCurrentProduct() {
    const idx = products.findIndex(p => p.id === currentProductId);
    if (idx === -1) return;
    const prod = products[idx];
    openDeleteModal(idx, 'product', `${t('delete_label_product')} «${prod.name}»`);
}

async function savePdHeader() {
    if (_isNewProduct) return;
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const name = document.getElementById('pdName').value.trim();
    const unit = document.getElementById('pdUnit').value;
    const price = parseFloat(document.getElementById('pdPrice').value);
    const batchSize = parseFloat(document.getElementById('pdBatchSize').value) || 1;
    if (!name || isNaN(price)) { showInfo(t('prod_fill_name_price')); return; }

    suppressRealtimeFor3s();
    showLoading();
    try {
        const { error } = await db.from('products').update({
            name, price: parseFloat(price.toFixed(2)), batch_size: batchSize, unit
        }).eq('id', prod.id);
        if (error) throw error;
        const unitChanged = prod.unit !== unit;
        const oldBs = Number(prod.batch_size) || 1;
        if (oldBs !== batchSize) {
            // количество материалов хранится на партию — пересчитываем под новый размер партии
            const mats = (prod.ingredients || []).filter(_isMatRow);
            await Promise.all(mats.map(async ri => {
                const q = _round6(Number(ri.quantity) / oldBs * batchSize);
                const r = await db.from('product_ingredients').update({ quantity: q }).eq('id', ri.id);
                if (r.error) throw r.error;
                ri.quantity = q;
            }));
        }
        prod.name = name; prod.price = parseFloat(price.toFixed(2));
        prod.batch_size = batchSize;
        prod.unit = unit;
        orders.forEach(o => o.items.forEach(it => { if (it.product_id === prod.id) it.product = name; }));
        updatePdUnitUI(unit);
        renderProductRecipe(prod);
        logActivity('product', `${t('log_product_changed')} «${prod.name}»${unitChanged ? ` (${t('ing_unit_label').toLowerCase()}: ${unitAbbrev(unit) || '—'})` : ''}`);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

function fillNewRecipeIngredientSelect() {
    setupSearchDropdown('newRecipeIngredient', 'newRecipeIngredientDropdown', () => {
        const names = ingredientsOnly().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(i => i.name);
        const sfNames = (typeof semiFinished !== 'undefined')
            ? semiFinished.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(s => s.name + t('prod_sf_suffix'))
            : [];
        return names.concat(sfNames);
    }, null, (text) => openQuickAddIngredientModal(text, 'product'));
}

// Находит ингредиент/полуфабрикат по тексту, введённому в поле поиска.
// Возвращает { type: 'ing'|'sf', id } или null, если совпадения нет.
function resolveRecipeIngredientInput(text) {
    const raw = text.trim();
    if (!raw) return null;
    const sfSuffix = t('prod_sf_suffix');
    if (raw.endsWith(sfSuffix)) {
        const name = raw.slice(0, -sfSuffix.length);
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
    if (!list.some(ri => !_isMatRow(ri))) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="4" class="text-center text-xs text-gray-400 py-2">${t('sf_no_ingredients_hint')}</td>`;
        tbody.appendChild(row);
    } else {
        list.forEach((ri, i) => {
            if (_isMatRow(ri)) return; // материалы показываются в своём блоке
            let displayName, unitLabel, unitPrice;
            if (ri.semi_finished_id) {
                const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === ri.semi_finished_id) : null;
                displayName = sf ? sf.name + t('prod_sf_suffix') : t('prod_sf_deleted');
                unitLabel = sf ? unitAbbrev(sf.unit) : '';
                unitPrice = sf ? semiFinishedUnitCost(sf) : 0;
            } else {
                const ing = ingredients.find(x => x.id === ri.ingredient_id);
                displayName = ing ? ing.name : t('sf_ingredient_deleted');
                unitLabel = ing ? unitAbbrev(ing.unit) : '';
                unitPrice = ing ? ingredientUnitPrice(ing) : 0;
            }
            const lineCost = unitPrice * ri.quantity;
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.innerHTML = `
                <td class="p-0.5 table-text">${escapeHtml(displayName)}</td>
                <td class="p-0.5 table-text text-center">${ri.quantity} ${unitLabel}</td>
                <td class="p-0.5 table-text text-center font-medium">${formatMoney(lineCost)}</td>
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

    document.getElementById('pdBatchCost').textContent = formatMoney(batchCost);
    document.getElementById('pdUnitCost').textContent  = formatMoney(unitCost);
    document.getElementById('pdProfit').textContent    = formatMoney(profit);
    document.getElementById('pdProfitPct').textContent = profitPct.toFixed(1) + '%';
    renderProductMaterials(prod);
}

// ==================== МАТЕРИАЛЫ В ИЗДЕЛИИ (на штуку) ====================
// Материал — складская позиция kind='material'. В рецепте хранится строкой product_ingredients
// с ingredient_id = материал и quantity НА ПАРТИЮ (= количество на штуку × размер партии),
// поэтому себестоимость, списание и нехватка работают тем же кодом, что и для ингредиентов.
// В блоке показываем количество на штуку (quantity ÷ размер партии). При смене размера партии
// количество материалов пересчитывается (savePdHeader).
function _isMatRow(ri) {
    if (!ri || !ri.ingredient_id) return false;
    const ing = ingredients.find(x => x.id === ri.ingredient_id);
    return isMaterial(ing);
}
const _round6 = x => Math.round(x * 1e6) / 1e6;

function renderProductMaterials(prod) {
    const tbody = document.getElementById('pdMatBody');
    if (!tbody) return;
    const bs = Number(prod.batch_size) || 1;
    tbody.innerHTML = '';
    const rows = (prod.ingredients || []).map((ri, i) => ({ ri, i })).filter(x => _isMatRow(x.ri));
    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" class="text-center text-xs text-gray-400 py-2">${t('mat_block_hint')}</td>`;
        tbody.appendChild(tr);
    } else {
        rows.forEach(({ ri, i }) => {
            const ing = ingredients.find(x => x.id === ri.ingredient_id);
            const qpu = _round6(Number(ri.quantity) / bs);
            const cost = ingredientUnitPrice(ing) * qpu;
            const tr = document.createElement('tr');
            tr.className = 'border-b';
            tr.innerHTML = `
                <td class="p-0.5 table-text">${escapeHtml(ing.name)}</td>
                <td class="p-0.5 text-center"><input type="number" value="${qpu}" step="0.01" min="0" inputmode="decimal" autocomplete="off" onchange="changeMaterialQty(${i}, this.value)" class="border p-0.5 rounded-xl table-text" style="width:56px;padding-left:3px;padding-right:3px;text-align:center;"> <span class="table-text text-gray-500">${escapeHtml(unitAbbrev(ing.unit))}</span></td>
                <td class="p-0.5 table-text text-center font-medium">${formatMoney(cost)}</td>
                <td class="p-0.5 text-center">${hasPermission('can_delete') ? svgDelete(`deleteRecipeItem(${i})`) : ''}</td>`;
            tbody.appendChild(tr);
        });
    }
    // Выбор: только материалы со склада, которых ещё нет в изделии
    const sel = document.getElementById('pdNewMat');
    if (sel) {
        const used = new Set((prod.ingredients || []).map(ri => ri.ingredient_id));
        const all = ingredients.filter(isMaterial);
        const avail = all.filter(m => !used.has(m.id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const prev = sel.value;
        sel.innerHTML = `<option value="">${escapeHtml(t('mat_pick'))}</option>` + avail.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
        if (prev && avail.some(m => String(m.id) === prev)) sel.value = prev;
        document.getElementById('pdMatNone')?.classList.toggle('hidden', avail.length > 0);
    }
}

async function addMaterialToProduct() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const matId = document.getElementById('pdNewMat').value;
    const qpu = parseFloat(document.getElementById('pdNewMatQty').value);
    const ing = ingredients.find(x => String(x.id) === String(matId));
    if (!ing || !(qpu > 0)) { showInfo(t('mat_choose_and_qty')); return; }
    const bs = Number(prod.batch_size) || 1;
    showLoading();
    try {
        suppressRealtimeFor3s();
        const { data, error } = await db.from('product_ingredients').insert({
            org_id: currentOrgId, product_id: prod.id, ingredient_id: ing.id, semi_finished_id: null, quantity: _round6(qpu * bs)
        }).select().single();
        if (error) throw error;
        if (!prod.ingredients) prod.ingredients = [];
        prod.ingredients.push({ id: data.id, ingredient_id: data.ingredient_id, semi_finished_id: null, quantity: Number(data.quantity) });
        document.getElementById('pdNewMatQty').value = '';
        document.getElementById('pdNewMat').value = '';
        renderProductRecipe(prod);
        logActivity('product', `${t('log_material_added')} «${prod.name}»: «${ing.name}» (${qpu})`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

async function changeMaterialQty(i, v) {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const ri = prod.ingredients[i];
    const qpu = parseFloat(v);
    if (!ri || !(qpu > 0)) { renderProductRecipe(prod); return; }
    const bs = Number(prod.batch_size) || 1;
    const q = _round6(qpu * bs);
    suppressRealtimeFor3s();
    try {
        const { error } = await db.from('product_ingredients').update({ quantity: q }).eq('id', ri.id);
        if (error) throw error;
        ri.quantity = q;
        renderProductRecipe(prod);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); renderProductRecipe(prod); }
}

async function addIngredientToRecipe() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const inputEl = document.getElementById('newRecipeIngredient');
    const quantity = parseFloat(document.getElementById('newRecipeQty').value);
    const resolved = resolveRecipeIngredientInput(inputEl.value);
    if (!resolved || isNaN(quantity) || quantity <= 0) {
        showInfo(t('prod_choose_ing_sf_and_qty')); return;
    }
    const type = resolved.type, selectedId = resolved.id;
    const insertRow = type === 'sf'
        ? { product_id: prod.id, semi_finished_id: selectedId, ingredient_id: null, quantity }
        : { product_id: prod.id, ingredient_id: selectedId, semi_finished_id: null, quantity };

    showLoading();
    try {
        suppressRealtimeFor3s();
        const { data, error } = await db.from('product_ingredients').insert({ org_id: currentOrgId, ...insertRow }).select().single();
        if (error) throw error;
        if (!prod.ingredients) prod.ingredients = [];
        prod.ingredients.push({ id: data.id, ingredient_id: data.ingredient_id, semi_finished_id: data.semi_finished_id, quantity: Number(data.quantity) });
        renderProductRecipe(prod);
        let itemName = '';
        if (type === 'sf') {
            const sf = semiFinished.find(s => s.id === selectedId);
            itemName = sf ? sf.name + t('prod_sf_suffix') : '';
        } else {
            const ing = ingredients.find(i => i.id === selectedId);
            itemName = ing ? ing.name : '';
        }
        logActivity('product', `${t('log_added_to_recipe')} «${prod.name}»: «${itemName}» (${quantity})`);
        inputEl.value = '';
        document.getElementById('newRecipeQty').value = '';
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

function openEditRecipeItemModal(i) {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    editRecipeItemIdx = i;
    const ri = prod.ingredients[i];
    const currentValue = ri.semi_finished_id ? ('sf-' + ri.semi_finished_id) : ('ing-' + ri.ingredient_id);

    const sel = document.getElementById('editRecipeIngredient');
    sel.innerHTML = `<option value="">${t('prod_choose_ing_or_sf')}</option>`;
    if (ingredientsOnly().length) {
        const grpIng = document.createElement('optgroup');
        grpIng.label = t('prod_optgroup_ingredients');
        ingredientsOnly().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(ing => {
            const opt = document.createElement('option');
            opt.value = 'ing-' + ing.id; opt.textContent = ing.name;
            if (opt.value === currentValue) opt.selected = true;
            grpIng.appendChild(opt);
        });
        sel.appendChild(grpIng);
    }
    if (typeof semiFinished !== 'undefined' && semiFinished.length) {
        const grpSf = document.createElement('optgroup');
        grpSf.label = t('prod_optgroup_semifinished');
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
        showInfo(t('common_fill_correctly')); return;
    }
    const [type, idStr] = selectedRaw.split('-');
    const selectedId = Number(idStr);
    const ri = prod.ingredients[editRecipeItemIdx];
    const updateRow = type === 'sf'
        ? { ingredient_id: null, semi_finished_id: selectedId, quantity }
        : { ingredient_id: selectedId, semi_finished_id: null, quantity };

    showLoading();
    try {
        suppressRealtimeFor3s();
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
        logActivity('product', `${t('log_ingredient_changed_in_recipe')} «${prod.name}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

function deleteRecipeItem(i) {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const ri = prod.ingredients[i];
    let itemName = '';
    if (ri.semi_finished_id) {
        const sf = semiFinished.find(x => x.id === ri.semi_finished_id);
        itemName = sf ? sf.name + t('prod_sf_suffix') : '';
    } else {
        const ing = ingredients.find(x => x.id === ri.ingredient_id);
        itemName = ing ? ing.name : '';
    }
    openDeleteModal(i, 'recipeItem', `«${itemName}» ${t('delete_label_from_recipe')}`);
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
        suppressRealtimeFor3s();
        const { error } = await db.from('products').update({ recipe_confirmed: checked }).eq('id', prod.id);
        if (error) throw error;
        prod.recipe_confirmed = checked;
        logActivity('product', `${t('log_recipe_word')} «${prod.name}» ${t('log_marked_as')} ${checked ? t('log_fully_filled') : t('log_incomplete')}`);
    } catch (e) {
        console.error(e); showInfo(t('error_save_check_connection'));
        document.getElementById('pdRecipeConfirmed').checked = !checked;
    } finally { hideLoading(); }
}

async function toggleTrackStock() {
    const prod = products.find(p => p.id === currentProductId);
    if (!prod) return;
    const checked = document.getElementById('pdTrackStock').checked;
    showLoading();
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('products').update({ track_stock: checked }).eq('id', prod.id);
        if (error) throw error;
        prod.track_stock = checked;
        // Обновляем пульсацию корзинки
        if (typeof updateInventoryAlertDot === 'function') updateInventoryAlertDot();
        logActivity('product', `«${prod.name}» — ${t('log_stock_tracking')} ${checked ? t('log_enabled') : t('log_disabled')}`);
    } catch (e) {
        console.error(e); showInfo(t('error_save_check_connection'));
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
        suppressRealtimeFor3s();
        await dbMust(db.from('products').update({ recipe_confirmed: false }).eq('id', prod.id));
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
    const srcItems = (src.ingredients || []).filter(ri => !_isMatRow(ri)); // материалы не копируем (количество зависит от размера партии)
    if (!srcItems.length) { showInfo(t('prod_no_recipe_to_copy')); return; }

    const existingIngIds = new Set((prod.ingredients || []).filter(i => i.ingredient_id).map(i => i.ingredient_id));
    const existingSfIds  = new Set((prod.ingredients || []).filter(i => i.semi_finished_id).map(i => i.semi_finished_id));
    const toCopy = srcItems.filter(ri => ri.semi_finished_id ? !existingSfIds.has(ri.semi_finished_id) : !existingIngIds.has(ri.ingredient_id));
    const skipped = srcItems.length - toCopy.length;

    if (!toCopy.length) { showInfo(t('prod_all_positions_already_in_recipe').replace('{name}', sourceName)); return; }

    const posWord = toCopy.length === 1 ? t('sf_position_one') : t('sf_position_many');
    let msg = `${t('sf_copy_positions_confirm_prefix')} ${toCopy.length} ${posWord} ${t('sf_copy_positions_confirm_from')} «${sourceName}» ${t('common_into')} «${prod.name}»?`;
    if (skipped) msg += `\n(${skipped} ${t('sf_already_in_recipe_skip')})`;
    if (!(await showConfirm(msg))) return;

    showLoading();
    try {
        suppressRealtimeFor3s();
        const rows = toCopy.map(ri => ri.semi_finished_id
            ? { org_id: currentOrgId, product_id: prod.id, semi_finished_id: ri.semi_finished_id, ingredient_id: null, quantity: ri.quantity }
            : { org_id: currentOrgId, product_id: prod.id, ingredient_id: ri.ingredient_id, semi_finished_id: null, quantity: ri.quantity });
        const { data, error } = await db.from('product_ingredients').insert(rows).select();
        if (error) throw error;
        if (!prod.ingredients) prod.ingredients = [];
        data.forEach(d => prod.ingredients.push({ id: d.id, ingredient_id: d.ingredient_id, semi_finished_id: d.semi_finished_id, quantity: Number(d.quantity) }));
        renderProductRecipe(prod);
        logActivity('product', `${t('log_copied_to_recipe')} «${prod.name}»: ${toCopy.length} ${t('sf_position_many')} ${t('sf_copy_positions_confirm_from')} «${sourceName}»`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// ==================== ФОТО ИЗДЕЛИЯ ====================
// Тот же принцип, что и кроп-инструмент логотипа компании (см. company.js:
// openLogoCropModal/drawLogoCropCanvas/applyLogoCrop) — перетаскивание + зум
// на canvas. Отличие: логотип один на организацию и хранится как base64
// прямо в колонке organizations.logo_data_url, а фото изделий может быть
// много (по одному на товар), поэтому используем Supabase Storage (бакет
// product-photos) и храним в products.photo_url только ссылку.

const PRODUCT_PHOTO_CROP_OUTPUT_SIZE = 800; // финальный размер сохранённого фото, px
const PRODUCT_PHOTO_CROP_CANVAS_SIZE = 260; // размер видимой рамки кроп-инструмента, px
const PRODUCT_PHOTO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 МБ — фото с телефона крупнее логотипа

let _pdPhotoCropImg = null;
let _pdPhotoCropBaseScale = 1;
let _pdPhotoCropOffsetX = 0;
let _pdPhotoCropOffsetY = 0;
let _pdPhotoCropDragging = false;
let _pdPhotoCropLastX = 0;
let _pdPhotoCropLastY = 0;

// Отрисовывает блок фото в развёрнутой карточке (вызывается из openProductDetail)
function renderPdPhotoUI(photoUrl) {
    const img = document.getElementById('pdPhotoImg');
    const empty = document.getElementById('pdPhotoEmpty');
    const editBtn = document.getElementById('pdPhotoEditBtn');
    if (!img || !empty) return;
    if (photoUrl) {
        img.src = photoUrl;
        img.style.display = 'block';
        empty.style.display = 'none';
        editBtn.classList.remove('hidden');
    } else {
        img.style.display = 'none';
        empty.style.display = 'flex';
        editBtn.classList.add('hidden'); // без фото — кликабельна вся плашка "Добавить фото", отдельная кнопка не нужна
    }
    // Пока фото нет — весь квадрат кликом открывает выбор файла (клик по empty-плашке)
    empty.onclick = () => document.getElementById('pdPhotoFileInput').click();
}

function handleProductPhotoFileSelected(input) {
    const file = input.files && input.files[0];
    input.value = ''; // чтобы повторный выбор того же файла тоже сработал
    if (!file) return;
    if (file.size > PRODUCT_PHOTO_MAX_UPLOAD_BYTES) {
        showInfo(t('company_logo_too_large'));
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => openProductPhotoCropModal(img);
        img.onerror = () => showInfo(t('company_logo_load_error'));
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function openProductPhotoCropModal(img) {
    _pdPhotoCropImg = img;
    const size = PRODUCT_PHOTO_CROP_CANVAS_SIZE;
    _pdPhotoCropBaseScale = Math.max(size / img.width, size / img.height);
    _pdPhotoCropOffsetX = (size - img.width * _pdPhotoCropBaseScale) / 2;
    _pdPhotoCropOffsetY = (size - img.height * _pdPhotoCropBaseScale) / 2;
    document.getElementById('productPhotoCropZoom').value = 100;
    drawProductPhotoCropCanvas();
    document.getElementById('productPhotoCropModal').style.display = 'flex';
}

function closeProductPhotoCropModal() {
    document.getElementById('productPhotoCropModal').style.display = 'none';
    _pdPhotoCropImg = null;
}

function currentPdPhotoCropScale() {
    const zoomPct = Number(document.getElementById('productPhotoCropZoom').value) || 100;
    return _pdPhotoCropBaseScale * (zoomPct / 100);
}

function clampPdPhotoCropOffset() {
    const size = PRODUCT_PHOTO_CROP_CANVAS_SIZE;
    const scale = currentPdPhotoCropScale();
    const w = _pdPhotoCropImg.width * scale;
    const h = _pdPhotoCropImg.height * scale;
    _pdPhotoCropOffsetX = Math.min(0, Math.max(size - w, _pdPhotoCropOffsetX));
    _pdPhotoCropOffsetY = Math.min(0, Math.max(size - h, _pdPhotoCropOffsetY));
}

function drawProductPhotoCropCanvas() {
    if (!_pdPhotoCropImg) return;
    clampPdPhotoCropOffset();
    const canvas = document.getElementById('productPhotoCropCanvas');
    const ctx = canvas.getContext('2d');
    const scale = currentPdPhotoCropScale();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(_pdPhotoCropImg, _pdPhotoCropOffsetX, _pdPhotoCropOffsetY, _pdPhotoCropImg.width * scale, _pdPhotoCropImg.height * scale);
}

(function initProductPhotoCropInteractions() {
    document.addEventListener('DOMContentLoaded', () => {
        const canvas = document.getElementById('productPhotoCropCanvas');
        const zoomSlider = document.getElementById('productPhotoCropZoom');
        if (!canvas || !zoomSlider) return;

        canvas.addEventListener('pointerdown', (e) => {
            _pdPhotoCropDragging = true;
            _pdPhotoCropLastX = e.clientX;
            _pdPhotoCropLastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!_pdPhotoCropDragging) return;
            _pdPhotoCropOffsetX += e.clientX - _pdPhotoCropLastX;
            _pdPhotoCropOffsetY += e.clientY - _pdPhotoCropLastY;
            _pdPhotoCropLastX = e.clientX;
            _pdPhotoCropLastY = e.clientY;
            drawProductPhotoCropCanvas();
        });
        const stopDrag = () => {
            _pdPhotoCropDragging = false;
            canvas.style.cursor = 'grab';
        };
        canvas.addEventListener('pointerup', stopDrag);
        canvas.addEventListener('pointercancel', stopDrag);
        canvas.addEventListener('pointerleave', stopDrag);

        zoomSlider.addEventListener('input', () => drawProductPhotoCropCanvas());
    });
})();

async function applyProductPhotoCrop() {
    if (!_pdPhotoCropImg || !currentProductId) return;
    const out = document.createElement('canvas');
    out.width = PRODUCT_PHOTO_CROP_OUTPUT_SIZE;
    out.height = PRODUCT_PHOTO_CROP_OUTPUT_SIZE;
    const ctx = out.getContext('2d');
    const ratio = PRODUCT_PHOTO_CROP_OUTPUT_SIZE / PRODUCT_PHOTO_CROP_CANVAS_SIZE;
    const scale = currentPdPhotoCropScale() * ratio;
    ctx.drawImage(_pdPhotoCropImg, _pdPhotoCropOffsetX * ratio, _pdPhotoCropOffsetY * ratio, _pdPhotoCropImg.width * scale, _pdPhotoCropImg.height * scale);

    closeProductPhotoCropModal();
    showLoading();
    try {
        const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', 0.85));
        // Уникальное имя на каждое сохранение (не перезаписываем старый файл по тому
        // же пути) — иначе кэш браузера/CDN мог бы ещё долго показывать старое фото
        // после замены. Путь начинается с org_id — так работает RLS-политика Storage
        // (см. is_org_member((storage.foldername(name))[1]::bigint)).
        const path = `${currentOrgId}/${currentProductId}-${Date.now()}.jpg`;
        const { error: uploadError } = await db.storage.from('product-photos').upload(path, blob, {
            contentType: 'image/jpeg',
            upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = db.storage.from('product-photos').getPublicUrl(path);
        const photoUrl = urlData.publicUrl;

        await updateChecked(db.from('products').update({ photo_url: photoUrl }).eq('id', currentProductId));

        const prod = products.find(p => p.id === currentProductId);
        if (prod) prod.photo_url = photoUrl;
        renderPdPhotoUI(photoUrl);
        renderProductCards();
        // Обновляем локальный снимок кэша немедленно — иначе он остаётся
        // "устаревшим" (без нового фото) вплоть до следующей полной перезагрузки
        // данных (loadAllData), и при быстром старте из кэша фото пропадало бы
        // до тех пор, пока не подтянутся свежие данные из сети.
        if (typeof saveAppSnapshot === 'function') saveAppSnapshot();
        logActivity('product', `${t('log_field_changed')} «${t('prod_photo_label')}» «${prod ? prod.name : ''}»`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}


// ==================== СТАТЬИ РАСХОДОВ БЕЗ СКЛАДА (п. 12) ====================
// Редактор списка «название / сумма / на единицу или на партию» в карточке изделия (kind 'p')
// и полуфабриката (kind 's'). Сохраняется сразу при изменении, как остальные поля карточки.
function _ciEnt(kind) {
    return kind === 'p' ? products.find(p => p.id === currentProductId)
                        : semiFinished.find(s => s.id === currentSemiFinishedId);
}
function _ciPerUnitLabel(ent, kind) {
    if (kind === 'p') {
        const u = ent.unit;
        return (!u || u === 'pcs') ? t('cost_per_piece') : t('cost_per_unit_of') + ' ' + (unitAbbrev(u) || u);
    }
    return t('cost_per_unit_of') + ' ' + (unitAbbrev(ent.unit) || ent.unit);
}
function renderCostItemsEditor(boxId, kind) {
    const box = document.getElementById(boxId);
    const ent = _ciEnt(kind);
    if (!box || !ent) return;
    const items = costItemsOf(ent);
    if (kind === 's') items.forEach(it => { it.p = 'b'; }); // у полуфабриката все статьи на партию
    const perU = _ciPerUnitLabel(ent, kind);
    const quick = ['other', 'packaging', 'label', 'energy', 'delivery'].map(k => `<option value="${escapeHtml(t('cost_item_' + k))}"></option>`).join('');
    const IN = 'border p-0.5 rounded-xl table-text';
    const W = { a: 'width:52px;flex:none;padding-left:4px;padding-right:4px;', p: 'width:84px;flex:none;padding-left:3px;padding-right:1px;font-size:12px;', x: 'width:62px;flex:none;' };
    const showPer = kind === 'p'; // у полуфабриката «на единицу» (на г, на мл) не имеет смысла — только на партию
    const perSel = (id, handler, isUnit) => !showPer ? '' : `<select ${id ? `id="${id}"` : ''} ${handler ? `onchange="${handler}"` : ''} class="${IN}" style="${W.p}">
                <option value="u"${isUnit ? ' selected' : ''}>${escapeHtml(perU)}</option>
                <option value="b"${isUnit ? '' : ' selected'}>${escapeHtml(t('cost_per_batch'))}</option></select>`;
    const hdr = `<div class="flex items-center gap-1 mb-1" style="background:#e3e8df;border-radius:12px;padding:5px 4px;font-size:10.5px;font-weight:600;color:#6b7a63;text-align:center;">
            <div style="flex:1 1 0;min-width:0;">${escapeHtml(t('cost_col_name'))}</div><div style="width:52px;flex:none;">${escapeHtml(t('cost_col_sum'))}</div>${showPer ? `<div style="width:84px;flex:none;">${escapeHtml(t('cost_col_basis'))}</div>` : ''}<div style="width:62px;flex:none;">${escapeHtml(t('sf_col_actions'))}</div></div>`;
    const rows = items.map((it, i) => `
        <div class="flex items-center gap-1 mb-1">
            <input type="text" list="costItemNames" value="${escapeHtml(costItemName(it))}" placeholder="${escapeHtml(t('cost_item_name_ph'))}" autocomplete="off"
                   onchange="ciChange('${kind}',${i},'n',this.value)" class="${IN}" style="flex:1 1 0;min-width:0;">
            <input type="number" value="${(Number(it.a) || 0) ? Number(it.a) : ''}" placeholder="0.00" autocomplete="off" inputmode="decimal" step="0.01" min="0"
                   onchange="ciChange('${kind}',${i},'a',this.value)" class="${IN}" style="${W.a}">
            ${perSel('', `ciChange('${kind}',${i},'p',this.value)`, it.p === 'u')}
            <div style="${W.x}text-align:center;"><button type="button" onclick="ciRemove('${kind}',${i})" aria-label="x" style="border:none;background:transparent;color:#a3493d;font-size:20px;line-height:1;padding:0 8px;">×</button></div>
        </div>`).join('');
    const entry = `
        <div class="flex items-center gap-1" style="padding-top:2px;">
            <input id="ciNewName_${kind}" type="text" list="costItemNames" placeholder="${escapeHtml(t('cost_item_name_ph'))}" autocomplete="off" class="${IN}" style="flex:1 1 0;min-width:0;">
            <input id="ciNewAmt_${kind}" type="number" placeholder="0.00" autocomplete="off" inputmode="decimal" step="0.01" min="0" class="${IN}" style="${W.a}">
            ${perSel('ciNewPer_' + kind, '', true)}
            <div style="${W.x}text-align:center;"><button type="button" onclick="ciAddFromRow('${kind}')" class="pill-btn" style="font-size:11px;padding:4px 7px;line-height:1.15;white-space:normal;">${escapeHtml(t('cost_item_add'))}</button></div>
        </div>`;
    box.innerHTML = `<datalist id="costItemNames">${quick}</datalist>${hdr}${rows}${entry}`;
}
function ciAddFromRow(kind) {
    const ent = _ciEnt(kind); if (!ent) return;
    const name = (document.getElementById('ciNewName_' + kind)?.value || '').trim();
    const amt = Math.max(0, parseFloat(parseFloat(document.getElementById('ciNewAmt_' + kind)?.value || 0).toFixed(2)) || 0);
    const per = (kind === 'p' && document.getElementById('ciNewPer_' + kind)?.value !== 'b') ? 'u' : 'b';
    if (!name && !amt) return;
    ent.cost_items = costItemsOf(ent).concat([{ n: name, a: amt, p: per }]);
    renderCostItemsEditor(kind === 'p' ? 'pdCostItemsBox' : 'sfdCostItemsBox', kind);
    ciSave(kind);
}
function ciRemove(kind, i) {
    const ent = _ciEnt(kind); if (!ent) return;
    ent.cost_items = costItemsOf(ent).filter((_, j) => j !== i);
    renderCostItemsEditor(kind === 'p' ? 'pdCostItemsBox' : 'sfdCostItemsBox', kind);
    ciSave(kind);
}
function ciChange(kind, i, field, val) {
    const ent = _ciEnt(kind); if (!ent) return;
    const it = costItemsOf(ent)[i]; if (!it) return;
    if (field === 'n') { it.n = String(val).trim(); delete it.k; }
    else if (field === 'a') { it.a = Math.max(0, parseFloat(parseFloat(val || 0).toFixed(2)) || 0); }
    else if (field === 'p') { it.p = val === 'u' ? 'u' : 'b'; }
    ciSave(kind);
}
async function ciSave(kind) {
    const ent = _ciEnt(kind); if (!ent) return;
    const clean = costItemsOf(ent).filter(it => (it.k || it.n) || Number(it.a)).map(it => {
        const o = { a: Number(it.a) || 0, p: it.p === 'u' ? 'u' : 'b' };
        if (it.k) o.k = it.k; else o.n = it.n || '';
        return o;
    });
    suppressRealtimeFor3s();
    try {
        const { error } = await db.from(kind === 'p' ? 'products' : 'semi_finished').update({ cost_items: clean }).eq('id', ent.id);
        if (error) throw error;
        if (kind === 'p') renderProductRecipe(ent); else renderSemiFinishedRecipe(ent);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
}
