<?php
declare(strict_types=1);

require dirname(__DIR__).'/src/App.php';
require dirname(__DIR__).'/src/AnalysisWorker.php';

use Cti\App;
use Cti\AnalysisWorker;

$sample=$argv[1]??null;
if(!$sample || !is_file($sample)){fwrite(STDERR,"Uso: php tests/ai-end-to-end.php caminho/gravacao-portugues-pcm16.wav\n");exit(1);}
$storage=sys_get_temp_dir().'/cti-real-ai-'.bin2hex(random_bytes(6));
mkdir($storage,0700,true);
$app=new App(new PDO('sqlite::memory:'),$storage);
$app->initialize();
$pdo=$app->db();
$pdo->exec("UPDATE feedbacks SET analysis_status='not_required'");
$_SESSION=[];
$checks=0;
function check(bool $condition,string $message): void {global $checks;if(!$condition){throw new RuntimeException($message);}echo "PASS $message\n";$checks++;}
function request(string $method,string $route,array $body=[],array $files=[]): array {global $app;$_SERVER['HTTP_X_CSRF_TOKEN']=$_SESSION['csrf_token']??'';return $app->handle($method,$route,$body,[],$files);}
function login(string $email): void {request('GET','/api/session');$result=request('POST','/api/login',['email'=>$email,'password'=>'CtiDemo2026!']);if($result['status']!==200){throw new RuntimeException('Falha no login do teste.');}}
function feedback(array $body,array $files=[]): int {
    login('rafael@cti.demo');
    $ticket=request('POST','/api/tickets',['client_id'=>1,'subject'=>'Teste integrado de inteligencia artificial','channel'=>'Portal','priority'=>'medium'])['body']['data']['id'];
    request('POST',"/api/tickets/$ticket/solution",['solution'=>'Configuracao ajustada e conectividade restabelecida.']);
    login('lucas@cti.demo');
    $result=request('POST','/api/feedbacks',['ticket_id'=>$ticket,...$body],$files);
    check($result['status']===201 && $result['body']['data']['analysis_status']==='pending','Feedback persiste e entra na fila');
    return (int)$result['body']['data']['id'];
}
try {
    $worker=new AnalysisWorker($pdo,$storage);
    $positive=feedback(['rating'=>1,'resolved'=>true,'mode'=>'text','text'=>'Muito obrigado, o atendimento foi excelente e resolveu tudo.']);
    check($worker->processOne()['status']==='completed','Processo PHP executa modelo Node real');
    $result=$pdo->query("SELECT * FROM feedbacks WHERE id=$positive")->fetch();
    check($result['sentiment']==='positive' && (float)$result['confidence']>0 && $result['analysis_source']==='local_model','Texto positivo independe da nota baixa');
    $negative=feedback(['rating'=>5,'resolved'=>false,'mode'=>'text','text'=>'O atendimento foi horrivel. Ninguem resolveu e quero cancelar.']);
    check($worker->processOne()['status']==='completed','Segundo texto conclui sem baixar modelos novamente');
    $result=$pdo->query("SELECT * FROM feedbacks WHERE id=$negative")->fetch();
    check($result['sentiment']==='negative' && $result['criticality']==='critical','Texto negativo independe da nota alta');
    $audio=feedback(['rating'=>3,'resolved'=>true,'mode'=>'audio'],['audio'=>['name'=>'gravacao.wav','tmp_name'=>$sample,'error'=>0]]);
    check($worker->processOne()['status']==='completed','Fila executa transcricao real do audio privado');
    $result=$pdo->query("SELECT * FROM feedbacks WHERE id=$audio")->fetch();
    check(mb_strlen($result['transcript']??'')>10 && str_contains($result['transcription_model']??'','whisper'),'Transcricao e modelo ficam persistidos');
    $public=array_values(array_filter(request('GET','/api/bootstrap')['body']['data']['feedbacks'],fn($item)=>$item['id']===$audio))[0];
    check($public['transcript']===$result['transcript'] && $public['confidence']!==null && !isset($public['audio_path']),'Cliente recebe transcricao e score sem caminho privado');
    echo json_encode(['transcript'=>$result['transcript'],'sentiment'=>$result['sentiment'],'confidence'=>$public['confidence']],JSON_UNESCAPED_UNICODE)."\n";
    echo "$checks verificacoes reais de IA aprovadas.\n";
} finally {
    unset($worker,$app,$pdo);
    foreach(glob($storage.'/audio/*')?:[] as $file){unlink($file);}
    @rmdir($storage.'/audio');
    @rmdir($storage);
}
