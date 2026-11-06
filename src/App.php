<?php
declare(strict_types=1);

namespace Cti;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;
use Throwable;

final class HttpError extends RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}

final class App {
    private const FEEDBACK_WINDOW = '+3 days';
    private const RESPONSE_MINUTES = ['low'=>480,'medium'=>240,'high'=>60,'critical'=>30];
    private const STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
    private string $storage;

    public function __construct(private PDO $pdo, ?string $storage = null) {
        $this->storage = $storage ?? dirname(__DIR__) . '/storage';
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    }

    public static function open(): self {
        $storage = getenv('CTI_STORAGE_PATH') ?: dirname(__DIR__) . '/storage';
        if (!is_dir($storage)) { mkdir($storage, 0700, true); }
        $path = getenv('CTI_DB_PATH') ?: $storage . '/cti.sqlite';
        $app = new self(new PDO('sqlite:' . $path), $storage);
        $app->initialize();
        return $app;
    }

    public function db(): PDO { return $this->pdo; }

    public static function maskSensitive(string $text): string {
        $text=preg_replace('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/','[e-mail omitido]',$text);
        $text=preg_replace('/(?<![\d.])(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)/','[CPF omitido]',$text);
        return preg_replace('/(?<!\w)(?:\+?55[\s.-]?)?(?:\(0?\d{2}\)|0?\d{2})[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)|(?<![\w.,-])9\d{4}[\s.-]?\d{4}(?!\d)/','[telefone omitido]',$text);
    }
    private function now(): string { return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DATE_ATOM); }
    private function run(string $sql, array $params = []): \PDOStatement {
        $s = $this->pdo->prepare($sql); $s->execute($params); return $s;
    }
    private function all(string $sql, array $params = []): array { return $this->run($sql, $params)->fetchAll(); }
    private function one(string $sql, array $params = []): ?array { return $this->run($sql, $params)->fetch() ?: null; }
    private function fail(int $status, string $message): never { throw new HttpError($status, $message); }

    public function initialize(): void {
        $schema=file_get_contents(dirname(__DIR__) . '/database/schema.sqlite.sql');
        $uniqueClients='';
        $schema=preg_replace_callback('/^CREATE UNIQUE INDEX IF NOT EXISTS clients_name_nocase[^;]*;/mi',static function(array $m) use (&$uniqueClients): string { $uniqueClients=$m[0]; return ''; },$schema);
        $this->pdo->exec($schema);
        try { if($uniqueClients!==''){ $this->pdo->exec($uniqueClients); } }
        catch (Throwable $e) { error_log('CTI initialize: indice clients_name_nocase nao criado, resolva os clientes duplicados. '.$e->getMessage()); }
        $columns=array_column($this->all('PRAGMA table_info(feedbacks)'),'name');
        $legacy=!in_array('analysis_status',$columns,true);
        foreach(['analysis_status'=>"TEXT NOT NULL DEFAULT 'not_required'",'analysis_error'=>'TEXT','analysis_attempts'=>'INTEGER NOT NULL DEFAULT 0','analysis_started_at'=>'TEXT','analyzed_at'=>'TEXT','transcript'=>'TEXT','confidence'=>'REAL','topics'=>'TEXT','evidence'=>'TEXT','analysis_model'=>'TEXT','transcription_model'=>'TEXT','original_sentiment'=>'TEXT','original_criticality'=>'TEXT','original_summary'=>'TEXT'] as $name=>$type){
            if(!in_array($name,$columns,true)){$this->pdo->exec("ALTER TABLE feedbacks ADD COLUMN $name $type");}
        }
        $added=['tickets'=>['priority'=>"TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical'))",'support_level'=>'INTEGER NOT NULL DEFAULT 1 CHECK(support_level BETWEEN 1 AND 3)'],'clients'=>['city'=>'TEXT','state'=>'TEXT']];
        foreach($added as $table=>$fields){
            $present=array_column($this->all("PRAGMA table_info($table)"),'name');
            foreach($fields as $name=>$type){if(!in_array($name,$present,true)){$this->pdo->exec("ALTER TABLE $table ADD COLUMN $name $type");}}
        }
        $this->pdo->exec('CREATE INDEX IF NOT EXISTS feedbacks_analysis_idx ON feedbacks(analysis_status,id)');
        if($legacy){
            $this->run("UPDATE feedbacks SET original_sentiment=sentiment,original_criticality=criticality,original_summary=summary,analysis_status='pending',analysis_source='pending',sentiment=CASE WHEN reviewed=1 THEN sentiment ELSE 'pending' END WHERE redacted_at IS NULL AND ((mode='text' AND text IS NOT NULL) OR (mode='audio' AND audio_path IS NOT NULL))");
            $this->run("UPDATE feedbacks SET analysis_source='rating' WHERE mode='quick' AND analysis_source='local_rules'");
        }
        $this->run("UPDATE feedbacks SET original_sentiment=COALESCE(original_sentiment,CASE WHEN rating>=4 THEN 'positive' WHEN rating<=2 THEN 'negative' ELSE 'neutral' END),original_criticality=COALESCE(original_criticality,CASE WHEN resolved=0 THEN 'critical' ELSE 'regular' END),original_summary=COALESCE(original_summary,CASE WHEN resolved=1 THEN 'Cliente confirmou a resolucao em avaliacao rapida.' ELSE 'Cliente informou que o problema continua.' END),analysis_source='rating' WHERE mode='quick' AND redacted_at IS NULL AND (original_sentiment IS NULL OR original_criticality IS NULL OR original_summary IS NULL)");
        if ((int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) { return; }
        $this->pdo->beginTransaction();
        try {
            foreach ([1 => 'Conectividade', 2 => 'Cloud e seguranca'] as $id => $name) { $this->run('INSERT INTO teams VALUES (?,?)', [$id,$name]); }
            foreach ([1 => ['Grupo Aurora Logistica','Curitiba','PR'], 2 => ['Redecom Telecom','Belo Horizonte','MG'], 3 => ['Clinica Vida Plena','Porto Alegre','RS'], 4 => ['Mercado Bom Preco','Salvador','BA'], 5 => ['Escritorio Campos e Lima','Campinas','SP'], 6 => ['Industria Metalurgica Brasil','Joinville','SC']] as $id => [$name,$city,$state]) { $this->run('INSERT INTO clients VALUES (?,?,?,?)', [$id,$name,$city,$state]); }
            foreach ([1 => 'Acesso VPN', 2 => 'Conexao e link dedicado', 3 => 'Cloud e backup', 4 => 'Firewall e seguranca'] as $id => $name) { $this->run('INSERT INTO categories VALUES (?,?)', [$id,$name]); }
            $hash = password_hash('CtiDemo2026!', PASSWORD_DEFAULT);
            $users = [[1,'Rafael Moreira','rafael@cti.demo','attendant',1,null],[2,'Marina Duarte','marina@cti.demo','supervisor',1,null],[3,'Helena Albuquerque','helena@cti.demo','manager',null,null],[4,'Lucas Ferreira','lucas@cti.demo','client',null,1],[5,'Bruno Ferraz','bruno@cti.demo','attendant',1,null],[6,'Camila Torres','camila@cti.demo','attendant',2,null],[7,'Leticia Almeida','leticia@cti.demo','attendant',2,null],[8,'Diego Martins','diego@cti.demo','supervisor',2,null],[9,'Ana Santos','ana@cti.demo','client',null,2]];
            foreach ($users as [$id,$name,$email,$role,$team,$client]) { $this->run('INSERT INTO users VALUES (?,?,?,?,?,?,?)', [$id,$name,$email,$hash,$role,$team,$client]); }
            $examples = [
                ['Instabilidade na VPN site a site',1,'Renovar as credenciais do tunel VPN, conferir rotas e validar a conexao com o cliente.','VPN,acesso,credencial'],
                ['Queda intermitente no link dedicado',2,'Verificar logs de oscilacao, substituir o cabo da porta WAN e monitorar a estabilidade do link.','link,conexao,rede'],
                ['Backup em nuvem sem concluir',3,'Liberar espaco no destino, revisar credenciais e executar o backup incremental de validacao.','backup,cloud,nuvem'],
                ['Bloqueio de acesso ao firewall corporativo',4,'Revisar a regra de origem e destino, aplicar a liberacao aprovada e testar o acesso.','firewall,seguranca'],
                ['Lentidao no acesso ao armazenamento em nuvem',3,'Revisar a regiao do armazenamento em nuvem e ajustar a capacidade provisionada apos medir a latencia.','armazenamento,cloud,nuvem'],
                ['Renovacao de certificado de seguranca',4,'Renovar o certificado TLS, instalar a cadeia intermediaria e validar a data de expiracao e o dominio.','certificado,TLS,seguranca'],
                ['Perda de pacotes na rede Wi-Fi da filial',2,'Medir interferencia, mudar o canal Wi-Fi e reposicionar o ponto de acesso; confirmar perda de pacotes apos o ajuste.','wifi,pacotes,rede'],
                ['Migracao de servidores para nuvem',3,'Validar o backup antes da migracao para nuvem, replicar os servidores e confirmar a integridade dos dados na nova instancia.','migracao,servidores,cloud,nuvem']
            ];
            $feedbackSerial=0; $now=new DateTimeImmutable('now',new DateTimeZone('UTC'));
            $iso=static fn(DateTimeImmutable $d): string => $d->format(DATE_ATOM);
            $fb=static fn(int $rating,string $sentiment,string $criticality,?string $text,string $summary,array $extra=[]): array => $extra+['rating'=>$rating,'resolved'=>1,'mode'=>$text===null?'quick':'text','text'=>$text,'sentiment'=>$sentiment,'criticality'=>$criticality,'summary'=>$summary];
            $addFeedback=function(int $ticket,string $tags,array $f,DateTimeImmutable $at) use (&$feedbackSerial,$iso): void {
                $quick=$f['mode']==='quick'; $failed=!empty($f['failed']); $done=!$quick&&!$failed;
                $summary=$quick?($f['resolved']?'Cliente confirmou a resolucao em avaliacao rapida.':'Cliente informou que o problema continua.'):$f['summary'];
                $row=['protocol'=>sprintf('FDB-2026-%04d',++$feedbackSerial),'ticket_id'=>$ticket,'attempt'=>1,'rating'=>$f['rating'],'resolved'=>$f['resolved'],'mode'=>$f['mode'],'text'=>$f['text'],
                    'sentiment'=>$failed?'pending':$f['sentiment'],'criticality'=>$f['criticality'],'reviewed'=>$f['reviewed']??0,'summary'=>$failed?null:$summary,'created_at'=>$iso($at),
                    'analysis_status'=>$quick?'not_required':($failed?'failed':'completed'),'analysis_source'=>$quick?'rating':($failed?'pending':'local_model'),'analysis_attempts'=>$quick?0:1,
                    'analysis_error'=>$failed?'Nao foi possivel concluir a analise. O supervisor pode tentar novamente.':null,'analyzed_at'=>$done?$iso($at->modify('+1 minute')):null,
                    'confidence'=>$done?0.8+($feedbackSerial%5)*0.03:null,'topics'=>$done?json_encode(array_slice(explode(',',$tags),0,2),JSON_UNESCAPED_UNICODE):null,'evidence'=>$done?json_encode($f['evidence']??[],JSON_UNESCAPED_UNICODE):null,
                    'analysis_model'=>$done?'demonstracao-sintetica':null,'original_sentiment'=>$failed?null:$f['sentiment'],'original_criticality'=>$failed?null:$f['criticality'],'original_summary'=>$failed?null:$summary];
                $this->run('INSERT INTO feedbacks('.implode(',',array_keys($row)).') VALUES ('.implode(',',array_fill(0,count($row),'?')).')',array_values($row));
            };
            $resolvedProfiles=[
                $fb(5,'positive','regular',null,''),
                $fb(3,'neutral','regular','A solucao funcionou, mas o retorno poderia ser mais rapido.','Cliente confirma a resolucao e pede retorno mais rapido.'),
                $fb(5,'positive','regular','Atendimento rapido e claro. Conexao funcionando novamente.','Cliente elogia a rapidez e confirma o funcionamento.',['review'=>['positive','regular']]),
                $fb(1,'negative','critical','Ja reclamei varias vezes da cobranca indevida e so agora corrigiram. Quero falar com um supervisor.','Cliente relata reclamacao recorrente e cobranca indevida.',['evidence'=>['Ja reclamei varias vezes','cobranca indevida','Quero falar com um supervisor']]),
                $fb(4,'positive','regular','Equipe objetiva, o ajuste foi feito no mesmo dia e explicaram o que mudou.','Cliente elogia a objetividade e a explicacao.',['review'=>['positive','regular']]),
                $fb(2,'negative','critical','Ninguem resolveu na primeira ligacao e tive que repetir o problema tres vezes. Vou cancelar se acontecer de novo.','Cliente cita falta de solucao inicial e ameaca cancelamento.',['reviewed'=>1,'evidence'=>['Ninguem resolveu','Vou cancelar']]),
                $fb(4,'positive','regular','Tudo normalizado desde o ajuste, obrigado pelo retorno.','',['failed'=>true]),
                $fb(4,'positive','regular','Gostei do retorno da equipe e da validacao feita comigo.','Cliente aprova o retorno e a validacao conjunta.'),
                $fb(2,'negative','regular','Foi resolvido, mas demorou bem mais do que o combinado.','Cliente confirma a resolucao, mas reclama do prazo.',['review'=>['neutral','regular']]),
                $fb(5,'positive','regular','Problema resolvido no mesmo dia. Atendimento claro.','Cliente confirma resolucao no mesmo dia.',['review'=>['positive','regular']]),
                $fb(1,'negative','critical','Houve cobranca indevida depois da migracao e ninguem resolveu na primeira tentativa. Se nao corrigirem, vou acionar a justica.','Cliente relata cobranca indevida sem solucao e ameaca processo.',['evidence'=>['cobranca indevida','ninguem resolveu','vou acionar a justica']]),
                $fb(3,'neutral','regular','Resolveu, porem precisei acompanhar o chamado para ele andar.','Cliente confirma a resolucao e critica o acompanhamento.',['review'=>['negative','regular']]),
                $fb(4,'positive','regular','Equipe atenciosa e conexao estavel desde o ajuste.','Cliente elogia a atencao e a estabilidade.',['review'=>['positive','regular']]),
                $fb(2,'negative','critical','Apareceu um acesso nao reconhecido na minha conta e isso parece fraude. Quero uma resposta urgente.','Cliente relata acesso nao reconhecido e suspeita de fraude.',['evidence'=>['acesso nao reconhecido','fraude']]),
                $fb(3,'neutral','regular',null,''),
                $fb(5,'positive','regular',null,''),
                $fb(4,'positive','regular','Backup funcionando e equipe sempre disponivel.','Cliente elogia a disponibilidade da equipe.'),
                $fb(3,'neutral','regular','A solucao funcionou, mas o prazo ficou acima do esperado.','',['failed'=>true]),
            ];
            $rejectedProfiles=[
                10=>$fb(1,'negative','critical','Ja reclamei varias vezes e ninguem resolveu. A indisponibilidade continua e vou cancelar.','Cliente informa que o problema continua, cita recorrencia e cancelamento.',['resolved'=>0,'evidence'=>['Ja reclamei varias vezes','ninguem resolveu','indisponibilidade','vou cancelar']]),
                15=>$fb(1,'negative','critical',null,'',['resolved'=>0]),
                20=>$fb(2,'negative','critical','O servico continua com indisponibilidade desde ontem. Quero falar com um supervisor.','Cliente informa que o problema continua e pede um supervisor.',['resolved'=>0,'evidence'=>['indisponibilidade','Quero falar com um supervisor']]),
            ];
            $pendingReply=[0=>[30,'low'],5=>[2,'low'],25=>[72,'high']];
            $priorities=['medium','low','high','medium','critical','low','medium','high'];
            $levels=[1,1,2,1,3,1,2,1,1,3];
            $delay=static fn(string $priority,int $i): int => (int)round(self::RESPONSE_MINUTES[$priority]*($i%6===3?1.5:0.6));
            $k=0;
            for ($i=0; $i<32; $i++) {
                $attendant = [1,5,6,7][intdiv($i,8)]; $team = $attendant <= 5 ? 1 : 2;
                $client = $i === 1 ? 2 : (($i % 6) + 1);
                [$subject,$category,$exampleSolution,$tags] = $examples[$i % 8];
                $channel = ['Portal','Telefone','E-mail','Chat'][$i % 4];
                $status = $i % 5 === 0 ? 'active' : ($i % 5 === 1 ? 'awaiting_feedback' : 'resolved');
                $rejected = isset($rejectedProfiles[$i]);
                $withSolution = $status !== 'active' || $rejected;
                $created = $now->modify('-' . (29 - intdiv($i * 29, 31)) . ' days')->modify('-' . (3 + $i % 5) . ' hours');
                $priority = $priorities[$i % 8];
                if (isset($pendingReply[$i])) { $created = $now->modify('-' . $pendingReply[$i][0] . ' hours'); $priority = $pendingReply[$i][1]; }
                $due = $created->modify('+' . self::RESPONSE_MINUTES[$priority] . ' minutes');
                $sent = $status === 'awaiting_feedback' ? $now->modify('-2 hours') : ($withSolution ? $created->modify('+' . $delay($priority,$i) . ' minutes') : null);
                $deadline = $status === 'awaiting_feedback' ? $sent->modify(self::FEEDBACK_WINDOW) : null;
                $feedbackAt = $sent ? $sent->modify('+' . ($rejected ? 10 : 6 + ($i % 3) * 4) . ' hours') : null;
                $replied = $withSolution ? $sent : (isset($pendingReply[$i]) ? null : $created->modify('+' . $delay($priority,$i) . ' minutes'));
                $this->run('INSERT INTO tickets(protocol,client_id,attendant_id,team_id,category_id,subject,channel,status,created_at,response_due_at,replied_at,solution,solution_sent_at,feedback_deadline,manual_status_changes,closed_at,closure_reason,solution_attempt,rejected_at,priority,support_level) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [sprintf('ATD-2026-%04d',$i+1),$client,$attendant,$team,$category,$subject,$channel,$status,$iso($created),$iso($due),$replied?$iso($replied):null,$withSolution?$exampleSolution:null,$sent?$iso($sent):null,$deadline?$iso($deadline):null,$withSolution?1:0,$status==='resolved'?$iso($feedbackAt):null,$status==='resolved'?'client_confirmed':null,$withSolution?1:0,$rejected?$iso($feedbackAt):null,$priority,$levels[$i % 10]]);
                $ticket = (int) $this->pdo->lastInsertId();
                if ($status === 'active' && !$withSolution && $replied) {
                    $this->run('INSERT INTO ticket_replies(ticket_id,user_id,message,created_at) VALUES (?,?,?,?)', [$ticket,$attendant,'Recebemos seu chamado e estamos analisando o caso.',$iso($replied)]);
                }
                if ($rejected) { $addFeedback($ticket,$tags,$rejectedProfiles[$i],$feedbackAt); }
                if ($status === 'resolved') {
                    $profile = $resolvedProfiles[$k++];
                    $addFeedback($ticket,$tags,$profile,$feedbackAt);
                    $feedbackId = (int) $this->pdo->lastInsertId();
                    if (!empty($profile['reviewed'])) {
                        $this->run('INSERT INTO reviews(feedback_id,reviewer_id,sentiment,criticality,justification,action,created_at) VALUES (?,?,?,?,?,?,?)', [$feedbackId,2,'negative','critical','Cliente cita cancelamento e falta de solucao inicial. Caso confirmado como critico.','Supervisao contatou o cliente e abriu acompanhamento semanal.',$iso($feedbackAt->modify('+1 day'))]);
                    }
                    if (isset($profile['review'])) {
                        [$reviewSentiment,$reviewCriticality]=$profile['review'];
                        $this->run('INSERT INTO reviews(feedback_id,reviewer_id,sentiment,criticality,justification,action,created_at) VALUES (?,?,?,?,?,?,?)', [$feedbackId,$team===1?2:8,$reviewSentiment,$reviewCriticality,'Revisao humana da classificacao automatica da demonstracao.','Registro validado pela supervisao.',$iso($feedbackAt->modify('+1 day'))]);
                        $this->run('UPDATE feedbacks SET sentiment=?,criticality=?,reviewed=1 WHERE id=?', [$reviewSentiment,$reviewCriticality,$feedbackId]);
                    }
                    $this->run('INSERT INTO resolution_cases(ticket_id,category_id,team_id,subject,solution,tags,usage_count,created_at) VALUES (?,?,?,?,?,?,?,?)', [$ticket,$category,$team,$subject,$exampleSolution,$tags,$i%7,$iso($feedbackAt)]);
                }
            }
            $previousPeriod=[
                [33,1,$fb(5,'positive','regular',null,'')],
                [35,6,$fb(4,'positive','regular','Equipe objetiva e o acesso voltou no mesmo dia.','Cliente elogia a objetividade e a rapidez.')],
                [38,5,$fb(3,'neutral','regular','A solucao funcionou, mas o retorno poderia ser mais rapido.','Cliente confirma a resolucao e pede retorno mais rapido.')],
                [40,7,$fb(2,'negative','regular','Foi resolvido, mas demorou bem mais do que o combinado.','Cliente confirma a resolucao, mas reclama do prazo.')],
                [42,5,$fb(2,'negative','critical','Ninguem resolveu na primeira tentativa e tive que repetir o problema duas vezes. Vou cancelar se acontecer de novo.','Cliente cita falta de solucao inicial e ameaca cancelamento.',['reviewed'=>1,'evidence'=>['Ninguem resolveu','Vou cancelar']])],
                [44,6,$fb(1,'negative','critical','Ja reclamei varias vezes da cobranca indevida e so agora corrigiram. Quero falar com um supervisor.','Cliente relata reclamacao recorrente e cobranca indevida.',['reviewed'=>1,'evidence'=>['Ja reclamei varias vezes','cobranca indevida','Quero falar com um supervisor']])],
                [46,5,$fb(5,'positive','regular',null,'')],
                [48,7,$fb(3,'neutral','regular',null,'')],
                [51,1,$fb(2,'negative','regular','O servico voltou, mas a indisponibilidade durou mais do que o previsto.','Cliente confirma a resolucao, mas reclama da duracao da indisponibilidade.')],
                [54,6,$fb(4,'positive','regular','Gostei do retorno da equipe e da validacao feita comigo.','Cliente aprova o retorno e a validacao conjunta.')],
            ];
            foreach ($previousPeriod as $j => [$daysAgo,$attendant,$profile]) {
                $team = $attendant <= 5 ? 1 : 2;
                [$subject,$category,$exampleSolution,$tags] = $examples[($j * 3) % 8];
                $created = $now->modify('-' . $daysAgo . ' days')->modify('-4 hours');
                $priority = $priorities[($j * 3 + 1) % 8];
                $sent = $created->modify('+' . $delay($priority,$j) . ' minutes'); $feedbackAt = $sent->modify('+' . (6 + ($j % 3) * 4) . ' hours');
                $this->run('INSERT INTO tickets(protocol,client_id,attendant_id,team_id,category_id,subject,channel,status,created_at,response_due_at,replied_at,solution,solution_sent_at,feedback_deadline,manual_status_changes,closed_at,closure_reason,solution_attempt,rejected_at,priority,support_level) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [sprintf('ATD-2026-%04d',33+$j),($j % 6)+1,$attendant,$team,$category,$subject,['Portal','Telefone','E-mail','Chat'][$j % 4],'resolved',$iso($created),$iso($created->modify('+' . self::RESPONSE_MINUTES[$priority] . ' minutes')),$iso($sent),$exampleSolution,$iso($sent),null,1,$iso($feedbackAt),'client_confirmed',1,null,$priority,[1,2,1,3,1,1,2,1,1,1][$j]]);
                $ticket = (int) $this->pdo->lastInsertId();
                $addFeedback($ticket,$tags,$profile,$feedbackAt);
                $feedbackId = (int) $this->pdo->lastInsertId();
                if (!empty($profile['reviewed'])) {
                    $this->run('INSERT INTO reviews(feedback_id,reviewer_id,sentiment,criticality,justification,action,created_at) VALUES (?,?,?,?,?,?,?)', [$feedbackId,$team===1?2:8,'negative','critical','Relato confirmado como critico pela supervisao.','Supervisao contatou o cliente e registrou o acompanhamento.',$iso($feedbackAt->modify('+1 day'))]);
                }
                $this->run('INSERT INTO resolution_cases(ticket_id,category_id,team_id,subject,solution,tags,usage_count,created_at) VALUES (?,?,?,?,?,?,?,?)', [$ticket,$category,$team,$subject,$exampleSolution,$tags,$j%7,$iso($feedbackAt)]);
            }
            $this->pdo->commit();
        } catch (Throwable $e) { $this->pdo->rollBack(); throw $e; }
    }

    public function handle(string $method, string $path, array $body = [], array $query = [], array $files = []): array {
        try {
            $_SESSION['csrf_token'] ??= bin2hex(random_bytes(32));
            if (!in_array($method, ['GET','HEAD'], true) && !hash_equals($_SESSION['csrf_token'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) { $this->fail(419,'Sua sessao expirou. Atualize a pagina e tente novamente.'); }
            if ($path === '/api/session' && $method === 'GET') { return $this->ok(['user'=>$this->user(false),'csrf_token'=>$_SESSION['csrf_token']]); }
            if ($path === '/api/login' && $method === 'POST') { return $this->login($body); }
            if ($path === '/api/logout' && $method === 'POST') { $_SESSION = ['csrf_token'=>bin2hex(random_bytes(32))]; if (session_status()===PHP_SESSION_ACTIVE) { session_regenerate_id(true); } return $this->ok(['user'=>null,'csrf_token'=>$_SESSION['csrf_token']]); }
            $user = $this->user();
            if ($path === '/api/bootstrap' && $method === 'GET') { return $this->bootstrap($user); }
            if ($path === '/api/clients' && $method === 'POST') { return $this->createClient($user,$body); }
            if ($path === '/api/tickets' && $method === 'POST') { return $this->createTicket($user,$body); }
            if (preg_match('#^/api/tickets/(\d+)$#',$path,$m) && $method === 'PATCH') { return $this->editTicket($user,(int)$m[1],$body); }
            if (preg_match('#^/api/tickets/(\d+)/(solution|reply|cases|retry|escalate)$#',$path,$m)) {
                $ticket=$this->ticket($user,(int)$m[1]);
                if ($m[2]==='cases' && $method==='GET') { return $this->ok($this->cases($user,['category_id'=>$ticket['category_id']])); }
                if ($m[2]==='solution' && $method==='POST') { return $this->sendSolution($user,$ticket,$body); }
                if ($m[2]==='reply' && $method==='POST') { return $this->reply($user,$ticket,$body); }
                if ($m[2]==='retry' && $method==='POST') { return $this->retry($user,$ticket,$body); }
                if ($m[2]==='escalate' && $method==='POST') { return $this->escalate($user,$ticket,$body); }
            }
            if ($path === '/api/cases' && $method === 'GET') { return $this->ok($this->cases($user,$query)); }
            if ($path === '/api/feedbacks' && $method === 'POST') { return $this->feedback($user,$body,$files); }
            if (preg_match('#^/api/feedbacks/(\d+)/(review|audio|retry-analysis)$#',$path,$m)) {
                $feedback=$this->feedbackById($user,(int)$m[1]);
                if ($m[2]==='review' && $method==='POST') { return $this->review($user,$feedback,$body); }
                if ($m[2]==='retry-analysis' && $method==='POST') { return $this->retryAnalysis($user,$feedback); }
                if ($m[2]==='audio' && $method==='GET') {
                    if (!$feedback['audio_path'] || !is_file($this->storage.'/audio/'.$feedback['audio_path'])) { $this->fail(404,'Audio indisponivel ou removido pela retencao.'); }
                    return ['status'=>200,'file'=>$this->storage.'/audio/'.$feedback['audio_path'],'headers'=>['Content-Type'=>'audio/wav','Content-Disposition'=>'inline; filename="feedback.wav"','Cache-Control'=>'no-store']];
                }
            }
            if (in_array($path,['/api/reports','/api/reports/export'],true) && $method==='GET') { return $this->report($user,$query,$path==='/api/reports/export'); }
            $this->fail(404,'Recurso nao encontrado.');
        } catch (HttpError $e) { return ['status'=>$e->status,'body'=>['message'=>$e->getMessage()],'headers'=>[]]; }
        catch (Throwable $e) { error_log((string)$e); return ['status'=>500,'body'=>['message'=>'Nao foi possivel concluir a operacao. Tente novamente.'],'headers'=>[]]; }
    }

    private function ok(mixed $data, int $status=200): array { return ['status'=>$status,'body'=>['data'=>$data],'headers'=>[]]; }
    private function user(bool $required=true): ?array {
        $u=isset($_SESSION['user_id'])?$this->one('SELECT id,name,email,role,team_id,client_id FROM users WHERE id=?',[$_SESSION['user_id']]):null;
        if (!$u && $required) { $this->fail(401,'Entre na plataforma para continuar.'); }
        return $u;
    }
    private function login(array $body): array {
        $email=mb_strtolower(trim((string)($body['email']??'')));
        $identity=hash('sha256',$email.'|'.($_SERVER['REMOTE_ADDR']??'cli'));
        $cutoff=(new DateTimeImmutable('-15 minutes'))->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
        if ((int)$this->run('SELECT COUNT(*) FROM login_attempts WHERE identity=? AND created_at>=?',[$identity,$cutoff])->fetchColumn() >= 10) { $this->fail(429,'Muitas tentativas. Aguarde 15 minutos.'); }
        $user=$this->one('SELECT * FROM users WHERE email=?',[$email]);
        $valid=password_verify((string)($body['password']??''),$user['password_hash']??'$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
        if (!$user || !$valid) { $this->run('INSERT INTO login_attempts(identity,created_at) VALUES (?,?)',[$identity,$this->now()]); $this->fail(401,'E-mail ou senha incorretos.'); }
        $this->run('DELETE FROM login_attempts WHERE identity=?',[$identity]);
        if (session_status()===PHP_SESSION_ACTIVE) { session_regenerate_id(true); }
        $_SESSION=['user_id'=>$user['id'],'csrf_token'=>bin2hex(random_bytes(32))];
        return $this->ok(['user'=>$this->user(),'csrf_token'=>$_SESSION['csrf_token']]);
    }
    private function scope(array $u, string $alias='t'): array {
        return match($u['role']) {
            'attendant'=>["$alias.attendant_id=?",[$u['id']]],
            'supervisor'=>["$alias.team_id=?",[$u['team_id']]],
            'client'=>["$alias.client_id=?",[$u['client_id']]],
            'manager'=>['1=1',[]],
            default=>['1=0',[]]
        };
    }
    private function ticketSelect(): string { return 'SELECT t.*,c.name client_name,c.city client_city,c.state client_state,u.name attendant_name,g.name team_name FROM tickets t JOIN clients c ON c.id=t.client_id JOIN users u ON u.id=t.attendant_id JOIN teams g ON g.id=t.team_id'; }
    private function ticket(array $u,int $id): array {
        $row=$this->one($this->ticketSelect().' WHERE t.id=?',[$id]);
        if (!$row) { $this->fail(404,'Atendimento nao encontrado.'); }
        [$scope,$params]=$this->scope($u);
        if (!$this->one("SELECT t.id FROM tickets t WHERE t.id=? AND $scope",[$id,...$params])) { $this->fail(403,'Este atendimento esta fora do seu acesso.'); }
        $row['replies']=$this->replies($u,$id);
        return $row;
    }
    private function replies(array $u,int $id): array {
        return $this->all('SELECT r.id,r.message,r.created_at,u.name author_name FROM ticket_replies r JOIN users u ON u.id=r.user_id WHERE r.ticket_id=? AND r.message IS NOT NULL'.($u['role']==='client'?" AND u.role='attendant'":'').' ORDER BY r.id',[$id]);
    }
    private function feedbackSelect(): string { return 'SELECT f.*,t.protocol ticket_protocol,t.status ticket_status,t.subject,t.client_id,t.attendant_id,t.team_id,t.category_id,c.name client_name,u.name attendant_name,g.name team_name FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id JOIN clients c ON c.id=t.client_id JOIN users u ON u.id=t.attendant_id JOIN teams g ON g.id=t.team_id'; }
    private function publicFeedback(array $row): array {
        $row['resolved']=(bool)$row['resolved']; $row['reviewed']=(bool)$row['reviewed'];
        $row['audio_url']=$row['audio_path']?'/api/feedbacks/'.$row['id'].'/audio':null;
        unset($row['audio_path']);
        $row['topics']=json_decode($row['topics']??'[]',true)?:[];
        $row['evidence']=json_decode($row['evidence']??'[]',true)?:[];
        $row['confidence']=$row['confidence']===null?null:(float)$row['confidence'];
        $row['model']=$row['analysis_model'];
        $row['reviews']=$this->all('SELECT r.id,r.reviewer_id,u.name reviewer_name,r.sentiment,r.criticality,r.justification,r.action,r.created_at FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE feedback_id=? ORDER BY r.id DESC',[$row['id']]);
        return $row;
    }
    private function feedbackById(array $u,int $id): array {
        $row=$this->one($this->feedbackSelect().' WHERE f.id=?',[$id]);
        if (!$row) { $this->fail(404,'Feedback nao encontrado.'); }
        $this->ticket($u,(int)$row['ticket_id']); return $row;
    }
    private function bootstrap(array $u): array {
        $this->maintenance(); [$scope,$params]=$this->scope($u);
        $tickets=$this->all($this->ticketSelect()." WHERE $scope ORDER BY t.id DESC",$params);
        foreach($tickets as &$ticket){$ticket['replies']=$this->replies($u,(int)$ticket['id']);}unset($ticket);
        $feedbacks=array_map(fn($r)=>$this->publicFeedback($r),$this->all($this->feedbackSelect()." WHERE $scope ORDER BY f.id DESC",$params));
        $clients=$u['role']==='client'?$this->all('SELECT id,name,city,state FROM clients WHERE id=?',[$u['client_id']]):$this->all('SELECT id,name,city,state FROM clients ORDER BY name');
        $teams=$u['role']==='manager'?$this->all('SELECT id,name FROM teams'):$this->all('SELECT id,name FROM teams WHERE id=?',[$u['team_id']??0]);
        $notifications=[];
        foreach ($tickets as $t) {
            if ($u['role']==='client' && $t['status']==='awaiting_feedback') { $notifications[]=['title'=>'A solucao funcionou?','message'=>'Confirme a resolucao de '.$t['protocol'].' em poucos segundos.','ticket_id'=>$t['id'],'due_at'=>$t['feedback_deadline'],'type'=>'feedback']; }
            if ($u['role']==='attendant' && $t['status']==='active' && !$t['replied_at'] && strtotime($t['response_due_at'])<=time()+86400) { $notifications[]=['title'=>strtotime($t['response_due_at'])<=time()?'Resposta atrasada':'Resposta prevista para hoje','message'=>'Lembre de responder ao cliente em '.$t['protocol'].'.','ticket_id'=>$t['id'],'due_at'=>$t['response_due_at'],'type'=>'response']; }
            if (in_array($u['role'],['attendant','supervisor'],true) && $t['rejected_at'] && $t['status']==='active') { $notifications[]=['title'=>'Cliente informou que nao resolveu','message'=>$t['protocol'].' precisa de revisao do supervisor.','ticket_id'=>$t['id'],'due_at'=>null,'type'=>'rejected']; }
        }
        if($u['role']==='supervisor'){
            foreach($feedbacks as $f){if($f['criticality']==='critical'&&!$f['reviewed']){$notifications[]=['title'=>'Feedback critico precisa de revisao','message'=>$f['protocol'].' apresenta um sinal para avaliacao humana.','ticket_id'=>$f['ticket_id'],'feedback_id'=>$f['id'],'due_at'=>null,'type'=>'critical'];}}
        }
        return $this->ok(['user'=>$u,'clients'=>$clients,'teams'=>$teams,'attendants'=>$this->all("SELECT id,name,team_id FROM users WHERE role='attendant'".($u['role']==='manager'?'':' AND team_id=?'),$u['role']==='manager'?[]:[$u['team_id']??0]),'categories'=>$this->all('SELECT * FROM categories'),'tickets'=>$tickets,'feedbacks'=>$feedbacks,'cases'=>$u['role']==='client'?[]:$this->cases($u,[]),'notifications'=>$notifications]);
    }
    private function attendant(array $u): void { if ($u['role']!=='attendant') { $this->fail(403,'Somente atendentes podem operar seus atendimentos.'); } }
    private function string(array $b,string $key,int $min,int $max): string {
        if (!isset($b[$key]) || !is_string($b[$key])) { $this->fail(422,'Preencha o campo '.$key.'.'); }
        $value=trim($b[$key]); if (mb_strlen($value)<$min || mb_strlen($value)>$max) { $this->fail(422,"O campo $key deve ter de $min a $max caracteres."); } return $value;
    }
    private function priority(mixed $value): string {
        if (!is_string($value) || !isset(self::RESPONSE_MINUTES[$value])) { $this->fail(400,'Informe a prioridade: low, medium, high ou critical.'); } return $value;
    }
    private function channel(mixed $value): string {
        if (!in_array($value,['Portal','Telefone','E-mail','Chat'],true)) { $this->fail(422,'Canal de atendimento invalido.'); } return $value;
    }
    private function createClient(array $u,array $b): array {
        if (!in_array($u['role'],['attendant','supervisor'],true)) { $this->fail(403,'Somente atendentes e supervisores podem cadastrar clientes.'); }
        if (array_diff(array_keys($b),['name','city','state'])) { $this->fail(422,'Informe apenas nome, cidade e UF do cliente.'); }
        $name=$this->string($b,'name',3,120);
        $city=isset($b['city'])&&is_string($b['city'])?trim($b['city']):'';
        if (mb_strlen($city)<2||mb_strlen($city)>80) { $this->fail(400,'Informe a cidade do cliente, de 2 a 80 caracteres.'); }
        $state=isset($b['state'])&&is_string($b['state'])?strtoupper(trim($b['state'])):'';
        if (!in_array($state,self::STATES,true)) { $this->fail(400,'Informe uma UF valida para o cliente.'); }
        $duplicate='Cliente ja cadastrado com esse nome.';
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            foreach ($this->all('SELECT name FROM clients') as $c) { if (mb_strtolower($c['name'])===mb_strtolower($name)) { $this->fail(409,$duplicate); } }
            $this->run('INSERT INTO clients(name,city,state) VALUES (?,?,?)',[$name,$city,$state]); $id=(int)$this->pdo->lastInsertId();
            $this->audit($u['id'],null,'client_created');
            $this->pdo->exec('COMMIT');
        } catch (\PDOException $e) {
            $this->pdo->exec('ROLLBACK');
            if ($e->getCode()==='23000') { $this->fail(409,$duplicate); }
            throw $e;
        } catch (Throwable $e) { $this->pdo->exec('ROLLBACK'); throw $e; }
        return $this->ok(['id'=>$id,'name'=>$name,'city'=>$city,'state'=>$state],201);
    }
    private function createTicket(array $u,array $b): array {
        $this->attendant($u); $subject=$this->string($b,'subject',5,180); $channel=$this->channel($b['channel']??null); $priority=$this->priority($b['priority']??null);
        if (!$this->one('SELECT id FROM clients WHERE id=?',[$b['client_id']??0])) { $this->fail(422,'Selecione um cliente cadastrado.'); }
        $category=isset($b['category_id']) && $b['category_id']!==''?(int)$b['category_id']:null;
        if ($category && !$this->one('SELECT id FROM categories WHERE id=?',[$category])) { $this->fail(422,'Categoria invalida.'); }
        $status='active'; $solution=null;
        if (array_key_exists('status',$b)) { if (!in_array($b['status'],['active','resolved'],true)) { $this->fail(422,'Status invalido. Use active ou resolved.'); } $status=$b['status']; }
        if ($status==='resolved') { $solution=$this->string($b,'solution',10,2000); }
        elseif (array_key_exists('solution',$b)) { $this->fail(422,'A solucao so pode ser informada ao registrar o atendimento como resolvido.'); }
        $now=$this->now(); $due=(new DateTimeImmutable($now))->modify('+'.self::RESPONSE_MINUTES[$priority].' minutes')->format(DATE_ATOM); $sent=$solution!==null?$now:null; $deadline=$sent?(new DateTimeImmutable($now))->modify(self::FEEDBACK_WINDOW)->format(DATE_ATOM):null;
        $this->pdo->beginTransaction();
        try {
            $this->run('INSERT INTO tickets(client_id,attendant_id,team_id,category_id,subject,channel,created_at,response_due_at,status,solution,solution_sent_at,feedback_deadline,replied_at,manual_status_changes,solution_attempt,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[(int)$b['client_id'],$u['id'],$u['team_id'],$category,$subject,$channel,$now,$due,$solution!==null?'awaiting_feedback':'active',$solution,$sent,$deadline,$sent,$solution!==null?1:0,$solution!==null?1:0,$priority]);
            $id=(int)$this->pdo->lastInsertId(); $protocol='ATD-'.date('Y').'-'.str_pad((string)$id,4,'0',STR_PAD_LEFT);
            $this->run('UPDATE tickets SET protocol=? WHERE id=?',[$protocol,$id]); $this->audit($u['id'],$id,'ticket_created'); if ($solution!==null) { $this->audit($u['id'],$id,'solution_sent'); } $this->pdo->commit();
        } catch(Throwable $e) { $this->pdo->rollBack(); throw $e; }
        return $this->ok($this->ticket($u,$id),201);
    }
    private function editTicket(array $u,int $id,array $b): array {
        $this->attendant($u); $ticket=$this->ticket($u,$id);
        if (array_diff(array_keys($b),['subject','channel','response_due_at','category_id'])) { $this->fail(422,'Altere apenas os dados do atendimento. O status e controlado pelo fluxo de solucao.'); }
        if (!in_array($ticket['status'],['active','awaiting_feedback'],true)) { $this->fail(409,'Atendimento encerrado nao pode ser alterado.'); }
        $sets=[];$params=[];
        unset($b['response_due_at']);
        foreach ($b as $key=>$value) {
            $value=match($key) {'subject'=>$this->string($b,$key,5,180),'channel'=>$this->channel($value),'category_id'=>$value?(int)$value:null};
            if ($key==='category_id' && $value && !$this->one('SELECT id FROM categories WHERE id=?',[$value])) { $this->fail(422,'Categoria invalida.'); }
            $sets[]="$key=?";$params[]=$value;
        }
        if (!$sets) { $this->fail(422,'Informe os dados que deseja atualizar.'); }
        $this->run('UPDATE tickets SET '.implode(',',$sets).' WHERE id=?',[...$params,$id]); $this->audit($u['id'],$id,'ticket_updated'); return $this->ok($this->ticket($u,$id));
    }
    private function sendSolution(array $u,array $t,array $b): array {
        $this->attendant($u); $solution=$this->string($b,'solution',10,2000);
        $now=$this->now();$deadline=(new DateTimeImmutable($now))->modify(self::FEEDBACK_WINDOW)->format(DATE_ATOM);
        $s=$this->run("UPDATE tickets SET status='awaiting_feedback',solution=?,solution_sent_at=?,feedback_deadline=?,manual_status_changes=1,solution_attempt=solution_attempt+1,replied_at=? WHERE id=? AND attendant_id=? AND status='active' AND manual_status_changes=0",[$solution,$now,$deadline,$now,$t['id'],$u['id']]);
        if ($s->rowCount()!==1) { $this->fail(409,'A mudanca manual ja foi utilizada. Aguarde o cliente ou solicite revisao do supervisor.'); }
        $this->audit($u['id'],$t['id'],'solution_sent'); return $this->ok($this->ticket($u,(int)$t['id']));
    }
    private function reply(array $u,array $t,array $b): array {
        $this->attendant($u);$message=$this->string($b,'message',5,2000);
        if ($t['status']!=='active') { $this->fail(409,'Envie mensagens apenas em atendimentos ativos.'); }
        $now=$this->now();$this->run('INSERT INTO ticket_replies(ticket_id,user_id,message,created_at) VALUES (?,?,?,?)',[$t['id'],$u['id'],$message,$now]);$this->run('UPDATE tickets SET replied_at=? WHERE id=?',[$now,$t['id']]);$this->audit($u['id'],$t['id'],'client_reply_recorded');return $this->ok($this->ticket($u,(int)$t['id']));
    }
    private function retry(array $u,array $t,array $b): array {
        if($u['role']!=='supervisor'){$this->fail(403,'Somente a supervisao pode encaminhar uma nova solucao apos a rejeicao.');}
        $solution=$this->string($b,'solution',10,2000);$justification=$this->string($b,'justification',10,1000);$now=$this->now();$deadline=(new DateTimeImmutable($now))->modify(self::FEEDBACK_WINDOW)->format(DATE_ATOM);
        $this->pdo->beginTransaction();
        try {
            $updated=$this->run("UPDATE tickets SET status='awaiting_feedback',solution=?,solution_sent_at=?,feedback_deadline=?,replied_at=?,solution_attempt=solution_attempt+1,rejected_at=NULL WHERE id=? AND team_id=? AND status='active' AND rejected_at IS NOT NULL",[$solution,$now,$deadline,$now,$t['id'],$u['team_id']]);
            if($updated->rowCount()!==1){$this->fail(409,'Nova tentativa exige rejeicao anterior do cliente em atendimento ativo.');}
            $this->run('INSERT INTO ticket_replies(ticket_id,user_id,message,created_at) VALUES (?,?,?,?)',[$t['id'],$u['id'],'Justificativa da nova tentativa: '.$justification,$now]);$this->audit($u['id'],$t['id'],'supervisor_solution_retry');$this->pdo->commit();
        }catch(Throwable $e){$this->pdo->rollBack();throw $e;}
        return $this->ok($this->ticket($u,(int)$t['id']));
    }
    private function escalate(array $u,array $t,array $b): array {
        if($u['role']!=='supervisor'){$this->fail(403,'Somente a supervisao pode escalar o nivel de suporte.');}
        $level=$b['level']??null;
        if(!is_int($level)||$level<1||$level>3){$this->fail(400,'Informe o nivel de suporte 2 ou 3.');}
        if($level<=(int)$t['support_level']){$this->fail(400,'O nivel so pode aumentar. Nivel atual: '.$t['support_level'].'.');}
        $updated=$this->run('UPDATE tickets SET support_level=? WHERE id=? AND support_level<?',[$level,$t['id'],$level]);
        if($updated->rowCount()!==1){$this->fail(400,'O nivel so pode aumentar.');}
        $this->audit($u['id'],(int)$t['id'],'ticket_escalated_level_'.$level);
        return $this->ok($this->ticket($u,(int)$t['id']));
    }
    private function cases(array $u,array $q): array {
        if ($u['role']==='client') { $this->fail(403,'Cases internos sao exclusivos da equipe.'); }
        $where=['1=1'];$params=[];
        if ($u['role']!=='manager') {$where[]='team_id=?';$params[]=$u['team_id'];}
        if (!empty($q['category_id'])) {$where[]='category_id=?';$params[]=(int)$q['category_id'];}
        $search=trim((string)($q['q']??''));
        if ($search!=='') { $where[]='(subject LIKE ? OR solution LIKE ? OR tags LIKE ?)';$needle='%'.$search.'%';array_push($params,$needle,$needle,$needle); }
        return $this->all('SELECT id,ticket_id,category_id,team_id,subject,solution,tags,usage_count,created_at FROM resolution_cases WHERE '.implode(' AND ',$where).' ORDER BY usage_count DESC,id DESC LIMIT 12',$params);
    }
    private function wav(array $file): array {
        if (($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK || !is_file($file['tmp_name']??'')) { $this->fail(422,'Nao foi possivel receber a gravacao.'); }
        $size=filesize($file['tmp_name']);
        if ($size<44 || $size>6*1024*1024) { $this->fail(422,'Audio invalido ou maior que 6 MB.'); }
        $bytes=file_get_contents($file['tmp_name']);
        if (substr($bytes,0,4)!=='RIFF' || substr($bytes,8,4)!=='WAVE' || unpack('V',substr($bytes,4,4))[1]+8!==$size) { $this->fail(422,'Envie uma gravacao WAV PCM valida.'); }
        $offset=12;$format=null;$data=null;
        while ($offset+8<=$size) {
            $tag=substr($bytes,$offset,4);$length=unpack('V',substr($bytes,$offset+4,4))[1];$offset+=8;
            if ($offset+$length>$size) { $this->fail(422,'Gravacao WAV incompleta.'); }
            if ($tag==='fmt ' && $length>=16) {$format=unpack('vcodec/vchannels/Vrate/Vbyte_rate/valign/vbits',substr($bytes,$offset,16));}
            if ($tag==='data') {if($data!==null){$this->fail(422,'Gravacao WAV invalida.');}$data=$length;}
            $offset+=$length+($length%2);
        }
        if (!$format || $format['codec']!==1 || $format['channels']!==1 || $format['bits']!==16 || $format['rate']<8000 || $format['rate']>48000 || $format['align']!==2 || $format['byte_rate']!==$format['rate']*2 || !$data || $data%2!==0) { $this->fail(422,'A gravacao deve ser WAV PCM mono de 16 bits.'); }
        $seconds=$data/$format['byte_rate'];if ($seconds>60 || $seconds<0.1) {$this->fail(422,'Grave entre 0,1 e 60 segundos.');}
        return [$file['tmp_name'],$seconds];
    }
    private function feedback(array $u,array $b,array $files): array {
        if ($u['role']!=='client') {$this->fail(403,'Somente o cliente pode confirmar e avaliar a resolucao.');}
        $this->maintenance();
        $t=$this->ticket($u,(int)($b['ticket_id']??0));
        if ($t['status']!=='awaiting_feedback' || $this->one('SELECT id FROM feedbacks WHERE ticket_id=? AND attempt=?',[$t['id'],$t['solution_attempt']])) {$this->fail(409,'Este atendimento nao esta aguardando um novo feedback.');}
        $rating=filter_var($b['rating']??null,FILTER_VALIDATE_INT); if (!$rating || $rating<1 || $rating>5) {$this->fail(422,'Escolha uma nota de 1 a 5.');}
        $resolved=match($b['resolved']??null){true,1,'1','true'=>1,false,0,'0','false'=>0,default=>null};if($resolved===null){$this->fail(422,'Informe se a solucao funcionou.');}
        $mode=$b['mode']??null;if(!in_array($mode,['quick','text','audio'],true)){$this->fail(422,'Escolha uma forma de enviar o feedback.');}
        $text=isset($b['text'])&&is_string($b['text'])?trim($b['text']):'';
        if (($mode!=='audio' && $files) || ($mode==='audio' && $text!=='') || ($mode==='quick' && $text!=='')) {$this->fail(422,'Use apenas uma forma de feedback por envio.');}
        if ($mode==='text' && ($text==='' || mb_strlen($text)>500 || count(preg_split('/\r\n|\r|\n/',$text))>5)) {$this->fail(422,'Escreva ate 500 caracteres em no maximo 5 linhas.');}
        $text=self::maskSensitive($text);
        $temp=null;$seconds=null;$audio=null;
        if($mode==='audio') {if(array_keys($files)!==['audio']){$this->fail(422,'Envie apenas a gravacao de audio.');}[$temp,$seconds]=$this->wav($files['audio']);$audio=bin2hex(random_bytes(20)).'.wav';}
        $sentiment=$mode==='quick'?($rating>=4?'positive':($rating<=2?'negative':'neutral')):'pending';
        $criticality=!$resolved||preg_match('/parad|perdemos|cancel|tres vezes|urgente|indispon|prejuizo/ui',$text)?'critical':'regular';
        $summary=$mode==='quick'?($resolved?'Cliente confirmou a resolucao em avaliacao rapida.':'Cliente informou que o problema continua.'):null;
        $now=$this->now();
        $this->pdo->beginTransaction();
        try {
            $fresh=$this->one('SELECT status,solution_attempt,feedback_deadline FROM tickets WHERE id=?',[$t['id']]);
            if($fresh['status']!=='awaiting_feedback' || $fresh['feedback_deadline'] <= $this->now()){$this->fail(409,'O atendimento nao esta mais aguardando feedback.');}
            if($audio){$dir=$this->storage.'/audio';if(!is_dir($dir)){mkdir($dir,0700,true);}if(!copy($temp,$dir.'/'.$audio)){throw new RuntimeException('Falha ao armazenar audio.');}}
            $this->run('INSERT INTO feedbacks(ticket_id,attempt,rating,resolved,mode,text,audio_path,audio_seconds,sentiment,criticality,summary,created_at,analysis_status,analysis_source,original_sentiment,original_criticality,original_summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[$t['id'],$fresh['solution_attempt'],$rating,$resolved,$mode,$text!==''?$text:null,$audio,$seconds,$sentiment,$criticality,$summary,$now,$mode==='quick'?'not_required':'pending',$mode==='quick'?'rating':'pending',$mode==='quick'?$sentiment:null,$mode==='quick'?$criticality:null,$mode==='quick'?$summary:null]);
            $id=(int)$this->pdo->lastInsertId();$this->run('UPDATE feedbacks SET protocol=? WHERE id=?',['FDB-'.date('Y').'-'.str_pad((string)$id,4,'0',STR_PAD_LEFT),$id]);
            if($resolved){$this->run("UPDATE tickets SET status='resolved',closed_at=?,closure_reason='client_confirmed',feedback_deadline=NULL WHERE id=?",[$now,$t['id']]);$this->run('INSERT INTO resolution_cases(ticket_id,category_id,team_id,subject,solution,tags,created_at) VALUES (?,?,?,?,?,?,?)',[$t['id'],$t['category_id'],$t['team_id'],$t['subject'],$t['solution'],'confirmado pelo cliente',$now]);}
            else {$this->run("UPDATE tickets SET status='active',feedback_deadline=NULL,rejected_at=?,closed_at=NULL,closure_reason=NULL WHERE id=?",[$now,$t['id']]);}
            $this->audit($u['id'],$t['id'],$resolved?'client_confirmed':'client_rejected');$this->pdo->commit();
        }catch(Throwable $e){$this->pdo->rollBack();if($audio){@unlink($this->storage.'/audio/'.$audio);}throw $e;}
        return $this->ok($this->publicFeedback($this->feedbackById($u,$id)),201);
    }
    private function review(array $u,array $f,array $b): array {
        if($u['role']!=='supervisor'){$this->fail(403,'Somente supervisores podem revisar feedbacks da equipe.');}
        $sentiment=$b['sentiment']??null;$criticality=$b['criticality']??null;
        if(!in_array($sentiment,['positive','neutral','negative'],true)||!in_array($criticality,['critical','regular'],true)){$this->fail(422,'Classificacao de revisao invalida.');}
        if($f['redacted_at']){$this->fail(409,'O conteudo deste feedback ja foi removido pela retencao.');}
        $justification=$this->string($b,'justification',10,1000);$action=$this->string($b,'action',5,1000);
        $this->pdo->beginTransaction();try{$this->run('INSERT INTO reviews(feedback_id,reviewer_id,sentiment,criticality,justification,action,created_at) VALUES (?,?,?,?,?,?,?)',[$f['id'],$u['id'],$sentiment,$criticality,$justification,$action,$this->now()]);$this->run('UPDATE feedbacks SET sentiment=?,criticality=?,reviewed=1 WHERE id=?',[$sentiment,$criticality,$f['id']]);$this->audit($u['id'],$f['ticket_id'],'human_review');$this->pdo->commit();}catch(Throwable $e){$this->pdo->rollBack();throw $e;}
        return $this->ok($this->publicFeedback($this->feedbackById($u,(int)$f['id'])));
    }
    private function retryAnalysis(array $u,array $f): array {
        if($u['role']!=='supervisor'){$this->fail(403,'Somente supervisores podem tentar a analise novamente.');}
        if($f['redacted_at']){$this->fail(409,'O conteudo deste feedback foi removido pela retencao.');}
        $updated=$this->run("UPDATE feedbacks SET analysis_status='pending',analysis_error=NULL,analysis_started_at=NULL WHERE id=? AND analysis_status='failed' AND redacted_at IS NULL",[$f['id']]);
        if(!$updated->rowCount()){$this->fail(409,'Somente uma analise com falha pode ser reenviada.');}
        $this->audit($u['id'],(int)$f['ticket_id'],'analysis_retried');
        return $this->ok($this->publicFeedback($this->feedbackById($u,(int)$f['id'])));
    }
    private function audit(?int $user,?int $ticket,string $event): void {$this->run('INSERT INTO audit_events(user_id,ticket_id,event,created_at) VALUES (?,?,?,?)',[$user,$ticket,$event,$this->now()]);}

    private function redactContent(int $id,string $stamp): bool {
        $updated=$this->run("UPDATE feedbacks SET text=NULL,audio_path=NULL,summary=NULL,transcript=NULL,topics=NULL,evidence=NULL,original_summary=NULL,analysis_error=NULL,analysis_status=CASE WHEN analysis_status IN ('pending','processing','failed') THEN 'not_required' ELSE analysis_status END,redacted_at=? WHERE id=? AND redacted_at IS NULL",[$stamp,$id]);
        if(!$updated->rowCount()){return false;}
        $this->run('UPDATE reviews SET justification=NULL,action=NULL WHERE feedback_id=?',[$id]);
        return true;
    }

    private function removeAudio(string $name): bool {
        $file=$this->storage.'/audio/'.$name;
        if(!file_exists($file)){return false;}
        if(@unlink($file)){return true;}
        error_log('CTI redact: nao foi possivel apagar o audio '.basename($name));
        return false;
    }

    public function redactFeedback(int $id): array {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $f=$this->one('SELECT id,ticket_id,protocol,audio_path,redacted_at FROM feedbacks WHERE id=?',[$id]);
            if(!$f){throw new RuntimeException("Feedback $id nao encontrado.");}
            $stamp=$this->now();
            $done=$f['redacted_at']===null&&$this->redactContent($id,$stamp);
            if($done){$this->audit(null,(int)$f['ticket_id'],'content_redacted');}
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) { $this->pdo->exec('ROLLBACK'); throw $e; }
        $audioRemoved=$done&&$f['audio_path']&&$this->removeAudio($f['audio_path']);
        return ['feedback_id'=>$id,'protocol'=>$f['protocol'],'status'=>$done?'redacted':'already_redacted','redacted_at'=>$done?$stamp:$f['redacted_at'],'audio_removed'=>$audioRemoved];
    }

    public function maintenance(?DateTimeImmutable $now=null): array {
        $now=($now??new DateTimeImmutable())->setTimezone(new DateTimeZone('UTC'));$stamp=$now->format(DATE_ATOM);$cutoff=$now->modify('-12 months')->format(DATE_ATOM);
        $expired=$this->all("SELECT t.id FROM tickets t WHERE status='awaiting_feedback' AND feedback_deadline<=? AND rejected_at IS NULL AND NOT EXISTS(SELECT 1 FROM feedbacks f WHERE f.ticket_id=t.id AND f.attempt=t.solution_attempt)",[$stamp]);
        $closed=0;foreach($expired as $t){$s=$this->run("UPDATE tickets SET status='closed_no_response',closed_at=?,closure_reason='no_response_72h' WHERE id=? AND status='awaiting_feedback'",[$stamp,$t['id']]);if($s->rowCount()){ $this->audit(null,$t['id'],'closed_no_response_72h');$closed++;}}
        $old=$this->all('SELECT id,audio_path FROM feedbacks WHERE created_at<? AND redacted_at IS NULL',[$cutoff]);
        foreach($old as $f){if($this->redactContent((int)$f['id'],$stamp)&&$f['audio_path']){$this->removeAudio($f['audio_path']);}}
        $this->run('UPDATE ticket_replies SET message=NULL WHERE created_at<?',[$cutoff]);$this->run('DELETE FROM login_attempts WHERE created_at<?',[$now->modify('-1 day')->format(DATE_ATOM)]);
        return ['closed_no_response'=>$closed,'redacted_feedbacks'=>count($old),'executed_at'=>$stamp];
    }

    public function backup(string $dir,int $keep=30,?DateTimeImmutable $now=null): array {
        if($keep<1){throw new RuntimeException('--keep deve ser um inteiro maior ou igual a 1.');}
        $root=rtrim($dir,'/\\');
        $target=$root.'/cti-backup-'.($now??new DateTimeImmutable())->format('Ymd-His');
        if(file_exists($target)){throw new RuntimeException('Ja existe um backup em '.$target.'. Aguarde um segundo e tente de novo.');}
        if(!mkdir($target,0700,true)){throw new RuntimeException('Nao foi possivel criar '.$target.'.');}
        $this->pdo->exec('VACUUM INTO '.$this->pdo->quote($target.'/cti.sqlite'));
        $audio=$this->storage.'/audio';
        if(is_dir($audio)){self::copyDir($audio,$target.'/audio');}
        $bytes=0;
        foreach(new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($target,\FilesystemIterator::SKIP_DOTS)) as $f){$bytes+=$f->getSize();}
        $names=array_values(array_filter(scandir($root),fn($n)=>preg_match('/^cti-backup-\d{8}-\d{6}$/',$n)&&is_dir("$root/$n")&&!is_link("$root/$n")));
        rsort($names);$removed=[];
        foreach(array_slice($names,$keep) as $n){self::removeDir("$root/$n");$removed[]=$n;}
        return ['path'=>$target,'bytes'=>$bytes,'removed'=>$removed];
    }
    private static function copyDir(string $from,string $to): void {
        mkdir($to,0700,true);
        foreach(array_diff(scandir($from),['.','..']) as $n){
            if(is_dir("$from/$n")){self::copyDir("$from/$n","$to/$n");}
            elseif(!copy("$from/$n","$to/$n")){throw new RuntimeException('Falha ao copiar '.$n.'.');}
        }
    }
    private static function removeDir(string $dir): void {
        foreach(array_diff(scandir($dir),['.','..']) as $n){is_dir("$dir/$n")&&!is_link("$dir/$n")?self::removeDir("$dir/$n"):unlink("$dir/$n");}
        rmdir($dir);
    }

    private function comparison(array $where,array $params,array $q): array {
        $today=new DateTimeImmutable('today',new DateTimeZone('UTC'));
        if(!empty($q['from'])&&!empty($q['to'])){
            [$from,$to]=array_map(fn($v)=>DateTimeImmutable::createFromFormat('!Y-m-d',(string)$v,new DateTimeZone('UTC')),[$q['from'],$q['to']]);
            if(!$from||!$to||$from->format('Y-m-d')!==$q['from']||$to->format('Y-m-d')!==$q['to']){$this->fail(422,'Datas de filtro invalidas.');}
        } else { $to=$today;$from=$today->modify('-29 days'); }
        $days=max(1,(int)$from->diff($to)->days+1);
        $previousTo=$from->modify('-1 day');$previousFrom=$previousTo->modify('-'.($days-1).' days');
        $window=function(DateTimeImmutable $start,DateTimeImmutable $end) use ($where,$params): array {
            $row=$this->one("SELECT COUNT(*) received,COALESCE(SUM(f.sentiment IN ('positive','neutral','negative')),0) analyzed,COALESCE(SUM(f.sentiment='negative'),0) negative,COALESCE(SUM(f.criticality='critical'),0) critical FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE substr(f.created_at,1,10)>=? AND substr(f.created_at,1,10)<=? AND ".implode(' AND ',$where),[$start->format('Y-m-d'),$end->format('Y-m-d'),...$params]);
            return ['from'=>$start->format('Y-m-d'),'to'=>$end->format('Y-m-d'),'received'=>(int)$row['received'],'negative_percent'=>(int)$row['analyzed']?(int)round($row['negative']/$row['analyzed']*100):0,'critical'=>(int)$row['critical'],'negative'=>(int)$row['negative']];
        };
        return ['current'=>$window($from,$to),'previous'=>$window($previousFrom,$previousTo)];
    }

    private function deadline(array $tickets): array {
        $out=['on_time'=>0,'late'=>0,'awaiting_on_time'=>0,'overdue'=>0,'total'=>count($tickets)];$now=time();
        foreach($tickets as $t){
            $due=strtotime($t['response_due_at']);
            $out[$t['replied_at']!==null?(strtotime($t['replied_at'])<=$due?'on_time':'late'):($due>=$now?'awaiting_on_time':'overdue')]++;
        }
        return $out;
    }
    private function countBy(array $tickets,string $field,array $keys): array {
        $out=array_fill_keys($keys,0);
        foreach($tickets as $t){$out[$t[$field]]++;}
        return $out;
    }

    private function report(array $u,array $q,bool $export): array {
        if($u['role']==='client'){$this->fail(403,'Relatorios internos sao exclusivos da equipe.');}
        [$scope,$params]=$this->scope($u);$where=[$scope];
        foreach(['team_id','attendant_id','client_id'] as $key){if(!empty($q[$key])){if(!ctype_digit((string)$q[$key])){$this->fail(422,'Filtro invalido.');}$where[]="t.$key=?";$params[]=(int)$q[$key];}}
        if(!empty($q['channel'])){$where[]='t.channel=?';$params[]=$q['channel'];}
        if(!empty($q['q'])){$where[]='t.subject LIKE ?';$params[]='%'.trim((string)$q['q']).'%';}
        $baseWhere=$where;$baseParams=$params;
        foreach(['from'=>'>=','to'=>'<='] as $key=>$op){if(!empty($q[$key])){if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',(string)$q[$key])){$this->fail(422,'Datas de filtro invalidas.');}$where[]="substr(t.created_at,1,10)$op?";$params[]=$q[$key];}}
        $ticketWhere=implode(' AND ',$where);
        $tickets=$this->all($this->ticketSelect().' WHERE '.$ticketWhere,$params);
        $feedbackWhere=$baseWhere;$fp=$baseParams;
        foreach(['from'=>'>=','to'=>'<='] as $key=>$op){if(!empty($q[$key])){$feedbackWhere[]="substr(f.created_at,1,10)$op?";$fp[]=$q[$key];}}
        $otherWhere=[];$otherParams=[];
        foreach(['sentiment','criticality','mode'] as $key){if(!empty($q[$key])){$otherWhere[]="f.$key=?";$otherParams[]=$q[$key];}}
        if(($q['type']??'')==='criticality'){$otherWhere[]="f.criticality='critical'";}
        $feedbackWhere=[...$feedbackWhere,...$otherWhere];$fp=[...$fp,...$otherParams];
        $feedbacks=$this->all($this->feedbackSelect().' WHERE '.implode(' AND ',$feedbackWhere),$fp);
        if(!empty($q['sentiment'])||!empty($q['criticality'])||!empty($q['mode'])||($q['type']??'')==='criticality'){$ids=array_column($feedbacks,'ticket_id');$tickets=array_values(array_filter($tickets,fn($t)=>in_array($t['id'],$ids,true)));}
        $sentiments=['positive'=>0,'neutral'=>0,'negative'=>0];$trend=[];$topics=[];$critical=[];
        foreach($feedbacks as $f){if(isset($sentiments[$f['sentiment']])){$sentiments[$f['sentiment']]++;}$day=substr($f['created_at'],0,10);$trend[$day]??=['date'=>$day,'positive'=>0,'neutral'=>0,'negative'=>0];if(isset($trend[$day][$f['sentiment']])){$trend[$day][$f['sentiment']]++;}$topics[$f['subject']]=($topics[$f['subject']]??0)+1;if($f['criticality']==='critical'){$critical[]=$this->publicFeedback($f);}}
        ksort($trend);arsort($topics);$topicRows=[];foreach(array_slice($topics,0,6,true) as $subject=>$count){$topicRows[]=['subject'=>$subject,'count'=>$count];}
        $teams=[];foreach($tickets as $t){$id=$t['team_id'];$teams[$id]??=['id'=>$id,'name'=>$t['team_name'],'tickets'=>0,'received'=>0,'analyzed'=>0,'positive'=>0,'critical'=>0,'critical_resolved'=>0,'resolved'=>0];$teams[$id]['tickets']++;if($t['status']==='resolved'){$teams[$id]['resolved']++;}}
        foreach($feedbacks as $f){$id=$f['team_id'];$teams[$id]??=['id'=>$id,'name'=>$f['team_name'],'tickets'=>0,'received'=>0,'analyzed'=>0,'positive'=>0,'critical'=>0,'critical_resolved'=>0,'resolved'=>0];$teams[$id]['received']++;if(isset($sentiments[$f['sentiment']])){$teams[$id]['analyzed']++;}if($f['sentiment']==='positive'){$teams[$id]['positive']++;}if($f['criticality']==='critical'){$teams[$id]['critical']++;if($f['ticket_status']==='resolved'){$teams[$id]['critical_resolved']++;}}}
        $comparison=$export?null:$this->comparison([...$baseWhere,...$otherWhere],[...$baseParams,...$otherParams],$q);
        $analyzed=array_sum($sentiments);$countStatus=fn(string $status)=>count(array_filter($tickets,fn($t)=>$t['status']===$status));
        $report=['received'=>count($feedbacks),'analyzed'=>$analyzed,'positive_percent'=>$analyzed?round($sentiments['positive']/$analyzed*100):0,'critical'=>count($critical),'total_tickets'=>count($tickets),'awaiting_feedback'=>$countStatus('awaiting_feedback'),'resolved'=>$countStatus('resolved'),'closed_no_response'=>$countStatus('closed_no_response'),'active'=>$countStatus('active'),'sentiments'=>$sentiments,'trend'=>array_values($trend),'topics'=>$topicRows,'teams'=>array_values($teams),'critical_cases'=>$critical,'response_overdue'=>$u['role']!=='attendant'?[]:array_values(array_filter($tickets,fn($t)=>$t['status']==='active'&&!$t['replied_at']&&strtotime($t['response_due_at'])<time())),'comparison'=>$comparison,'deadline'=>$this->deadline($tickets),'by_priority'=>$this->countBy($tickets,'priority',array_keys(self::RESPONSE_MINUTES)),'by_support_level'=>$this->countBy($tickets,'support_level',[1,2,3]),'filters'=>$q];
        if(!$export){return $this->ok($report);}
        $stream=fopen('php://temp','w+');fwrite($stream,"\xEF\xBB\xBF");fputcsv($stream,['Protocolo','Assunto','Equipe','Canal','Status','Data','Encerramento'],';', '"', '');
        foreach($tickets as $t){$row=[$t['protocol'],$t['subject'],$t['team_name'],$t['channel'],$t['status'],$t['created_at'],$t['closure_reason']??''];$row=array_map(static fn($v)=>preg_match('/^[\s]*[=+@\-\t\r]/u',(string)$v)?"'".$v:$v,$row);fputcsv($stream,$row,';', '"', '');}rewind($stream);$csv=stream_get_contents($stream);fclose($stream);
        return ['status'=>200,'raw'=>$csv,'headers'=>['Content-Type'=>'text/csv; charset=utf-8','Content-Disposition'=>'attachment; filename="cti-relatorio-'.date('Y-m-d').'.csv"']];
    }
}
