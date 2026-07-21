// ==================== ПАРТИОННЫЙ УЧЁТ СКЛАДА (FIFO) ====================
// Общая логика для ингредиентов и полуфабрикатов.
// Партия (батч) — конкретная закупка/производство с своей ценой и остатком.
// Списание всегда идёт со старейшей ещё не исчерпанной партии; если партий
// не хватает на нужное количество — недостача считается по ТЕКУЩЕЙ цене
// (ingredients.package_price или semiFinishedUnitCost), без создания батча.
// Зависит от: db (supabaseClient.js), ingredients, ingredientUnitPrice (money.js),
// semiFinished, semiFinishedUnitCost (semifinished.js).

// Создаёт новую партию (используется при закупке ингредиента и производстве п/ф)
async function createStockBatch(itemType, itemId, unitPrice, qty, source, notes) {
    if (!(qty > 0)) return null;
    const row = {
        org_id: currentOrgId,
        item_type: itemType,
        ingredient_id: itemType === 'ingredient' ? itemId : null,
        semi_finished_id: itemType === 'semi_finished' ? itemId : null,
        unit_price: parseFloat(Number(unitPrice).toFixed(6)),
        qty_original: parseFloat(Number(qty).toFixed(4)),
        qty_remaining: parseFloat(Number(qty).toFixed(4)),
        source,
        notes: notes || null
    };
    const { data, error } = await db.from('stock_batches').insert(row).select().single();
    if (error) { console.error('Ошибка создания партии:', error); return null; }
    return data;
}

// Текущая цена "по умолчанию" — используется для недостачи, когда партий не хватает
function currentUnitPriceFor(itemType, itemId) {
    if (itemType === 'ingredient') {
        const ing = ingredients.find(i => i.id === itemId);
        return ing ? ingredientUnitPrice(ing) : 0;
    } else {
        const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === itemId) : null;
        return sf ? semiFinishedUnitCost(sf) : 0;
    }
}

// Списывает quantity единиц товара по FIFO. Возвращает:
// { totalCost, breakdown: [{batch_id, quantity, unit_price}] }
// breakdown содержит запись с batch_id=null для недостачи (списано по текущей цене).
async function consumeFIFO(itemType, itemId, quantity) {
    let remaining = parseFloat(Number(quantity).toFixed(4));
    const breakdown = [];
    let totalCost = 0;
    if (remaining <= 0) return { totalCost: 0, breakdown: [] };

    const col = itemType === 'ingredient' ? 'ingredient_id' : 'semi_finished_id';
    const { data: batches, error } = await db.from('stock_batches')
        .select('id, unit_price, qty_remaining')
        .eq('item_type', itemType)
        .eq(col, itemId)
        .gt('qty_remaining', 0)
        .order('created_at', { ascending: true });
    if (error) { console.error('Ошибка чтения партий:', error); }

    const updates = [];
    for (const b of (batches || [])) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(b.qty_remaining));
        if (take <= 0) continue;
        const newRemainingQty = parseFloat((Number(b.qty_remaining) - take).toFixed(4));
        updates.push({ id: b.id, qty_remaining: newRemainingQty });
        breakdown.push({ batch_id: b.id, quantity: parseFloat(take.toFixed(4)), unit_price: Number(b.unit_price) });
        totalCost += take * Number(b.unit_price);
        remaining = parseFloat((remaining - take).toFixed(4));
    }

    // Недостача — считаем по текущей цене, партию не создаём
    if (remaining > 0.0001) {
        const price = currentUnitPriceFor(itemType, itemId);
        breakdown.push({ batch_id: null, quantity: parseFloat(remaining.toFixed(4)), unit_price: price });
        totalCost += remaining * price;
        remaining = 0;
    }

    // Применяем обновления остатков партий
    for (const u of updates) {
        const { error: updErr } = await db.from('stock_batches')
            .update({ qty_remaining: u.qty_remaining }).eq('id', u.id);
        if (updErr) console.error('Ошибка обновления остатка партии:', updErr);
    }

    return { totalCost: parseFloat(totalCost.toFixed(4)), breakdown };
}

// Возврат обратно в те же партии, откуда списывали (используется при сторно).
// breakdown — массив вида [{batch_id, quantity, unit_price}], как из consumeFIFO.
// Записи с batch_id=null (недостача) пропускаются — возвращать некуда.
async function restoreFIFO(breakdown) {
    if (!breakdown || !breakdown.length) return;
    for (const b of breakdown) {
        if (!b.batch_id) continue;
        try {
            const { data, error } = await db.from('stock_batches')
                .select('qty_remaining').eq('id', b.batch_id).single();
            if (error || !data) continue; // партия могла быть удалена — пропускаем
            const newQty = parseFloat((Number(data.qty_remaining) + Number(b.quantity)).toFixed(4));
            await db.from('stock_batches').update({ qty_remaining: newQty }).eq('id', b.batch_id);
        } catch (e) { console.error('Ошибка восстановления партии:', e); }
    }
}

// ==================== ОТОБРАЖЕНИЕ ПАРТИЙ В КАРТОЧКЕ ====================
// Разворачиваемый блок "Партии" — показывает активные (qty_remaining > 0)
// партии ингредиента/п/ф, от старой к новой, с ценой и остатком каждой.

function renderBatchesList(batches, unitLabel, itemType) {
    if (!batches || !batches.length) {
        return `<div class="table-text text-gray-400">${t('batch_no_active')}</div>`;
    }
    let html = '<table class="w-full text-xs table-clean"><thead><tr style="background-color:#e3e8df;position:sticky;top:0;">' +
        `<th class="p-1 text-left">${t('history_col_date')}</th><th class="p-1 text-right">${t('inv_col_balance')}</th><th class="p-1 text-right">${t('orders_price_per_unit_short')}</th></tr></thead><tbody>`;
    batches.forEach(b => {
        const dateStr = new Date(b.created_at).toLocaleDateString('ru-RU');
        const isActive = Number(b.qty_remaining) > 0;
        const rowStyle = isActive ? 'font-weight:600;color:#3d3a33;' : 'color:#a29c8c;';
        html += `<tr class="border-b cursor-pointer" style="${rowStyle}" ${dataAction('openEditBatchModal', [b.id, itemType, unitLabel])}>
            <td class="p-0.5">${escapeHtml(dateStr)}</td>
            <td class="p-0.5 text-right">${Number(b.qty_remaining).toFixed(2)} ${escapeHtml(unitLabel)}</td>
            <td class="p-0.5 text-right">${formatMoney(b.unit_price, 4)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    return html;
}

// Открывает модалку редактирования партии — читает актуальные данные из базы
// (не из уже отрисованного списка), чтобы не редактировать устаревшие значения.
async function openEditBatchModal(batchId, itemType, unitLabel) {
    const { data, error } = await db.from('stock_batches')
        .select('id, item_type, unit_price, qty_remaining, created_at')
        .eq('id', batchId).single();
    if (error || !data) { showInfo(t('batch_load_error')); return; }
    document.getElementById('editBatchId').value = data.id;
    document.getElementById('editBatchItemType').value = data.item_type;
    document.getElementById('editBatchDate').textContent =
        `${t('batch_from_date_prefix')} ${new Date(data.created_at).toLocaleDateString('ru-RU')}`;
    document.getElementById('editBatchUnit').textContent = unitLabel;
    document.getElementById('editBatchQty').value = Number(data.qty_remaining).toFixed(2);
    document.getElementById('editBatchPrice').value = Number(data.unit_price).toFixed(4);
    document.getElementById('editBatchModal').style.display = 'flex';
}

// Сохраняет правку партии. Если остаток изменился — добавляет компенсирующую
// запись прихода/расхода в inventory, чтобы общий остаток на складе (который
// считается отдельно, по движениям) остался верным и не разъехался с партиями.
async function saveBatchEdit() {
    const batchId = Number(document.getElementById('editBatchId').value);
    const itemType = document.getElementById('editBatchItemType').value;
    const newQty = parseFloat(document.getElementById('editBatchQty').value);
    const newPrice = parseFloat(document.getElementById('editBatchPrice').value);
    if (isNaN(newQty) || newQty < 0 || isNaN(newPrice) || newPrice < 0) {
        showInfo(t('batch_enter_valid_values')); return;
    }
    showLoading();
    try {
        const { data: batch, error: readErr } = await db.from('stock_batches')
            .select('id, item_type, ingredient_id, semi_finished_id, qty_remaining, qty_original')
            .eq('id', batchId).single();
        if (readErr || !batch) throw readErr || new Error(t('batch_not_found'));

        const delta = parseFloat((newQty - Number(batch.qty_remaining)).toFixed(4));
        if (Math.abs(delta) > 0.0001) {
            await db.from('inventory').insert({
                org_id: currentOrgId,
                ingredient_id: itemType === 'ingredient' ? batch.ingredient_id : null,
                semi_finished_id: itemType === 'semi_finished' ? batch.semi_finished_id : null,
                type: delta > 0 ? 'приход' : 'расход',
                quantity: Math.abs(delta),
                notes: t('batch_manual_edit_note')
            });
        }

        const qtyOriginal = newQty > Number(batch.qty_original) ? newQty : Number(batch.qty_original);
        await db.from('stock_batches').update({
            unit_price: parseFloat(newPrice.toFixed(6)),
            qty_remaining: parseFloat(newQty.toFixed(4)),
            qty_original: qtyOriginal
        }).eq('id', batchId);

        await loadInventory();
        closeModal();
        await refreshBatchesAndStockAfterEdit(itemType, batch.ingredient_id || batch.semi_finished_id);
        logActivity('inventory', t('log_batch_edited'));
    } catch (e) { console.error(e); showInfo(t('error_save_generic')); }
    finally { hideLoading(); }
}

// Удаляет партию. Если в ней ещё оставался неисчерпанный остаток — списывает
// его компенсирующей записью, чтобы общий остаток на складе не завысился.
async function deleteBatch() {
    const batchId = Number(document.getElementById('editBatchId').value);
    const itemType = document.getElementById('editBatchItemType').value;
    const ok = await showConfirm(t('batch_delete_confirm'));
    if (!ok) return;
    showLoading();
    try {
        const { data: batch, error: readErr } = await db.from('stock_batches')
            .select('id, item_type, ingredient_id, semi_finished_id, qty_remaining')
            .eq('id', batchId).single();
        if (readErr || !batch) throw readErr || new Error(t('batch_not_found'));

        if (Number(batch.qty_remaining) > 0.0001) {
            await db.from('inventory').insert({
                org_id: currentOrgId,
                ingredient_id: itemType === 'ingredient' ? batch.ingredient_id : null,
                semi_finished_id: itemType === 'semi_finished' ? batch.semi_finished_id : null,
                type: 'расход',
                quantity: Number(batch.qty_remaining),
                notes: t('batch_manual_delete_note')
            });
        }
        await db.from('stock_batches').delete().eq('id', batchId);

        await loadInventory();
        closeModal();
        await refreshBatchesAndStockAfterEdit(itemType, batch.ingredient_id || batch.semi_finished_id);
        logActivity('inventory', t('log_batch_deleted'));
    } catch (e) { console.error(e); showInfo(t('error_delete_generic')); }
    finally { hideLoading(); }
}

// Обновляет и список партий (если он открыт), и общий блок остатка на карточке
// после правки/удаления партии.
async function refreshBatchesAndStockAfterEdit(itemType, itemId) {
    if (itemType === 'ingredient') {
        const ing = ingredients.find(i => i.id === itemId);
        if (ing) {
            await renderIngredientStockBlock(ing);
            displayIngredients();
            const list = document.getElementById('ingBatchesList');
            if (list && !list.classList.contains('hidden')) {
                document.getElementById('ingBatchesToggleLabel').textContent = t('ing_batches');
                list.classList.add('hidden');
                await toggleIngredientBatches();
            }
        }
    } else {
        const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === itemId) : null;
        if (sf) {
            await renderSfStockBlock(sf);
            const list = document.getElementById('sfBatchesList');
            if (list && !list.classList.contains('hidden')) {
                document.getElementById('sfBatchesToggleLabel').textContent = t('ing_batches');
                list.classList.add('hidden');
                await toggleSfBatches();
            }
        }
    }
}

async function toggleIngredientBatches() {
    const list = document.getElementById('ingBatchesList');
    const chevron = document.getElementById('ingBatchesChevron');
    if (!list) return;
    const willShow = list.classList.contains('hidden');
    list.classList.toggle('hidden');
    if (chevron) chevron.style.transform = willShow ? 'rotate(180deg)' : '';
    if (willShow) {
        const ing = ingredients.find(i => i.id === currentIngredientId);
        if (!ing) return;
        list.innerHTML = `<div class="table-text text-gray-400">${t('common_loading')}</div>`;
        const { data, error } = await db.from('stock_batches')
            .select('id, unit_price, qty_remaining, created_at')
            .eq('item_type', 'ingredient').eq('ingredient_id', ing.id)
            .order('created_at', { ascending: true });
        const unitLabel = unitAbbrev(ing.unit);
        const label = document.getElementById('ingBatchesToggleLabel');
        if (label) label.textContent = `${t('ing_batches')}${!error && data ? ` (${data.length})` : ''}`;
        list.innerHTML = error ? `<div class="table-text text-gray-400">${t('batch_load_list_error')}</div>` : `<div style="max-height:210px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">${renderBatchesList(data, unitLabel, 'ingredient')}</div>`;
    }
}

async function toggleSfBatches() {
    const list = document.getElementById('sfBatchesList');
    const chevron = document.getElementById('sfBatchesChevron');
    if (!list) return;
    const willShow = list.classList.contains('hidden');
    list.classList.toggle('hidden');
    if (chevron) chevron.style.transform = willShow ? 'rotate(180deg)' : '';
    if (willShow) {
        const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === currentSemiFinishedId) : null;
        if (!sf) return;
        list.innerHTML = `<div class="table-text text-gray-400">${t('common_loading')}</div>`;
        const { data, error } = await db.from('stock_batches')
            .select('id, unit_price, qty_remaining, created_at')
            .eq('item_type', 'semi_finished').eq('semi_finished_id', sf.id)
            .order('created_at', { ascending: true });
        const unitLabel = unitAbbrev(sf.unit);
        const label = document.getElementById('sfBatchesToggleLabel');
        if (label) label.textContent = `${t('ing_batches')}${!error && data ? ` (${data.length})` : ''}`;
        list.innerHTML = error ? `<div class="table-text text-gray-400">${t('batch_load_list_error')}</div>` : `<div style="max-height:210px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;">${renderBatchesList(data, unitLabel, 'semi_finished')}</div>`;
    }
}
