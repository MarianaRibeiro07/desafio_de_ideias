<?php
declare(strict_types=1);

require dirname(__DIR__).'/src/App.php';
require dirname(__DIR__).'/src/AnalysisWorker.php';
$command=$argv[1]??'help';
if(!in_array($command,['init','maintenance','analysis:once','analysis:work'],true)){echo "Uso: php bin/console.php init|maintenance|analysis:once|analysis:work [--now ISO8601]\n";exit($command==='help'?0:1);}
try {
    $app=\Cti\App::open();
    if($command==='init'){echo "Banco inicializado. Base de demonstracao preservada se ja existir.\n";exit(0);}
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
