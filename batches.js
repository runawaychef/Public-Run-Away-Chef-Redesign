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

// Возвращает списанное количество обратно в исходные партии (используется при сторно).
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
