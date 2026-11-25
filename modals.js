// ==================== УДАЛЕНИЕ / ОБЩИЕ МОДАЛЬНЫЕ ОКНА ====================
// Подтверждение и выполнение удаления для всех типов записей (заказ, позиция,
// клиент, изделие), закрытие любого модального окна.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), products/customers/orders/currentOrderId (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// displayProducts (products.js), displayCustomers (customers.js),
// displayOrders/renderDetailItems (orders.js), reverseInventoryForOrder/reverseInventoryForOrderItem (inventory.js),
// deleteId/deleteType/editIndex/editItemIdx (главный скрипт).

// ==================== УДАЛЕНИЕ ====================
// Примечание в окне удаления изделия, ингредиента (упаковки), полуфабриката (v942): удаление необратимо,
// перечислено, что исчезнет вместе с записью и где она используется (по данным в памяти; внешние ключи —
// claude/delete-audit-and-trash-2026-11-23.md). id — индекс в соответствующем массиве.
function deleteNoteFor(type, idx) {
    const n = (key, num) => t(key).replace('{n}', String(num));
    const parts = [];
    if (type === 'product') {
        const prod = products[idx];
        if (!prod) return '';
        const cnt = orders.filter(o => !o.deleted_at && (o.items || []).some(it => it.product_id === prod.id)).length;
        parts.push(t('del_note_prod_head'));
        if (cnt > 0) parts.push(n('del_note_prod_orders', cnt));
    } else if (type === 'semiFinished') {
        const sf = semiFinished[idx];
        if (!sf) return '';
        const cnt = products.filter(p => (p.ingredients || []).some(ri => ri.semi_finished_id === sf.id)).length;
        parts.push(t('del_note_sf_head'));
        if (cnt > 0) parts.push(n('del_note_in_products', cnt));
    } else if (type === 'ingredient') {
        const ing = ingredients[idx];
        if (!ing) return '';
        const inProducts = products.filter(p => (p.ingredients || []).some(ri => ri.ingredient_id === ing.id)).length;
        const inSf = semiFinished.filter(s => (s.ingredients || []).some(ri => ri.ingredient_id === ing.id)).length;
        const ordWith = orders.filter(o => !o.deleted_at && (o.materials || []).some(m => m.ingredient_id === ing.id));
        const ordPriced = ordWith.filter(o => (o.materials || []).some(m => m.ingredient_id === ing.id && Number(m.quantity) > 0 && Number(m.price) > 0)).length;
        parts.push(t(ing.kind === 'material' ? 'del_note_head_mat' : 'del_note_head_ing'));
        if (inProducts > 0) parts.push(n('del_note_in_products', inProducts));
        if (inSf > 0) parts.push(n('del_note_in_sf', inSf));
        if (ordWith.length > 0) parts.push(n('del_note_in_orders', ordWith.length));
        if (ordPriced > 0) parts.push(t('del_note_orders_sum'));
    }
    return parts.join('\n');
}

// v967: есть ли у позиции связи в базе (все заказы, включая корзину). Ошибка запроса = «есть» (безопаснее архив).
async function dbEntityHasRefs(type, id) {
    const checks = type === 'product'
        ? [['order_items', 'product_id']]
        : type === 'ingredient'
            ? [['product_ingredients', 'ingredient_id'], ['semi_finished_ingredients', 'ingredient_id'], ['order_materials', 'ingredient_id'], ['order_item_ingredients', 'ingredient_id'], ['inventory', 'ingredient_id']]
            : [['product_ingredients', 'semi_finished_id'], ['inventory', 'semi_finished_id']];
    try {
        const res = await Promise.all(checks.map(([tb, col]) => db.from(tb).select('*', { count: 'exact', head: true }).eq(col, id)));
        return res.some(r => r.error || (r.count || 0) > 0);
    } catch (e) { console.error(e); return true; }
}

let _orderDeleteVerified = false;
function openDeleteModal(id, type, label) {
    // v968: заказ с работой/оплатой/документами не удаляется — сначала проверка по базе
    if (type === 'order' && !_orderDeleteVerified) {
        const o = orders[id];
        if (!o) return;
        orderDeleteGuard(o.id).then(ok => {
            if (!ok) return;
            _orderDeleteVerified = true;
            try { openDeleteModal(id, type, label); } finally { _orderDeleteVerified = false; }
        });
        return;
    }
    deleteId   = id;
    deleteType = type;
    let text = `${t('delete_confirm_prefix')} ${label}?`;
    if (type === 'order' && typeof orderDeleteQuotaNote === 'function') {
        const note = orderDeleteQuotaNote(orders[id]);
        if (note) text += '\n\n' + note;
    }
    if (type === 'customer' && typeof customerDeleteNote === 'function') {
        const cnote = customerDeleteNote(customers[id]);
        if (cnote) text += '\n\n' + cnote;
    }
    const dnote = (type === 'product' || type === 'ingredient' || type === 'semiFinished') ? deleteNoteFor(type, id) : '';
    if (dnote) text += '\n\n' + dnote;
    const textEl = document.getElementById('deleteModalText');
    textEl.style.whiteSpace = 'pre-line';
    textEl.textContent = text;
    document.getElementById('deleteModal').style.display = 'flex';

    // Заказ из сводного счёта: предупреждаем, что он выпадет из счёта (номер счёта догружаем при необходимости)
    const ord = type === 'order' ? orders[id] : null;
    if (ord && ord.consolidated_invoice_id && typeof _payConsNumber === 'function') {
        const cid = ord.consolidated_invoice_id;
        const withNote = () => text + '\n\n' + t('order_delete_cons_note').replace('{number}', _payConsNumber(cid));
        textEl.textContent = withNote();
        if (typeof _payLoadConsNumbers === 'function' && _payConsNumber(cid) === '…') {
            _payLoadConsNumbers([cid]).then(() => { if (deleteId === id && deleteType === 'order') textEl.textContent = withNote(); });
        }
    }
}

async function confirmDelete() {
    if (deleteId === null || !deleteType) return;
    // Страховка: даже если кнопка удаления где-то по ошибке не спрятана,
    // без права can_delete фактическое удаление не выполнится.
    if (!hasPermission('can_delete')) {
        closeModal();
        showInfo(t('ing_no_delete_permission'));
        return;
    }
    showLoading();
    // Подавляем Realtime на все виды удаления через это окно — иначе собственное
    // событие (в т.ч. от сторно склада при удалении заказа/позиции) прилетает
    // обратно и вызывает лишнюю перезагрузку данных.
    suppressRealtimeFor3s();
    try {
        // v967: окончательно удаляем только позицию без связей в БАЗЕ (в памяти нет заказов из корзины) — иначе архив
        if (deleteType === 'product' || deleteType === 'ingredient' || deleteType === 'semiFinished') {
            const _src = deleteType === 'product' ? products[deleteId] : deleteType === 'ingredient' ? ingredients[deleteId] : semiFinished[deleteId];
            if (_src && await dbEntityHasRefs(deleteType, _src.id)) {
                hideLoading();
                closeModal();
                await showInfo(t('del_has_db_links'));
                if (deleteType === 'product' && typeof archiveProduct === 'function') archiveProduct();
                else if (deleteType === 'ingredient' && typeof archiveIngredient === 'function') archiveIngredient();
                else if (deleteType === 'semiFinished' && typeof archiveSemiFinished === 'function') archiveSemiFinished();
                return;
            }
        }
        if (deleteType === 'product') {
            const prod = products[deleteId];
            const wasOpenInDetail = prod.id === currentProductId;
            const { error } = await db.from('products').delete().eq('id', prod.id);
            if (error) throw error;
            products.splice(deleteId, 1);
            if (wasOpenInDetail) {
                currentProductId = null;
                document.getElementById('productsList').classList.remove('hidden');
                document.getElementById('productDetail').classList.remove('active');
                refreshFab();
            }
            displayProducts();
            logActivity('product', `${t('log_product_deleted')} «${prod.name}»`);
        } else if (deleteType === 'customer') {
            const cust = customers[deleteId];
            const wasOpenInDetail = cust.id === currentCustomerId;
            // v946: клиента с авансом удалять нельзя — сначала вернуть или зачесть
            const credBal = typeof loadCustomerBalance === 'function' ? await loadCustomerBalance(cust.id) : 0;
            if (Math.abs(credBal) > 0.004) {
                hideLoading();
                closeModal();
                showInfo(t('credit_delete_blocked').replace('{sum}', formatMoney(credBal)));
                return;
            }
            // v950: удалить навсегда можно только пустого клиента (без заказов, в т.ч. из корзины, аванса и сводных счетов)
            if (await customerHasHistory(cust.id)) {
                hideLoading();
                closeModal();
                showInfo(t('cust_delete_has_history'));
                return;
            }
            const { error } = await db.from('customers').delete().eq('id', cust.id);
            if (error) throw error;
            customers.splice(deleteId, 1);
            if (wasOpenInDetail) {
                currentCustomerId = null;
                document.getElementById('customersList').classList.remove('hidden');
                document.getElementById('customerDetail').classList.remove('active');
                refreshFab();
            }
            displayCustomers();
            logActivity('customer', `${t('log_customer_deleted')} «${cust.name}»`);
        } else if (deleteType === 'order') {
            const order = orders[deleteId];
            const wasOpenInDetail = order.id === currentOrderId;
            // Сторнируем списание со склада
            await reverseInventoryForOrder(order.id);
            // Soft delete — помечаем как удалённый, не удаляем физически
            const { error } = await db.from('orders')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', order.id);
            if (error) throw error;
            orders.splice(deleteId, 1);
            if (wasOpenInDetail) {
                currentOrderId = null;
                document.getElementById('ordersList').classList.remove('hidden');
                document.getElementById('orderDetail').classList.remove('active');
            }
            displayOrders();
            logActivity('order', `${t('trash_order_word')} №${order.id} (${t('delete_label_customer')} «${order.customer}») ${t('log_moved_to_trash')}`);
            if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
            // Удалили заказ, открытый из карточки позиции, — возвращаемся в карточку (inventory.js, 22.10)
            if (wasOpenInDetail && typeof stockCardReturnPending === 'function' && stockCardReturnPending()) await returnToStockCard();
            else if (wasOpenInDetail && typeof docsReturnPending === 'function' && docsReturnPending()) await returnToDocsPreview();
            else if (wasOpenInDetail && typeof docs2ReturnPending === 'function' && docs2ReturnPending()) await returnToDocs2();
        } else if (deleteType === 'item') {
            const order = orders.find(o => o.id === currentOrderId);
            if (order) {
                const item = order.items[deleteId];
                // Если склад по этой позиции уже был списан — сторнируем точно
                // (по order_item_id). Если списание ещё отложено (inventory_pending),
                // сторнировать нечего — удалённая позиция просто не попадёт
                // в processPendingInventory(), т.к. она уже убрана из order.items.
                if (!order.inventory_pending) {
                    await reverseInventoryForOrderItem(item.id);
                }
                await dbMust(db.from('order_item_ingredients').delete().eq('order_item_id', item.id));
                const { error } = await db.from('order_items').delete().eq('id', item.id);
                if (error) throw error;
                order.items.splice(deleteId, 1);
                renderDetailItems(order);
                logActivity('item', `${t('log_position_deleted')} «${item.product}» × ${item.quantity} ${t('log_from_order')} №${order.id}`, order.id);
            }
        } else if (deleteType === 'ordmat') {
            const order = orders.find(o => o.id === currentOrderId);
            if (order) await removeOrderMaterial(order, deleteId);
        } else if (deleteType === 'ingredient') {
            const ing = ingredients[deleteId];
            const wasOpenInDetail = ing.id === currentIngredientId;
            const { error } = await db.from('ingredients').delete().eq('id', ing.id);
            if (error) throw error;
            ingredients.splice(deleteId, 1);
            if (wasOpenInDetail) {
                currentIngredientId = null;
                document.getElementById('ingredientsList').classList.remove('hidden');
                document.getElementById('ingredientDetail').classList.remove('active');
                refreshFab();
            }
            displayIngredients();
            logActivity('ingredient', `${t('log_ingredient_deleted')} «${ing.name}»`);
        } else if (deleteType === 'recipeItem') {
            const prod = products.find(p => p.id === currentProductId);
            if (prod) {
                const ri = prod.ingredients[deleteId];
                const { error } = await db.from('product_ingredients').delete().eq('id', ri.id);
                if (error) throw error;
                prod.ingredients.splice(deleteId, 1);
                renderProductRecipe(prod);
                await resetProductRecipeConfirmed(prod);
                logActivity('product', `${t('log_ingredient_removed_from_recipe')} «${prod.name}»`);
            }
        } else if (deleteType === 'semiFinished') {
            const sf = semiFinished[deleteId];
            const wasOpenInDetail = sf.id === currentSemiFinishedId;
            const { error } = await db.from('semi_finished').delete().eq('id', sf.id);
            if (error) throw error;
            semiFinished.splice(deleteId, 1);
            if (wasOpenInDetail) {
                currentSemiFinishedId = null;
                document.getElementById('semiFinishedList').classList.remove('hidden');
                document.getElementById('semiFinishedDetail').classList.remove('active');
                refreshFab();
            }
            displaySemiFinished();
            logActivity('semiFinished', `${t('log_sf_deleted')} «${sf.name}»`);
        } else if (deleteType === 'sfRecipeItem') {
            const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
            if (sf) {
                const ri = sf.ingredients[deleteId];
                const { error } = await db.from('semi_finished_ingredients').delete().eq('id', ri.id);
                if (error) throw error;
                sf.ingredients.splice(deleteId, 1);
                renderSemiFinishedRecipe(sf);
                await resetSfRecipeConfirmed(sf);
                logActivity('semiFinished', `${t('log_ingredient_removed_from_sf_recipe')} «${sf.name}»`);
            }
        }
        closeModal();
    } catch (e) {
        console.error(e);
        showInfo(t('modals_delete_error_detailed'));
        closeModal();
    } finally {
        hideLoading();
    }
}

function closeModal() {
    if (typeof _saveExitCancel === 'function') _saveExitCancel(); // окно «Сохранить?» закрыто «назад» = остаться
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    editIndex = null; editItemIdx = null; deleteId = null; deleteType = null;
    // Подсветку тележки/шестерёнки держит страница (helpers.js _appPageShowTop): окно поверх
    // «Умного склада» или «Настроек» её не снимает (22.10)
    const topPage = typeof appPageTop === 'function' ? appPageTop() : null;
    if (topPage !== 'inventoryPage') document.getElementById('inventoryBtn')?.classList.remove('active');
    if (topPage !== 'settingsPage') document.getElementById('settingsBtn')?.classList.remove('active');
}
