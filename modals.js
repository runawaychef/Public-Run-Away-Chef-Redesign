// ==================== УДАЛЕНИЕ / ОБЩИЕ МОДАЛЬНЫЕ ОКНА ====================
// Подтверждение и выполнение удаления для всех типов записей (заказ, позиция,
// клиент, изделие), закрытие любого модального окна.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), products/customers/orders/currentOrderId (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// displayProducts (products.js), displayCustomers (customers.js),
// displayOrders/renderDetailItems (orders.js), deleteId/deleteType/editIndex/editItemIdx (главный скрипт).

// ==================== УДАЛЕНИЕ ====================
function openDeleteModal(id, type, label) {
    deleteId   = id;
    deleteType = type;
    document.getElementById('deleteModalText').textContent = `Вы уверены, что хотите удалить ${label}?`;
    document.getElementById('deleteModal').style.display = 'flex';
}

async function confirmDelete() {
    if (deleteId === null || !deleteType) return;
    showLoading();
    try {
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
            logActivity('product', `Удалено изделие «${prod.name}»`);
        } else if (deleteType === 'customer') {
            const cust = customers[deleteId];
            const wasOpenInDetail = cust.id === currentCustomerId;
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
            logActivity('customer', `Удалён клиент «${cust.name}»`);
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
            logActivity('order', `Заказ №${order.id} (клиент «${order.customer}») перемещён в корзину`);
        } else if (deleteType === 'item') {
            const order = orders.find(o => o.id === currentOrderId);
            if (order) {
                const item = order.items[deleteId];
                const { error } = await db.from('order_items').delete().eq('id', item.id);
                if (error) throw error;
                order.items.splice(deleteId, 1);
                renderDetailItems(order);
                logActivity('item', `Удалена позиция «${item.product}» × ${item.quantity} из заказа №${order.id}`, order.id);
            }
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
            logActivity('ingredient', `Удалён ингредиент «${ing.name}»`);
        } else if (deleteType === 'recipeItem') {
            const prod = products.find(p => p.id === currentProductId);
            if (prod) {
                const ri = prod.ingredients[deleteId];
                const { error } = await db.from('product_ingredients').delete().eq('id', ri.id);
                if (error) throw error;
                prod.ingredients.splice(deleteId, 1);
                renderProductRecipe(prod);
                await resetProductRecipeConfirmed(prod);
                logActivity('product', `Удалён ингредиент из рецепта «${prod.name}»`);
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
            logActivity('semiFinished', `Удалён полуфабрикат «${sf.name}»`);
        } else if (deleteType === 'sfRecipeItem') {
            const sf = semiFinished.find(s => s.id === currentSemiFinishedId);
            if (sf) {
                const ri = sf.ingredients[deleteId];
                const { error } = await db.from('semi_finished_ingredients').delete().eq('id', ri.id);
                if (error) throw error;
                sf.ingredients.splice(deleteId, 1);
                renderSemiFinishedRecipe(sf);
                await resetSfRecipeConfirmed(sf);
                logActivity('semiFinished', `Удалён ингредиент из рецепта полуфабриката «${sf.name}»`);
            }
        }
        closeModal();
    } catch (e) {
        console.error(e);
        showInfo('Ошибка удаления. Возможно, запись связана с другими данными, либо нет подключения к интернету.');
        closeModal();
    } finally {
        hideLoading();
    }
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    editIndex = null; editItemIdx = null; deleteId = null; deleteType = null;
}
