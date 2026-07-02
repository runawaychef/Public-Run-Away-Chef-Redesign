// ==================== ДЕМО-ДАННЫЕ ДЛЯ ЗНАКОМСТВА С ПРИЛОЖЕНИЕМ ====================
// Предлагаются на экране первого запуска (галочка "Показать пример").
// Небольшой готовый набор: 2 клиента, 4 ингредиента, 2 изделия с рецептами,
// 1 заказ — чтобы новый владелец сразу увидел, как всё выглядит и связано.
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

    // Рецептура изделий
    const { error: riErr } = await db.from('product_ingredients').insert([
        { org_id: orgId, product_id: croissant, ingredient_id: flour, semi_finished_id: null, quantity: 0.5 },
        { org_id: orgId, product_id: croissant, ingredient_id: butter, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: croissant, ingredient_id: sugar, semi_finished_id: null, quantity: 0.05 },
        { org_id: orgId, product_id: croissant, ingredient_id: eggs, semi_finished_id: null, quantity: 2 },
        { org_id: orgId, product_id: honeycake, ingredient_id: flour, semi_finished_id: null, quantity: 0.4 },
        { org_id: orgId, product_id: honeycake, ingredient_id: sugar, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: honeycake, ingredient_id: eggs, semi_finished_id: null, quantity: 4 }
    ]);
    if (riErr) throw riErr;

    // Заказ-пример
    const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: orgId });
    if (numErr) throw numErr;
    const { data: orderData, error: orderErr } = await db.from('orders').insert({
        org_id: orgId, customer_id: customersData[0].id, order_date: new Date().toISOString().split('T')[0],
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
// потом ингредиенты, и только в конце — клиенты.
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

        await db.from('ingredients').delete().eq('org_id', currentOrgId).eq('is_demo', true);
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
    const ok = await showConfirm('Удалить весь демо-набор (демо-клиенты, изделия, ингредиенты и демо-заказ)? Ваши собственные данные это не затронет.');
    if (ok) await clearDemoData();
}
