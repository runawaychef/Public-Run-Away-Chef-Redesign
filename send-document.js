// ==================== ОТПРАВКА ДОКУМЕНТА НА EMAIL (ВИЗУАЛ) ====================
// Пока только разметка и переключение состояний на клиенте. Реальная генерация
// PDF (переиспользуется freezeDocumentSnapshot из invoice.js), отправка через
// Edge Function/Resend и сохранение email клиента будут добавлены отдельным
// шагом — см. обсуждение в чате.

let _sendSheetState = null; // { orderId, custId, docType }

function _sendDocTemplate(docType, custName, orgName, orderNumLabel, sumLabel) {
    const docLabel = docType === 'invoice' ? t('orders_doc_invoice') : t('orders_doc_delivery_note');
    return t('send_body_template')
        .replace('{customer}', custName)
        .replace('{doc_label}', docLabel.toLowerCase())
        .replace('{order_number}', orderNumLabel)
        .replace('{sum}', sumLabel)
        .replace('{org_name}', orgName);
}

function _sendAttachmentName(docType, orderNumLabel) {
    const base = docType === 'invoice' ? t('send_attachment_base_invoice') : t('send_attachment_base_delivery');
    return `${base}_${orderNumLabel}.pdf`;
}

function openSendDocumentSheet(orderId, docType) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const cust = order.customer_id ? customers.find(c => c.id === order.customer_id) : null;
    _sendSheetState = { orderId, custId: cust ? cust.id : null, docType: docType || 'invoice' };

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
    } else {
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
            <p style="font-size:13px; color:#6b675d; margin:0 0 6px;">${t('send_body_label')}</p>
            <textarea id="sendEmailBody" rows="6" class="border p-2 rounded-xl table-text w-full resize-none" style="margin-bottom:8px;">${_sendDocTemplate(_sendSheetState.docType, custName, escapeHtml(currentOrgName || ''), orderNumLabel, sumLabel)}</textarea>
            <div class="send-attachment-row" style="margin-bottom:14px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b675d" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
                <span id="sendAttachmentName">${_sendAttachmentName(_sendSheetState.docType, orderNumLabel)}</span>
            </div>
            <button class="pill-btn w-full justify-center" onclick="submitSendDocument()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
                <span>${t('send_button')}</span>
            </button>`;
    }

    document.getElementById('sendDocumentSheet').style.display = 'flex';
}

function selectSendDocType(docType) {
    if (!_sendSheetState) return;
    _sendSheetState.docType = docType;
    const order = orders.find(o => o.id === _sendSheetState.orderId);
    const cust = customers.find(c => c.id === _sendSheetState.custId);
    if (!order || !cust) return;

    document.getElementById('sendDocTypeInvoice').classList.toggle('active', docType === 'invoice');
    document.getElementById('sendDocTypeDelivery').classList.toggle('active', docType === 'delivery_note');

    const orderNumLabel = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const sumLabel = formatMoney(orderGrandTotal(order));
    document.getElementById('sendEmailBody').value = _sendDocTemplate(docType, escapeHtml(order.customer || t('orders_no_customer')), escapeHtml(currentOrgName || ''), orderNumLabel, sumLabel);
    document.getElementById('sendAttachmentName').textContent = _sendAttachmentName(docType, orderNumLabel);
}

function submitSendDocument() {
    // Заглушка на этапе визуала — реальная отправка (генерация PDF через
    // freezeDocumentSnapshot + вызов Edge Function/Resend) подключится отдельно.
    showInfo(t('send_stub_notice'));
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
