// ==================== ДЕМО-ДАННЫЕ ДЛЯ ЗНАКОМСТВА С ПРИЛОЖЕНИЕМ ====================
// Предлагаются на экране первого запуска (галочка "Показать пример").
// Небольшой готовый набор: 2 клиента, 4 ингредиента, 1 полуфабрикат с рецептом,
// 2 изделия с рецептами (одно из них использует полуфабрикат), немного движений
// по складу (приход сырья + производство партии полуфабриката) и 1 заказ —
// чтобы новый владелец сразу увидел весь цикл: ингредиент → полуфабрикат → изделие.
// Все демо-записи помечаются is_demo = true — это позволяет потом убрать
// весь набор одной кнопкой в настройках, не трогая то, что ввёл сам пользователь.
// Зависит от: db (supabaseClient.js), currentOrgId (employees.js).

async function createDemoData(orgId, employeeId) {
    // Клиенты
    const { data: customersData, error: custErr } = await db.from('customers').insert([
        { org_id: orgId, name: 'Иван Иванов', contact: '+370 600 00000', discount: 0, vat_exempt: false, notes: 'Демо-клиент для примера', is_demo: true },
        { org_id: orgId, name: 'Кафе «Ромашка»', contact: 'info@romashka.lt', discount: 5, vat_exempt: false, notes: 'Демо-клиент для примера', is_demo: true }
    ]).select();
    if (custErr) throw custErr;

    // Ингредиенты
    const { data: ingData, error: ingErr } = await db.from('ingredients').insert([
        { org_id: orgId, name: 'Мука пшеничная', package_price: 1.20, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Сахар', package_price: 1.50, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Масло сливочное', package_price: 4.00, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Яйца', package_price: 3.00, package_size: 10, unit: 'pcs', is_demo: true }
    ]).select();
    if (ingErr) throw ingErr;
    const flour = ingData.find(i => i.name === 'Мука пшеничная').id;
    const sugar = ingData.find(i => i.name === 'Сахар').id;
    const butter = ingData.find(i => i.name === 'Масло сливочное').id;
    const eggs = ingData.find(i => i.name === 'Яйца').id;

    // Изделия
    const { data: prodData, error: prodErr } = await db.from('products').insert([
        { org_id: orgId, name: 'Круассан', price: 2.50, unit: 'pcs', batch_size: 10, other_costs: 1.00, is_demo: true },
        { org_id: orgId, name: 'Медовик (кусок)', price: 3.20, unit: 'pcs', batch_size: 8, other_costs: 1.50, is_demo: true }
    ]).select();
    if (prodErr) throw prodErr;
    const croissant = prodData.find(p => p.name === 'Круассан').id;
    const honeycake = prodData.find(p => p.name === 'Медовик (кусок)').id;

    // Полуфабрикат — крем, используется в рецепте "Медовика"
    const { data: sfData, error: sfErr } = await db.from('semi_finished').insert({
        org_id: orgId, name: 'Крем масляный', unit: 'kg', batch_size: 0.75, other_costs: 0.30, is_demo: true
    }).select().single();
    if (sfErr) throw sfErr;
    const cream = sfData.id;

    // Рецепт полуфабриката: крем = масло + сахар
    const { error: sfRiErr } = await db.from('semi_finished_ingredients').insert([
        { org_id: orgId, semi_finished_id: cream, ingredient_id: butter, quantity: 0.5 },
        { org_id: orgId, semi_finished_id: cream, ingredient_id: sugar, quantity: 0.3 }
    ]);
    if (sfRiErr) throw sfRiErr;

    // Рецептура изделий (у "Медовика" в составе — и сырые ингредиенты, и полуфабрикат)
    const { error: riErr } = await db.from('product_ingredients').insert([
        { org_id: orgId, product_id: croissant, ingredient_id: flour, semi_finished_id: null, quantity: 0.5 },
        { org_id: orgId, product_id: croissant, ingredient_id: butter, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: croissant, ingredient_id: sugar, semi_finished_id: null, quantity: 0.05 },
        { org_id: orgId, product_id: croissant, ingredient_id: eggs, semi_finished_id: null, quantity: 2 },
        { org_id: orgId, product_id: honeycake, ingredient_id: flour, semi_finished_id: null, quantity: 0.4 },
        { org_id: orgId, product_id: honeycake, ingredient_id: sugar, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: honeycake, ingredient_id: eggs, semi_finished_id: null, quantity: 4 },
        { org_id: orgId, product_id: honeycake, ingredient_id: null, semi_finished_id: cream, quantity: 0.2 }
    ]);
    if (riErr) throw riErr;

    // Движения по складу: приход сырья + производство партии крема
    // (списание масла/сахара на производство, приход готового крема) —
    // чтобы в разделе "Склад" сразу было видно, как это работает.
    const today = getLocalDateStr ? getLocalDateStr(0) : new Date().toISOString().split('T')[0];
    const { error: invErr } = await db.from('inventory').insert([
        { org_id: orgId, ingredient_id: flour, type: 'приход', quantity: 5, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: sugar, type: 'приход', quantity: 3, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: butter, type: 'приход', quantity: 2, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: eggs, type: 'приход', quantity: 30, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: butter, type: 'расход', quantity: 0.5, notes: 'Демо: производство п/ф «Крем масляный»' },
        { org_id: orgId, ingredient_id: sugar, type: 'расход', quantity: 0.3, notes: 'Демо: производство п/ф «Крем масляный»' },
        { org_id: orgId, semi_finished_id: cream, type: 'приход', quantity: 0.7, notes: `Демо: произведена партия ${today}` }
    ]);
    if (invErr) throw invErr;

    // Заказ-пример
    const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: orgId });
    if (numErr) throw numErr;
    const { data: orderData, error: orderErr } = await db.from('orders').insert({
        org_id: orgId, customer_id: customersData[0].id, order_date: today,
        status: 'принят', discount: 0, vat_exempt: false, employee_id: employeeId || null,
        order_number: orderNumberData, notes: 'Демо-заказ для примера', is_demo: true
    }).select().single();
    if (orderErr) throw orderErr;

    const { error: itemsErr } = await db.from('order_items').insert([
        { org_id: orgId, order_id: orderData.id, product_id: croissant, quantity: 2, price: 2.50 },
        { org_id: orgId, order_id: orderData.id, product_id: honeycake, quantity: 1, price: 3.20 }
    ]);
    if (itemsErr) throw itemsErr;
}

// Полностью убирает демо-набор (и всё, что на него ссылается) — вызывается
// из настроек, кнопка "Удалить демо-данные и начать заново".
// Порядок важен: сначала заказы (и их позиции), потом изделия (и их рецепты),
// потом полуфабрикат (и его рецепт + складские движения по нему), потом
// ингредиенты (и их историю цен + складские движения), и только в конце — клиенты.
async function clearDemoData() {
    showLoading('Удаляю демо-данные...');
    try {
        const { data: demoOrders } = await db.from('orders').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const orderIds = (demoOrders || []).map(o => o.id);
        if (orderIds.length) {
            await db.from('order_items').delete().in('order_id', orderIds);
            await db.from('order_payments').delete().in('order_id', orderIds);
            await db.from('orders').delete().in('id', orderIds);
        }

        const { data: demoProducts } = await db.from('products').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const productIds = (demoProducts || []).map(p => p.id);
        if (productIds.length) {
            await db.from('product_ingredients').delete().in('product_id', productIds);
            await db.from('products').delete().in('id', productIds);
        }

        const { data: demoSf } = await db.from('semi_finished').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const sfIds = (demoSf || []).map(s => s.id);
        if (sfIds.length) {
            await db.from('semi_finished_ingredients').delete().in('semi_finished_id', sfIds);
            await db.from('inventory').delete().in('semi_finished_id', sfIds);
            await db.from('semi_finished').delete().in('id', sfIds);
        }

        const { data: demoIng } = await db.from('ingredients').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const ingIds = (demoIng || []).map(i => i.id);
        if (ingIds.length) {
            await db.from('inventory').delete().in('ingredient_id', ingIds);
            await db.from('ingredient_price_history').delete().in('ingredient_id', ingIds);
            await db.from('ingredients').delete().in('id', ingIds);
        }

        await db.from('customers').delete().eq('org_id', currentOrgId).eq('is_demo', true);

        hideLoading();
        closeModal();
        await loadAllData();
        await loadInventory();
        logActivity('auth', 'Демо-данные удалены');
        await showInfo('Демо-данные удалены. Можно начинать вводить свои данные.');
    } catch (e) {
        hideLoading();
        console.error(e);
        showInfo('Ошибка удаления демо-данных. Проверьте подключение и попробуйте ещё раз.');
    }
}

// Кнопка в настройках: подтверждение + проверка, что демо-данные вообще есть.
async function confirmClearDemoData() {
    try {
        const { count } = await db.from('customers').select('id', { count: 'exact', head: true }).eq('org_id', currentOrgId).eq('is_demo', true);
        if (!count) { showInfo('Демо-данных не найдено — похоже, они уже удалены или не создавались.'); return; }
    } catch (e) { console.error(e); }
    const ok = await showConfirm('Удалить весь демо-набор (демо-клиенты, изделия, полуфабрикат, ингредиенты и демо-заказ)? Ваши собственные данные это не затронет.');
    if (ok) await clearDemoData();
}
