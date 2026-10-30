// ==================== УТИЛИТЫ: ДЕНЬГИ / РАСЧЁТЫ ПО ЗАКАЗУ ====================
// Чистые функции расчёта сумм, скидок и НДС. Зависят только от объекта order.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.

// Ставка НДС теперь настраивается per-organization — см. currentOrgVatRate (employees.js),
// заполняется из company.js (карточка "Информация о компании"). Дефолт 0 (без НДС) — на случай
// организаций, где поле ещё не заполнено.

// Символы валют — единая таблица соответствий, используется и в formatMoney(),
// и в invoice.js (там валюта может браться не из текущей, а из снимка счёта).
const CURRENCY_SYMBOLS = {
    EUR: '€', USD: '$', RUB: '₽', BYN: 'Br', KZT: '₸', KGS: 'с', UZS: 'сум',
    TJS: 'SM', TMT: 'm', AZN: '₼', AMD: '֏', GEL: '₾', MDL: 'L', UAH: '₴', PLN: 'zł'
};

// Единая точка форматирования сумм — везде в приложении, где раньше было
// `amount.toFixed(2) + ' €'`, теперь formatMoney(amount). Символ берётся из
// currentOrgCurrency (глобальная переменная, employees.js) — настройки
// валюты организации из карточки "Информация о компании".
function formatMoney(amount, decimals) {
    const sym = CURRENCY_SYMBOLS[typeof currentOrgCurrency !== 'undefined' ? currentOrgCurrency : 'EUR'] || 'EUR';
    return Number(amount || 0).toFixed(decimals != null ? decimals : 2) + ' ' + sym;
}

// ==================== РАСЧЁТ СУММ ЗАКАЗА (единственная формула) ====================
// ВСЕ суммы заказа и документов (экран, статистика, оплаты, счёт HTML и PDF) считаются
// ЗДЕСЬ, в целых центах, чтобы не накапливались дробные хвосты и сумма строк
// всегда в точности равнялась итогу:
//   1. сумма строки = округлённое до цента кол-во × цена;
//   2. скидка = процент от суммы всех строк, округлена до цента;
//   3. НДС считается ОДИН РАЗ от итога без НДС и округляется до цента (0,005 вверх);
//   4. скидка и НДС раскладываются по строкам "методом наибольшего остатка" —
//      сумма долей по строкам ровно равна общей скидке / общему НДС.

// Округление неотрицательного числа до целого (0,5 вверх) с поправкой на двоичную
// дробь (31.499999999999996 тоже должно давать 31.5 → 32).
function _roundCents(x) {
    return Math.round(x + 1e-7);
}

// Раскладывает целое число центов total пропорционально весам weights так, чтобы
// сумма долей была ровно total. Остаток раздаётся строкам с наибольшей дробной частью.
function _allocateCents(total, weights) {
    const n = weights.length;
    const sumW = weights.reduce((s, w) => s + w, 0);
    if (!n || sumW <= 0 || !total) return weights.map(() => 0);
    const exact = weights.map(w => total * w / sumW);
    const parts = exact.map(e => Math.floor(e + 1e-9));
    let left = total - parts.reduce((s, p) => s + p, 0);
    const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e + 1e-9) }))
        .sort((x, y) => (y.frac - x.frac) || (x.i - y.i));
    for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k].i] += 1;
    return parts;
}

// Главная функция. items: [{quantity, price}], discountPct: число (проценты),
// vatExempt: bool, vatRate: доля (0.21). Возвращает суммы в валюте (не в центах):
// { lines: [{net, vat, gross}], subtotal, discount, net, vat, grand }
function calcTotals(items, discountPct, vatExempt, vatRate) {
    const list = items || [];
    const lineC = list.map(it => _roundCents(Math.max(0, (Number(it.quantity) || 0) * (Number(it.price) || 0)) * 100));
    const subtotalC = lineC.reduce((s, v) => s + v, 0);
    const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
    const discountC = _roundCents(subtotalC * pct / 100);
    const netC = subtotalC - discountC;
    const discShares = _allocateCents(discountC, lineC);
    const lineNetC = lineC.map((v, i) => v - discShares[i]);
    const rate = Number(vatRate) || 0;
    const vatC = vatExempt ? 0 : _roundCents(netC * rate);
    const lineVatC = _allocateCents(vatC, lineNetC);
    return {
        lines: lineNetC.map((n, i) => ({ net: n / 100, vat: lineVatC[i] / 100, gross: (n + lineVatC[i]) / 100 })),
        subtotal: subtotalC / 100,
        discount: discountC / 100,
        net: netC / 100,
        vat: vatC / 100,
        grand: (netC + vatC) / 100
    };
}

// «Без НДС» у заказа (30.10.2026). Защищённая пекарня (id1) — прежняя логика: флаг заказа order.vat_exempt.
// Остальные: НДС есть, только если пекарня — плательщик НДС и дата заказа не раньше «плательщик с даты»
// (пусто = с начала). Флаг заказа/клиента vat_exempt там не учитывается.
function orderVatExempt(order) {
    if (typeof currentOrgProtected !== 'undefined' && currentOrgProtected) return !!(order && order.vat_exempt);
    if (typeof currentOrgVatPayer === 'undefined' || !currentOrgVatPayer) return true;
    const from = typeof currentOrgVatPayerFrom !== 'undefined' ? currentOrgVatPayerFrom : null;
    const d = order && (order.date || order.order_date);
    if (from && d && String(d).slice(0, 10) < String(from).slice(0, 10)) return true;
    return false;
}

function _orderTotals(order) {
    const rate = typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0;
    return calcTotals(order.items, order.discount, orderVatExempt(order), rate);
}

// Сумма позиций без скидки и НДС
function orderTotal(order) {
    return _orderTotals(order).subtotal;
}

function orderDiscountAmount(order) {
    return _orderTotals(order).discount;
}

function orderAfterDiscount(order) {
    return _orderTotals(order).net;
}

function orderVatAmount(order) {
    return _orderTotals(order).vat;
}

function orderGrandTotal(order) {
    return _orderTotals(order).grand;
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
