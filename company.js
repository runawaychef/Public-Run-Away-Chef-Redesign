// ==================== ИНФОРМАЦИЯ О КОМПАНИИ ====================
// Карточка реквизитов организации: физ./юр. лицо, контакты, банковские
// реквизиты, валюта расчёта. Открывается из Настроек (только владелец).
// Зависит от: db (supabaseClient.js), currentOrgId, currentOrgName,
// currentOrgCurrency, currentOrgVatRate (employees.js), showLoading/hideLoading/showInfo,
// updateChecked (helpers.js),
// showAutosaveToast, updateHeaderOrgName (employees.js), logActivity.

let _companyEntityType = 'company'; // текущее выбранное значение в открытой карточке
let _cmpCurrentCountryCode = null;   // код текущей страны — для обновления подписи при смене языка
let _cmpCurrentCurrencyCode = null;  // код текущей валюты — аналогично

// Евро/доллар — по умолчанию, остальные — валюты русскоязычных стран
// (страны бывшего СССР; страны Прибалтики уже покрываются евро) + польский злотый.
const CURRENCY_OPTIONS = [
    { code: 'EUR', label: 'Евро (€)', labelEn: 'Euro (€)' },
    { code: 'USD', label: 'Доллар США ($)', labelEn: 'US Dollar ($)' },
    { code: 'PLN', label: 'Польский злотый (zł)', labelEn: 'Polish Zloty (zł)' },
    { code: 'RUB', label: 'Российский рубль (₽)', labelEn: 'Russian Ruble (₽)' },
    { code: 'BYN', label: 'Белорусский рубль (Br)', labelEn: 'Belarusian Ruble (Br)' },
    { code: 'KZT', label: 'Казахстанский тенге (₸)', labelEn: 'Kazakhstani Tenge (₸)' },
    { code: 'KGS', label: 'Киргизский сом (с)', labelEn: 'Kyrgyzstani Som (с)' },
    { code: 'UZS', label: 'Узбекский сум', labelEn: 'Uzbekistani Som' },
    { code: 'TJS', label: 'Таджикский сомони', labelEn: 'Tajikistani Somoni' },
    { code: 'TMT', label: 'Туркменский манат (m)', labelEn: 'Turkmenistani Manat (m)' },
    { code: 'AZN', label: 'Азербайджанский манат (₼)', labelEn: 'Azerbaijani Manat (₼)' },
    { code: 'AMD', label: 'Армянский драм (֏)', labelEn: 'Armenian Dram (֏)' },
    { code: 'GEL', label: 'Грузинский лари (₾)', labelEn: 'Georgian Lari (₾)' },
    { code: 'MDL', label: 'Молдавский лей (L)', labelEn: 'Moldovan Leu (L)' },
    { code: 'UAH', label: 'Украинская гривна (₴)', labelEn: 'Ukrainian Hryvnia (₴)' },
];

// Выбирает подпись на текущем языке приложения (i18n.js задаёт currentLang
// глобально) — используется и для валют, и для стран ниже.
function _localizedLabel(option) {
    return (typeof currentLang !== 'undefined' && currentLang === 'en' && option.labelEn) ? option.labelEn : option.label;
}

function currencyLabel(code) {
    const found = CURRENCY_OPTIONS.find(c => c.code === code);
    return found ? _localizedLabel(found) : code;
}

// ==================== СТРАНА (определяет валюту и ставку НДС по умолчанию) ====================
// Стартовый набор: несколько стран ЕС (первый рынок) + весь список русскоязычных
// стран бывшего СССР (обязательный охват). Ставки НДС актуальны на 2026 год и могут
// меняться — при выборе страны они лишь подставляются как отправная точка,
// после чего остаются полностью редактируемыми вручную (см. selectCountry()).
const COUNTRY_OPTIONS = [
    { code: 'LT', label: 'Литва', labelEn: 'Lithuania', currency: 'EUR', vatRate: 0.21 },
    { code: 'LV', label: 'Латвия', labelEn: 'Latvia', currency: 'EUR', vatRate: 0.21 },
    { code: 'EE', label: 'Эстония', labelEn: 'Estonia', currency: 'EUR', vatRate: 0.24 },
    { code: 'DE', label: 'Германия', labelEn: 'Germany', currency: 'EUR', vatRate: 0.19 },
    { code: 'PL', label: 'Польша', labelEn: 'Poland', currency: 'PLN', vatRate: 0.23 },
    { code: 'RU', label: 'Россия', labelEn: 'Russia', currency: 'RUB', vatRate: 0.22 },
    { code: 'BY', label: 'Беларусь', labelEn: 'Belarus', currency: 'BYN', vatRate: 0.20 },
    { code: 'KZ', label: 'Казахстан', labelEn: 'Kazakhstan', currency: 'KZT', vatRate: 0.16 },
    { code: 'KG', label: 'Киргизия', labelEn: 'Kyrgyzstan', currency: 'KGS', vatRate: 0.12 },
    { code: 'UZ', label: 'Узбекистан', labelEn: 'Uzbekistan', currency: 'UZS', vatRate: 0.12 },
    { code: 'TJ', label: 'Таджикистан', labelEn: 'Tajikistan', currency: 'TJS', vatRate: 0.14 },
    { code: 'TM', label: 'Туркменистан', labelEn: 'Turkmenistan', currency: 'TMT', vatRate: 0.15 },
    { code: 'AZ', label: 'Азербайджан', labelEn: 'Azerbaijan', currency: 'AZN', vatRate: 0.18 },
    { code: 'AM', label: 'Армения', labelEn: 'Armenia', currency: 'AMD', vatRate: 0.20 },
    { code: 'GE', label: 'Грузия', labelEn: 'Georgia', currency: 'GEL', vatRate: 0.18 },
    { code: 'MD', label: 'Молдова', labelEn: 'Moldova', currency: 'MDL', vatRate: 0.20 },
    { code: 'UA', label: 'Украина', labelEn: 'Ukraine', currency: 'UAH', vatRate: 0.20 },
    { code: 'GB', label: 'Великобритания', labelEn: 'United Kingdom', currency: 'GBP', vatRate: 0.20 },
    { code: 'AE', label: 'ОАЭ', labelEn: 'United Arab Emirates', currency: 'AED', vatRate: 0.05 },
    // США и Канада сознательно пока не добавлены: там не НДС, а другой по механике
    // налог (sales tax в США — без единой ставки, по штатам; GST/HST в Канаде —
    // федеральный + провинциальный). Слово "НДС"/"VAT" сейчас зашито ~в 20 местах
    // интерфейса, включая сам счёт-фактуру ("VAT INVOICE" и т.п.) — добавлять эти
    // страны нужно вместе с веткой терминологии (Sales Tax/Tax invoice), а не просто
    // строкой в этом списке. Сделать в течение 14-дневного окна тестирования.
];

// Подписи некоторых полей зависят от страны:
// — Литва: "Личный код" → "Номер свидетельства о деятельности" (individual activity)
// — Беларусь: и для юрлица, и для физлица/ИП основной идентификатор — единый
//   УНП (учётный номер плательщика), поэтому отдельное поле "Код НДС / PVM"
//   для Беларуси скрывается целиком (не дублируем один и тот же номер),
//   а "Рег. номер"/"Личный код" переименовываются в "УНП".
// Значение в БД (personal_code/reg_number/vat_code) при этом не меняется —
// меняются только подписи и видимость полей.
function updateCountrySpecificLabels() {
    const personalCodeLabelEl = document.getElementById('cmpPersonalCodeLabel');
    const regNumberLabelEl = document.getElementById('cmpRegNumberLabel');
    const vatCodeCompanyWrap = document.getElementById('cmpVatCodeCompanyWrap');
    const vatCodeCompanyLabelEl = document.getElementById('cmpVatCodeCompanyLabel');
    const vatCodeIndividualWrap = document.getElementById('cmpVatCodeIndividualWrap');
    const vatCodeIndividualLabelEl = document.getElementById('cmpVatCodeIndividualLabel');
    const bankAccountLabelEl = document.getElementById('cmpBankAccountLabel');
    const bankSwiftLabelEl = document.getElementById('cmpBankSwiftLabel');
    if (!personalCodeLabelEl) return;

    const isBY = _cmpCurrentCountryCode === 'BY';
    const isLT = _cmpCurrentCountryCode === 'LT';
    const isRU = _cmpCurrentCountryCode === 'RU';

    personalCodeLabelEl.textContent = isBY ? t('company_unp_label') : isRU ? t('company_inn_label') : isLT ? t('company_personal_code_label_lt') : t('company_personal_code_label');
    regNumberLabelEl.textContent = isBY ? t('company_unp_label') : isRU ? t('company_ogrn_label') : t('company_reg_number_label');
    vatCodeCompanyLabelEl.textContent = isRU ? t('company_inn_kpp_label') : t('company_vat_code_label');
    vatCodeIndividualLabelEl.textContent = isRU ? t('company_ogrnip_label') : t('company_vat_code_label');
    vatCodeCompanyWrap.classList.toggle('hidden', isBY);
    vatCodeIndividualWrap.classList.toggle('hidden', isBY);

    if (bankAccountLabelEl) bankAccountLabelEl.textContent = isRU ? t('company_bank_account_label_ru') : t('company_bank_account_label');
    if (bankSwiftLabelEl) bankSwiftLabelEl.textContent = isRU ? t('company_bank_swift_label_ru') : t('company_bank_swift_label');
}

// Прогрессивное раскрытие карточки компании: пока страна не выбрана ни разу
// (org.country ещё NULL в базе), показываем только "Название" и "Страна" —
// остальные поля появляются сразу после выбора страны. При всех следующих
// открытиях карточки (страна уже сохранена) форма сразу полная — состояние
// выводится из данных, отдельного флага в БД не заводим.
function updateProgressiveFieldsVisibility(hasCountry) {
    ['cmpProgressiveFields', 'cmpProgressiveFields2', 'cmpProgressiveFields3', 'cmpProgressiveFields4', 'cmpCompanyFields', 'cmpIndividualFields']
        .forEach(id => document.getElementById(id)?.classList.toggle('hidden', !hasCountry));
}

function countryLabel(code) {
    const found = COUNTRY_OPTIONS.find(c => c.code === code);
    if (found) return _localizedLabel(found);
    return (typeof t === 'function') ? t('company_country_not_specified') : 'Не указана';
}

function renderCurrencyDropdown() {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    dropdown.innerHTML = CURRENCY_OPTIONS.map(c =>
        `<div onclick="selectCurrency('${c.code}')" class="table-text px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer">${_localizedLabel(c)}</div>`
    ).join('');
}

function toggleCurrencyDropdown() {
    document.getElementById('cmpCurrencyDropdown').classList.toggle('hidden');
}

function selectCurrency(code) {
    _cmpCurrentCurrencyCode = code;
    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(code);
    document.getElementById('cmpCurrencyDropdown').classList.add('hidden');
    saveCompanyInfo('currency_code', code);
}

function renderCountryDropdown() {
    const dropdown = document.getElementById('cmpCountryDropdown');
    dropdown.innerHTML = COUNTRY_OPTIONS.map(c =>
        `<div onclick="selectCountry('${c.code}')" class="table-text px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer">${_localizedLabel(c)}</div>`
    ).join('');
}

function toggleCountryDropdown() {
    document.getElementById('cmpCountryDropdown').classList.toggle('hidden');
}

// Выбор страны: сохраняет саму страну и одновременно подставляет валюту
// и ставку НДС по умолчанию для неё. Оба поля остаются редактируемыми
// вручную сразу после этого — подстановка лишь отправная точка.
async function selectCountry(code) {
    const found = COUNTRY_OPTIONS.find(c => c.code === code);
    _cmpCurrentCountryCode = code;
    document.getElementById('cmpCountryLabel').textContent = countryLabel(code);
    document.getElementById('cmpCountryDropdown').classList.add('hidden');
    updateCountrySpecificLabels();
    updateProgressiveFieldsVisibility(true);

    if (!found) { await saveCompanyInfo('country', code); return; }

    _cmpCurrentCurrencyCode = found.currency;
    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(found.currency);
    document.getElementById('cmpVatRate').value = (found.vatRate * 100).toString();

    showLoading(t('common_saving'));
    try {
        await updateChecked(db.from('organizations')
            .update({ country: code, currency_code: found.currency, vat_rate: found.vatRate })
            .eq('id', currentOrgId));
        currentOrgCurrency = found.currency;
        currentOrgVatRate = found.vatRate;
        logActivity('system', `${t('log_country_changed')}: ${found.label}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_country'));
    } finally {
        hideLoading();
    }
}

// Ставка НДС хранится в базе как доля (0.21), а вводится пользователем в процентах (21).
function saveVatRatePercent(percentStr) {
    const pct = parseFloat(String(percentStr).replace(',', '.'));
    if (isNaN(pct) || pct < 0 || pct > 100) {
        showInfo('Ставка НДС должна быть числом от 0 до 100.');
        return;
    }
    saveCompanyInfo('vat_rate', pct / 100);
}

// Закрытие выпадающего списка валют по клику снаружи (как у фильтра заказов)
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    const btn = document.getElementById('cmpCurrencyBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

// Закрытие выпадающего списка стран по клику снаружи — тот же паттерн
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('cmpCountryDropdown');
    const btn = document.getElementById('cmpCountryBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

async function openCompanyInfoModal() {
    showLoading();
    try {
        const { data, error } = await db.from('organizations')
            .select('name, currency_code, country, vat_rate, entity_type, phone, email, address, legal_name, reg_number, vat_code, director_name, director_position, personal_code, bank_name, bank_account, bank_swift, logo_data_url, logo_on_documents')
            .eq('id', currentOrgId)
            .single();
        if (error) throw error;

        document.getElementById('cmpOrgName').value      = data.name || '';
        _cmpCurrentCountryCode = data.country || null;
        _cmpCurrentCurrencyCode = data.currency_code || 'EUR';
        renderCountryDropdown();
        document.getElementById('cmpCountryLabel').textContent = countryLabel(data.country);
        renderCurrencyDropdown();
        document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(data.currency_code || 'EUR');
        document.getElementById('cmpVatRate').value = data.vat_rate != null ? (Number(data.vat_rate) * 100).toString() : '0';
        document.getElementById('cmpPhone').value        = data.phone || '';
        document.getElementById('cmpEmail').value        = data.email || '';
        document.getElementById('cmpAddress').value      = data.address || '';
        document.getElementById('cmpLegalName').value    = data.legal_name || '';
        document.getElementById('cmpRegNumber').value    = data.reg_number || '';
        document.getElementById('cmpVatCode').value      = data.vat_code || '';
        document.getElementById('cmpDirectorName').value = data.director_name || '';
        document.getElementById('cmpDirectorPosition').value = data.director_position || '';
        document.getElementById('cmpPersonalCode').value = data.personal_code || '';
        document.getElementById('cmpVatCodeIndividual').value = data.vat_code || '';
        document.getElementById('cmpBankName').value     = data.bank_name || '';
        document.getElementById('cmpBankAccount').value  = data.bank_account || '';
        document.getElementById('cmpBankSwift').value    = data.bank_swift || '';
        updateCountrySpecificLabels();
        renderCompanyLogoUI(data.logo_data_url || '', !!data.logo_on_documents);
        updateProgressiveFieldsVisibility(!!data.country);

        setCompanyEntityType(data.entity_type || 'company', /*skipSave*/ true);
        document.getElementById('companyInfoModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo('Не удалось загрузить информацию о компании.');
    } finally {
        hideLoading();
    }
}

// Переключение Физ. лицо / Юр. лицо — показывает нужный блок полей
// и (если это не просто отрисовка при открытии) сохраняет выбор.
function setCompanyEntityType(type, skipSave) {
    _companyEntityType = type;
    const isCompany = type === 'company';

    document.getElementById('cmpCompanyFields').classList.toggle('hidden', !isCompany);
    document.getElementById('cmpIndividualFields').classList.toggle('hidden', isCompany);

    const companyBtn    = document.getElementById('cmpEntityCompanyBtn');
    const individualBtn = document.getElementById('cmpEntityIndividualBtn');
    companyBtn.classList.toggle('active', isCompany);
    individualBtn.classList.toggle('active', !isCompany);

    if (!skipSave) saveCompanyInfo('entity_type', type);
}

// Универсальное сохранение одного поля карточки компании.
async function saveCompanyInfo(field, value) {
    try {
        await updateChecked(db.from('organizations').update({ [field]: value }).eq('id', currentOrgId));

        // Локально обновляем то, что используется в остальном приложении
        if (field === 'name') {
            currentOrgName = value;
            updateHeaderOrgName();
        }
        if (field === 'currency_code') {
            currentOrgCurrency = value;
        }
        if (field === 'vat_rate') {
            currentOrgVatRate = Number(value);
        }

        logActivity('system', `${t('log_field_changed')} «${field}» ${t('log_in_company_info')}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    }
}

// Вызывается из setLang() (i18n.js), если окно "Информация о компании" открыто —
// подписи страны/валюты собираются в JS из COUNTRY_OPTIONS/CURRENCY_OPTIONS, поэтому
// applyI18n() (который работает только с data-i18n атрибутами) их не подхватывает.
function refreshCompanyLangDependentUI() {
    const countryLabelEl = document.getElementById('cmpCountryLabel');
    if (!countryLabelEl) return; // окно сейчас не открыто — нечего обновлять
    countryLabelEl.textContent = countryLabel(_cmpCurrentCountryCode);
    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(_cmpCurrentCurrencyCode);
    renderCountryDropdown();
    renderCurrencyDropdown();
    updateCountrySpecificLabels();
}

// ==================== ЛОГОТИП ДЛЯ ДОКУМЕНТОВ ====================
// Хранится как base64 прямо в organizations.logo_data_url (не в Storage —
// это единственная небольшая картинка на организацию, не список файлов).
// Итоговый файл всегда квадратный ~240×240px — независимо от того, что
// именно загрузил пользователь, за счёт кроп-инструмента ниже.

const LOGO_CROP_OUTPUT_SIZE = 400; // финальный размер сохранённого логотипа, px (увеличено под больший размер на документе)
const LOGO_CROP_CANVAS_SIZE = 260; // размер видимой рамки кроп-инструмента, px
const LOGO_MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 МБ — ограничение на входной файл

let _logoCropImg = null;
let _logoCropBaseScale = 1;   // масштаб, при котором картинка ровно закрывает рамку ("cover")
let _logoCropOffsetX = 0;
let _logoCropOffsetY = 0;
let _logoCropDragging = false;
let _logoCropLastX = 0;
let _logoCropLastY = 0;

// Отрисовывает превью в самой карточке "Информация о компании" (не в кроп-окне)
function renderCompanyLogoUI(dataUrl, onDocuments) {
    const img = document.getElementById('cmpLogoPreview');
    const placeholder = document.getElementById('cmpLogoPlaceholder');
    const removeBtn = document.getElementById('cmpLogoRemoveBtn');
    const checkbox = document.getElementById('cmpLogoOnDocuments');
    if (dataUrl) {
        img.src = dataUrl;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.classList.remove('hidden');
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.classList.add('hidden');
    }
    checkbox.checked = onDocuments;
    checkbox.disabled = !dataUrl;
}

function handleLogoFileSelected(input) {
    const file = input.files && input.files[0];
    input.value = ''; // чтобы повторный выбор того же файла тоже сработал
    if (!file) return;
    if (file.size > LOGO_MAX_UPLOAD_BYTES) {
        showInfo(t('company_logo_too_large'));
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => openLogoCropModal(img);
        img.onerror = () => showInfo(t('company_logo_load_error'));
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function openLogoCropModal(img) {
    _logoCropImg = img;
    const size = LOGO_CROP_CANVAS_SIZE;
    // "cover"-масштаб: минимальный, при котором картинка полностью закрывает квадрат рамки
    _logoCropBaseScale = Math.max(size / img.width, size / img.height);
    // стартуем по центру картинки
    _logoCropOffsetX = (size - img.width * _logoCropBaseScale) / 2;
    _logoCropOffsetY = (size - img.height * _logoCropBaseScale) / 2;
    document.getElementById('logoCropZoom').value = 100;
    drawLogoCropCanvas();
    document.getElementById('logoCropModal').style.display = 'flex';
}

function closeLogoCropModal() {
    document.getElementById('logoCropModal').style.display = 'none';
    _logoCropImg = null;
}

function currentLogoCropScale() {
    const zoomPct = Number(document.getElementById('logoCropZoom').value) || 100;
    return _logoCropBaseScale * (zoomPct / 100);
}

// Держит картинку так, чтобы она всегда полностью закрывала рамку — не даёт
// утащить её так, что по краям появится пустое место.
function clampLogoCropOffset() {
    const size = LOGO_CROP_CANVAS_SIZE;
    const scale = currentLogoCropScale();
    const w = _logoCropImg.width * scale;
    const h = _logoCropImg.height * scale;
    _logoCropOffsetX = Math.min(0, Math.max(size - w, _logoCropOffsetX));
    _logoCropOffsetY = Math.min(0, Math.max(size - h, _logoCropOffsetY));
}

function drawLogoCropCanvas() {
    if (!_logoCropImg) return;
    clampLogoCropOffset();
    const canvas = document.getElementById('logoCropCanvas');
    const ctx = canvas.getContext('2d');
    const scale = currentLogoCropScale();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(_logoCropImg, _logoCropOffsetX, _logoCropOffsetY, _logoCropImg.width * scale, _logoCropImg.height * scale);
}

(function initLogoCropInteractions() {
    document.addEventListener('DOMContentLoaded', () => {
        const canvas = document.getElementById('logoCropCanvas');
        const zoomSlider = document.getElementById('logoCropZoom');
        if (!canvas || !zoomSlider) return;

        canvas.addEventListener('pointerdown', (e) => {
            _logoCropDragging = true;
            _logoCropLastX = e.clientX;
            _logoCropLastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!_logoCropDragging) return;
            _logoCropOffsetX += e.clientX - _logoCropLastX;
            _logoCropOffsetY += e.clientY - _logoCropLastY;
            _logoCropLastX = e.clientX;
            _logoCropLastY = e.clientY;
            drawLogoCropCanvas();
        });
        const stopDrag = (e) => {
            _logoCropDragging = false;
            canvas.style.cursor = 'grab';
        };
        canvas.addEventListener('pointerup', stopDrag);
        canvas.addEventListener('pointercancel', stopDrag);
        canvas.addEventListener('pointerleave', stopDrag);

        zoomSlider.addEventListener('input', () => drawLogoCropCanvas());
    });
})();

async function applyLogoCrop() {
    if (!_logoCropImg) return;
    const out = document.createElement('canvas');
    out.width = LOGO_CROP_OUTPUT_SIZE;
    out.height = LOGO_CROP_OUTPUT_SIZE;
    const ctx = out.getContext('2d');
    const ratio = LOGO_CROP_OUTPUT_SIZE / LOGO_CROP_CANVAS_SIZE;
    const scale = currentLogoCropScale() * ratio;
    ctx.drawImage(_logoCropImg, _logoCropOffsetX * ratio, _logoCropOffsetY * ratio, _logoCropImg.width * scale, _logoCropImg.height * scale);
    const dataUrl = out.toDataURL('image/png');

    closeLogoCropModal();
    showLoading();
    try {
        await updateChecked(db.from('organizations').update({ logo_data_url: dataUrl, logo_on_documents: true }).eq('id', currentOrgId));
        renderCompanyLogoUI(dataUrl, true);
        logActivity('system', `${t('log_field_changed')} «${t('company_logo_label')}» ${t('log_in_company_info')}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}

async function removeCompanyLogo() {
    showLoading();
    try {
        await updateChecked(db.from('organizations').update({ logo_data_url: null, logo_on_documents: false }).eq('id', currentOrgId));
        renderCompanyLogoUI('', false);
        logActivity('system', `${t('log_field_changed')} «${t('company_logo_label')}» ${t('log_in_company_info')}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}

async function toggleLogoOnDocuments() {
    const checked = document.getElementById('cmpLogoOnDocuments').checked;
    try {
        await updateChecked(db.from('organizations').update({ logo_on_documents: checked }).eq('id', currentOrgId));
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    }
}
