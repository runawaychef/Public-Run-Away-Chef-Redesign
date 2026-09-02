// ==================== ОТМЕТКА "ДОКУМЕНТ ОТПРАВЛЕН" (самолётик на карточке) ====================
// Раздельно по типу документа (invoice/delivery_note), хранится только ПОСЛЕДНЯЯ
// отправка (не история) — orders.invoice_sent_at/_via, orders.delivery_note_sent_at/_via.
// Считается "отправленным" только реальная передача — через email (когда подключим)
// или через нативное меню "Поделиться" (см. pdfSaveOrShare -> shareOrderDocumentPdf) —
// НЕ простое локальное скачивание PDF на устройство.

// ==================== ОТМЕТКА "ДОКУМЕНТ ОТПРАВЛЕН" (самолётик на карточке) ====================
// Раздельно по типу документа (invoice/delivery_note), хранится только ПОСЛЕДНЯЯ
// отправка (не история) — orders.invoice_sent_at/_via, orders.delivery_note_sent_at/_via.
// Считается "отправленным" только реальная передача — через email или через
// нативное меню "Поделиться" (см. pdfSaveOrShare -> shareOrderDocumentPdf) —
// НЕ простое локальное скачивание PDF на устройство.
//
// Для email дополнительно отслеживается СТАТУС ДОСТАВКИ (invoice_delivery_status/
// delivery_note_delivery_status: 'sent' → 'delivered' / 'bounced' / 'complained' /
// 'delayed') — обновляется асинхронно через Resend Webhooks → Edge Function
// resend-webhook, когда почта Resend узнаёт судьбу письма. Для 'share' статуса
// доставки нет и быть не может (Web Share API не даёт такого подтверждения) —
// там значок всегда нейтральный.

// Смотрим на оба документа заказа и выбираем "худший" статус — так значок
// сразу сигналит о проблеме, даже если второй документ ушёл нормально.
function _worstDeliveryStatus(order) {
    const statuses = [order.invoice_delivery_status, order.delivery_note_delivery_status].filter(Boolean);
    if (statuses.includes('bounced') || statuses.includes('complained')) return 'alarm';
    if (statuses.includes('delivered')) return 'delivered';
    if (statuses.includes('delayed') || statuses.includes('sent')) return 'neutral';
    // Отправлено через 'Поделиться' (или email без статуса, вебхук ещё не пришёл) — нейтрально.
    if (order.invoice_sent_at || order.delivery_note_sent_at) return 'neutral';
    return null;
}

function _sentIconHtml(order) {
    const state = _worstDeliveryStatus(order);
    if (!state) return '';
    return `<svg class="oc-sent-icon oc-sent-icon--${state}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" onclick="event.stopPropagation(); showDocumentSentInfo(${order.id})"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h9a2.25 2.25 0 012.25 2.25v5.25M2.25 6.75v7.5A2.25 2.25 0 004.5 16.5h5.25M2.25 6.75L9 11.69a1.5 1.5 0 001.76 0L15.75 8.4"/><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 16.5l2.25 2.25 4.5-4.5"/></svg>`;
}

function _formatSentDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _sentViaLabel(via) {
    return via === 'email' ? t('send_via_email') : t('send_via_share');
}

function _deliveryStatusLabel(status) {
    switch (status) {
        case 'delivered': return t('send_status_delivered');
        case 'bounced': return t('send_status_bounced');
        case 'complained': return t('send_status_complained');
        case 'delayed': return t('send_status_delayed');
        case 'sent': return t('send_status_sent');
        default: return '';
    }
}

function showDocumentSentInfo(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const lines = [];
    if (order.invoice_sent_at) {
        const statusPart = order.invoice_sent_via === 'email' && order.invoice_delivery_status
            ? ` — ${_deliveryStatusLabel(order.invoice_delivery_status)}` : '';
        lines.push(`${t('orders_doc_invoice')}: ${_sentViaLabel(order.invoice_sent_via)}, ${_formatSentDateTime(order.invoice_sent_at)}${statusPart}`);
    }
    if (order.delivery_note_sent_at) {
        const statusPart = order.delivery_note_sent_via === 'email' && order.delivery_note_delivery_status
            ? ` — ${_deliveryStatusLabel(order.delivery_note_delivery_status)}` : '';
        lines.push(`${t('orders_doc_delivery_note')}: ${_sentViaLabel(order.delivery_note_sent_via)}, ${_formatSentDateTime(order.delivery_note_sent_at)}${statusPart}`);
    }
    if (!lines.length) return;
    showInfo(lines.join('\n'));
}

// Фиксирует факт отправки (docType: 'invoice'|'delivery_note', via: 'share'|'email',
// messageId — ID письма от Resend, только для via==='email', нужен вебхуку, чтобы
// потом найти этот заказ по событию доставки). Оптимистичное обновление, как и
// остальные быстрые действия в orders.js — сразу перерисовываем список, откатываем
// при ошибке сохранения.
async function recordDocumentSent(orderId, docType, via, messageId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const atField = docType === 'invoice' ? 'invoice_sent_at' : 'delivery_note_sent_at';
    const viaField = docType === 'invoice' ? 'invoice_sent_via' : 'delivery_note_sent_via';
    const msgIdField = docType === 'invoice' ? 'invoice_sent_message_id' : 'delivery_note_sent_message_id';
    const statusField = docType === 'invoice' ? 'invoice_delivery_status' : 'delivery_note_delivery_status';
    const prev = { at: order[atField], via: order[viaField], msgId: order[msgIdField], status: order[statusField] };
    const nowIso = new Date().toISOString();
    const newMsgId = via === 'email' ? (messageId || null) : null;
    const newStatus = via === 'email' ? 'sent' : null;

    order[atField] = nowIso;
    order[viaField] = via;
    order[msgIdField] = newMsgId;
    order[statusField] = newStatus;
    displayOrders();

    try {
        await updateChecked(db.from('orders').update({
            [atField]: nowIso, [viaField]: via, [msgIdField]: newMsgId, [statusField]: newStatus,
        }).eq('id', orderId));
    } catch (e) {
        console.error(e);
        order[atField] = prev.at;
        order[viaField] = prev.via;
        order[msgIdField] = prev.msgId;
        order[statusField] = prev.status;
        displayOrders();
        showInfo(t('send_status_save_error') + (e && e.message ? e.message : ''));
    }
}

// ==================== ОТПРАВКА ДОКУМЕНТА НА EMAIL (ВИЗУАЛ) ====================
// Пока только разметка и переключение состояний на клиенте. Реальная генерация
// PDF (переиспользуется freezeDocumentSnapshot из invoice.js) и отправка через
// Edge Function/Resend будут добавлены отдельным шагом — см. обсуждение в чате.
//
// Язык самого письма (emailLang) НЕЗАВИСИМ от языка интерфейса приложения —
// пекарь может вести приложение на русском, но написать письмо клиенту на
// литовском. Кнопки-переключатели (тип документа и т.п.) остаются на языке
// интерфейса (t()), а тело письма и имя вложения генерируются через tLang()
// на выбранном языке письма, с ленивой подгрузкой словаря при первом выборе.

let _sendSheetState = null; // { orderId, custId, docType, emailLang }

// Достаёт перевод НЕ из текущего языка интерфейса, а из конкретного lang —
// нужно для генерации текста письма независимо от языка приложения.
// Словарь должен быть уже загружен (см. ensureLangLoaded) до вызова.
function tLang(key, lang) {
    const dict = (typeof I18N !== 'undefined' && I18N[lang]) || {};
    if (dict[key] !== undefined) return dict[key];
    const base = (typeof I18N !== 'undefined' && I18N[BASE_LANG]) || {};
    if (base[key] !== undefined) return base[key];
    return key;
}

function _sendDocTemplate(docType, lang, custName, orgName, orderNumLabel, docNumberLabel, sumLabel) {
    const docLabel = docType === 'invoice' ? tLang('orders_doc_invoice', lang) : tLang('orders_doc_delivery_note', lang);
    const key = docNumberLabel ? 'send_body_template_known' : 'send_body_template_new';
    return tLang(key, lang)
        .replace('{customer}', custName)
        .replace('{doc_label}', docLabel.toLowerCase())
        .replace('{order_number}', orderNumLabel)
        .replace('{doc_number}', docNumberLabel || '')
        .replace('{sum}', sumLabel)
        .replace('{org_name}', orgName);
}

// Имя вложения: если документ для этого заказа уже когда-то генерировался —
// используем его реальный номер (совпадает с тем, что видно на самом PDF).
// Если это первая генерация — временно используем номер заказа, до момента
// реальной отправки (см. submitSendDocument — там имя пересчитывается заново
// с уже гарантированно присвоенным номером документа).
function _sendAttachmentName(docType, lang, docNumberLabel, orderNumLabel) {
    const base = docType === 'invoice' ? tLang('send_attachment_base_invoice', lang) : tLang('send_attachment_base_delivery', lang);
    return `${base}_${docNumberLabel || orderNumLabel}.pdf`;
}

function _sendSubject(docType, lang, orderNumLabel, docNumberLabel, orgName) {
    const docLabel = docType === 'invoice' ? tLang('orders_doc_invoice', lang) : tLang('orders_doc_delivery_note', lang);
    const key = docNumberLabel ? 'send_subject_template_known' : 'send_subject_template_new';
    return tLang(key, lang)
        .replace('{doc_label}', docLabel)
        .replace('{order_number}', orderNumLabel)
        .replace('{doc_number}', docNumberLabel || '')
        .replace('{org_name}', orgName);
}

// Номер ЗАКАЗА (order.order_number) и номер ДОКУМЕНТА (свой отдельный счётчик,
// присваивается только когда документ реально сформирован — snapshot.number)
// — это два РАЗНЫХ значения, которые легко перепутать. Текст письма должен
// явно ссылаться на правильный из них, а не показывать номер заказа так,
// будто это номер документа (было именно так раньше — вводило в заблуждение,
// см. обсуждение в чате 31.08.2026). Префикс INV-/DN- — тот же, что рисуется
// на самом PDF (invoice.js, numberPrefix).
function _formatDocNumber(docType, rawNumber) {
    if (!rawNumber) return null;
    return (docType === 'invoice' ? 'INV-' : 'DN-') + rawNumber;
}

// Резервирует номер документа (Счёта или Накладной) СРАЗУ, в момент открытия
// шита отправки / переключения типа документа — а не откладывает до реального
// нажатия "Отправить". Так текст письма никогда не показывает "временный"
// номер, который потом может не совпасть с тем, что окажется на PDF. Цена
// компромисса: если человек откроет шит и передумает — номер останется
// зарезервированным за этим заказом (пропуск в последовательности), но
// НИКОГДА не будет задвоен — присвоение атомарно на уровне самой SQL-функции.
async function _reserveDocSnapshot(order, docType) {
    const field = snapshotField(docType);
    const { data: freshRow, error: freshErr } = await db.from('orders').select(field).eq('id', order.id).single();
    if (freshErr) throw freshErr;
    const existing = freshRow ? freshRow[field] : null;
    return await freezeDocumentSnapshot(order, docType, existing);
}

function _renderSendEmailLangSwitch() {
    return `<div class="lang-switch" id="sendEmailLangSwitch" style="margin-bottom:10px;">` +
        AVAILABLE_LANGS.map(code =>
            `<button type="button" class="${code === _sendSheetState.emailLang ? 'active' : ''}" onclick="selectSendEmailLang('${code}')">${code.toUpperCase()}</button>`
        ).join('') +
        `</div>`;
}

async function openSendDocumentSheet(orderId, docType) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const cust = order.customer_id ? customers.find(c => c.id === order.customer_id) : null;
    _sendSheetState = { orderId, custId: cust ? cust.id : null, docType: docType || 'invoice', emailLang: currentLang, bccSelf: currentOrgBccSelf, snapshot: null, docNumber: null };

    const custName = escapeHtml(order.customer || t('orders_no_customer'));
    const body = document.getElementById('sendSheetBody');
    if (!body) return;

    if (!cust || !cust.email) {
        body.innerHTML = `
            <div class="send-no-email-box">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c99a3b" stroke-width="1.6" style="margin:0 auto 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
                <p style="font-size:14px; font-weight:600; margin:0 0 4px; color:#3c3a34;" data-i18n="send_no_email_title">${t('send_no_email_title')}</p>
                <p style="font-size:13px; color:#6b675d; margin:0 0 14px;" data-i18n="send_no_email_body">${t('send_no_email_body')}</p>
                <button class="pill-btn-secondary w-full justify-center" onclick="closeModal(); openCustomerDetail(${cust ? cust.id : 'null'})" ${cust ? '' : 'disabled style="opacity:.5;"'}>${t('send_open_customer_card')}</button>
            </div>`;
        document.getElementById('sendDocumentSheet').style.display = 'flex';
        return;
    }

    // Резервируем номер документа СЕЙЧАС, до отрисовки текста письма — см.
    // комментарий у _reserveDocSnapshot. Без email резервировать смысла нет
    // (см. return выше), поэтому этот шаг только в ветке "email есть".
    showLoading(t('customers_pdf_generating'));
    try {
        _sendSheetState.snapshot = await _reserveDocSnapshot(order, _sendSheetState.docType);
        _sendSheetState.docNumber = _formatDocNumber(_sendSheetState.docType, _sendSheetState.snapshot.number);
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
        return;
    }
    hideLoading();

    const orderNumLabel = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const sumLabel = formatMoney(orderGrandTotal(order));
    body.innerHTML = `
        <div class="send-doctype-switch" style="margin-bottom:14px;">
            <button id="sendDocTypeInvoice" class="${_sendSheetState.docType === 'invoice' ? 'active' : ''}" onclick="selectSendDocType('invoice')">${t('orders_doc_invoice')}</button>
            <button id="sendDocTypeDelivery" class="${_sendSheetState.docType === 'delivery_note' ? 'active' : ''}" onclick="selectSendDocType('delivery_note')">${t('orders_doc_delivery_note')}</button>
        </div>
        <div class="send-recipient-row" style="margin-bottom:14px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b675d" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
            <span class="email-value" id="sendRecipientEmail">${escapeHtml(cust.email)}</span>
            <span class="send-edit-link" onclick="openEmailQuickEdit(${cust.id})">${t('send_edit_email')}</span>
        </div>
        <div class="flex items-center justify-between" style="margin-bottom:6px;">
            <p style="font-size:13px; color:#6b675d; margin:0;">${t('send_body_label')}</p>
            <p style="font-size:11px; color:#9a9488; margin:0;">${t('send_letter_lang_label')}</p>
        </div>
        ${_renderSendEmailLangSwitch()}
        <textarea id="sendEmailBody" rows="6" class="border p-2 rounded-xl table-text w-full resize-none" style="margin-bottom:8px;">${_sendDocTemplate(_sendSheetState.docType, _sendSheetState.emailLang, custName, escapeHtml(currentOrgName || ''), orderNumLabel, _sendSheetState.docNumber, sumLabel)}</textarea>
        <div class="send-attachment-row" style="margin-bottom:14px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b675d" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
            <span id="sendAttachmentName">${_sendAttachmentName(_sendSheetState.docType, _sendSheetState.emailLang, _sendSheetState.docNumber, orderNumLabel)}</span>
        </div>
        <label class="flex items-center gap-1.5" style="margin-bottom:10px; cursor:pointer;">
            <input type="checkbox" id="sendBccSelf" ${_sendSheetState.bccSelf ? 'checked' : ''} onchange="_sendSheetState.bccSelf = this.checked;" class="w-4 h-4" style="accent-color:#7c9473;">
            <span style="font-size:13px; color:#3c3a34;">${t('send_bcc_self_label')}</span>
        </label>
        <p style="font-size:13px; color:#6b675d; margin:0 0 6px;">${t('send_extra_cc_label')}</p>
        <input type="text" id="sendExtraCc" placeholder="${t('send_extra_cc_placeholder')}" class="border p-2 rounded-xl table-text w-full" style="margin-bottom:14px;">
        <button class="pill-btn w-full justify-center" id="sendDocSubmitBtn" onclick="submitSendDocument()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zm0 0l9.75 6.75 9.75-6.75"/></svg>
            <span>${t('send_button')}</span>
        </button>`;

    document.getElementById('sendDocumentSheet').style.display = 'flex';
}

async function selectSendDocType(docType) {
    if (!_sendSheetState) return;
    _sendSheetState.docType = docType;
    const order = orders.find(o => o.id === _sendSheetState.orderId);
    const cust = customers.find(c => c.id === _sendSheetState.custId);
    if (!order || !cust) return;

    document.getElementById('sendDocTypeInvoice').classList.toggle('active', docType === 'invoice');
    document.getElementById('sendDocTypeDelivery').classList.toggle('active', docType === 'delivery_note');

    // У Счёта и Накладной РАЗНЫЕ номера — при переключении типа резервируем
    // номер заново под новый тип (та же логика, что при открытии шита).
    showLoading(t('customers_pdf_generating'));
    try {
        _sendSheetState.snapshot = await _reserveDocSnapshot(order, docType);
        _sendSheetState.docNumber = _formatDocNumber(docType, _sendSheetState.snapshot.number);
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
        return;
    }
    hideLoading();

    const orderNumLabel = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const sumLabel = formatMoney(orderGrandTotal(order));
    document.getElementById('sendEmailBody').value = _sendDocTemplate(docType, _sendSheetState.emailLang, escapeHtml(order.customer || t('orders_no_customer')), escapeHtml(currentOrgName || ''), orderNumLabel, _sendSheetState.docNumber, sumLabel);
    document.getElementById('sendAttachmentName').textContent = _sendAttachmentName(docType, _sendSheetState.emailLang, _sendSheetState.docNumber, orderNumLabel);
}

// Переключает ЯЗЫК ПИСЬМА (не интерфейса) — подгружает словарь выбранного
// языка при первом обращении к нему (LT/UK и т.п. грузятся лениво), затем
// перегенерирует текст письма и имя вложения на этом языке. Номер документа
// НЕ пересматриваем — тип документа не менялся, значение уже в _sendSheetState.docNumber.
async function selectSendEmailLang(lang) {
    if (!_sendSheetState || !AVAILABLE_LANGS.includes(lang)) return;
    const order = orders.find(o => o.id === _sendSheetState.orderId);
    const cust = customers.find(c => c.id === _sendSheetState.custId);
    if (!order || !cust) return;

    await ensureLangLoaded(lang);
    _sendSheetState.emailLang = lang;

    document.querySelectorAll('#sendEmailLangSwitch button').forEach((btn, i) => {
        btn.classList.toggle('active', AVAILABLE_LANGS[i] === lang);
    });

    const orderNumLabel = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const sumLabel = formatMoney(orderGrandTotal(order));
    document.getElementById('sendEmailBody').value = _sendDocTemplate(_sendSheetState.docType, lang, escapeHtml(order.customer || t('orders_no_customer')), escapeHtml(currentOrgName || ''), orderNumLabel, _sendSheetState.docNumber, sumLabel);
    document.getElementById('sendAttachmentName').textContent = _sendAttachmentName(_sendSheetState.docType, lang, _sendSheetState.docNumber, orderNumLabel);
}

// Реальная отправка: номер документа УЖЕ зарезервирован при открытии шита
// (см. _reserveDocSnapshot в openSendDocumentSheet/selectSendDocType) — здесь
// просто переиспользуем готовый снимок, без повторного похода в базу.
// Генерирует PDF на выбранном языке письма, кодирует в base64 и вызывает
// Edge Function send-document-email (она уже сама зовёт Resend). При успехе
// фиксирует факт отправки — recordDocumentSent(...,'email') — самолётик
// на карточке появится сразу.
async function submitSendDocument() {
    if (!_sendSheetState) return;
    const { orderId, docType, custId, emailLang, snapshot } = _sendSheetState;
    const order = orders.find(o => o.id === orderId);
    const cust = customers.find(c => c.id === custId);
    if (!order || !cust || !cust.email || !snapshot) return;

    const btn = document.getElementById('sendDocSubmitBtn');

    // Разбираем "Дополнительные получатели" (через запятую) — валидируем на
    // клиенте, чтобы сразу подсказать про опечатку, а не после похода на сервер.
    const extraCcRaw = (document.getElementById('sendExtraCc')?.value || '').trim();
    const extraCc = extraCcRaw ? extraCcRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidCc = extraCc.filter(e => !emailRe.test(e));
    if (invalidCc.length) {
        showInfo(t('send_extra_cc_invalid') + ' ' + invalidCc.join(', '));
        return;
    }

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));

    try {
        await ensureLangLoaded(emailLang);
        const pdf = await buildDocumentPdf(docType, snapshot, emailLang);
        const pdfBase64 = pdf.output('datauristring').split(',')[1];

        // Текст письма (bodyText) НЕ пересобираем — берём как есть из textarea,
        // чтобы не затереть возможные ручные правки пекаря.
        const orderNumLabel = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
        const docNumberLabel = _formatDocNumber(docType, snapshot.number);
        const pdfFilename = _sendAttachmentName(docType, emailLang, docNumberLabel, orderNumLabel);
        const subject = _sendSubject(docType, emailLang, orderNumLabel, docNumberLabel, currentOrgName || '');
        const bodyText = document.getElementById('sendEmailBody').value;

        const { data: result, error: fnError } = await db.functions.invoke('send-document-email', {
            body: {
                orgId: currentOrgId,
                recipientEmail: cust.email,
                subject,
                bodyText,
                pdfBase64,
                pdfFilename,
                senderName: currentOrgName || '',
                bccSelf: !!_sendSheetState.bccSelf,
                extraCc,
            },
        });
        if (fnError) throw fnError;
        if (!result || !result.success) throw new Error((result && result.error) || 'send failed');

        await recordDocumentSent(orderId, docType, 'email', result.id);
        const docLabel = docType === 'invoice' ? t('orders_doc_invoice') : t('orders_doc_delivery_note');
        logActivity('order', `${docLabel} ${docNumberLabel} ${t('log_doc_email_sent')} (${cust.email})`, orderId);
        closeModal();
        showInfo(t('send_success'));
    } catch (e) {
        console.error(e);
        showInfo(t('send_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

// ---- Мини-редактор email клиента (открывается по "изменить" в шите отправки) ----

function openEmailQuickEdit(custId) {
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;
    document.getElementById('emailQuickEditInput').value = cust.email || '';
    document.getElementById('emailQuickEditModal').dataset.custId = custId;
    document.getElementById('emailQuickEditModal').style.display = 'flex';
}

async function saveEmailQuickEdit() {
    const modal = document.getElementById('emailQuickEditModal');
    const custId = Number(modal.dataset.custId);
    const value = document.getElementById('emailQuickEditInput').value.trim();
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;

    suppressRealtimeFor3s();
    showLoading();
    try {
        await updateChecked(db.from('customers').update({ email: value || null }).eq('id', custId));
        cust.email = value || null;
        closeModal();
        if (_sendSheetState && _sendSheetState.custId === custId) {
            openSendDocumentSheet(_sendSheetState.orderId, _sendSheetState.docType);
        }
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}
