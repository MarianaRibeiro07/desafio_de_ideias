<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/App.php';
require_once dirname(__DIR__).'/src/AnalysisWorker.php';

use Cti\App;
use Cti\AnalysisWorker;

$savedEnvironment=[];
foreach(['CTI_ANALYSIS_PROVIDER'=>'gemini','CTI_GEMINI_API_KEY'=>'chave-ficticia-sem-rede','CTI_GEMINI_MAX_REQUESTS'=>'20'] as $name=>$value){$savedEnvironment[$name]=getenv($name);putenv("$name=$value");}
$storage=sys_get_temp_dir().'/cti-hosted-'.bin2hex(random_bytes(6));
mkdir($storage,0700,true);
$pdo=new PDO('sqlite::memory:');
$calls=0;
$inputs=[];
$runner=function(array $input) use (&$calls,&$inputs): array {
    $calls++;
    $inputs[]=$input;
    if(str_contains($input['text']??'','simular falha')){throw new RuntimeException('Falha simulada sem rede.');}
    return ['transcript'=>null,'sentiment'=>'positive','confidence'=>null,'summary'=>'O cliente elogia a rapidez do atendimento.','topics'=>['Atendimento'],'evidence'=>['Gostei da rapidez'],'criticality'=>'regular','model'=>'gemini-3.5-flash-lite','transcription_model'=>null,'analysis_source'=>'gemini_api'];
};
$app=new App($pdo,$storage,$runner);
$app->initialize();
$_SESSION=[];
$checks=0;
function check(bool $ok,string $message): void {global $checks;if(!$ok){throw new RuntimeException($message);}echo "PASS $message\n";$checks++;}
function request(string $method,string $path,array $body=[]): array {global $app;$_SERVER['HTTP_X_CSRF_TOKEN']=$_SESSION['csrf_token']??'';return $app->handle($method,$path,$body);}
function signIn(string $email): void {request('GET','/api/session');$r=request('POST','/api/login',['email'=>$email,'password'=>'CtiDemo2026!']);if($r['status']!==200){throw new RuntimeException('Falha no login do teste.');}}
function pendingFeedback(string $text='Gostei da rapidez do atendimento.'): int {
    signIn('rafael@cti.demo');
    $ticket=request('POST','/api/tickets',['client_id'=>1,'subject'=>'Demonstracao de analise hospedada','channel'=>'Portal','priority'=>'medium']);
    if($ticket['status']!==201){throw new RuntimeException('Falha ao preparar atendimento.');}
    $id=$ticket['body']['data']['id'];
    $solution=request('POST',"/api/tickets/$id/solution",['solution'=>'Conexao ajustada e validada com o cliente.']);
    if($solution['status']!==200){throw new RuntimeException('Falha ao preparar solucao.');}
    signIn('lucas@cti.demo');
    $result=request('POST','/api/feedbacks',['ticket_id'=>$id,'rating'=>5,'resolved'=>true,'mode'=>'text','text'=>$text]);
    if($result['status']!==201){throw new RuntimeException('Falha ao preparar feedback.');}
    return (int)$result['body']['data']['id'];
}
function reservations(): int {global $pdo;return (int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE event='gemini_request_reserved'")->fetchColumn();}
function row(int $id): array {global $pdo;$statement=$pdo->prepare('SELECT * FROM feedbacks WHERE id=?');$statement->execute([$id]);return $statement->fetch(PDO::FETCH_ASSOC);}

try {
    $first=pendingFeedback();
    $result=request('POST',"/api/feedbacks/$first/analyze");
    check($result['status']===200,'Cliente solicita analise do proprio feedback pela rota hospedada');
    check($calls===1 && reservations()===1,'Uma analise reserva e executa somente uma chamada simulada');
    $public=$result['body']['data'];
    check($public['analysis_status']==='completed' && $public['analysis_source']==='gemini_api' && $public['confidence']===null,'Resultado identifica Gemini e preserva confianca nula');
    check(!array_key_exists('audio_path',$public),'Rota de analise nao expoe caminho privado');
    check($inputs[0]['text']==='Gostei da rapidez do atendimento.' && ($inputs[0]['audio_path']??null)===null,'Somente o relato solicitado chega ao analisador simulado');
    $again=request('POST',"/api/feedbacks/$first/analyze");
    check($again['status']===200 && $calls===1 && reservations()===1,'Repetir analise concluida devolve o resultado sem gastar outra chamada');
    $bootstrap=request('GET','/api/bootstrap')['body']['data'];
    check(($bootstrap['analysis']['on_demand']??false)===true && ($bootstrap['analysis']['remaining_requests']??null)===19,'Bootstrap informa processamento sob demanda e saldo do teto global');
    check(!str_contains(json_encode($bootstrap),'chave-ficticia-sem-rede'),'Bootstrap nao publica a chave da API');
    check($calls===1 && reservations()===1,'Carregar bootstrap com o seed e suas falhas nao consome chamadas');

    $second=pendingFeedback();
    $before=$calls;
    $_SESSION=[];
    request('GET','/api/session');
    check(request('POST',"/api/feedbacks/$second/analyze")['status']===401,'Analise hospedada exige autenticacao');
    signIn('lucas@cti.demo');
    $_SERVER['HTTP_X_CSRF_TOKEN']='invalido';
    check($app->handle('POST',"/api/feedbacks/$second/analyze")['status']===419,'Analise hospedada exige CSRF valido');
    foreach(['ana@cti.demo'=>'Cliente de outra organizacao','bruno@cti.demo'=>'Atendente que nao e dono','diego@cti.demo'=>'Supervisor de outra equipe','helena@cti.demo'=>'Gestor'] as $email=>$label){signIn($email);check(request('POST',"/api/feedbacks/$second/analyze")['status']===403,"$label nao dispara analise");}
    check($calls===$before && reservations()===1 && row($second)['analysis_status']==='pending','Requisicoes proibidas preservam pendencia e nao reservam cota');
    signIn('rafael@cti.demo');
    check(request('POST',"/api/feedbacks/$second/analyze")['status']===200 && $calls===$before+1,'Atendente dono pode processar o feedback pendente');

    $third=pendingFeedback();
    signIn('marina@cti.demo');
    check(request('POST',"/api/feedbacks/$third/review",['sentiment'=>'negative','criticality'=>'critical','justification'=>'A supervisao identificou um impacto importante.','action'=>'Investigar a indisponibilidade com a equipe.'])['status']===200,'Revisao humana pode ser registrada antes da analise remota');
    $pdo->prepare('UPDATE feedbacks SET summary=? WHERE id=?')->execute(['Resumo confirmado pela supervisao.',$third]);
    check(request('POST',"/api/feedbacks/$third/analyze")['status']===200,'Supervisor da equipe pode processar o feedback');
    $reviewed=row($third);
    check($reviewed['sentiment']==='negative' && $reviewed['criticality']==='critical' && $reviewed['summary']==='Resumo confirmado pela supervisao.','Gemini nao sobrescreve sentimento criticidade nem resumo ja revisados');
    check($reviewed['original_sentiment']==='positive' && $reviewed['original_summary']==='O cliente elogia a rapidez do atendimento.','Resultado original do Gemini fica separado da revisao humana');

    $states=[];
    foreach(['processing','failed','not_required','redacted'] as $status){$states[$status]=pendingFeedback();$pdo->prepare('UPDATE feedbacks SET analysis_status=?, redacted_at=? WHERE id=?')->execute([$status==='redacted'?'pending':$status,$status==='redacted'?gmdate(DATE_ATOM):null,$states[$status]]);}
    signIn('lucas@cti.demo');
    $before=$calls;$reserved=reservations();
    check(request('POST',"/api/feedbacks/{$states['processing']}/analyze")['status']===200,'Requisicao repetida durante processamento nao inicia outra chamada');
    foreach(['failed','not_required','redacted'] as $status){check(request('POST',"/api/feedbacks/{$states[$status]}/analyze")['status']===409,"Estado $status nao e processado automaticamente");}
    check($calls===$before && reservations()===$reserved,'Estados nao elegiveis nao consomem cota');
    check(request('POST',"/api/feedbacks/{$states['failed']}/retry-analysis")['status']===403,'Cliente nao reenfileira falha');
    signIn('marina@cti.demo');
    check(request('POST',"/api/feedbacks/{$states['failed']}/retry-analysis")['status']===200,'Supervisor pode autorizar nova tentativa apos falha');
    check($calls===$before && reservations()===$reserved,'Autorizar nova tentativa ainda nao chama a API');

    $failing=pendingFeedback('Gostei, mas quero simular falha de rede no teste.');
    $before=$calls;$reserved=reservations();
    request('POST',"/api/feedbacks/$failing/analyze");
    check(row($failing)['analysis_status']==='failed' && row($failing)['text']!==null,'Falha remota preserva relato e registra estado recuperavel');
    check($calls===$before+1 && reservations()===$reserved+1,'Falha remota consome uma reserva sem repeticao automatica');
    check(request('POST',"/api/feedbacks/$failing/analyze")['status']===409 && $calls===$before+1,'Atualizar depois da falha nao repete a chamada');

    $local=pendingFeedback();
    putenv('CTI_ANALYSIS_PROVIDER=local');
    $before=$calls;$reserved=reservations();
    check(request('POST',"/api/feedbacks/$local/analyze")['status']===503,'Provedor local nao expoe processamento hospedado');
    check($calls===$before && reservations()===$reserved,'Provedor local nao reserva cota Gemini');
    putenv('CTI_ANALYSIS_PROVIDER=gemini');

    $workerFirst=pendingFeedback();
    $workerSecond=pendingFeedback();
    $blocked=pendingFeedback();
    $reserved=reservations();
    putenv('CTI_GEMINI_MAX_REQUESTS='.($reserved+2));
    $worker=new AnalysisWorker($pdo,$storage,$runner);
    check($worker->processOne($workerFirst)['status']==='completed','Worker processa somente o ID solicitado');
    $otherWorker=new AnalysisWorker($pdo,$storage,$runner);
    check($otherWorker->processOne($workerSecond)['status']==='completed','Segundo worker compartilha o contador persistido');
    check(row($states['failed'])['analysis_status']==='pending' && row($local)['analysis_status']==='pending','IDs pendentes anteriores permanecem intocados');
    $before=$calls;
    check(request('POST',"/api/feedbacks/$blocked/analyze")['status']===429,'Teto global esgotado bloqueia analise hospedada');
    check(row($blocked)['analysis_status']==='pending' && $calls===$before && reservations()===$reserved+2,'Teto esgotado preserva pendencia sem chamar o provedor');
    check((request('GET','/api/bootstrap')['body']['data']['analysis']['remaining_requests']??null)===0,'Bootstrap informa saldo zero quando o teto e atingido');

    echo "\n$checks verificacoes hospedadas aprovadas, sem rede e sem consumo Gemini.\n";
} finally {
    foreach($savedEnvironment as $name=>$value){putenv($value===false?$name:"$name=$value");}
    unset($worker,$otherWorker,$app,$pdo);
    @rmdir($storage);
}
