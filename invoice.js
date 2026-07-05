// ==================== СЧЁТ / НАКЛАДНАЯ ПО ЗАКАЗУ ====================
// Формирует PDF-документ (счёт или накладная) на основе данных заказа,
// реквизитов пекарни (organizations) и реквизитов клиента (customers).
//
// Данные "замораживаются" при первом формировании документа: номер и полный
// снимок (позиции, реквизиты обеих сторон на тот момент) сохраняются в
// orders.invoice_snapshot / orders.delivery_note_snapshot (jsonb). При
// повторном открытии показывается именно сохранённый снимок, а не пересчёт
// из текущих (возможно, уже изменившихся) данных — иначе один и тот же номер
// документа мог бы каждый раз показывать разное содержимое. Кнопка
// «Обновить снимок» в предпросмотре позволяет осознанно пересчитать данные
// заново, сохранив тот же номер.
//
// Зависит от: db, currentOrgId, orders/customers (orders.js/customers.js),
// VAT_RATE (money.js), formatDateDMY (dates.js),
// escapeHtml/showLoading/hideLoading/showInfo/updateChecked (helpers.js).

const CURRENCY_SYMBOLS = {
    EUR: '€', USD: '$', RUB: '₽', BYN: 'Br', KZT: '₸', KGS: 'с', UZS: 'сум',
    TJS: 'SM', TMT: 'm', AZN: '₼', AMD: '֏', GEL: '₾', MDL: 'L', UAH: '₴'
};

let _docPreview = null; // { docType, snapshot } — состояние открытого предпросмотра

function snapshotField(docType) {
    return docType === 'invoice' ? 'invoice_snapshot' : 'delivery_note_snapshot';
}

function openDocumentTypeModal() {
    document.getElementById('documentTypeModal').style.display = 'flex';
}

// Шаг 1: выбор типа документа → снимок (существующий или свежесобранный) → предпросмотр
async function openOrderDocumentPreview(docType) {
    closeModal();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;

    showLoading('Формирование документа...');
    try {
        let snapshot = order[snapshotField(docType)];
        if (!snapshot) {
            snapshot = await freezeDocumentSnapshot(order, docType);
        }
        _docPreview = { docType, snapshot };
        renderDocumentPreviewThumbnail();
        document.getElementById('orderDocumentModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сформировать документ: ' + (e && e.message ? e.message : 'неизвестная ошибка'));
    } finally {
        hideLoading();
    }
}

// Пересобирает снимок из текущих данных и сохраняет его поверх старого
// (номер при этом не меняется — только содержимое).
async function refreshDocumentSnapshot() {
    if (!_docPreview) return;
    const { docType } = _docPreview;
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;

    showLoading('Обновление снимка...');
    try {
        const snapshot = await freezeDocumentSnapshot(order, docType, /*reuseNumber*/ order[snapshotField(docType)].number);
        _docPreview = { docType, snapshot };
        renderDocumentPreviewThumbnail();
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось обновить снимок: ' + (e && e.message ? e.message : 'неизвестная ошибка'));
    } finally {
        hideLoading();
    }
}

// Собирает снимок данных из текущего состояния заказа/компании/клиента,
// присваивает номер (если ещё не присвоен) и сохраняет в orders.*_snapshot.
async function freezeDocumentSnapshot(order, docType, reuseNumber) {
    const [{ data: org, error: orgErr }, { data: cust, error: custErr }] = await Promise.all([
        db.from('organizations').select('*').eq('id', currentOrgId).single(),
        order.customer_id
            ? db.from('customers').select('*').eq('id', order.customer_id).single()
            : Promise.resolve({ data: null, error: null })
    ]);
    if (orgErr) throw orgErr;
    if (custErr) throw custErr;

    let number = reuseNumber;
    if (!number) {
        const rpcName = docType === 'invoice' ? 'get_next_invoice_number' : 'get_next_delivery_note_number';
        const { data, error } = await db.rpc(rpcName, { p_org_id: currentOrgId });
        if (error) throw error;
        number = data;
    }

    const now = new Date();
    const due = new Date(now);
    due.setDate(due.getDate() + 7);

    const snapshot = {
        number,
        issueDate: now.toISOString().slice(0, 10),
        dueDate: due.toISOString().slice(0, 10),
        customerNameFallback: order.customer || '—',
        order: {
            items: (order.items || []).map(it => ({ product: it.product, quantity: it.quantity, price: it.price })),
            discount: order.discount,
            vat_exempt: order.vat_exempt,
        },
        org: {
            name: org.name, legal_name: org.legal_name, entity_type: org.entity_type,
            personal_code: org.personal_code, reg_number: org.reg_number, vat_code: org.vat_code,
            address: org.address, phone: org.phone, email: org.email,
            bank_name: org.bank_name, bank_account: org.bank_account, bank_swift: org.bank_swift,
            director_name: org.director_name, currency_code: org.currency_code,
        },
        cust: cust ? {
            name: cust.name, entity_type: cust.entity_type, personal_code: cust.personal_code,
            reg_number: cust.reg_number, vat_code: cust.vat_code, address: cust.address, contact: cust.contact,
        } : null,
    };

    const field = snapshotField(docType);
    await updateChecked(db.from('orders').update({ [field]: snapshot }).eq('id', order.id));
    order[field] = snapshot;
    return snapshot;
}

// Показывает документ в предпросмотре как уменьшенную копию целой страницы A4
// (настоящий размер 794px используется только "под капотом" — на экране
// телефона он умещается целиком за счёт CSS-трансформации масштаба).
function renderDocumentPreviewThumbnail() {
    const container = document.getElementById('orderDocumentContent');
    container.innerHTML = `<div id="orderDocumentPreviewWrap" style="overflow:hidden;margin:0 auto;background:#f3f4f6;">
        <div id="orderDocumentInner" style="transform-origin:top left;">${buildDocumentHtml(_docPreview.docType, _docPreview.snapshot)}</div>
    </div>`;

    requestAnimationFrame(() => {
        const inner = document.getElementById('orderDocumentInner');
        const wrap = document.getElementById('orderDocumentPreviewWrap');
        const trueWidth = inner.scrollWidth;
        const trueHeight = inner.scrollHeight;
        const targetWidth = Math.min(340, container.clientWidth || 340);
        const scale = targetWidth / trueWidth;
        inner.style.transform = `scale(${scale})`;
        wrap.style.width = Math.round(trueWidth * scale) + 'px';
        wrap.style.height = Math.round(trueHeight * scale) + 'px';
    });
}

// Строит HTML-разметку документа из ЗАМОРОЖЕННОГО снимка (не из текущих
// живых данных) — используется и для предпросмотра, и для снимка в PDF.
function buildDocumentHtml(docType, snapshot) {
    const { order, org, cust, number, issueDate, dueDate, customerNameFallback } = snapshot;
    const isInvoice = docType === 'invoice';
    const title = isInvoice ? (org.vat_code ? 'СЧЁТ-ФАКТУРА (НДС)' : 'СЧЁТ') : 'НАКЛАДНАЯ';
    const sym = CURRENCY_SYMBOLS[org.currency_code] || org.currency_code || '€';
    const money = n => Number(n).toFixed(2) + ' ' + sym;

    // ---- Продавец ----
    const sellerName = org.entity_type === 'individual' ? (org.name || '') : (org.legal_name || org.name || '');
    const sellerIdLine = org.entity_type === 'individual'
        ? (org.personal_code ? `Личный код: ${escapeHtml(org.personal_code)}` : '')
        : (org.reg_number ? `Рег. номер: ${escapeHtml(org.reg_number)}` : '');
    const sellerLines = [
        sellerIdLine,
        org.vat_code ? `Код НДС: ${escapeHtml(org.vat_code)}` : '',
        org.address ? escapeHtml(org.address) : '',
        [org.phone, org.email].filter(Boolean).map(escapeHtml).join(' · '),
        org.bank_name ? `${escapeHtml(org.bank_name)}${org.bank_account ? ' — ' + escapeHtml(org.bank_account) : ''}` : '',
        org.bank_swift ? `SWIFT: ${escapeHtml(org.bank_swift)}` : '',
    ].filter(Boolean);

    // ---- Покупатель ----
    const buyerName = cust ? cust.name : customerNameFallback;
    const buyerIdLine = cust && cust.entity_type === 'individual'
        ? (cust.personal_code ? `Личный код: ${escapeHtml(cust.personal_code)}` : '')
        : (cust && cust.reg_number ? `Рег. номер: ${escapeHtml(cust.reg_number)}` : '');
    const buyerLines = cust ? [
        buyerIdLine,
        cust.vat_code ? `Код НДС: ${escapeHtml(cust.vat_code)}` : '',
        cust.address ? escapeHtml(cust.address) : '',
        cust.contact ? escapeHtml(cust.contact) : '',
    ].filter(Boolean) : [];

    // ---- Позиции с распределением скидки и НДС по строкам ----
    // Считаем по тем же формулам, что и money.js, но на данных из снимка
    const items = order.items || [];
    const subtotalAll = items.reduce((s, it) => s + it.quantity * it.price, 0);
    const discountAll = subtotalAll * (Number(order.discount) || 0) / 100;
    const afterDiscountAll = subtotalAll - discountAll;
    const vatAll = order.vat_exempt ? 0 : afterDiscountAll * VAT_RATE;
    const grandAll = afterDiscountAll + vatAll;
    const vatPctLabel = order.vat_exempt ? '0%' : (VAT_RATE * 100).toFixed(0) + '%';

    let itemsHtml = '';
    let totalQty = 0;
    items.forEach(item => {
        const lineNet = item.quantity * item.price;
        const discShare = subtotalAll > 0 ? (lineNet / subtotalAll) * discountAll : 0;
        const lineNetAfterDiscount = lineNet - discShare;
        const lineVat = order.vat_exempt ? 0 : lineNetAfterDiscount * VAT_RATE;
        const lineSubtotal = lineNetAfterDiscount + lineVat;
        totalQty += Number(item.quantity);
        itemsHtml += `<tr>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.product)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.price)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineNetAfterDiscount)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineVat)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${vatPctLabel}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineSubtotal)}</td>
        </tr>`;
    });

    const dueDateRow = isInvoice
        ? `<div>Срок оплаты: ${formatDateDMY(dueDate)}</div>`
        : '';

    // Макет рассчитан на реальную ширину A4 при 96dpi (794px) — не под экран
    // телефона. На телефоне эта разметка показывается уменьшенной копией
    // (см. renderDocumentPreviewThumbnail), а для PDF снимок делается с
    // нетронутого, полноразмерного варианта — поэтому шрифты и отступы
    // подобраны как для печатной страницы, а не для мобильного экрана.
    return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;padding:56px;font-size:16px;background:white;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
            <h1 style="font-size:26px;margin:0;">${title}</h1>
            <div style="text-align:right;font-size:15px;color:#374151;">
                <div>Номер: ${escapeHtml(number)}</div>
                <div>Дата: ${formatDateDMY(issueDate)}</div>
                ${dueDateRow}
            </div>
        </div>

        <div style="display:flex;gap:32px;margin-bottom:28px;">
            <div style="flex:1;">
                <div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:4px;">ПРОДАВЕЦ</div>
                <div style="font-weight:600;font-size:16px;">${escapeHtml(sellerName)}</div>
                ${sellerLines.map(l => `<div style="font-size:15px;color:#374151;">${l}</div>`).join('')}
            </div>
            <div style="flex:1;">
                <div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:4px;">ПОКУПАТЕЛЬ</div>
                <div style="font-weight:600;font-size:16px;">${escapeHtml(buyerName)}</div>
                ${buyerLines.map(l => `<div style="font-size:15px;color:#374151;">${l}</div>`).join('')}
            </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:15px;table-layout:fixed;">
            <thead>
                <tr style="background:#f3f4f6;">
                    <th style="padding:10px 8px;text-align:left;width:32%;">Наименование</th>
                    <th style="padding:10px 8px;text-align:center;width:8%;">Кол-во</th>
                    <th style="padding:10px 8px;text-align:right;width:14%;">Цена без НДС</th>
                    <th style="padding:10px 8px;text-align:right;width:14%;">Сумма без НДС</th>
                    <th style="padding:10px 8px;text-align:right;width:12%;">НДС</th>
                    <th style="padding:10px 8px;text-align:center;width:8%;">НДС %</th>
                    <th style="padding:10px 8px;text-align:right;width:12%;">Итого</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>

        <div style="margin-top:20px;text-align:right;font-size:15px;">
            <div>Итого кол-во: <b>${totalQty}</b></div>
            <div>Итого без НДС: <b>${money(afterDiscountAll)}</b></div>
            <div>Сумма НДС: <b>${money(vatAll)}</b></div>
            <div style="font-size:19px;margin-top:6px;">Итого к оплате: <b>${money(grandAll)}</b></div>
        </div>

        <div style="margin-top:56px;display:flex;justify-content:space-between;font-size:15px;">
            <div>Выставил: ${escapeHtml(org.director_name || sellerName)}</div>
            <div>Принято: _______________________</div>
        </div>
    </div>`;
}

// Шаг 2: превращаем предпросмотр в PDF и пытаемся отправить (иначе — скачиваем)
async function shareOrderDocumentPdf() {
    if (!_docPreview) return;
    const btn = document.getElementById('sendOrderDocumentBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    const clone = document.createElement('div');
    clone.id = 'orderDocumentClone';
    clone.style.cssText = 'position:absolute; top:0; left:-9999px;';
    clone.innerHTML = buildDocumentHtml(_docPreview.docType, _docPreview.snapshot);
    document.body.appendChild(clone);

    function withTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms))
        ]);
    }

    const { docType, snapshot } = _docPreview;
    const filename = `${docType === 'invoice' ? 'schet' : 'nakladnaya'}_${snapshot.number}.pdf`;

    showLoading('Формируется PDF, подождите — это может занять до 30 секунд...');
    try {
        if (typeof html2canvas === 'undefined' || !window.jspdf) {
            throw new Error('Библиотеки для PDF не загрузились (html2canvas/jsPDF). Проверьте интернет и обновите страницу.');
        }
        const canvas = await withTimeout(html2canvas(clone, { scale: 1.5, backgroundColor: '#ffffff' }), 15000, 'Создание снимка документа');
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW - 20;
        const imgH = (canvas.height * imgW) / canvas.width;

        let heightLeft = imgH;
        let position = 10;
        pdf.addImage(imgData, 'PNG', 10, position, imgW, imgH);
        heightLeft -= (pageH - 20);
        while (heightLeft > 0) {
            position = heightLeft - imgH + 10;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 10, position, imgW, imgH);
            heightLeft -= (pageH - 20);
        }

        // Пробуем отправить сам файл через системное меню "Поделиться".
        // Поддерживается не всеми браузерами — если нет, просто скачиваем.
        const blob = pdf.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: filename });
            } catch (e) { /* пользователь закрыл меню — ничего не делаем */ }
        } else {
            pdf.save(filename);
            await showInfo(`Готово: файл «${filename}» сохранён.`);
        }
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сформировать документ: ' + (e && e.message ? e.message : 'неизвестная ошибка') + '. Проверьте подключение и попробуйте ещё раз.');
    } finally {
        clone.remove();
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}
