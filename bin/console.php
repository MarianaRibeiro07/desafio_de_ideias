<?php
declare(strict_types=1);

require dirname(__DIR__).'/src/App.php';
require dirname(__DIR__).'/src/AnalysisWorker.php';
$command=$argv[1]??'help';
if(!in_array($command,['init','maintenance','analysis:once','analysis:work','redact','backup'],true)){echo "Uso: php bin/console.php init|maintenance|analysis:once|analysis:work|redact|backup [--now ISO8601] [--feedback=ID] [--dir=PATH] [--keep=N]\n";exit($command==='help'?0:1);}
try {
    $app=\Cti\App::open();
    if($command==='init'){echo "Banco inicializado. Base de demonstracao preservada se ja existir.\n";exit(0);}
    if($command==='redact'){
        $id=null;foreach($argv as $arg){if(preg_match('/^--feedback=(\d+)$/',$arg,$m)){$id=(int)$m[1];}}
        if($id===null||$id<1){throw new RuntimeException('Informe o feedback: php bin/console.php redact --feedback=ID');}
        echo json_encode($app->redactFeedback($id),JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
        exit(0);
    }
    if($command==='backup'){
        $dir=(getenv('CTI_STORAGE_PATH')?:dirname(__DIR__).'/storage').'/backups';$keep='30';
        foreach($argv as $arg){if(preg_match('/^--dir=(.+)$/',$arg,$m)){$dir=$m[1];}if(preg_match('/^--keep=(.*)$/',$arg,$m)){$keep=$m[1];}}
        if(!ctype_digit($keep)||(int)$keep<1){throw new RuntimeException('--keep deve ser um inteiro maior ou igual a 1.');}
        $result=$app->backup($dir,(int)$keep);
        printf("Backup criado: %s (%s)
",$result['path'],$result['bytes']>=1048576?round($result['bytes']/1048576,1).' MB':($result['bytes']>=1024?round($result['bytes']/1024,1).' KB':$result['bytes'].' B'));
        if($result['removed']){echo 'Removidos pela retencao: '.implode(', ',$result['removed'])."
";}
        exit(0);
    }
    if(str_starts_with($command,'analysis:')){
        $worker=new \Cti\AnalysisWorker($app->db(),getenv('CTI_STORAGE_PATH')?:dirname(__DIR__).'/storage');
        do {
            $app->maintenance();
            $result=$worker->processOne();
            if($result!==null || $command==='analysis:once'){echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";}
            if($command==='analysis:once'){exit(($result['status']??null)==='failed'?1:0);}
            if($result===null){sleep(2);}
        }while(true);
    }
    $now=null;foreach($argv as $i=>$arg){if($arg==='--now'){if(!isset($argv[$i+1])){throw new RuntimeException('Informe data ISO8601 apos --now.');}$now=new DateTimeImmutable($argv[$i+1]);}}
    echo json_encode($app->maintenance($now),JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT)."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
