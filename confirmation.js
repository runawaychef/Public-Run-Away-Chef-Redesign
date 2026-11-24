// ==================== «ПОДТВЕРЖДЕНИЕ ЗАКАЗА» (31.10.2026) ====================
// Режим пекарни «По заказу»: вместо счетов и накладных — простая бумага для клиента.
// НЕ налоговый документ: номер и дата — от самого заказа, без НДС и реквизитов оплаты, сам документ не хранится
// (строится по текущим данным заказа). С v945 при отправке запоминается ФАКТ отправки и снимок заказа
// (orders.confirmation_sent_at / confirmation_snapshot) — чтобы показать плашку «заказ изменён после отправки», как у счёта. Просмотр → «Поделиться (PDF)» / «Отправить на почту».
// Зависит от: orders, customers, _orderPaidTotals, calcTotals/_orderTotals (money.js), createPdfDoc/pdfSaveOrShare (helpers.js),
// tDoc (invoice.js), edge function send-document-email.

let _confState = null;

// Вход из карточки заказа и свайпа: в режиме «По счёту» — прежнее окно документов, иначе подтверждение
function openOrderDocAction(orderId) {
    if (typeof docsEnabled === 'function' && !docsEnabled()) return openOrderConfirmation(orderId);
    return openSendDocumentSheet(orderId);
}

function _confOrderNum(order) { return order.order_number ? String(order.order_number) : String(order.id); }

async function openOrderConfirmation(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    showLoading();
    let org;
    try {
        const { data, error } = await db.from('organizations').select('*').eq('id', currentOrgId).single();
        if (error) throw error;
        org = data;
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    const lang = currentLang;
    try { if (typeof ensureLangLoaded === 'function') await ensureLangLoaded(lang); } catch (e) { console.error(e); }
    // v954: что реально отправлено клиенту (снимок v945): после отправки подтверждение открывается ровно таким
    let sent = null;
    try {
        const r = await db.from('orders').select('confirmation_sent_at, confirmation_snapshot').eq('id', orderId).single();
        if (!r.error && r.data && r.data.confirmation_snapshot && Array.isArray(r.data.confirmation_snapshot.items)) sent = { at: r.data.confirmation_sent_at, snap: r.data.confirmation_snapshot };
    } catch (e) { console.error(e); }
    hideLoading();
    _confState = { orderId, org, lang, sent, live: false };
    openAppPage('orderConfPage');
    _renderOrderConf(); // _appPageOnShow срабатывает только при возврате на страницу, при открытии рисуем сами
}

function _confData() {
    const st = _confState;
    const order = orders.find(o => o.id === st.orderId);
    if (!order) return null;
    const cust = order.customer_id ? customers.find(c => c.id === order.customer_id) : null;
    // v954: после отправки позиции, цены, скидка, НДС и итог берутся из снимка отправленного (не меняются);
    // «оплачено / осталось» всегда на сегодня. Пока пользователь не нажал «Обновить подтверждение».
    const snap = (st.sent && !st.live) ? st.sent.snap : null;
    const vatRateNow = Number(typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0) || 0;
    let tot, srcItems, discountPct, vatExempt, vatRate;
    if (snap) {
        srcItems = snap.items;
        discountPct = Number(snap.discount) || 0;
        vatExempt = !!snap.vat_exempt;
        vatRate = snap.vat_rate != null ? (Number(snap.vat_rate) || 0) : vatRateNow;   // снимки v945 без ставки — текущая ставка
        tot = calcTotals(srcItems, snap.discount || 0, vatExempt, vatRate);
    } else {
        srcItems = orderBillItems(order);
        discountPct = Number(order.discount) || 0;
        vatExempt = orderVatExempt(order);
        vatRate = vatRateNow;
        tot = _orderTotals(order);
    }
    const paid = Number(_orderPaidTotals[order.id] || 0);
    const due = Math.max(0, Math.round((tot.grand - paid) * 100) / 100);
    // v940: сумма строки = количество × цена (до скидки и НДС) — читатель может проверить умножением;
    // скидка, «Итого без НДС» и НДС показываются отдельными строками ниже (как в карточке заказа).
    // Те же центы, что в calcTotals (money.js): сумма строк ровно равна tot.subtotal.
    const items = srcItems.map(it => ({
        product: it.product, quantity: it.quantity, price: it.price,
        sum: _roundCents(Math.max(0, (Number(it.quantity) || 0) * (Number(it.price) || 0)) * 100) / 100,
    }));
    const vatApplies = !vatExempt && vatRate > 0;
    return {
        vatApplies, vatPct: Math.round(vatRate * 10000) / 100, discountPct, snapUsed: !!snap,
        order, cust, items, tot, paid, due,
        num: _confOrderNum(order),
        date: (snap && snap.date) || order.date || order.order_date || '',
        clientName: cust ? cust.name : (order.customer || ''),
        sym: CURRENCY_SYMBOLS[st.org.currency_code] || st.org.currency_code || '€',
        org: st.org, lang: st.lang,
    };
}

function _confOrgLines(org) {
    return [org.address || '', [org.phone, org.email].filter(Boolean).join(' · ')].filter(Boolean);
}

function _confStatusText(d, lang) {
    if (d.tot.grand <= 0.005) return '';
    // v954: остаток считается на сегодня — подписываем датой, чтобы читатель понимал, на какой день цифра
    const asOf = ' (' + tDoc('conf_as_of', lang).replace('{date}', formatDateDMY(getLocalDateStr(0))) + ')';
    if (d.due <= 0.005) return tDoc('conf_paid', lang) + asOf;
    return (d.paid > 0.005 ? `${tDoc('conf_paid', lang)}: ${d.paid.toFixed(2)} ${d.sym} · ${tDoc('conf_to_pay', lang)}: ${d.due.toFixed(2)} ${d.sym}` : `${tDoc('conf_to_pay', lang)}: ${d.due.toFixed(2)} ${d.sym}`) + asOf;
}

// Строки под таблицей (экран и PDF): скидка → «Итого без НДС» → НДС; «Итого» печатается отдельно.
// Скидка и НДС округлены ОДИН раз на весь заказ (calcTotals), поэтому:
// сумма строк − скидка = итого без НДС, итого без НДС + НДС = итого — копейка в копейку.
function _confSummaryRows(d, L, money) {
    const rows = [];
    if (d.tot.discount > 0) {
        const pct = d.discountPct || 0;
        rows.push({ label: tDoc('conf_discount', L) + (pct > 0 ? ` (${String(Math.round(pct * 100) / 100)}%)` : ''), value: '−' + money(d.tot.discount) });
    }
    if (d.vatApplies) {
        rows.push({ label: tDoc('inv_total_no_vat', L), value: money(d.tot.net) });
        rows.push({ label: tDoc('inv_vat_sum', L) + (d.vatPct > 0 ? ` (${String(d.vatPct)}%)` : ''), value: money(d.tot.vat) });
    }
    return rows;
}

function _renderOrderConf() {
    const body = document.getElementById('orderConfBody');
    if (!body || !_confState) return;
    const d = _confData();
    if (!d) { body.innerHTML = ''; return; }
    const L = d.lang, org = d.org, esc = escapeHtml;
    const money = n => Number(n).toFixed(2) + ' ' + d.sym;
    const logo = (org.logo_on_documents && org.logo_data_url) ? `<img src="${org.logo_data_url}" style="width:44px;height:44px;border-radius:10px;object-fit:cover;">` : '';
    const rows = d.items.map(it => `<tr><td style="padding:5px 4px;border-bottom:1px solid #eee;">${esc(it.product || '')}</td><td style="text-align:center;border-bottom:1px solid #eee;">${esc(String(it.quantity))}</td><td style="text-align:right;border-bottom:1px solid #eee;">${it.price == null ? '—' : money(it.price)}</td><td style="text-align:right;border-bottom:1px solid #eee;">${money(it.sum)}</td></tr>`).join('');
    const status = _confStatusText(d, L);
    const unpaid = d.due > 0.005 && d.tot.grand > 0.005;
    const canMail = !!(d.cust && d.cust.email);
    // v954: плашка — отправленное подтверждение устарело (заказ изменён) / показана обновлённая версия
    let banner = '';
    const _bannerCss = 'background:#f8efd9;color:#8a6a1f;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;';
    if (_confState.sent && !_confState.live) {
        const chg = _confChangedInfo(d.order, _confState.sent.snap);
        if (!chg) banner = `<div style="background:#e3e8df;color:#4f6349;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;">✓ ${esc(t('conf_sent_banner').replace('{via}', typeof _sentViaLabel === 'function' ? _sentViaLabel(_confState.sent.snap && _confState.sent.snap.via) : '').replace('{dt}', typeof _docSumShortDT === 'function' ? _docSumShortDT(_confState.sent.at) : ''))}</div>`;
        else banner = `<div style="${_bannerCss}">${esc(t('conf_frozen_changed').replace('{dt}', typeof _docSumShortDT === 'function' ? _docSumShortDT(_confState.sent.at) : '').replace('{old}', formatMoney(chg.old)).replace('{new}', formatMoney(chg.cur)))}<button type="button" class="pill-btn-secondary w-full justify-center" style="margin-top:8px;" onclick="confRefresh()"><span>${esc(t('conf_update_btn'))}</span></button></div>`;
    } else if (_confState.sent && _confState.live) {
        banner = `<div style="${_bannerCss}">${esc(t('conf_updated_note'))}</div>`;
    }
    body.innerHTML = banner + `
        <div style="background:#fff;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.15);padding:18px 16px;font-size:12px;color:#333;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div><div style="font-size:15px;font-weight:700;">${esc(org.legal_name || org.name || '')}</div><div style="color:#666;margin-top:2px;">${_confOrgLines(org).map(esc).join('<br>')}</div></div>${logo}
            </div>
            <div style="margin:16px 0 4px;font-size:16px;font-weight:700;text-align:center;">${esc(tDoc('conf_title', L))} № ${esc(d.num)}</div>
            <div style="text-align:center;color:#666;margin-bottom:12px;">${esc(tDoc('conf_order_date', L))}: ${esc(formatDateDMY(d.date))}</div>
            ${d.clientName ? `<div style="margin-bottom:10px;"><span style="color:#888;">${esc(tDoc('conf_client', L))}:</span> ${esc(d.clientName)}</div>` : ''}
            <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#e3e8df;"><th style="text-align:left;padding:5px 4px;">${esc(tDoc('inv_col_name', L))}</th><th>${esc(tDoc('inv_col_qty', L))}</th><th style="text-align:right;">${esc(tDoc(d.vatApplies ? 'inv_col_price_no_vat' : 'inv_col_price', L))}</th><th style="text-align:right;">${esc(tDoc(d.vatApplies ? 'inv_col_sum_no_vat' : 'inv_col_sum', L))}</th></tr></thead><tbody>${rows}</tbody></table>
            ${_confSummaryRows(d, L, money).map((r, i) => `<div style="text-align:right;margin-top:${i === 0 ? 8 : 2}px;color:#666;">${esc(r.label)}: ${esc(r.value)}</div>`).join('')}
            <div style="text-align:right;margin-top:8px;font-size:14px;font-weight:700;">${esc(tDoc('conf_total', L))}: ${money(d.tot.grand)}</div>
            ${status ? `<div style="text-align:right;margin-top:2px;color:${unpaid ? '#a3493d' : '#4f6349'};">${esc(status)}</div>` : ''}
            <div style="margin-top:18px;font-size:10.5px;color:#999;border-top:1px solid #eee;padding-top:8px;">${esc(tDoc('conf_note', L))}</div>
        </div>
        <button id="orderConfShareBtn" class="pill-btn w-full justify-center" style="margin-top:12px;" onclick="shareOrderConfirmation()"><span>${esc(t('conf_share_btn'))}</span></button>
        ${canMail ? `<button id="orderConfMailBtn" class="pill-btn-secondary w-full justify-center" style="margin-top:8px;" onclick="emailOrderConfirmation()"><span>${esc(t('send_email_btn'))}</span></button>
        <div style="font-size:12px;color:#888;text-align:center;margin-top:6px;">${esc(d.cust.email)}</div>` : ''}
        <button id="orderConfSaveBtn" class="pill-btn-secondary w-full justify-center" style="margin-top:${canMail ? 12 : 8}px;" onclick="saveOrderConfirmationPdf()"><span>${esc(t('conf_save_btn'))}</span></button>`;
}

// v954: изменился ли заказ с момента отправки подтверждения → { old, cur } или null (те же признаки, что у плашки оплаты)
function _confChangedInfo(order, snap) {
    try {
        const cur = orderGrandTotal(order);
        let chg = Math.abs(Number(snap.total) - cur) > 0.004;
        if (!chg) chg = _docItemsSig(orderBillItems(order)) !== _docItemsSig(snap.items)
            || Math.round((Number(order.discount) || 0) * 100) !== Math.round((Number(snap.discount) || 0) * 100)
            || !!(snap.date && order.date && String(snap.date) !== String(order.date));
        return chg ? { old: Number(snap.total), cur } : null;
    } catch (e) { console.error(e); return null; }
}

// v954: «Обновить подтверждение» — показать версию по текущему заказу (номер прежний); клиенту она уйдёт только при отправке
function confRefresh() {
    const st = _confState; if (!st || !st.sent) return;
    const order = orders.find(o => o.id === st.orderId); if (!order) return;
    const chg = _confChangedInfo(order, st.sent.snap);
    st.live = true;
    logActivity('order', t('conf_updated_log').replace('{n}', _confOrderNum(order)).replace('{old}', formatMoney(chg ? chg.old : Number(st.sent.snap.total))).replace('{new}', formatMoney(orderGrandTotal(order))), order.id);
    _renderOrderConf();
}
(window._appPageOnShow = window._appPageOnShow || {}).orderConfPage = () => _renderOrderConf();

async function _buildConfPdf(d) {
    const L = d.lang, org = d.org;
    const pdf = await createPdfDoc();
    const pageW = pdf.internal.pageSize.getWidth();
    const mx = 14;
    const money = n => Number(n).toFixed(2) + ' ' + d.sym;
    let textX = mx, y = 18;
    if (org.logo_on_documents && org.logo_data_url) {
        try {
            const fmt = org.logo_data_url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            pdf.addImage(org.logo_data_url, fmt, pageW - mx - 22, 8, 22, 22);
        } catch (e) { console.error('logo', e); }
    }
    pdf.setFontSize(14); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(org.legal_name || org.name || '', textX, y, { maxWidth: pageW - mx * 2 - 26 });
    pdf.setFontSize(9.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    y += 6;
    _confOrgLines(org).forEach(line => { pdf.text(line, textX, y, { maxWidth: pageW - mx * 2 - 26 }); y += 4.5; });
    y = Math.max(y, 34) + 8;
    pdf.setFontSize(17); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(`${tDoc('conf_title', L)} № ${d.num}`, pageW / 2, y, { align: 'center' });
    y += 7;
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    pdf.text(`${tDoc('conf_order_date', L)}: ${formatDateDMY(d.date)}`, pageW / 2, y, { align: 'center' });
    y += 9;
    if (d.clientName) {
        pdf.setFontSize(10.5); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(`${tDoc('conf_client', L)}:`, mx, y);
        pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
        pdf.text(d.clientName, mx + pdf.getTextWidth(`${tDoc('conf_client', L)}: `) + 1, y, { maxWidth: pageW - mx * 2 - 30 });
        y += 7;
    }
    pdf.autoTable({
        startY: y,
        margin: { left: mx, right: mx },
        head: [[tDoc('inv_col_name', L), tDoc('inv_col_qty', L), tDoc(d.vatApplies ? 'inv_col_price_no_vat' : 'inv_col_price', L), tDoc(d.vatApplies ? 'inv_col_sum_no_vat' : 'inv_col_sum', L)]],
        body: d.items.map(it => [it.product || '', String(it.quantity), it.price == null ? '—' : money(it.price), money(it.sum)]),
        headStyles: { ...PDF_TABLE_HEAD_STYLE, fontSize: 9 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        styles: { fontSize: 9, cellPadding: 2.2, font: 'Roboto' },
    });
    y = pdf.lastAutoTable.finalY + 8;
    const right = pageW - mx;
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    _confSummaryRows(d, L, money).forEach(r => { pdf.text(`${r.label}: ${r.value}`, right, y, { align: 'right' }); y += 5.5; });
    pdf.setFontSize(13); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(`${tDoc('conf_total', L)}: ${money(d.tot.grand)}`, right, y, { align: 'right' }); y += 6;
    const status = _confStatusText(d, L);
    if (status) {
        const unpaid = d.due > 0.005;
        pdf.setFontSize(10.5); pdf.setFont('Roboto', 'normal');
        pdf.setTextColor(...(unpaid ? PDF_COLORS.terracotta : PDF_COLORS.sageDark));
        pdf.text(status, right, y, { align: 'right' }); y += 6;
    }
    y += 12;
    pdf.setFontSize(8.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(150, 150, 150);
    pdf.text(pdf.splitTextToSize(tDoc('conf_note', L), pageW - mx * 2), mx, y);
    return pdf;
}

// v945: запоминаем отправку подтверждения и состояние заказа на этот момент (ошибка записи отправку не ломает)
// v954: в снимок добавлена ставка НДС (vat_rate) — чтобы отправленное подтверждение не менялось при смене ставки;
// snapOverride — если клиенту ушла прежняя (замороженная) версия, запоминаем именно её, а не текущий заказ
function _confSnapNow(order) {
    const s = (typeof _payOrderSnap === 'function' ? _payOrderSnap(order) : null) || {};
    s.vat_rate = Number(typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0) || 0;
    return s;
}
async function _confMarkSent(order, via, snapOverride) {
    try {
        const snap = Object.assign({}, snapOverride || _confSnapNow(order), { via });
        const at = new Date().toISOString();
        await updateChecked(db.from('orders').update({ confirmation_sent_at: at, confirmation_snapshot: snap }).eq('id', order.id));
        _docSumSnaps[order.id] = Object.assign(_docSumSnaps[order.id] || {}, { conf: { at, snap } });
        if (_confState && _confState.orderId === order.id) { _confState.sent = { at, snap }; _confState.live = false; }
        delete _docChgState[order.id];
        if (order.id === currentOrderId && typeof renderDetailDocSummary === 'function') renderDetailDocSummary(order);
    } catch (e) { console.error('Подтверждение: факт отправки не записан', e); }
}

function _confFilename(d) { return `order_confirmation_${d.num}.pdf`; }

// v954: меню «Поделиться». Закрыл меню, ничего не выбрав, — ничего не происходит (раньше файл молча скачивался).
// Меню недоступно (например, компьютер) — файл сохраняется, но отправкой это НЕ считается.
async function _confSharePdf(pdf, filename) {
    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') return false;
        }
    }
    pdf.save(filename);
    await showInfo(`${t('common_done')}: ${t('backup_file_saved_prefix')} «${filename}» ${t('backup_file_saved_suffix')}.`);
    return false;
}

// v954: «Сохранить PDF» — файл на устройство, БЕЗ отметки «отправлено»
async function saveOrderConfirmationPdf() {
    const d = _confData(); if (!d) return;
    const btn = document.getElementById('orderConfSaveBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));
    try {
        const pdf = await _buildConfPdf(d);
        pdf.save(_confFilename(d));
        hideLoading();
        await showInfo(`${t('common_done')}: ${t('backup_file_saved_prefix')} «${_confFilename(d)}» ${t('backup_file_saved_suffix')}.`);
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')) + t('customers_pdf_error_suffix'));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

async function shareOrderConfirmation() {
    const d = _confData(); if (!d) return;
    const btn = document.getElementById('orderConfShareBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));
    try {
        const pdf = await _buildConfPdf(d);
        const shared = await _confSharePdf(pdf, _confFilename(d));
        if (shared) {
            logActivity('order', `${tDoc('conf_title', d.lang)} №${d.num} ${t('log_doc_shared')}`, d.order.id);
            await _confMarkSent(d.order, 'share', d.snapUsed ? _confState.sent.snap : null);
            if (typeof _renderOrderConf === 'function') _renderOrderConf();
        }
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')) + t('customers_pdf_error_suffix'));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

async function emailOrderConfirmation() {
    const d = _confData(); if (!d || !d.cust || !d.cust.email) return;
    const btn = document.getElementById('orderConfMailBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));
    try {
        const pdf = await _buildConfPdf(d);
        const b64 = pdf.output('datauristring').split(',')[1];
        const orgName = currentOrgName || d.org.name || '';
        const subject = tDoc('conf_email_subject', d.lang).replace('{n}', d.num).replace('{org}', orgName);
        const bodyText = tDoc('conf_email_body', d.lang).replace('{name}', d.clientName).replace('{n}', d.num).replace('{org}', orgName);
        const payload = {
            orgId: currentOrgId, recipientEmail: d.cust.email, subject, bodyText,
            senderName: orgName, bccSelf: !!currentOrgBccSelf, extraCc: [],
            pdfBase64: b64, pdfFilename: _confFilename(d),
        };
        const { data: result, error: fnError } = await db.functions.invoke('send-document-email', { body: payload });
        if (fnError) throw fnError;
        if (result && !result.success && result.code) { showInfo(typeof _sendLimitMessage === 'function' ? _sendLimitMessage(result) : t('send_error_prefix')); return; }
        if (!result || !result.success) throw new Error((result && result.error) || 'send failed');
        logActivity('order', `${tDoc('conf_title', d.lang)} №${d.num} ${t('log_doc_email_sent')} (${d.cust.email})`, d.order.id);
        await _confMarkSent(d.order, 'email', d.snapUsed ? _confState.sent.snap : null);
        if (typeof _renderOrderConf === 'function') _renderOrderConf();
        showInfo(t('send_success'));
    } catch (e) {
        console.error(e);
        showInfo(t('send_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}
