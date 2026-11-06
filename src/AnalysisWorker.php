<?php
declare(strict_types=1);

namespace Cti;

use Closure;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;
use Throwable;

final class AnalysisWorker {
    private Closure $runner;

    public function __construct(private PDO $pdo,private string $storage,?callable $runner=null) {
        $this->runner=$runner===null?$this->invoke(...):Closure::fromCallable($runner);
    }

    private function now(): string {return (new DateTimeImmutable('now',new DateTimeZone('UTC')))->format(DATE_ATOM);}
    private function run(string $sql,array $params=[]): \PDOStatement {$s=$this->pdo->prepare($sql);$s->execute($params);return $s;}

    public function processOne(): ?array {
        $stale=(new DateTimeImmutable('-15 minutes',new DateTimeZone('UTC')))->format(DATE_ATOM);
        $this->run("UPDATE feedbacks SET analysis_status='failed',analysis_error='O processamento foi interrompido. Solicite uma nova tentativa ao supervisor.' WHERE analysis_status='processing' AND analysis_started_at<? AND redacted_at IS NULL",[$stale]);
        $claim=$this->run("UPDATE feedbacks SET analysis_status='processing',analysis_started_at=?,analysis_attempts=analysis_attempts+1,analysis_error=NULL WHERE id=(SELECT id FROM feedbacks WHERE analysis_status='pending' AND redacted_at IS NULL ORDER BY id LIMIT 1) AND analysis_status='pending' AND redacted_at IS NULL RETURNING *",[$this->now()]);
        $job=$claim->fetch(PDO::FETCH_ASSOC);
        $claim->closeCursor();
        if(!$job){return null;}
        try {
            $audio=null;
            if($job['mode']==='audio'){
                $audio=$this->storage.'/audio/'.$job['audio_path'];
                $root=realpath($this->storage.'/audio');$resolved=realpath($audio);
                if(!$root || !$resolved || !str_starts_with($resolved,$root.DIRECTORY_SEPARATOR) || !is_file($resolved)){throw new RuntimeException('Gravacao privada indisponivel.');}
                $audio=$resolved;
            }
            $result=($this->runner)(['text'=>$job['mode']==='text'?$job['text']:null,'audio_path'=>$audio]);
            $result=$this->validate($result,$job['mode']);
            $criticality=!(bool)$job['resolved']?'critical':$result['criticality'];
            $updated=$this->run("UPDATE feedbacks SET analysis_status='completed',analysis_error=NULL,analyzed_at=?,transcript=?,confidence=?,topics=?,evidence=?,analysis_model=?,transcription_model=?,original_sentiment=?,original_criticality=?,original_summary=?,analysis_source='local_model',sentiment=CASE WHEN reviewed=0 THEN ? ELSE sentiment END,criticality=CASE WHEN reviewed=0 THEN ? ELSE criticality END,summary=? WHERE id=? AND analysis_status='processing' AND analysis_attempts=? AND redacted_at IS NULL",[$this->now(),$result['transcript'],$result['confidence'],json_encode($result['topics'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),json_encode($result['evidence'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$result['model'],$result['transcription_model'],$result['sentiment'],$criticality,$result['summary'],$result['sentiment'],$criticality,$result['summary'],$job['id'],$job['analysis_attempts']]);
            return ['id'=>(int)$job['id'],'status'=>$updated->rowCount()?'completed':'discarded'];
        } catch(Throwable $e){
            error_log('CTI analysis feedback '.(int)$job['id'].': '.$e->getMessage());
            $updated=$this->run("UPDATE feedbacks SET analysis_status='failed',analysis_error='Nao foi possivel concluir a analise. O supervisor pode tentar novamente.' WHERE id=? AND analysis_status='processing' AND analysis_attempts=? AND redacted_at IS NULL",[$job['id'],$job['analysis_attempts']]);
            return ['id'=>(int)$job['id'],'status'=>$updated->rowCount()?'failed':'discarded'];
        }
    }

    private function validate(mixed $result,string $mode): array {
        if(!is_array($result) || !in_array($result['sentiment']??null,['positive','neutral','negative'],true) || !in_array($result['criticality']??null,['critical','regular'],true)) {throw new RuntimeException('Resultado de classificacao invalido.');}
        if(!isset($result['confidence']) || !is_numeric($result['confidence']) || !is_finite((float)$result['confidence']) || $result['confidence']<0 || $result['confidence']>1){throw new RuntimeException('Score de modelo invalido.');}
        foreach(['summary'=>1000,'model'=>180] as $key=>$limit){if(!isset($result[$key]) || !is_string($result[$key]) || trim($result[$key])==='' || mb_strlen($result[$key])>$limit){throw new RuntimeException('Campo de analise invalido: '.$key);}}
        foreach(['topics','evidence'] as $key){if(!isset($result[$key]) || !is_array($result[$key]) || !array_is_list($result[$key]) || count($result[$key])>20){throw new RuntimeException('Lista de analise invalida.');}foreach($result[$key] as $text){if(!is_string($text) || mb_strlen($text)>1000){throw new RuntimeException('Trecho de analise invalido.');}}}
        $result['transcript']=$result['transcript']??null;
        $result['transcription_model']=$result['transcription_model']??null;
        if($mode==='audio' && (!is_string($result['transcript']) || trim($result['transcript'])==='' || mb_strlen($result['transcript'])>16000 || !is_string($result['transcription_model']) || trim($result['transcription_model'])==='' || mb_strlen($result['transcription_model'])>180)){throw new RuntimeException('Transcricao invalida ou ausente.');}
        if($mode!=='audio'){$result['transcript']=null;$result['transcription_model']=null;}
        foreach(['transcript','summary'] as $key){if(is_string($result[$key])){$result[$key]=App::maskSensitive($result[$key]);}}
        foreach(['topics','evidence'] as $key){$result[$key]=array_map(App::maskSensitive(...),$result[$key]);}
        return $result;
    }

    private function invoke(array $input): array {
        $root=dirname(__DIR__);
        $outputFile=tempnam($this->storage,'analysis-out-');$errorFile=tempnam($this->storage,'analysis-err-');
        if($outputFile===false || $errorFile===false){if($outputFile){@unlink($outputFile);}if($errorFile){@unlink($errorFile);}throw new RuntimeException('Nao foi possivel reservar saida privada do motor.');}
        @chmod($outputFile,0600);@chmod($errorFile,0600);
        $process=null;$pipes=[];$exit=null;
        $timeout=max(1,min(600,(int)(getenv('CTI_ANALYSIS_TIMEOUT')?:300)));
        try {
            $process=proc_open([getenv('CTI_NODE_PATH')?:'node',$root.'/ai/analyze.mjs'],[0=>['pipe','r'],1=>['file',$outputFile,'w'],2=>['file',$errorFile,'w']],$pipes,$root,null,['bypass_shell'=>true]);
            if(!is_resource($process)){throw new RuntimeException('Nao foi possivel iniciar o motor local.');}
            fwrite($pipes[0],json_encode($input,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));fclose($pipes[0]);
            $deadline=microtime(true)+$timeout;
            do {
                clearstatcache(true,$outputFile);clearstatcache(true,$errorFile);
                if(filesize($outputFile)>131072 || filesize($errorFile)>1048576){throw new RuntimeException('Saida do motor excedeu o limite.');}
                $status=proc_get_status($process);
                if(!$status['running']){$exit=$status['exitcode'];break;}
                if(microtime(true)>$deadline){throw new RuntimeException('Tempo limite do processamento excedido.');}
                usleep(50000);
            }while(true);
            $output=file_get_contents($outputFile);$errors=file_get_contents($errorFile);
            if($exit!==0){throw new RuntimeException('Motor local retornou erro '.(int)$exit.'. '.substr(trim($errors),0,1000));}
            $result=json_decode(trim($output),true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)){throw new RuntimeException('Resposta do motor local invalida.');}
            return $result;
        } finally {
            foreach($pipes as $pipe){if(is_resource($pipe)){fclose($pipe);}}
            if(is_resource($process)){if(proc_get_status($process)['running']){proc_terminate($process);}proc_close($process);}
            @unlink($outputFile);@unlink($errorFile);
        }
    }
}
