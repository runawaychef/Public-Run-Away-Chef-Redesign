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
];

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
        logActivity('system', `Изменена страна в информации о компании: ${found.label}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сохранить страну. Проверьте подключение.');
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
            .select('name, currency_code, country, vat_rate, entity_type, phone, email, address, legal_name, reg_number, vat_code, director_name, personal_code, bank_name, bank_account, bank_swift')
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
        document.getElementById('cmpVatRate').value = data.vat_rate != null ? (Number(data.vat_rate) * 100).toString() : '21';
        document.getElementById('cmpPhone').value        = data.phone || '';
        document.getElementById('cmpEmail').value        = data.email || '';
        document.getElementById('cmpAddress').value      = data.address || '';
        document.getElementById('cmpLegalName').value    = data.legal_name || '';
        document.getElementById('cmpRegNumber').value    = data.reg_number || '';
        document.getElementById('cmpVatCode').value      = data.vat_code || '';
        document.getElementById('cmpDirectorName').value = data.director_name || '';
        document.getElementById('cmpPersonalCode').value = data.personal_code || '';
        document.getElementById('cmpBankName').value     = data.bank_name || '';
        document.getElementById('cmpBankAccount').value  = data.bank_account || '';
        document.getElementById('cmpBankSwift').value    = data.bank_swift || '';

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

        logActivity('system', `Изменено поле «${field}» в информации о компании`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сохранить изменение. Проверьте подключение.');
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
}
