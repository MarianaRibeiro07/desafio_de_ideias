<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';

use Cti\App;

$path = sys_get_temp_dir() . '/cti-test-' . bin2hex(random_bytes(6)) . '.sqlite';
$testStorage = $path . '-storage';
$app = new App(new PDO('sqlite:' . $path), $testStorage);
$app->initialize();
$_SESSION = [];
$checks = 0;
function check(bool $condition, string $message): void {
    global $checks;
    if (!$condition) { throw new RuntimeException($message); }
    $checks++;
    echo "PASS $message\n";
}
function req(string $method, string $path, array $body = [], array $query = [], array $files = []): array {
    global $app;
    if ($method !== 'GET') { $_SERVER['HTTP_X_CSRF_TOKEN'] = $_SESSION['csrf_token'] ?? ''; }
    return $app->handle($method, $path, $body, $query, $files);
}
function login(string $email): void {
    req('GET', '/api/session');
    $r = req('POST', '/api/login', ['email' => $email, 'password' => 'CtiDemo2026!']);
    check($r['status'] === 200, "Login $email");
}
try {
    $session = req('GET', '/api/session');
    check($session['body']['data']['user'] === null, 'Sessao anonima sem usuario');
    $_SERVER['HTTP_X_CSRF_TOKEN'] = 'invalid';
    $csrf = $app->handle('POST', '/api/login', ['email' => 'rafael@cti.demo', 'password' => 'CtiDemo2026!']);
    check($csrf['status'] === 419, 'CSRF invalido bloqueado');
    check(req('POST', '/api/login', ['email' => 'rafael@cti.demo', 'password' => 'wrong'])['status'] === 401, 'Senha incorreta bloqueada');
    login('rafael@cti.demo');
    $boot = req('GET', '/api/bootstrap')['body']['data'];
    check(count($boot['tickets']) >= 6, 'Seed possui atendimentos do atendente');
    check(count(array_filter($boot['tickets'], fn($t) => $t['attendant_id'] !== $boot['user']['id'])) === 0, 'Atendente so enxerga proprios tickets');
    $new = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Falha no acesso VPN', 'channel' => 'Portal', 'response_due_at' => '2026-11-06T12:00:00-03:00', 'category_id' => 1]);
    check($new['status'] === 201, 'Registro de atendimento persistido');
    $id = $new['body']['data']['id'];
    check(req('PATCH', "/api/tickets/$id", ['status' => 'resolved'])['status'] === 422, 'Status nao aceita alteracao direta');
    check(req('PATCH', "/api/tickets/$id", ['subject' => 'Falha no acesso VPN corporativo'])['status'] === 200, 'Edicao de dados sem mudar status');
    check(req('POST', "/api/tickets/$id/reply", ['message' => 'Recebemos seu contato e estamos verificando a conexao.'])['status'] === 200, 'Atendente envia resposta sem alterar status');
    check(req('POST', "/api/tickets/$id/solution", ['solution' => 'curta'])['status'] === 422, 'Solucao incompleta bloqueada');
    $sent = req('POST', "/api/tickets/$id/solution", ['solution' => 'Credenciais da VPN renovadas e conexao validada.']);
    check($sent['status'] === 200 && $sent['body']['data']['status'] === 'awaiting_feedback', 'Solucao aguarda confirmacao sem fechar');
    check(req('POST', "/api/tickets/$id/solution", ['solution' => 'Nova tentativa sem autorizacao.'])['status'] === 409, 'Segunda mudanca manual bloqueada');
    $pdo = $app->db();
    $other = (int) $pdo->query('SELECT id FROM tickets WHERE attendant_id <> 1 AND client_id <> 1 LIMIT 1')->fetchColumn();
    check(req('PATCH', "/api/tickets/$other", ['subject' => 'Alteracao indevida'])['status'] === 403, 'Edicao de ticket de outro atendente bloqueada');
    login('lucas@cti.demo');
    $clientTicket = array_values(array_filter(req('GET', '/api/bootstrap')['body']['data']['tickets'], fn($t) => $t['id'] === $id))[0];
    check(str_contains($clientTicket['replies'][0]['message'] ?? '', 'verificando a conexao'), 'Cliente consegue ler resposta enviada pelo atendente');
    check(req('POST', '/api/tickets', ['client_id' => 1])['status'] === 403, 'Cliente nao registra ticket como atendente');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $other, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 403, 'Cliente nao avalia ticket alheio');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'text', 'text' => str_repeat('a', 501)])['status'] === 422, 'Limite de 500 caracteres aplicado no servidor');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'text', 'text' => "1\n2\n3\n4\n5\n6"])['status'] === 422, 'Limite de cinco linhas aplicado no servidor');
    $feedback = req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'quick']);
    check($feedback['status'] === 201, 'Feedback rapido sem link nem texto');
    check($pdo->query("SELECT status FROM tickets WHERE id=$id")->fetchColumn() === 'resolved', 'Apenas confirmacao do cliente resolve atendimento');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 409, 'Feedback duplicado bloqueado');
    check(req('GET', '/api/reports')['status'] === 403, 'Cliente nao acessa relatorios internos');
    login('rafael@cti.demo');
    $negative = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'VPN continua falhando', 'channel' => 'Portal', 'response_due_at' => '2026-11-06T12:00:00-03:00'])['body']['data']['id'];
    req('POST', "/api/tickets/$negative/solution", ['solution' => 'Reconfiguracao do cliente VPN executada.']);
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $negative, 'rating' => 1, 'resolved' => false, 'mode' => 'text', 'text' => 'Continua sem funcionar e minha operacao esta parada.'])['status'] === 201, 'Cliente informa problema nao resolvido');
    $app->maintenance(new DateTimeImmutable('+4 days'));
    check($pdo->query("SELECT status FROM tickets WHERE id=$negative")->fetchColumn() === 'active', 'Negativa impede fechamento por timeout');
    login('marina@cti.demo');
    check(req('POST', "/api/tickets/$negative/retry", ['solution' => 'Perfil VPN recriado com rotas corretas.', 'justification' => 'O cliente confirmou que a primeira tentativa nao funcionou.'])['status'] === 200, 'Supervisor envia nova solucao justificada apos rejeicao');
    check((int)$pdo->query("SELECT manual_status_changes FROM tickets WHERE id=$negative")->fetchColumn() === 1, 'Nova tentativa supervisor preserva limite do atendente');
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $negative, 'rating' => 4, 'resolved' => true, 'mode' => 'quick'])['status'] === 201, 'Cliente pode avaliar nova tentativa sem perder feedback anterior');
    check((int)$pdo->query("SELECT COUNT(*) FROM feedbacks WHERE ticket_id=$negative")->fetchColumn() === 2, 'Historico preserva feedback das duas tentativas');
    login('rafael@cti.demo');
    $pending = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Retorno pendente', 'channel' => 'Portal', 'response_due_at' => '2026-11-06T12:00:00-03:00'])['body']['data']['id'];
    req('POST', "/api/tickets/$pending/solution", ['solution' => 'Conexao restabelecida e teste registrado.']);
    $deadline = new DateTimeImmutable($pdo->query("SELECT feedback_deadline FROM tickets WHERE id=$pending")->fetchColumn());
    $app->maintenance($deadline->modify('-1 minute'));
    check($pdo->query("SELECT status FROM tickets WHERE id=$pending")->fetchColumn() === 'awaiting_feedback', '71h59 nao fecha atendimento');
    $app->maintenance($deadline);
    check($pdo->query("SELECT status FROM tickets WHERE id=$pending")->fetchColumn() === 'closed_no_response', '72h fecha sem retorno sem contar como resolvido');
    $report = req('GET', '/api/reports')['body']['data'];
    check($report['total_tickets'] > 0 && $report['closed_no_response'] >= 1, 'Relatorio diferencia sem retorno de resolvido');
    check(req('GET', '/api/reports', [], ['team_id' => 2])['body']['data']['total_tickets'] === 0, 'Filtro nao amplia escopo do atendente');
    $expired = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Confirmacao enviada apos prazo', 'channel' => 'Portal', 'response_due_at' => '2026-11-06T12:00:00-03:00'])['body']['data']['id'];
    req('POST', "/api/tickets/$expired/solution", ['solution' => 'Conexao restabelecida e validada pela equipe.']);
    $pdo->exec("UPDATE tickets SET feedback_deadline='2020-01-01T00:00:00+00:00' WHERE id=$expired");
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $expired, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 409, 'Feedback vencido bloqueado sem consulta previa ao portal');
    check($pdo->query("SELECT status FROM tickets WHERE id=$expired")->fetchColumn() === 'closed_no_response', 'Envio apos prazo encerra como sem retorno');
    check((int)$pdo->query("SELECT COUNT(*) FROM feedbacks WHERE ticket_id=$expired")->fetchColumn() === 0, 'Envio vencido nao registra avaliacao nem resolucao');
    login('rafael@cti.demo');
    check(req('GET', '/api/cases', [], ['q' => 'VPN'])['body']['data'] !== [], 'Autocomplete busca cases reais no banco');
    $cloudCases = req('GET', '/api/cases', [], ['q' => 'nuvem'])['body']['data'];
    check(count(array_filter($cloudCases, fn($c) => $c['category_id'] === 1 || stripos($c['solution'], 'VPN') !== false)) === 0, 'Cases de nuvem nao sugerem credenciais VPN');
    $audioTicket = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Gravacao de feedback VPN', 'channel' => 'Portal', 'response_due_at' => '2026-11-06T12:00:00-03:00'])['body']['data']['id'];
    req('POST', "/api/tickets/$audioTicket/solution", ['solution' => 'Tunel VPN reconfigurado e conexao restabelecida.']);
    login('lucas@cti.demo');
    $wavPath = tempnam(sys_get_temp_dir(), 'cti-wav-');
    $writeWav = static function(int $seconds) use ($wavPath): void {
        $data = str_repeat("\0", 16000 * $seconds);
        file_put_contents($wavPath, 'RIFF'.pack('V',36+strlen($data)).'WAVEfmt '.pack('VvvVVvv',16,1,1,8000,16000,2,16).'data'.pack('V',strlen($data)).$data);
        clearstatcache(true, $wavPath);
    };
    $writeWav(61);
    $files = ['audio' => ['tmp_name' => $wavPath, 'error' => 0, 'name' => 'gravacao.wav']];
    $audioBody = ['ticket_id' => $audioTicket, 'rating' => 5, 'resolved' => '1', 'mode' => 'audio'];
    check(req('POST', '/api/feedbacks', $audioBody, [], $files)['status'] === 422, 'Servidor rejeita WAV real com mais de 60 segundos');
    $writeWav(60);
    check(req('POST', '/api/feedbacks', [...$audioBody, 'text' => 'conteudo adicional'], [], $files)['status'] === 422, 'Servidor impede audio e texto no mesmo feedback');
    $audioResponse = req('POST', '/api/feedbacks', $audioBody, [], $files);
    check($audioResponse['status'] === 201, 'Gravacao WAV de 60 segundos recebida');
    $audioId = $audioResponse['body']['data']['id'];
    check(req('GET', "/api/feedbacks/$audioId/audio")['status'] === 200, 'Cliente acessa propria gravacao autenticado');
    login('ana@cti.demo');
    check(req('GET', "/api/feedbacks/$audioId/audio")['status'] === 403, 'Audio privado nao pode ser ouvido por outro cliente');
    @unlink($wavPath);
    login('marina@cti.demo');
    $otherTeamTicket = (int)$pdo->query('SELECT id FROM tickets WHERE team_id=2 LIMIT 1')->fetchColumn();
    $otherTeamFeedback = (int)$pdo->query('SELECT f.id FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE t.team_id=2 LIMIT 1')->fetchColumn();
    check(req('GET', "/api/tickets/$otherTeamTicket/cases")['status'] === 403, 'Supervisor nao acessa atendimento de outra equipe');
    check(req('POST', "/api/feedbacks/$otherTeamFeedback/review", ['sentiment' => 'positive', 'criticality' => 'regular', 'justification' => 'Revisao fora da equipe deve ser bloqueada.', 'action' => 'Tentativa de alteracao indevida.'])['status'] === 403, 'Supervisor nao revisa feedback de outra equipe');
    $supervisorBoot = req('GET', '/api/bootstrap')['body']['data'];
    check(count(array_filter($supervisorBoot['notifications'], fn($n) => $n['type'] === 'critical')) >= 1, 'Supervisor recebe alerta de criticos ainda sem revisao');
    check(count(array_filter($supervisorBoot['tickets'], fn($t) => $t['team_id'] !== 1)) === 0, 'Supervisor enxerga somente tickets da equipe');
    check(req('GET', '/api/reports', [], ['team_id' => 2])['body']['data']['total_tickets'] === 0, 'Filtro outra equipe nao amplia acesso do supervisor');
    $fid = $feedback['body']['data']['id'];
    check(req('POST', "/api/feedbacks/$fid/review", ['sentiment' => 'positive', 'criticality' => 'regular', 'justification' => 'Conferencia com o retorno do cliente.', 'action' => 'Registro validado pela supervisao.'])['status'] === 200, 'Supervisor revisa feedback da equipe com historico');
    login('helena@cti.demo');
    check(req('POST', "/api/tickets/$id/reply", ['message' => 'Acesso de escrita indevido.'])['status'] === 403, 'Gestor possui leitura sem operar atendimento');
    check(count(req('GET', '/api/reports')['body']['data']['teams']) === 2, 'Gestor compara as duas equipes');
    $export = req('GET', '/api/reports/export');
    check($export['status'] === 200 && str_contains($export['headers']['Content-Type'], 'text/csv'), 'Exportacao CSV disponivel');
    $pdo->exec("UPDATE tickets SET subject='=HYPERLINK(1)' WHERE id=$pending");
    check(str_contains(req('GET', '/api/reports/export')['raw'], "'=HYPERLINK(1)"), 'Exportacao neutraliza formula de planilha');
    $pdo->exec("UPDATE tickets SET created_at='2020-01-01T00:00:00+00:00' WHERE id=$id");
    $today = gmdate('Y-m-d');
    check(req('GET', '/api/reports', [], ['from' => $today, 'to' => $today, 'client_id' => 1, 'q' => 'Falha no acesso VPN corporativo'])['body']['data']['received'] === 1, 'Periodo de feedback usa recebimento mesmo em atendimento antigo');
    $pdo->exec("UPDATE feedbacks SET created_at='2024-01-01T00:00:00+00:00' WHERE id=$fid");
    $privateAudio = $pdo->query("SELECT audio_path FROM feedbacks WHERE id=$audioId")->fetchColumn();
    $pdo->exec("UPDATE feedbacks SET created_at='2024-01-01T00:00:00+00:00' WHERE id=$audioId");
    $app->maintenance();
    check($pdo->query("SELECT text FROM feedbacks WHERE id=$fid")->fetchColumn() === null, 'Retencao remove conteudo antigo');
    check($pdo->query("SELECT justification FROM reviews WHERE feedback_id=$fid")->fetchColumn() === null, 'Retencao remove texto da revisao antiga');
    check(!is_file($testStorage . '/audio/' . $privateAudio), 'Retencao apaga arquivo privado de audio antigo');
    check($pdo->query("SELECT audio_path FROM feedbacks WHERE id=$audioId")->fetchColumn() === null, 'Retencao remove referencia de audio antigo');
    echo "\n$checks verificacoes aprovadas.\n";
} finally {
    unset($app, $pdo);
    @unlink($path);
    @unlink($path . '-wal');
    @unlink($path . '-shm');
    foreach (glob($testStorage . '/audio/*.wav') ?: [] as $file) { @unlink($file); }
    @rmdir($testStorage . '/audio');
    @rmdir($testStorage);
}
