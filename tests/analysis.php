<?php
declare(strict_types=1);

require dirname(__DIR__).'/src/App.php';

use Cti\App;
use Cti\AnalysisWorker;

$storage=sys_get_temp_dir().'/cti-analysis-'.bin2hex(random_bytes(6));
mkdir($storage,0700,true);
$app=new App(new PDO('sqlite::memory:'),$storage);
$app->initialize();
$pdo=$app->db();
$_SESSION=[];
$checks=0;
function check(bool $ok,string $message): void {global $checks;if(!$ok){throw new RuntimeException($message);}echo "PASS $message\n";$checks++;}
function request(string $method,string $path,array $body=[]): array {global $app;$_SERVER['HTTP_X_CSRF_TOKEN']=$_SESSION['csrf_token']??'';return $app->handle($method,$path,$body);}
function signIn(string $email): void {request('GET','/api/session');$r=request('POST','/api/login',['email'=>$email,'password'=>'CtiDemo2026!']);if($r['status']!==200){throw new RuntimeException('Falha login teste');}}
function pendingFeedback(string $mode='text',bool $resolved=true,int $rating=5): int {
    global $pdo;
    signIn('rafael@cti.demo');
    $r=request('POST','/api/tickets',['client_id'=>1,'subject'=>'Teste de analise automatica VPN','channel'=>'Portal','response_due_at'=>gmdate('Y-m-d\TH:i:s\Z',time()+3600)]);
    $id=$r['body']['data']['id'];
    request('POST',"/api/tickets/$id/solution",['solution'=>'Rota reconfigurada e conectividade validada.']);
    signIn('lucas@cti.demo');
    $r=request('POST','/api/feedbacks',['ticket_id'=>$id,'rating'=>$rating,'resolved'=>$resolved,'mode'=>$mode,'text'=>$mode==='text'?'Gostei muito do atendimento e da rapidez.':'']);
    if($r['status']!==201){throw new RuntimeException('Falha feedback teste '.json_encode($r));}
    return (int)$r['body']['data']['id'];
}
try {
    $id=pendingFeedback();
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$id")->fetch();
    check(($row['analysis_status']??null)==='pending' && $row['sentiment']==='pending','Texto entra na fila sem inventar sentimento pela nota');
    require dirname(__DIR__).'/src/AnalysisWorker.php';
    $pdo->exec("UPDATE feedbacks SET analysis_status='not_required' WHERE id<>$id");
    $calls=0;
    $runner=function(array $input) use (&$calls): array {$calls++;check($input['text']==='Gostei muito do atendimento e da rapidez.' && $input['audio_path']===null,'Worker recebe somente conteudo privado necessario');return ['transcript'=>null,'sentiment'=>'positive','confidence'=>0.93,'summary'=>'Cliente elogia a rapidez.','topics'=>['Atendimento'],'evidence'=>['Gostei muito'],'criticality'=>'regular','model'=>'teste-local','transcription_model'=>null];};
    $worker=new AnalysisWorker($pdo,$storage,$runner);
    check($worker->processOne()['status']==='completed','Worker conclui job pendente');
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$id")->fetch();
    check($row['sentiment']==='positive' && abs((float)$row['confidence']-.93)<.0001 && $row['analysis_source']==='local_model','Resultado do modelo e score sao persistidos');
    check($worker->processOne()===null && $calls===1,'Job concluido nao executa duas vezes');
    $public=array_values(array_filter(request('GET','/api/bootstrap')['body']['data']['feedbacks'],fn($f)=>$f['id']===$id))[0];
    check($public['topics']===['Atendimento'] && $public['evidence']===['Gostei muito'] && !array_key_exists('audio_path',$public),'API publica arrays e esconde caminho privado');
    $negative=pendingFeedback('text',false);
    $worker->processOne();
    check($pdo->query("SELECT criticality FROM feedbacks WHERE id=$negative")->fetchColumn()==='critical','Negativa de resolucao continua critica apesar de modelo regular');
    $reviewed=pendingFeedback();
    signIn('marina@cti.demo');
    check(request('POST',"/api/feedbacks/$reviewed/review",['sentiment'=>'negative','criticality'=>'critical','justification'=>'A supervisao confirmou impacto no cliente.','action'=>'Investigar o ocorrido com a equipe.'])['status']===200,'Revisao humana pode ocorrer durante a fila');
    $worker->processOne();
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$reviewed")->fetch();
    check($row['sentiment']==='negative' && $row['criticality']==='critical' && $row['original_sentiment']==='positive','IA preserva revisao humana e registra analise original separada');
    $report=$app->handle('GET','/api/reports',[],['q'=>'Teste de analise automatica VPN'])['body']['data'];
    check(($report['teams'][0]['analyzed']??null)===3,'Comparacao de equipes conta somente sentimentos disponiveis');
    check(($report['teams'][0]['critical_resolved']??null)===1,'Criticos resolvidos cruzam criticidade com resolucao confirmada');
    $pdo->exec("UPDATE tickets SET created_at='2020-01-01T00:00:00+00:00' WHERE id=(SELECT ticket_id FROM feedbacks WHERE id=$reviewed)");
    $dated=$app->handle('GET','/api/reports',[],['q'=>'Teste de analise automatica VPN','from'=>gmdate('Y-m-d')])['body']['data'];
    check(($dated['teams'][0]['critical_resolved']??null)===1,'Critico recebido hoje considera ticket antigo resolvido');
    $failed=pendingFeedback();
    $broken=new AnalysisWorker($pdo,$storage,fn()=>throw new RuntimeException('segredo caminho C:/privado/audio.wav'));
    check($broken->processOne()['status']==='failed','Falha do motor preserva feedback e registra estado');
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$failed")->fetch();
    check($row['text']!==null && !str_contains($row['analysis_error'],'segredo'),'Falha publica nao expoe detalhe tecnico nem perde conteudo');
    check(request('POST',"/api/feedbacks/$failed/retry-analysis")['status']===403,'Cliente nao pode reenfileirar analise');
    signIn('diego@cti.demo');
    check(request('POST',"/api/feedbacks/$failed/retry-analysis")['status']===403,'Supervisor de outra equipe nao reenfileira');
    signIn('marina@cti.demo');
    $_SERVER['HTTP_X_CSRF_TOKEN']='incorreto';
    check($app->handle('POST',"/api/feedbacks/$failed/retry-analysis")['status']===419,'Nova tentativa exige CSRF');
    check(request('POST',"/api/feedbacks/$failed/retry-analysis")['status']===200,'Supervisor da equipe pode reenfileirar falha');
    check(request('POST',"/api/feedbacks/$failed/retry-analysis")['status']===409,'Fila pendente nao admite novo reenfileiramento');
    $worker->processOne();
    check((int)$pdo->query("SELECT analysis_attempts FROM feedbacks WHERE id=$failed")->fetchColumn()===2,'Nova tentativa preserva contagem');
    $retained=pendingFeedback();
    $pdo->exec("UPDATE feedbacks SET created_at='2020-01-01T00:00:00+00:00',transcript='conteudo falado',topics='[\"privado\"]',evidence='[\"privado\"]',original_summary='privado',analysis_error='privado' WHERE id=$retained");
    $app->maintenance();
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$retained")->fetch();
    check($row['transcript']===null && $row['topics']===null && $row['evidence']===null && $row['original_summary']===null && $row['analysis_error']===null,'Retencao apaga transcricao e derivados');
    check($worker->processOne()===null,'Feedback removido pela retencao nao entra no motor');
    $quick=pendingFeedback('quick',false,1);
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$quick")->fetch();
    check($row['analysis_status']==='not_required' && $row['analysis_source']==='rating' && $row['confidence']===null,'Avaliacao rapida usa nota sem fingir inferencia');
    check($row['original_sentiment']==='negative' && $row['original_criticality']==='critical' && $row['original_summary']!==null,'Avaliacao rapida preserva classificacao original por nota');
    signIn('marina@cti.demo');
    request('POST',"/api/feedbacks/$quick/review",['sentiment'=>'neutral','criticality'=>'regular','justification'=>'A supervisao confirmou o contexto da nota.','action'=>'Acompanhar o retorno do cliente.']);
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$quick")->fetch();
    check($row['sentiment']==='neutral' && $row['criticality']==='regular' && $row['original_sentiment']==='negative' && $row['original_criticality']==='critical','Revisao humana nao apaga classificacao original da nota');
    $pdo->exec("UPDATE feedbacks SET original_sentiment=NULL,original_criticality=NULL,original_summary=NULL WHERE id=$quick");
    $app->initialize();
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$quick")->fetch();
    check($row['sentiment']==='neutral' && $row['original_sentiment']==='negative' && $row['original_criticality']==='critical' && $row['analysis_source']==='rating','Migration recupera origem da nota sem sobrescrever revisao');
    $audio=pendingFeedback();
    mkdir($storage.'/audio',0700,true);
    file_put_contents($storage.'/audio/teste.wav','gravacao de teste do contrato');
    $pdo->exec("UPDATE feedbacks SET mode='audio',text=NULL,audio_path='teste.wav' WHERE id=$audio");
    $audioWorker=new AnalysisWorker($pdo,$storage,function(array $input) use ($storage): array {
        check($input['text']===null && $input['audio_path']===realpath($storage.'/audio/teste.wav'),'Motor recebe WAV privado por caminho validado');
        return ['transcript'=>'A conexao agora funciona bem.','sentiment'=>'positive','confidence'=>.89,'summary'=>'Cliente confirma funcionamento.','topics'=>['Conexao'],'evidence'=>['funciona bem'],'criticality'=>'regular','model'=>'teste-local','transcription_model'=>'whisper-teste'];
    });
    check($audioWorker->processOne()['status']==='completed','Audio passa pela transcricao e classificacao');
    $row=$pdo->query("SELECT * FROM feedbacks WHERE id=$audio")->fetch();
    check($row['transcript']==='A conexao agora funciona bem.' && $row['transcription_model']==='whisper-teste','Transcricao e modelo sao armazenados');
    $lost=pendingFeedback();
    $pdo->exec("UPDATE feedbacks SET mode='audio',text=NULL,audio_path='../segredo.wav' WHERE id=$lost");
    check($audioWorker->processOne()['status']==='failed','Caminho de audio invalido falha sem acessar arquivo externo');
    $stale=pendingFeedback();
    $pdo->exec("UPDATE feedbacks SET analysis_status='processing',analysis_started_at='2020-01-01T00:00:00+00:00' WHERE id=$stale");
    check($worker->processOne()===null && $pdo->query("SELECT analysis_status FROM feedbacks WHERE id=$stale")->fetchColumn()==='failed','Worker abandonado vira falha recuperavel');
    $during=pendingFeedback();
    $discardWorker=new AnalysisWorker($pdo,$storage,function(array $input) use ($pdo,$during,$app): array {
        $pdo->exec("UPDATE feedbacks SET created_at='2020-01-01T00:00:00+00:00' WHERE id=$during");
        $app->maintenance();
        return ['sentiment'=>'positive','confidence'=>.8,'summary'=>'Conteudo que nao deve retornar.','topics'=>[],'evidence'=>[],'criticality'=>'regular','model'=>'teste-local'];
    });
    check($discardWorker->processOne()['status']==='discarded','Retencao durante inferencia impede restaurar conteudo apagado');
    check($pdo->query("SELECT original_summary FROM feedbacks WHERE id=$during")->fetchColumn()===null,'Resultado descartado nao restaura resumo privado');
    $claim=pendingFeedback();
    $claimWorker=new AnalysisWorker($pdo,$storage,function(array $input) use ($worker): array {
        check($worker->processOne()===null,'Job em processamento nao pode ser reclamado por segundo worker');
        return ['sentiment'=>'neutral','confidence'=>.6,'summary'=>'Confirmacao recebida.','topics'=>[],'evidence'=>[],'criticality'=>'regular','model'=>'teste-local'];
    });
    check($claimWorker->processOne()['status']==='completed','Reivindicacao do job permanece exclusiva');
    $invalid=pendingFeedback();
    $invalidWorker=new AnalysisWorker($pdo,$storage,fn()=>['sentiment'=>'positive','criticality'=>'regular','confidence'=>1.4]);
    check($invalidWorker->processOne()['status']==='failed','Score fora de zero a um nao entra no banco');
    $pdo->exec('ALTER TABLE feedbacks DROP COLUMN transcription_model');
    $app->initialize();
    check((int)$pdo->query("SELECT COUNT(*) FROM feedbacks WHERE id=$quick")->fetchColumn()===1 && array_key_exists('transcription_model',$pdo->query("SELECT * FROM feedbacks WHERE id=$quick")->fetch()),'Migration idempotente preserva banco existente');
    echo "\n$checks verificacoes de analise aprovadas.\n";
} finally { @unlink($storage.'/audio/teste.wav');@rmdir($storage.'/audio');@rmdir($storage); }
