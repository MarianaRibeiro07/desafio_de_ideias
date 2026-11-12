<?php
declare(strict_types=1);

// Mede tempo, tamanho e memoria de /api/bootstrap e /api/reports com volume inflado.
// Trabalha numa copia do banco em pasta temporaria; o banco real nao e alterado.
// Uso: php bin/medir-volume.php N   (N = total de tickets desejado, ex.: 1000)
require dirname(__DIR__).'/src/App.php';

$alvo=(int)($argv[1]??0);
if($alvo<1){fwrite(STDERR,"Uso: php bin/medir-volume.php N\n");exit(2);}
$storage=getenv('CTI_STORAGE_PATH')?:dirname(__DIR__).'/storage';
$origem=getenv('CTI_DB_PATH')?:$storage.'/cti.sqlite';
if(!is_file($origem)){fwrite(STDERR,"Banco nao encontrado em $origem. Rode php bin/console.php init.\n");exit(2);}
$dir=sys_get_temp_dir().'/cti-volume-'.$alvo;
if(!is_dir($dir)){mkdir($dir,0700,true);}
copy($origem,$dir.'/cti.sqlite');

$pdo=new PDO('sqlite:'.$dir.'/cti.sqlite');
$app=new Cti\App($pdo,$dir);
$app->initialize();
$tickets=$pdo->query('SELECT * FROM tickets')->fetchAll(PDO::FETCH_ASSOC);
$feedbacks=[];
foreach($pdo->query('SELECT * FROM feedbacks')->fetchAll(PDO::FETCH_ASSOC) as $f){$feedbacks[$f['ticket_id']][]=$f;}
if(!$tickets){fwrite(STDERR,"Banco sem tickets para replicar.\n");exit(2);}

$copiar=function(string $tabela,array $linha,array $troca) use($pdo): string {
    unset($linha['id']);
    foreach($troca as $k=>$v){$linha[$k]=$v;}
    $cols=array_keys($linha);
    $pdo->prepare("INSERT INTO $tabela(".implode(',',$cols).') VALUES('.implode(',',array_fill(0,count($cols),'?')).')')->execute(array_values($linha));
    return $pdo->lastInsertId();
};
$total=(int)$pdo->query('SELECT COUNT(*) FROM tickets')->fetchColumn();
$pdo->beginTransaction();
for($i=0;$total<$alvo;$i++,$total++){
    $t=$tickets[$i%count($tickets)];
    $novo=$copiar('tickets',$t,['protocol'=>"V$i-".$t['protocol']]);
    foreach($feedbacks[$t['id']]??[] as $f){$copiar('feedbacks',$f,['ticket_id'=>$novo,'protocol'=>"V$i-".$f['protocol']]);}
}
$pdo->commit();

$saida=['tickets'=>$total,'feedbacks'=>(int)$pdo->query('SELECT COUNT(*) FROM feedbacks')->fetchColumn()];
foreach(['manager'=>'helena@cti.demo','supervisor'=>'marina@cti.demo','attendant'=>'rafael@cti.demo'] as $perfil=>$email){
    $_SESSION=['user_id'=>$pdo->query("SELECT id FROM users WHERE email='$email'")->fetchColumn(),'csrf_token'=>'medicao'];
    foreach(['/api/bootstrap','/api/reports'] as $rota){
        $ini=hrtime(true);
        $r=$app->handle('GET',$rota,[],[],[]);
        $saida[$perfil][$rota]=['ms'=>(int)round((hrtime(true)-$ini)/1e6),'mb'=>round(strlen(json_encode($r['body']))/1048576,2)];
    }
}
$saida['pico_memoria_mb']=(int)round(memory_get_peak_usage(true)/1048576);
echo json_encode($saida,JSON_UNESCAPED_SLASHES),"\n";
