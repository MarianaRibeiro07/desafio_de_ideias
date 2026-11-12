<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$failed = 0;
function check(bool $ok, string $label): void {
    global $failed;
    echo ($ok ? 'PASS ' : 'FAIL ') . $label . PHP_EOL;
    if (!$ok) { $failed++; }
}
function privateWritablePath(string $path, string $public, bool $directory): bool {
    $resolved = realpath($path);
    $parent = realpath(dirname($path));
    if ($resolved === false && $parent === false) { return false; }
    $target = $resolved !== false ? $resolved : $parent . DIRECTORY_SEPARATOR . basename($path);
    $web = rtrim($public, DIRECTORY_SEPARATOR);
    if (DIRECTORY_SEPARATOR === '\\') { $target = strtolower($target); $web = strtolower($web); }
    if ($target === $web || str_starts_with($target, $web . DIRECTORY_SEPARATOR)) { return false; }
    if ($resolved === false) { return is_dir($parent) && is_writable($parent); }
    return ($directory ? is_dir($resolved) : is_file($resolved)) && is_writable($resolved);
}

check(PHP_VERSION_ID >= 80200, 'PHP >= 8.2');
$sqlite = class_exists(PDO::class) && in_array('sqlite', PDO::getAvailableDrivers(), true);
check($sqlite, 'PDO SQLite disponivel');
$version = null;
if ($sqlite) {
    try {
        $memory = new PDO('sqlite::memory:');
        $version = $memory->query('SELECT sqlite_version()')->fetchColumn();
        unset($memory);
    } catch (Throwable) { $version = null; }
}
check(is_string($version) && version_compare($version, '3.35.0', '>='), 'SQLite >= 3.35 para RETURNING');
check(extension_loaded('mbstring'), 'Extensao mbstring');
check(extension_loaded('curl') && function_exists('curl_init'), 'Extensao curl');

$root = dirname(__DIR__);
$storage = getenv('CTI_STORAGE_PATH') ?: $root . '/storage';
$database = getenv('CTI_DB_PATH') ?: $storage . '/cti.sqlite';
$public = realpath($root . '/public');
check(is_string($public) && privateWritablePath($storage, $public, true), 'Storage privado e gravavel, ou pai gravavel');
check(is_string($public) && privateWritablePath($database, $public, false), 'Banco privado e gravavel, ou pai gravavel');
check(trim(getenv('CTI_GEMINI_API_KEY') ?: '') !== '', 'CTI_GEMINI_API_KEY configurada (valor oculto)');
check(getenv('CTI_ANALYSIS_PROVIDER') === 'gemini', 'CTI_ANALYSIS_PROVIDER=gemini');
$limit = getenv('CTI_GEMINI_MAX_REQUESTS');
check($limit === false || $limit === '' || ctype_digit($limit) && (int) $limit >= 1 && (int) $limit <= 1000, 'CTI_GEMINI_MAX_REQUESTS inteiro de 1 a 1000 (padrao 20)');
$model = getenv('CTI_GEMINI_MODEL') ?: 'gemini-3.5-flash-lite';
check((bool) preg_match('/^gemini-[a-z0-9.-]{1,100}$/D', $model), 'Modelo Gemini configurado (padrao gemini-3.5-flash-lite)');

echo PHP_EOL . 'Verificacao local: nenhuma chamada a API e nenhum arquivo de banco criado.' . PHP_EOL;
echo 'HTTPS, credenciais aceitas, cota e tempo da hospedagem exigem verificacao separada.' . PHP_EOL;
exit($failed ? 1 : 0);
