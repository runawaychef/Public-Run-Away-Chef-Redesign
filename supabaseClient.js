// ==================== ПОДКЛЮЧЕНИЕ К SUPABASE ====================
// Создаёт единый клиент базы данных (db), используемый во всём приложении.
// Обычный скрипт (без модулей) — переменная db доступна глобально.
// Подключать после SDK Supabase (cdn.jsdelivr.net/npm/@supabase/supabase-js),
// но до основного скрипта программы.

const SUPABASE_URL = 'https://jdvrygtgcrikkacepbjk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RjZ04wO0LIS6o8f4gR_FpQ_88trzlUA';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
