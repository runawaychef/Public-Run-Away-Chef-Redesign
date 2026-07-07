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
// currentOrgVatRate (employees.js), formatDateDMY (dates.js),
// escapeHtml/showLoading/hideLoading/showInfo/updateChecked (helpers.js).

// CURRENCY_SYMBOLS — общая таблица, теперь в money.js (загружается раньше).

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
    container.innerHTML = `<div id="orderDocumentPreviewWrap" style="overflow:hidden;margin:0 auto;background:#f4f1ea;">
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
    const vatRate = typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0.21;
    const vatAll = order.vat_exempt ? 0 : afterDiscountAll * vatRate;
    const grandAll = afterDiscountAll + vatAll;
    const vatPctLabel = order.vat_exempt ? '0%' : (vatRate * 100).toFixed(0) + '%';

    let itemsHtml = '';
    let totalQty = 0;
    items.forEach(item => {
        const lineNet = item.quantity * item.price;
        const discShare = subtotalAll > 0 ? (lineNet / subtotalAll) * discountAll : 0;
        const lineNetAfterDiscount = lineNet - discShare;
        const lineVat = order.vat_exempt ? 0 : lineNetAfterDiscount * vatRate;
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
                <tr style="background:#e3e8df;">
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

// Строит счёт/накладную нативно через jsPDF+autoTable (см. helpers.js) —
// используется для скачивания/отправки; buildDocumentHtml() выше остаётся
// только для превью на экране телефона (это HTML, ему не нужна точность PDF).
async function buildDocumentPdf(docType, snapshot) {
    const { order, org, cust, number, issueDate, dueDate, customerNameFallback } = snapshot;
    const isInvoice = docType === 'invoice';
    const title = isInvoice ? (org.vat_code ? 'СЧЁТ-ФАКТУРА (НДС)' : 'СЧЁТ') : 'НАКЛАДНАЯ';
    const sym = CURRENCY_SYMBOLS[org.currency_code] || org.currency_code || '€';
    const money = n => Number(n).toFixed(2) + ' ' + sym;

    const sellerName = org.entity_type === 'individual' ? (org.name || '') : (org.legal_name || org.name || '');
    const sellerIdLine = org.entity_type === 'individual'
        ? (org.personal_code ? `Личный код: ${org.personal_code}` : '')
        : (org.reg_number ? `Рег. номер: ${org.reg_number}` : '');
    const sellerLines = [
        sellerIdLine,
        org.vat_code ? `Код НДС: ${org.vat_code}` : '',
        org.address || '',
        [org.phone, org.email].filter(Boolean).join(' · '),
        org.bank_name ? `${org.bank_name}${org.bank_account ? ' — ' + org.bank_account : ''}` : '',
        org.bank_swift ? `SWIFT: ${org.bank_swift}` : '',
    ].filter(Boolean);

    const buyerName = cust ? cust.name : customerNameFallback;
    const buyerIdLine = cust && cust.entity_type === 'individual'
        ? (cust.personal_code ? `Личный код: ${cust.personal_code}` : '')
        : (cust && cust.reg_number ? `Рег. номер: ${cust.reg_number}` : '');
    const buyerLines = cust ? [
        buyerIdLine,
        cust.vat_code ? `Код НДС: ${cust.vat_code}` : '',
        cust.address || '',
        cust.contact || '',
    ].filter(Boolean) : [];

    const items = order.items || [];
    const subtotalAll = items.reduce((s, it) => s + it.quantity * it.price, 0);
    const discountAll = subtotalAll * (Number(order.discount) || 0) / 100;
    const afterDiscountAll = subtotalAll - discountAll;
    const vatRate = typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0.21;
    const vatAll = order.vat_exempt ? 0 : afterDiscountAll * vatRate;
    const grandAll = afterDiscountAll + vatAll;
    const vatPctLabel = order.vat_exempt ? '0%' : (vatRate * 100).toFixed(0) + '%';

    let totalQty = 0;
    const bodyRows = items.map(item => {
        const lineNet = item.quantity * item.price;
        const discShare = subtotalAll > 0 ? (lineNet / subtotalAll) * discountAll : 0;
        const lineNetAfterDiscount = lineNet - discShare;
        const lineVat = order.vat_exempt ? 0 : lineNetAfterDiscount * vatRate;
        const lineSubtotal = lineNetAfterDiscount + lineVat;
        totalQty += Number(item.quantity);
        return [
            item.product, String(item.quantity), money(item.price),
            money(lineNetAfterDiscount), money(lineVat), vatPctLabel, money(lineSubtotal),
        ];
    });

    const pdf = await createPdfDoc();
    const pageW = pdf.internal.pageSize.getWidth();
    const marginX = 14;

    // ---- Заголовок: тип документа слева, номер/даты справа ----
    pdf.setFontSize(18); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(title, marginX, 20);
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    pdf.text(`Номер: ${number}`, pageW - marginX, 14, { align: 'right' });
    pdf.text(`Дата: ${formatDateDMY(issueDate)}`, pageW - marginX, 19, { align: 'right' });
    if (isInvoice) pdf.text(`Срок оплаты: ${formatDateDMY(dueDate)}`, pageW - marginX, 24, { align: 'right' });

    // ---- Продавец / Покупатель — две колонки ----
    const colW = (pageW - marginX * 2 - 10) / 2;
    const col2X = marginX + colW + 10;
    let y = 34;

    function drawParty(label, name, lines, x) {
        pdf.setFontSize(9); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(label, x, y);
        pdf.setFontSize(11); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
        pdf.text(name || '', x, y + 5, { maxWidth: colW });
        pdf.setFontSize(9.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        let ly = y + 10;
        lines.forEach(line => {
            const split = pdf.splitTextToSize(line, colW);
            pdf.text(split, x, ly);
            ly += 4.5 * split.length;
        });
        return ly;
    }
    const yAfterSeller = drawParty('ПРОДАВЕЦ', sellerName, sellerLines, marginX);
    const yAfterBuyer  = drawParty('ПОКУПАТЕЛЬ', buyerName, buyerLines, col2X);
    pdf.setTextColor(...PDF_COLORS.textDark);

    // ---- Таблица позиций ----
    pdf.autoTable({
        startY: Math.max(yAfterSeller, yAfterBuyer) + 6,
        margin: { left: marginX, right: marginX },
        head: [['Наименование', 'Кол-во', 'Цена без НДС', 'Сумма без НДС', 'НДС', 'НДС %', 'Итого']],
        body: bodyRows,
        headStyles: { ...PDF_TABLE_HEAD_STYLE, fontSize: 9 },
        columnStyles: {
            1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' },
            4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'right' },
        },
        styles: { fontSize: 9, cellPadding: 2.2, font: 'Roboto' },
    });

    // ---- Итоги (справа) ----
    y = pdf.lastAutoTable.finalY + 8;
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    const totalsRight = pageW - marginX;
    pdf.text(`Итого кол-во: ${totalQty}`, totalsRight, y, { align: 'right' }); y += 5;
    pdf.text(`Итого без НДС: ${money(afterDiscountAll)}`, totalsRight, y, { align: 'right' }); y += 5;
    pdf.text(`Сумма НДС: ${money(vatAll)}`, totalsRight, y, { align: 'right' }); y += 7;
    pdf.setFontSize(13); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(`Итого к оплате: ${money(grandAll)}`, totalsRight, y, { align: 'right' });

    // ---- Подписи ----
    y += 20;
    pdf.setFontSize(9.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    pdf.text(`Выставил: ${org.director_name || sellerName}`, marginX, y);
    pdf.text('Принято: _______________________', pageW - marginX, y, { align: 'right' });

    return pdf;
}

// Шаг 2: превращаем предпросмотр в PDF (нативно, через jsPDF+autoTable — см.
// helpers.js) и пытаемся отправить через системное меню "Поделиться".
async function shareOrderDocumentPdf() {
    if (!_docPreview) return;
    const btn = document.getElementById('sendOrderDocumentBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    const { docType, snapshot } = _docPreview;
    const filename = `${docType === 'invoice' ? 'schet' : 'nakladnaya'}_${snapshot.number}.pdf`;

    showLoading('Формируется PDF, подождите...');
    try {
        const pdf = await buildDocumentPdf(docType, snapshot);
        await pdfSaveOrShare(pdf, filename);
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сформировать документ: ' + (e && e.message ? e.message : 'неизвестная ошибка') + '. Проверьте подключение и попробуйте ещё раз.');
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}
