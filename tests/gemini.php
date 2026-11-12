<?php
declare(strict_types=1);

require dirname(__DIR__).'/src/GeminiAnalyzer.php';

use Cti\GeminiAnalyzer;

$checks=0;
$calls=[];
$secret='chave-ficticia-nao-usar-na-rede';
$original=[];
foreach(['CTI_GEMINI_API_KEY','CTI_GEMINI_MODEL','CTI_GEMINI_TIMEOUT'] as $name){$original[$name]=getenv($name);putenv($name);}
putenv('CTI_GEMINI_API_KEY='.$secret);
function check(bool $ok,string $message): void {global $checks;if(!$ok){throw new RuntimeException($message);}echo "PASS $message\n";$checks++;}
function fails(callable $run,string $fragment): string {
    try{$run();}catch(RuntimeException $e){check(str_contains($e->getMessage(),$fragment),'Falha controlada: '.$fragment);return $e->getMessage();}
    throw new RuntimeException('Era esperada uma falha: '.$fragment);
}
function payload(array $changes=[]): array {return [...['transcript'=>null,'sentiment'=>'negative','summary'=>'Cliente relata falha recorrente de VPN.','topics'=>['Conectividade'],'evidence'=>['A VPN caiu de novo.'],'criticality'=>'critical'],...$changes];}
function response(array $data=[],string $finish='STOP'): array {return ['status'=>200,'body'=>json_encode(['candidates'=>[['finishReason'=>$finish,'content'=>['parts'=>[['text'=>json_encode($data?:payload(),JSON_THROW_ON_ERROR)]]]]]],JSON_THROW_ON_ERROR)];}
$mock=function(array $request) use (&$calls): array {$calls[]=$request;return response();};
$sample=tempnam(sys_get_temp_dir(),'cti-gemini-');
try {
    $analyzer=new GeminiAnalyzer($mock);
    $result=$analyzer->analyze(['text'=>'A VPN caiu de novo.','audio_path'=>null]);
    check(count($calls)===1 && $result['sentiment']==='negative' && $result['criticality']==='critical','Texto gera uma unica requisicao e devolve classificacao');
    check($result['confidence']===null && $result['analysis_source']==='gemini_api' && $result['transcription_model']===null,'Gemini se identifica sem inventar score nem transcricao');
    $request=$calls[0];$body=json_decode($request['body'],true,512,JSON_THROW_ON_ERROR);
    check($request['url']==='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent' && !str_contains($request['url'],$secret),'Dominio fixo Google com chave fora da URL');
    check(in_array('x-goog-api-key: '.$secret,$request['headers'],true) && $request['timeout']<=45,'Chave no cabecalho e espera limitada');
    check($body['generationConfig']['responseMimeType']==='application/json' && $body['generationConfig']['candidateCount']===1 && $body['generationConfig']['maxOutputTokens']<=2048,'JSON estruturado com uma resposta e teto de tokens');
    check($body['generationConfig']['responseJsonSchema']['properties']['sentiment']['enum']===['positive','neutral','negative'] && !isset($body['generationConfig']['responseJsonSchema']['properties']['confidence']),'Schema limita classes e nao pede percentual de confianca');
    check(str_contains($body['systemInstruction']['parts'][0]['text'],'dados') && $body['contents'][0]['parts'][0]['text']==='A VPN caiu de novo.','Relato fica separado da instrucao de sistema');
    $wave='RIFF'.pack('V',36+3200).'WAVEfmt '.pack('VvvVVvv',16,1,1,16000,32000,2,16).'data'.pack('V',3200).str_repeat("\x01\x00",1600);
    file_put_contents($sample,$wave);
    $audioCalls=[];
    $audio=new GeminiAnalyzer(function(array $request) use (&$audioCalls): array {$audioCalls[]=$request;return response(payload(['transcript'=>'A VPN caiu de novo.']));});
    $audioResult=$audio(['text'=>null,'audio_path'=>$sample]);
    $audioBody=json_decode($audioCalls[0]['body'],true,512,JSON_THROW_ON_ERROR);
    $inline=$audioBody['contents'][0]['parts'][1]['inlineData'];
    check($inline['mimeType']==='audio/wav' && base64_decode($inline['data'],true)===$wave && !str_contains($audioCalls[0]['body'],$sample),'Audio segue inline sem publicar o caminho privado');
    check($audioResult['transcript']==='A VPN caiu de novo.' && $audioResult['transcription_model']==='gemini-3.5-flash-lite','Audio preserva transcricao e identifica modelo');
    $before=count($calls);
    fails(fn()=>$analyzer(['text'=>'texto','audio_path'=>$sample]),'texto ou audio');
    fails(fn()=>$analyzer(['text'=>'   ','audio_path'=>null]),'texto ou audio');
    fails(fn()=>$analyzer(['text'=>str_repeat('a',501),'audio_path'=>null]),'500');
    check(count($calls)===$before,'Entradas invalidas nao consomem chamadas');
    file_put_contents($sample,'nao e WAV');
    fails(fn()=>$audio(['text'=>null,'audio_path'=>$sample]),'WAV');
    check(count($audioCalls)===1,'Audio invalido e recusado antes da API');
    $quotaCalls=0;
    $quota=new GeminiAnalyzer(function() use (&$quotaCalls,$secret): array {$quotaCalls++;return ['status'=>429,'body'=>json_encode(['error'=>['message'=>$secret]])];});
    $message=fails(fn()=>$quota(['text'=>'A VPN caiu de novo.']),'cota');
    check($quotaCalls===1 && !str_contains($message,$secret),'429 nao repete chamada nem expoe resposta do provedor');
    foreach([401=>'credencial',403=>'credencial',500=>'indisponivel',503=>'indisponivel'] as $status=>$fragment){
        $failing=new GeminiAnalyzer(fn()=>['status'=>$status,'body'=>$secret]);
        $message=fails(fn()=>$failing(['text'=>'texto']),$fragment);
        check(!str_contains($message,$secret),'Erro HTTP '.$status.' preserva segredo');
    }
    $transportError=new GeminiAnalyzer(fn()=>throw new RuntimeException('erro privado '.$secret));
    $message=fails(fn()=>$transportError(['text'=>'texto']),'conexao');
    check(!str_contains($message,$secret),'Erro de transporte nao vaza detalhe tecnico');
    foreach([
        ['status'=>200,'body'=>'JSON quebrado'],
        response(payload(),'MAX_TOKENS'),
        response(payload(),'SAFETY'),
        ['status'=>200,'body'=>json_encode(['promptFeedback'=>['blockReason'=>'SAFETY']])],
        response(payload(['sentiment'=>'angry'])),
        response(payload(['topics'=>'Conectividade'])),
        response(payload(['evidence'=>['trecho que nao existe no relato']])),
        response(payload(['summary'=>str_repeat('a',1001)])),
        response(payload(['transcript'=>'Transcricao inventada no texto.'])),
    ] as $bad){
        $invalid=new GeminiAnalyzer(fn()=>$bad);
        fails(fn()=>$invalid(['text'=>'A VPN caiu de novo.']),'resposta');
    }
    $noTranscript=new GeminiAnalyzer(fn()=>response());
    file_put_contents($sample,$wave);
    fails(fn()=>$noTranscript(['audio_path'=>$sample]),'transcricao');
    putenv('CTI_GEMINI_API_KEY');
    fails(fn()=>$analyzer(['text'=>'texto']),'chave');
    putenv('CTI_GEMINI_API_KEY='.$secret);
    putenv('CTI_GEMINI_MODEL=../servidor-externo');
    fails(fn()=>$analyzer(['text'=>'texto']),'modelo');
    putenv('CTI_GEMINI_MODEL=gemini-outro-modelo');putenv('CTI_GEMINI_TIMEOUT=999');
    $analyzer(['text'=>'A VPN caiu de novo.']);
    check(str_ends_with($calls[array_key_last($calls)]['url'],'/gemini-outro-modelo:generateContent') && $calls[array_key_last($calls)]['timeout']===45,'Modelo e configuravel e timeout respeita o teto');
    echo "\n$checks verificacoes Gemini aprovadas sem rede.\n";
} finally {
    @unlink($sample);
    foreach($original as $name=>$value){putenv($value===false?$name:$name.'='.$value);}
}
