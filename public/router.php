<?php
declare(strict_types=1);

$path=rawurldecode(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)?:'/');
if(str_contains($path,"\0")||str_contains($path,'\\')||preg_match('#(^|/)\.#',$path)) {http_response_code(404);exit;}
if($path==='/api'||str_starts_with($path,'/api/')) {require __DIR__.'/api.php';return true;}
$file=realpath(__DIR__.$path);
if($file&&str_starts_with($file,__DIR__.DIRECTORY_SEPARATOR)&&is_file($file)&&!str_ends_with(strtolower($file),'.php')) {
    $ext=strtolower(pathinfo($file,PATHINFO_EXTENSION));
    $types=['css'=>'text/css; charset=utf-8','js'=>'text/javascript; charset=utf-8','svg'=>'image/svg+xml','png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','woff2'=>'font/woff2','ttf'=>'font/ttf','txt'=>'text/plain; charset=utf-8','ico'=>'image/x-icon'];
    if(isset($types[$ext])){header('Content-Type: '.$types[$ext]);header('X-Content-Type-Options: nosniff');readfile($file);return true;}
}
if($path!=='/'&&pathinfo($path,PATHINFO_EXTENSION)!==''){http_response_code(404);exit;}
header('X-Content-Type-Options: nosniff');header('X-Frame-Options: DENY');header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__.(rtrim($path,'/')==='/clientes'?'/clientes/index.html':'/index.html'));return true;
