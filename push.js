// ==================== PUSH-УВЕДОМЛЕНИЯ ====================
// Подписка устройства на push (Web Push API) + настройки, какие типы
// уведомлений сотрудник хочет получать (таблицы push_subscriptions и
// notification_preferences, см. Supabase). Отправка самих уведомлений —
// отдельная Edge Function на сервере (см. документацию проекта), этот файл
// только подписывает/отписывает устройство и хранит предпочтения.
// Зависит от: db, currentOrgId, currentEmployee, showInfo, t (i18n.js).

// Публичный ключ VAPID — не секрет, безопасно хранить в клиентском коде.
// Приватная пара живёт только в секретах Supabase Edge Function.
const PUSH_VAPID_PUBLIC_KEY = 'BAj0Hpw2vFpBObn3cC6PTThGuIgG0PSunol_tMcEdEyCw-Lh8ZL_jclC-GLq1626UW7rmXBYV_t6pNfvHyaOBt4';

// Известные типы push-уведомлений — по мере добавления новых сценариев
// (склад, лимит заказов и т.п.) достаточно дописать сюда и в разметку
// #pushTypesList в index.html.
const PUSH_TYPES = ['new_order'];

function _pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

// Обновляет вид блока в Настройках под текущее состояние: поддерживается ли
// push вообще, есть ли уже активная подписка на этом устройстве, и какие
// типы уведомлений включены у текущего сотрудника.
async function refreshPushSettingsUI() {
    const block = document.getElementById('pushSettingsBlock');
    if (!block) return;
    block.classList.remove('hidden');

    if (!_pushSupported()) {
        document.getElementById('pushMasterToggleBtn').classList.add('hidden');
        document.getElementById('pushTypesList').classList.add('hidden');
        document.getElementById('pushUnsupportedNote').classList.remove('hidden');
        return;
    }

    let subscription = null;
    try {
        const reg = await navigator.serviceWorker.ready;
        subscription = await reg.pushManager.getSubscription();
    } catch (e) { /* игнорируем — просто считаем, что подписки нет */ }

    const isOn = !!subscription && Notification.permission === 'granted';
    _setPushMasterUI(isOn);

    if (isOn) await _loadNotificationPreferencesIntoUI();
}

function _setPushMasterUI(isOn) {
    const stateEl = document.getElementById('pushMasterToggleState');
    const listEl = document.getElementById('pushTypesList');
    const btnEl = document.getElementById('pushMasterToggleBtn');
    if (isOn) {
        stateEl.textContent = t('push_state_on');
        stateEl.style.color = '#4f6349';
        btnEl.classList.add('active');
        listEl.classList.remove('hidden');
    } else {
        stateEl.textContent = t('push_state_off');
        stateEl.style.color = '#a6a196';
        btnEl.classList.remove('active');
        listEl.classList.add('hidden');
    }
}

async function _loadNotificationPreferencesIntoUI() {
    if (!currentEmployee) return;
    const { data } = await db.from('notification_preferences')
        .select('type, enabled')
        .eq('employee_id', currentEmployee.id);
    const byType = {};
    (data || []).forEach(r => { byType[r.type] = r.enabled; });
    PUSH_TYPES.forEach(type => {
        const cb = document.getElementById('pushType_' + type);
        if (cb) cb.checked = byType[type] !== false; // нет записи — считаем включённым по умолчанию
    });
}

// Включает/выключает push целиком на этом устройстве.
async function togglePushMaster() {
    const btn = document.getElementById('pushMasterToggleBtn');
    const alreadyOn = btn.classList.contains('active');
    btn.disabled = true;
    try {
        if (alreadyOn) {
            await _disablePush();
        } else {
            await _enablePush();
        }
    } catch (e) {
        console.error('push toggle error:', e);
        showInfo(t('push_error'));
    } finally {
        btn.disabled = false;
        await refreshPushSettingsUI();
    }
}

async function _enablePush() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showInfo(t('push_permission_denied'));
        return;
    }

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
        subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
        });
    }

    const json = subscription.toJSON();
    const { error } = await db.from('push_subscriptions').upsert({
        org_id: currentOrgId,
        employee_id: currentEmployee.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent
    }, { onConflict: 'endpoint' });

    if (error) { console.error('push_subscriptions upsert error:', error); showInfo(t('push_error')); return; }
    showInfo(t('push_enabled_toast'));
}

async function _disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => {});
        await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
}

// Переключатель конкретного типа уведомлений (например "Новые заказы").
async function setNotificationPreference(type, enabled) {
    if (!currentEmployee || !currentOrgId) return;
    const { error } = await db.from('notification_preferences').upsert({
        org_id: currentOrgId,
        employee_id: currentEmployee.id,
        type,
        enabled
    }, { onConflict: 'employee_id,type' });
    if (error) console.error('notification_preferences upsert error:', error);
}
