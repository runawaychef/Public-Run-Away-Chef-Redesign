// ==================== УТИЛИТЫ: ДЕНЬГИ / РАСЧЁТЫ ПО ЗАКАЗУ ====================
// Чистые функции расчёта сумм, скидок и НДС. Зависят только от объекта order.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.

const VAT_RATE = 0.21; // НДС 21% (Литва)

// Сумма позиций без скидки и НДС
function orderTotal(order) {
    if (!order.items || !order.items.length) return 0;
    return order.items.reduce((s, it) => s + (it.quantity * it.price || 0), 0);
}

function orderDiscountAmount(order) {
    const subtotal = orderTotal(order);
    const pct = order.discount || 0;
    return subtotal * (pct / 100);
}

function orderAfterDiscount(order) {
    return orderTotal(order) - orderDiscountAmount(order);
}

function orderVatAmount(order) {
    if (order.vat_exempt) return 0;
    return orderAfterDiscount(order) * VAT_RATE;
}

function orderGrandTotal(order) {
    return orderAfterDiscount(order) + orderVatAmount(order);
}

// ==================== СЕБЕСТОИМОСТЬ ИЗДЕЛИЙ ====================
// Зависит от: ingredients (ingredients.js), ingredientUnitPrice (ingredients.js).

// Себестоимость партии изделия: сумма (расход ингредиента × цена за единицу) + прочие расходы
function productBatchCost(prod) {
    const ingredientsCost = (prod.ingredients || []).reduce((sum, ri) => {
        if (ri.semi_finished_id) {
            const sf = (typeof semiFinished !== 'undefined') ? semiFinished.find(s => s.id === ri.semi_finished_id) : null;
            if (!sf) return sum;
            return sum + semiFinishedUnitCost(sf) * ri.quantity;
        }
        const ing = ingredients.find(i => i.id === ri.ingredient_id);
        if (!ing) return sum;
        return sum + ingredientUnitPrice(ing) * ri.quantity;
    }, 0);
    return ingredientsCost + (prod.other_costs || 0);
}

// Себестоимость одной единицы изделия = себестоимость партии / размер партии
function productUnitCost(prod) {
    const batchSize = prod.batch_size || 1;
    if (batchSize <= 0) return 0;
    return productBatchCost(prod) / batchSize;
}

// Прибыль с одной единицы изделия (продажная цена - себестоимость единицы)
function productProfit(prod) {
    return (prod.price || 0) - productUnitCost(prod);
}

// Рентабельность изделия в % (прибыль / продажная цена)
function productProfitPct(prod) {
    if (!prod.price) return 0;
    return productProfit(prod) / prod.price * 100;
}

// Себестоимость одной позиции заказа.
// Если item_cost зафиксирован при создании позиции — используем его.
// Иначе считаем по текущим ценам (для старых заказов без item_cost).
function orderItemCost(item) {
    if (item.item_cost != null) return Number(item.item_cost);
    const prod = products.find(p => p.id === item.product_id);
    if (!prod) return 0;
    return productUnitCost(prod) * item.quantity;
}

// Полная себестоимость заказа (сумма себестоимости всех позиций)
function orderCost(order) {
    return (order.items || []).reduce((sum, it) => sum + orderItemCost(it), 0);
}

// Прибыль по заказу (сумма после скидки и НДС минус себестоимость)
// Используем сумму "после скидки" (без НДС, т.к. НДС не доход), минус себестоимость
function orderProfit(order) {
    return orderAfterDiscount(order) - orderCost(order);
}
