<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/App.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
ini_set('display_errors','0');
ini_set('session.use_strict_mode','1');
session_name('cti_session');
session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off','httponly'=>true,'samesite'=>'Strict']);
session_start();

$body=$_POST;
if(str_starts_with(strtolower($_SERVER['CONTENT_TYPE']??''),'application/json')) {
    try {$decoded=json_decode(file_get_contents('php://input'),true,64,JSON_THROW_ON_ERROR);if(!is_array($decoded)||array_is_list($decoded)&&$decoded!==[]){throw new RuntimeException();}$body=$decoded;}
    catch(Throwable){http_response_code(400);header('Content-Type: application/json; charset=utf-8');echo json_encode(['message'=>'Corpo JSON invalido.']);exit;}
}
if((int)($_SERVER['CONTENT_LENGTH']??0)>7*1024*1024){http_response_code(413);header('Content-Type: application/json; charset=utf-8');echo json_encode(['message'=>'Envio maior que o limite permitido.']);exit;}
try {
    $app=\Cti\App::open();
    $response=$app->handle($_SERVER['REQUEST_METHOD'],parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH),$body,$_GET,$_FILES);
}catch(Throwable $e){error_log((string)$e);$response=['status'=>500,'body'=>['message'=>'Nao foi possivel acessar a plataforma.'],'headers'=>[]];}
http_response_code($response['status']);
foreach($response['headers'] as $name=>$value){header($name.': '.$value);}
if(isset($response['file'])){session_write_close();readfile($response['file']);}
elseif(isset($response['raw'])){echo $response['raw'];}
else{header('Content-Type: application/json; charset=utf-8');echo json_encode($response['body'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);}
